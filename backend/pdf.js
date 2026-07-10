/**
 * Renders a booking document to a PDF Buffer, mirroring the A4 print layout
 * used by the frontend (frontend/app.js → printBooking).
 *
 * Uses pdfkit (pure JS, no headless browser needed).
 */

const PDFDocument = require('pdfkit');

// Section → list of [label, fieldKey] rows, matching the on-screen detail view.
const SECTIONS = [
  ['Function Prospectus', [
    ['Series No', 'series_no'], ['Reservation No', 'reservation_no'],
    ['Date', 'date'],
    ['Type of Function', 'function_type'], ['Venue', 'venue'], ['MG', 'mg'],
    ['Expected Pax', 'expected_pax'], ['Time Slot', 'time_slot'], ['Menu', 'menu'],
  ]],
  ['Party Details', [
    ['Name of Party', 'party_name'], ['Company Name', 'company_name'],
    ['GST No', 'gst_no'], ['PAN No', 'pan_no'], ['Address', 'address'],
    ['Contact Person', 'contact_person'], ['Telephone / Mobile', 'telephone'],
    ['Email', 'email'], ['Seating Arrangement', 'seating_arrangement'],
    ['Add on Rooms', 'add_on_rooms'],
  ]],
  ['Billing', [
    ['Rate', 'rate'], ['Hall Rent', 'hall_rent'], ['Mode of Payment', 'mode_of_payment'],
    ['Advance Amt', 'advance_amt'], ['Transaction Details', 'transaction_details'],
  ]],
  ['Additional Services', [
    ['Board to Read', 'board_to_read'], ['Other Charges', 'other_charges'],
    ['Details / Amount', 'details_amount'],
  ]],
  ['Instructions', [
    ['Billing Instruction', 'billing_instruction'], ['Housekeeping', 'housekeeping'],
    ['F&B', 'fnb'], ['Kitchen', 'kitchen'],
  ]],
];

function val(v) {
  const s = v == null ? '' : String(v).trim();
  return s || '—';
}

// Kept in sync with backend/mailer.js → BRANCH_CONFIG's `name` fields.
const VENUE_NAMES = {
  Amravti: 'Centre Point Amravti',
  Nagpur: 'Centre Point Nagpur',
  Pablo: 'Pablo - The Art Cafe',
  NaviMumbai: 'Centre Point Navi Mumbai',
  Dali: 'Dali',
};

function venueName(branch) {
  return VENUE_NAMES[branch] || VENUE_NAMES.Amravti;
}

/**
 * @param {object} b  a booking (plain object, e.g. Booking.toJSON()).
 * @returns {Promise<Buffer>}
 */
function renderBookingPdf(b) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const series = b.series_no || String(b.id ?? b.seq ?? '').padStart(3, '0');
    const stamp = b.created_at ? new Date(b.created_at).toLocaleString() : '';
    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;

    // --- Header --------------------------------------------------------------
    doc.fillColor('#111').font('Helvetica-Bold').fontSize(18)
      .text(venueName(b.branch), left, doc.y, { continued: false });
    doc.font('Helvetica').fontSize(10).fillColor('#333')
      .text('Function Booking Form');

    const metaLines = [
      `Booking No ${series}`,
      b.reservation_no ? `Res. No: ${b.reservation_no}` : null,
      `Submitted by: ${val(b.submitted_by)}`,
      stamp ? `Timestamp: ${stamp}` : null,
    ].filter(Boolean);
    doc.fontSize(9).fillColor('#555')
      .text(metaLines.join('\n'), left, doc.page.margins.top, {
        width,
        align: 'right',
      });

    doc.moveDown(0.5);
    const lineY = doc.y + 2;
    doc.moveTo(left, lineY).lineTo(right, lineY).lineWidth(1.5).strokeColor('#111').stroke();
    doc.moveDown(0.8);

    // --- Sections ------------------------------------------------------------
    const labelW = width * 0.28;
    const valueW = width - labelW - 12;

    for (const [title, rows] of SECTIONS) {
      ensureSpace(doc, 60);
      // Section heading with a shaded bar.
      const hy = doc.y;
      doc.rect(left, hy, width, 18).fill('#f0f0f0');
      doc.rect(left, hy, 3, 18).fill('#111');
      doc.fillColor('#111').font('Helvetica-Bold').fontSize(10)
        .text(title.toUpperCase(), left + 10, hy + 4, { width: width - 12 });
      doc.y = hy + 22;

      for (const [label, key] of rows) {
        const text = val(b[key]);
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#555');
        const lh = doc.heightOfString(label, { width: labelW });
        doc.font('Helvetica').fontSize(9).fillColor('#111');
        const vh = doc.heightOfString(text, { width: valueW });
        const rowH = Math.max(lh, vh) + 6;

        ensureSpace(doc, rowH + 4);
        const y0 = doc.y;
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#555')
          .text(label, left, y0, { width: labelW });
        doc.font('Helvetica').fontSize(9).fillColor('#111')
          .text(text, left + labelW + 12, y0, { width: valueW });
        const y1 = y0 + rowH;
        doc.moveTo(left, y1 - 3).lineTo(right, y1 - 3)
          .lineWidth(0.5).strokeColor('#eee').stroke();
        doc.y = y1;
      }
      doc.moveDown(0.5);
    }

    doc.end();
  });
}

// Add a page break if fewer than `needed` points remain on the page.
function ensureSpace(doc, needed) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + needed > bottom) doc.addPage();
}

module.exports = { renderBookingPdf };
