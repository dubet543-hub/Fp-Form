# Multi-property Function Booking Form

A multi-venue booking app built with **Node.js (Express)** + **MongoDB
(Mongoose)**. One shared backend and one shared frontend serve Centre Point
Amravati, Centre Point Nagpur, Centre Point Navi Mumbai, Pablo, and Dali.

The user selects a venue on the login page. The backend then applies that
venue's name, login allowlist, booking-data scope, PDF branding, and
email-recipient list.

A **frontend admin login** protects the form: the admin logs in first, and only
then does the **Function Booking Form (FP form)** open. The login is a separate
page — the booking form itself contains **no** "Submitted By / Password" section.
Bookings are validated server-side, stored in MongoDB, and each has a
print-friendly A4 view you can save as a PDF. Every booking gets an
auto-generated series number (`001`, `002`, …) and a timestamp.

## Features

- **Venue-specific admin login** (session-based, credentials kept in backend environment variables)
- The FP form only opens **after** a successful admin login
- Full booking form with sections: Function Prospectus, Party Details, Billing,
  Additional Services, Instructions
- **Save as draft**: park an unfinished form, come back later, add the rest and
  submit it (see *Drafts* below)
- Server-side validation with inline error messages
- Bookings persisted to **MongoDB** via Mongoose
- Auto-incrementing series number (`001`+) via an atomic Mongo counter
- `/submissions` — list of all bookings (login-protected)
- `/booking/:id` — view a booking; `/booking/:id/print` — A4 print / save as PDF
- Logout

## Project structure

**One shared backend plus one shared frontend**: the selected venue code is sent
with every API request, and the backend enforces the corresponding profile.

- **Backend API** → `http://localhost:3001` (Express + Mongoose + MongoDB)
- **Frontend UI** → `http://localhost:5173` (static server for the SPA)

Each folder has its own `package.json`, so you `cd` in and run just that server.
The root `package.json` can also run both at once.

```
function-booking/
├── backend/
│   ├── package.json        # cd backend && npm run dev → API only
│   ├── server.js           # Express JSON API (auth, bookings, Mongoose models, CORS)
│   ├── .env                # shared API/database/mail config (gitignored)
│   └── .env.example
├── frontend/
│   ├── package.json        # cd frontend && npm run dev → UI only
│   ├── server.js           # static server for the UI (port 5173)
│   ├── index.html          # SPA shell
│   ├── app.js              # UI + API_BASE pointing at the backend
│   ├── .env.example        # VITE_API_BASE + venue PROPERTY_CODE
│   └── style.css
├── package.json            # root: installs deps; can run BOTH via concurrently
├── free-ports.sh           # frees a given port before start (auto via pre* hooks)
└── start-mongo.sh          # start a local MongoDB instance
```

### API endpoints

| Method | Path                | Auth | Purpose                        |
|--------|---------------------|------|--------------------------------|
| POST   | `/api/login`        | —    | Log in (username + password)   |
| POST   | `/api/logout`       | ✓    | Log out                        |
| GET    | `/api/me`           | —    | Current login state            |
| GET    | `/api/options`      | —    | Property name + option lists   |
| GET    | `/api/bookings`     | ✓    | List bookings                  |
| GET    | `/api/bookings/:id` | ✓    | One booking                    |
| POST   | `/api/bookings`     | ✓    | Create a booking or draft      |
| PUT    | `/api/bookings/:id` | ✓    | Edit, or submit a draft        |
| GET    | `/api/bookings/:id/pdf`    | ✓ | Download the A4 PDF         |
| POST   | `/api/bookings/:id/resend` | ✓ | Re-send the booking email   |

`POST`/`PUT` treat `"status": "draft"` in the body as a draft save; anything
else is a full submission.

## Setup & run

First, once:

```bash
npm install
./start-mongo.sh &     # start local MongoDB (leave running)
```

### Default: two terminals (one per server)

Each folder is its own runnable unit. Open **two terminals**:

```bash
# Terminal 1 — backend API (:3001)
cd backend
npm run dev

# Terminal 2 — frontend UI (:5173)
cd frontend
npm run dev
```

Each starts **only** its own server and frees **only** its own port first, so
they never kill each other. Use `npm start` instead of `npm run dev` to run
without file-watching.

Then open the **frontend** in your browser:

**http://localhost:5173**. Use a login allowed by the frontend's venue profile.

> Use `localhost` (not `127.0.0.1`) so the frontend and API are treated as the
> same site and the login cookie is sent.

### Alternative: both in one terminal

From the project root:

```bash
npm run dev     # runs backend + frontend together via concurrently
```

## Venue logins

Venue profiles use the fixed user allowlists in `backend/property.js`.
The login endpoint and every protected request verify that the username belongs
to the active venue, so an account or session from another venue is rejected.

## How it works

1. Visiting `/` (or any protected page) while logged out redirects to `/login`.
2. After logging in, you land on the FP booking form at `/form`.
3. Submitting a valid booking saves it and shows the booking with a
   "Download PDF (A4)" option.
