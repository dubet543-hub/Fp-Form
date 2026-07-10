/**
 * Email delivery for booking PDFs, via the cpgh.in SMTP mail server.
 *
 * All connection details come from backend/.env (see .env.example):
 *   SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, MAIL_FROM,
 *   and one MAIL_RECIPIENTS_<BRANCH> list per venue (see BRANCH_CONFIG below).
 *
 * If SMTP is not configured, sending is skipped with a warning so that
 * booking creation itself never fails because of mail problems.
 */

const nodemailer = require('nodemailer');
const { renderBookingPdf } = require('./pdf');

function parseList(envVal) {
  return (envVal || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// One entry per branch: display name, MAIL_RECIPIENTS_* env var name, and a
// fallback recipient list used only if that env var isn't set.
const BRANCH_CONFIG = {
  Amravti: {
    name: 'Centre Point Amravti',
    envVar: 'MAIL_RECIPIENTS_AMRAVTI',
    // MAIL_RECIPIENTS is kept as a legacy alias for Amravti's recipients.
    legacyEnvVar: 'MAIL_RECIPIENTS',
    defaultRecipients: [],
  },
  Nagpur: {
    name: 'Centre Point Nagpur',
    envVar: 'MAIL_RECIPIENTS_NAGPUR',
    defaultRecipients: [
      'cfo@cpgh.in',
      'sales2.nagpur@cpgh.in',
      'exechef.nagpur@cpgh.in',
      'accounts@centrepointnagpur.com',
      'fnbcontroller.nagpur@cpgh.in',
      'fnb.nagpur@cpgh.in',
      'gm.nagpur@cpgh.in',
      'angadh.arora@cpgh.in',
      'arjun.arora@cpgh.in',
      'do@cpgh.in',
      'ea@cpgh.in',
    ],
  },
  Pablo: {
    name: 'Pablo - The Art Cafe',
    envVar: 'MAIL_RECIPIENTS_PABLO',
    defaultRecipients: [
      'rm.pablo@cpgh.in',
      'chef.ufo@cpgh.in',
      'accounts.ufo@cpgh.in',
      'fo.units1@cpgh.in',
      'angadh.arora@cpgh.in',
      'arjun.arora@cpgh.in',
      'fnbcontroller.nagpur@cpgh.in',
      'digital@cpgh.in',
    ],
  },
  NaviMumbai: {
    name: 'Centre Point Navi Mumbai',
    envVar: 'MAIL_RECIPIENTS_NAVIMUMBAI',
    defaultRecipients: [
      'gm.navimumbai@cpgh.in',
      'fnb.navimumbai@cpgh.in',
      'exe.navimumbai@cpgh.in',
      'accounts.navimumbai@cpgh.in',
      'fo.units1@cpgh.in',
      'angadh.arora@cpgh.in',
      'arjun.arora@cpgh.in',
      'fnbcontroller.nagpur@cpgh.in',
      'digital@cpgh.in',
    ],
  },
  Dali: {
    name: 'Dali',
    envVar: 'MAIL_RECIPIENTS_DALI',
    defaultRecipients: [
      'dali@cpgh.in',
      'natasha.arora@cpgh.in',
      'accounts.dali@cpgh.in',
      'fo.units1@cpgh.in',
      'angadh.arora@cpgh.in',
      'arjun.arora@cpgh.in',
      'fnbcontroller.nagpur@cpgh.in',
      'digital@cpgh.in',
    ],
  },
};

const RECIPIENTS_BY_BRANCH = {};
for (const [branch, cfg] of Object.entries(BRANCH_CONFIG)) {
  const envVal = process.env[cfg.envVar] || (cfg.legacyEnvVar && process.env[cfg.legacyEnvVar]);
  RECIPIENTS_BY_BRANCH[branch] = envVal ? parseList(envVal) : cfg.defaultRecipients;
}

// Kept for backward compatibility (e.g. anything importing RECIPIENTS directly).
const RECIPIENTS = RECIPIENTS_BY_BRANCH.Amravti;
const RECIPIENTS_AMRAVTI = RECIPIENTS_BY_BRANCH.Amravti;
const RECIPIENTS_NAGPUR = RECIPIENTS_BY_BRANCH.Nagpur;
const RECIPIENTS_PABLO = RECIPIENTS_BY_BRANCH.Pablo;

function recipientsFor(branch) {
  return RECIPIENTS_BY_BRANCH[branch] || RECIPIENTS_BY_BRANCH.Amravti;
}

function venueName(branch) {
  return (BRANCH_CONFIG[branch] || BRANCH_CONFIG.Amravti).name;
}

let transporter = null;

function isConfigured(branch) {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && recipientsFor(branch).length);
}

function getTransporter() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    // secure=true for port 465 (implicit TLS); false uses STARTTLS on 587.
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transporter;
}

/**
 * Generate the booking PDF and email it to the internal distribution list.
 * Resolves to a summary; never throws (errors are caught and logged) so the
 * caller can fire-and-forget without risking an unhandled rejection.
 *
 * @param {object} booking  a plain booking object (Booking.toJSON()).
 */
async function sendBookingEmail(booking) {
  const series = booking.series_no || String(booking.id ?? booking.seq ?? '');
  const recipients = recipientsFor(booking.branch);
  if (!isConfigured(booking.branch)) {
    console.warn(
      `[mail] SMTP not configured — skipped emailing booking ${series}. ` +
        'Set SMTP_HOST/SMTP_USER/SMTP_PASS and the branch\'s MAIL_RECIPIENTS_* in backend/.env.'
    );
    return { sent: false, reason: 'not-configured' };
  }

  try {
    const pdf = await renderBookingPdf(booking);
    const fileName = `Booking-${series}-${(booking.party_name || 'party')
      .replace(/[^\w\-]+/g, '_')
      .slice(0, 40)}.pdf`;

    const info = await getTransporter().sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to: recipients,
      subject: `Function Booking ${series} — ${booking.party_name || ''} (${booking.date || ''})`.trim(),
      text: bookingSummaryText(booking, series),
      attachments: [{ filename: fileName, content: pdf, contentType: 'application/pdf' }],
    });

    console.log(`[mail] Booking ${series} emailed to ${recipients.length} recipients (id: ${info.messageId})`);
    return { sent: true, messageId: info.messageId, recipients: recipients.length };
  } catch (err) {
    console.error(`[mail] Failed to email booking ${series}: ${err.message}`);
    return { sent: false, reason: err.message };
  }
}

function bookingSummaryText(b, series) {
  const line = (label, v) => (v ? `${label}: ${v}` : null);
  return [
    `A new function booking has been recorded at ${venueName(b.branch)}.`,
    ``,
    line('Booking No', series),
    line('Reservation No', b.reservation_no),
    line('Date', b.date),
    line('Time', b.time),
    line('Type', b.function_type),
    line('Venue', b.venue),
    line('Time Slot', b.time_slot),
    line('Expected Pax', b.expected_pax),
    line('Party', b.party_name),
    line('Company', b.company_name),
    line('Contact', b.contact_person),
    line('Telephone', b.telephone),
    line('Submitted by', b.submitted_by),
    ``,
    `The full details are attached as a PDF.`,
  ]
    .filter((l) => l !== null)
    .join('\n');
}

module.exports = {
  sendBookingEmail,
  isConfigured,
  RECIPIENTS,
  RECIPIENTS_AMRAVTI,
  RECIPIENTS_NAGPUR,
  RECIPIENTS_PABLO,
  RECIPIENTS_BY_BRANCH,
};
