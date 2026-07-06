/**
 * Amravti FP — Backend API (Express + MongoDB/Mongoose).
 *
 * A JSON API for the Centre Point Amravti Function Booking Form. The frontend
 * (in ../frontend) is served as static files from this same server, so the
 * session cookie is same-origin and no CORS setup is needed.
 *
 * Storage: MongoDB via Mongoose (connection from backend/.env → MONGODB_URI).
 * Auth: a frontend admin logs in; only then can the booking endpoints be used.
 *
 * Default admin (first run only): admin / admin123
 *   Override with ADMIN_USERNAME / ADMIN_PASSWORD.
 */

const path = require('path');
const http = require('http');
// Prefer IPv4 for outbound connections. Some hosts (e.g. Render's free tier)
// have no outbound IPv6 route, so resolving the SMTP host to an IPv6 address
// first causes ENETUNREACH. This forces IPv4-first DNS resolution.
require('dns').setDefaultResultOrder('ipv4first');
// Load environment variables from backend/.env
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const session = require('express-session');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { sendBookingEmail } = require('./mailer');

const PORT = process.env.PORT || 3001;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const SECRET_KEY = process.env.SECRET_KEY || 'change-me-in-production';
const MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/amravti_fp';

// Option lists (also used by the frontend via /api/options).
const OPTIONS = {
  functionTypes: ['Social', 'Corporate'],
  venues: ['Hall', 'Lawn'],
  timeSlots: [
    'Breakfast (08:00 - 12:00)',
    'Lunch (12:00 - 15:00)',
    'Hi-Tea (16:00 - 18:00)',
    'Dinner (19:00 - 00:00)',
  ],
  menus: ['Veg', 'Non-Veg', 'Veg + Non-Veg', 'Jain'],
  paymentModes: ['Cash', 'Card', 'UPI'],
  otherCharges: ['Alcohol', 'DJ', 'AV', 'Other Charges'],
};

const FIELDS = [
  'reservation_no',
  'date', 'time', 'function_type', 'venue', 'mg', 'expected_pax',
  'time_slot', 'menu',
  'party_name', 'company_name', 'gst_no', 'pan_no', 'address',
  'contact_person', 'telephone', 'email', 'seating_arrangement', 'add_on_rooms',
  'rate', 'hall_rent', 'mode_of_payment', 'advance_amt', 'transaction_details',
  'board_to_read', 'other_charges', 'details_amount',
  'billing_instruction', 'housekeeping', 'fnb', 'kitchen',
];

const REQUIRED = [
  'date', 'function_type', 'venue', 'time_slot', 'menu',
  'party_name', 'telephone', 'rate',
];

// --- Mongoose models --------------------------------------------------------

const adminSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password_hash: { type: String, required: true },
});
const Admin = mongoose.model('Admin', adminSchema);

// Atomic counter for the sequential booking series number.
const counterSchema = new mongoose.Schema({
  _id: String,
  seq: { type: Number, default: 0 },
});
const Counter = mongoose.model('Counter', counterSchema);