4. `/submissions` lists all bookings.
5. `/logout` clears the session and returns to the login page.

## Drafts

A booking that isn't ready to go out can be saved as a **draft** with the
"Save as Draft" button next to "Submit & Save Booking".

- **Nothing is mandatory** in a draft except at least one filled-in field, so a
  half-completed form is never lost. The usual required fields are only
  enforced when it is submitted.
- **Drafts are never emailed.** The internal recipient list is only mailed when
  the booking is submitted, and "Resend Email" is refused for a draft.
- **A draft carries no booking number.** The next series number is issued at
  submission, so the numbered series has no gaps left by abandoned drafts.
- **A draft's PDF can still be downloaded** and is stamped `DRAFT` diagonally
  across the page, with "DRAFT (not submitted)" in the header, so a working
  copy cannot be mistaken for a confirmed booking.
- The bookings list marks each row Draft or Submitted and can be filtered to
  either. Open a draft to continue editing it or submit it.
- Submitting turns the draft into a normal booking: it takes the next series
  number and is emailed exactly like one created in a single sitting. A
  submitted booking cannot be turned back into a draft.

Existing databases are migrated automatically on the first start: every record
that predates drafts is marked submitted and keeps its series number, and
numbering continues from where it left off.

## Configuration (`backend/.env`)

Config is loaded from `backend/.env` via `dotenv`. Copy the example and edit:

```bash
cp backend/.env.example backend/.env
```

| Variable           | Default                                | Purpose                          |
|--------------------|----------------------------------------|----------------------------------|
| `PORT`             | `3001`                                 | Shared backend API port          |
| `FRONTEND_ORIGINS` | `http://localhost:5173`                | Comma-separated frontend origins |
| `SECRET_KEY`       | `change-me-in-production`              | Session signing secret           |
| `MONGODB_URI`      | `mongodb://127.0.0.1:27017/amravti_fp` | Shared MongoDB connection        |
| `SMTP_HOST`        | —                                      | Shared SMTP server               |
| `SMTP_PORT`        | `587`                                  | SMTP port                        |
| `SMTP_SECURE`      | `false`                                | Implicit TLS (normally port 465) |
| `SMTP_USER`        | —                                      | SMTP username                    |
| `SMTP_PASS`        | —                                      | SMTP password                    |
| `MAIL_FROM`        | SMTP user                              | Sender name/address              |

The shared backend also requires five JSON environment variables containing
the private venue credentials: `AMRAVATI_ALLOWED_USERS`,
`NAGPUR_ALLOWED_USERS`, `DALI_ALLOWED_USERS`,
`NAVI_MUMBAI_ALLOWED_USERS`, and `PABLO_ALLOWED_USERS`. Keep their real values
in the hosting dashboard and local ignored `.env`; never commit them.

`.env` is gitignored; `.env.example` is committed as a template.

### Shared backend and frontend

Both are deployed once. The frontend only needs the shared API URL:

```dotenv
VITE_API_BASE=https://shared-booking-api.example.com
```

The built-in `PROPERTY_CODE` values are `centre_point_amravati`,
`centre_point_nagpur`, `dali`, `centre_point_navi_mumbai`, and `pablo`. Each
selects a fixed username/password allowlist and email-recipient allowlist from
`backend/property.js`.
The login page supplies the selected venue code. The backend uses it to select
the fixed users and recipients. All booking queries include the venue code, so
users cannot view or edit another venue's records. The frontend gets the display
name from `/api/options`, so its title, header and footer update automatically.

## MongoDB (local)

A local MongoDB 8.x install is available and can be started with:

```bash
./start-mongo.sh          # serves mongodb://127.0.0.1:27017, data in ./.mongodb-data
```

The backend connects to `MONGODB_URI` (from `.env`) on startup and stores all
bookings and admins there. Collections created: `admins`, `bookings`,
`counters` (the atomic series-number counter). Inspect with `mongosh`:

```bash
mongosh amravti_fp --eval 'db.bookings.find().pretty()'
```

## Notes

- **Two ports**: backend API on **3001**, frontend UI on **5173**. Change the
  API port with `PORT` in `backend/.env` and update `VITE_API_BASE` if needed.
  The frontend port can be set with `FRONTEND_PORT`.
- CORS: the backend only accepts credentialed requests from
  `FRONTEND_ORIGINS` (plus local development and Vercel preview origins).
- **No more `EADDRINUSE`**: `npm start` / `npm run dev` auto-run `free-ports.sh`
  first (via `prestart` / `predev`), which kills any leftover process on 3001 or
  5173. Run it manually anytime with `npm run free-ports`.
- Venue logins are checked against the selected server-side profile.
- Bookings use a numeric `seq` as their public id (URL `/booking/1`), plus a
  zero-padded `series_no` (`001`).
- Set a strong `SECRET_KEY` and mail credentials on the production backend.
