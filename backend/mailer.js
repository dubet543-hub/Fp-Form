/**
 * Email delivery for booking PDFs, via the cpgh.in SMTP mail server.
 *
 * All connection details come from backend/.env (see .env.example):
 *   SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS,
 *   MAIL_FROM, MAIL_RECIPIENTS
 *
 * If SMTP is not configured, sending is skipped with a warning so that
 * booking creation itself never fails because of mail problems.
 */

const nodemailer = require('nodemailer');
const { renderBookingPdf } = require('./pdf');

// Fallback recipient list for Centre Point Nagpur bookings, used only if
// MAIL_RECIPIENTS_NAGPUR isn't set in the environment.
const DEFAULT_NAGPUR_RECIPIENTS = [
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
];

function parseList(envVal) {
  return (envVal || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const RECIPIENTS_AMRAVTI = parseList(
  process.env.MAIL_RECIPIENTS_AMRAVTI || process.env.MAIL_RECIPIENTS
);
const RECIPIENTS_NAGPUR = process.env.MAIL_RECIPIENTS_NAGPUR
  ? parseList(process.env.MAIL_RECIPIENTS_NAGPUR)
  : DEFAULT_NAGPUR_RECIPIENTS;

// Kept for backward compatibility (e.g. anything importing RECIPIENTS directly).
const RECIPIENTS = RECIPIENTS_AMRAVTI;

function recipientsFor(branch) {
  return branch === 'Nagpur' ? RECIPIENTS_NAGPUR : RECIPIENTS_AMRAVTI;
}

function venueName(branch) {
  return branch === 'Nagpur' ? 'Centre Point Nagpur' : 'Centre Point Amravti';
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
        'Set SMTP_HOST/SMTP_USER/SMTP_PASS and MAIL_RECIPIENTS_AMRAVTI/MAIL_RECIPIENTS_NAGPUR in backend/.env.'
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

module.exports = { sendBookingEmail, isConfigured, RECIPIENTS, RECIPIENTS_AMRAVTI, RECIPIENTS_NAGPUR };