async function nextSeq(name) {
  const doc = await Counter.findByIdAndUpdate(
    name,
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return doc.seq;
}

// Zero-padded series number, starting at 001 (001, 002, … 999, 1000, …).
function seriesNo(n) {
  return String(n).padStart(3, '0');
}

const bookingSchema = new mongoose.Schema({
  seq: { type: Number, unique: true, index: true }, // public numeric id
  series_no: String,
  reservation_no: String,
  submitted_by: { type: String, required: true },
  date: String, time: String, function_type: String, venue: String,
  mg: String, expected_pax: String, time_slot: String, menu: String,
  party_name: String, company_name: String, gst_no: String, pan_no: String,
  address: String, contact_person: String, telephone: String, email: String,
  seating_arrangement: String, add_on_rooms: String,
  rate: String, hall_rent: String, mode_of_payment: String, advance_amt: String,
  transaction_details: String, board_to_read: String, other_charges: String,
  details_amount: String, billing_instruction: String, housekeeping: String,
  fnb: String, kitchen: String,
  created_at: { type: Date, default: Date.now },
});

// Expose `id` = seq and hide Mongo internals in JSON responses.
bookingSchema.set('toJSON', {
  transform(doc, ret) {
    ret.id = ret.seq;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
const Booking = mongoose.model('Booking', bookingSchema);

// --- App setup --------------------------------------------------------------

const app = express();

// Allow the frontend to call this API with the session cookie. Accept the
// configured origin, local dev, and any *.vercel.app URL (Vercel gives each
// deploy/preview a different subdomain, so a single fixed origin isn't enough).
const corsOrigin = (origin, cb) => {
  if (
    !origin || // same-origin or non-browser (curl, health checks)
    origin === FRONTEND_ORIGIN ||
    /^http:\/\/localhost:\d+$/.test(origin) ||
    /\.vercel\.app$/.test(origin)
  ) {
    return cb(null, true);
  }
  cb(new Error('Not allowed by CORS: ' + origin));
};
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json());
// In production the frontend (Vercel) and backend (Render) are different
// sites, so the session cookie must be SameSite=None + Secure to be sent on
// cross-site API calls. Render terminates TLS at a proxy, so trust it.
const IS_PROD = process.env.NODE_ENV === 'production';
if (IS_PROD) app.set('trust proxy', 1);
app.use(
  session({
    secret: SECRET_KEY,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: IS_PROD ? 'none' : 'lax',
      secure: IS_PROD,
      maxAge: 1000 * 60 * 60 * 8,
    },
  })
);

function authRequired(req, res, next) {
  if (!req.session.adminId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

// Wrap async route handlers so rejections become 500s instead of crashes.
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// Start listening, retrying briefly if the port is momentarily still in use
// (e.g. a --watch restart before the old process fully released it).
function listenWithRetry(server, port, onListen, retries = 20, delayMs = 250) {
  const attempt = (left) => {
    const onError = (err) => {
      if (err.code === 'EADDRINUSE' && left > 0) {
        console.log(`Port ${port} busy — retrying in ${delayMs}ms (${left} left)…`);
        setTimeout(() => attempt(left - 1), delayMs);
      } else {
        console.error(`Failed to bind port ${port}: ${err.message}`);
        process.exit(1);
      }
    };
    server.once('error', onError);
    server.listen(port, () => {
      server.removeListener('error', onError);
      onListen();
    });
  };
  attempt(retries);
}

// --- Auth API ---------------------------------------------------------------

app.post(
  '/api/login',
  wrap(async (req, res) => {
    const username = (req.body.username || '').trim();
    const password = req.body.password || '';

    const admin = await Admin.findOne({ username });
    if (admin && bcrypt.compareSync(password, admin.password_hash)) {
      req.session.adminId = String(admin._id);
      req.session.adminUsername = admin.username;
      return res.json({ ok: true, username: admin.username });
    }
    res.status(401).json({ error: 'Invalid username or password.' });
  })
);

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (req.session.adminId) {
    return res.json({ loggedIn: true, username: req.session.adminUsername });
  }
  res.json({ loggedIn: false });
});

app.get('/api/options', (req, res) => {
  res.json(OPTIONS);
});

// --- Bookings API -----------------------------------------------------------

app.get(
  '/api/bookings',
  authRequired,
  wrap(async (req, res) => {
    const rows = await Booking.find()
      .sort({ seq: -1 })
      .select(
        'seq series_no reservation_no submitted_by date time function_type venue party_name telephone created_at'
      );
    res.json(rows.map((r) => r.toJSON()));
  })
);

app.get(
  '/api/bookings/:id',
  authRequired,
  wrap(async (req, res) => {
    const booking = await Booking.findOne({ seq: Number(req.params.id) });
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    res.json(booking.toJSON());
  })
);

// Extract + validate booking fields from a request body. Shared by create
// and update. `checkPastDate` is only enforced on create (an edit may touch a
// booking whose date has already passed).
function parseBookingBody(body, { checkPastDate }) {
  const data = {};
  for (const key of FIELDS) {
    if (key === 'other_charges') continue;
    data[key] = String(body[key] || '').trim();
  }
  const otherCharges = Array.isArray(body.other_charges)
    ? body.other_charges
    : body.other_charges
    ? [body.other_charges]
    : [];

  const errors = {};
  for (const key of REQUIRED) {
    if (!data[key]) errors[key] = 'This field is required.';
  }
  if (data.email && (!data.email.includes('@') || !data.email.includes('.'))) {
    errors.email = 'Enter a valid email address.';
  }
  if (data.date) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const picked = new Date(data.date + 'T00:00:00');
    if (isNaN(picked.getTime())) {
      errors.date = 'Enter a valid date.';
    } else if (checkPastDate && picked < today) {
      errors.date = 'Date cannot be in the past.';
    }
  }
  return { data, otherCharges, errors };
}

app.post(
  '/api/bookings',
  authRequired,
  wrap(async (req, res) => {
    const { data, otherCharges, errors } = parseBookingBody(req.body || {}, {
      checkPastDate: true,
    });
    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ errors });
    }

    const seq = await nextSeq('bookingSeq');
    const booking = await Booking.create({
      ...data,
      other_charges: otherCharges.join(', '),
      submitted_by: req.session.adminUsername,
      seq,
      series_no: seriesNo(seq),
      created_at: new Date(),
    });

    // Email the booking PDF to the internal distribution list. Fire-and-forget:
    // a mail failure must not fail the booking, which is already saved.
    sendBookingEmail(booking.toJSON());

    res.status(201).json({ id: booking.seq, series_no: booking.series_no });
  })
);

app.put(
  '/api/bookings/:id',
  authRequired,
  wrap(async (req, res) => {
    const booking = await Booking.findOne({ seq: Number(req.params.id) });
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    const { data, otherCharges, errors } = parseBookingBody(req.body || {}, {
      checkPastDate: false,
    });
    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ errors });
    }

    Object.assign(booking, data, { other_charges: otherCharges.join(', ') });
    await booking.save();

    res.json({ id: booking.seq, series_no: booking.series_no });
  })
);

// Health check / root.
app.get('/', (req, res) => {
  res.json({ service: 'amravti-fp-api', ok: true });
});

// --- Startup ----------------------------------------------------------------

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log('✓ MongoDB connected');

  // Seed the admin account if none exists.
  if ((await Admin.countDocuments()) === 0) {
    await Admin.create({
      username: ADMIN_USERNAME,
      password_hash: bcrypt.hashSync(ADMIN_PASSWORD, 10),
    });
    console.log(`Seeded admin "${ADMIN_USERNAME}" (password: ${ADMIN_PASSWORD})`);
  }

  const server = http.createServer(app);
  listenWithRetry(server, PORT, () => {
    console.log(`✓ Server running → port ${PORT} (http://localhost:${PORT})`);
    console.log(`  Allowing frontend origin: ${FRONTEND_ORIGIN}`);
  });
}

main().catch((err) => {
  console.error('Failed to start:', err.message);
  process.exit(1);
});
