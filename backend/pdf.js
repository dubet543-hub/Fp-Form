/**
 * Renders a booking document to a single-page A4 PDF Buffer.
 *
 * Layout: full-width header, then two columns that ALWAYS stay on one page —
 *   • LEFT  = the (potentially very long) Menu.
 *   • RIGHT = every other booking field, grouped into sections.
 * The body font size is shrunk automatically until both columns fit the page,
 * so even a 60-item menu never spills onto a second page.
 *
 * Uses pdfkit (pure JS, no headless browser needed).
 */

const PDFDocument = require('pdfkit');
const { PROPERTY_NAME } = require('./property');

// RIGHT column → section → list of [label, fieldKey] rows. Menu is intentionally
// NOT here: it is rendered on its own in the left column.
const RIGHT_SECTIONS = [
  ['Function Prospectus', [
    ['Series No', 'series_no'], ['Reservation No', 'reservation_no'],
    ['Date', 'date'],
    ['Type of Function', 'function_type'], ['Venue', 'venue'], ['MG', 'mg'],
    ['Expected Pax', 'expected_pax'], ['Time Slot', 'time_slot'],
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

/**
 * @param {object} b  a booking (plain object, e.g. Booking.toJSON()).
 * @returns {Promise<Buffer>}
 */
function renderBookingPdf(b) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 36 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Hard guarantee: exactly ONE A4 page. pdfkit silently calls addPage()
    // whenever a text write overflows the bottom margin; neutralise it so a long
    // value can never create a second page. (The auto-fit below is what keeps
    // text inside the page in the normal case — this is just a backstop.)
    doc.addPage = () => doc;

    // A draft is a working copy: it holds no series number yet and must never
    // be mistaken for a confirmed booking, so it is stamped across the page.
    const isDraft = b.status === 'draft';
    const series = isDraft
      ? ''
      : b.series_no || String(b.id ?? b.seq ?? '').padStart(3, '0');
    const stamp = b.created_at ? new Date(b.created_at).toLocaleString() : '';
    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;
    const pageBottom = doc.page.height - doc.page.margins.bottom;

    // --- DRAFT watermark -----------------------------------------------------
    // Drawn first so the booking details sit on top of it. All later writes
    // position themselves explicitly, so this can't disturb the layout.
    if (isDraft) {
      doc.save();
      // Move the origin to the middle of the page, turn 45°, then draw the
      // word centred on that origin so it lies corner to corner.
      doc.translate(doc.page.width / 2, doc.page.height / 2).rotate(-45);
      doc.opacity(0.16).fillColor('#b45309').font('Helvetica-Bold').fontSize(140)
        .text('DRAFT', -350, -80, { width: 700, align: 'center', lineBreak: false });
      doc.opacity(1);
      doc.restore();
    }

    // --- Header (full width) -------------------------------------------------
    doc.fillColor('#111').font('Helvetica-Bold').fontSize(18)
      .text(b.property_name || PROPERTY_NAME, left, doc.page.margins.top);
    doc.font('Helvetica').fontSize(10).fillColor(isDraft ? '#b45309' : '#333')
      .text(
        isDraft
          ? 'Function Booking Form — DRAFT (not submitted)'
          : 'Function Booking Form'
      );

    const metaLines = [
      isDraft ? 'DRAFT — Booking No pending' : `Booking No ${series}`,
      b.reservation_no ? `Res. No: ${b.reservation_no}` : null,
      `${isDraft ? 'Saved' : 'Submitted'} by: ${val(b.submitted_by)}`,
      stamp ? `Timestamp: ${stamp}` : null,
    ].filter(Boolean);
    doc.fontSize(9).fillColor(isDraft ? '#b45309' : '#555')
      .text(metaLines.join('\n'), left, doc.page.margins.top, { width, align: 'right' });

    doc.moveDown(0.5);
    const lineY = doc.y + 2;
    doc.moveTo(left, lineY).lineTo(right, lineY).lineWidth(1.5).strokeColor('#111').stroke();

    // --- Two-column geometry -------------------------------------------------
    const contentTop = lineY + 8;
    const availH = pageBottom - contentTop;
    const gap = 16;
    const leftW = (width - gap) * 0.44;      // menu column
    const rightW = (width - gap) * 0.56;     // everything-else column
    const leftX = left;
    const rightX = left + leftW + gap;
    const menuText = val(b.menu);

    const barH = (fs) => fs + 7;
    const rLabelW = (fs) => rightW * 0.42;
    const rValueW = (fs) => rightW - rLabelW(fs) - 6;

    // Height each column would need at a given font size.
    const rightHeight = (fs) => {
      let h = 0;
      for (const [, rows] of RIGHT_SECTIONS) {
        h += barH(fs) + 4;
        for (const [label, key] of rows) {
          doc.font('Helvetica-Bold').fontSize(fs);
          const lh = doc.heightOfString(label, { width: rLabelW(fs) });
          doc.font('Helvetica').fontSize(fs);
          const vh = doc.heightOfString(val(b[key]), { width: rValueW(fs) });
          h += Math.max(lh, vh) + 3;
        }
        h += 4;
      }
      return h;
    };
    const leftHeight = (fs) => {
      doc.font('Helvetica').fontSize(fs);
      return barH(fs) + 6 + doc.heightOfString(menuText, { width: leftW - 8 });
    };

    // Pick the largest font size (readability) at which BOTH columns fit.
    let fs = 4.5;
    for (let s = 9; s >= 4.5; s -= 0.5) {
      if (rightHeight(s) <= availH && leftHeight(s) <= availH) { fs = s; break; }
    }

    // --- Draw ----------------------------------------------------------------
    const sectionBar = (x, y, w, title) => {
      doc.rect(x, y, w, barH(fs)).fill('#f0f0f0');
      doc.rect(x, y, 3, barH(fs)).fill('#111');
      doc.fillColor('#111').font('Helvetica-Bold').fontSize(fs)
        .text(title.toUpperCase(), x + 8, y + (barH(fs) - fs) / 2 - 1,
          { width: w - 10, lineBreak: false });
    };

    // Left column: MENU
    {
      let y = contentTop;
      sectionBar(leftX, y, leftW, 'Menu');
      y += barH(fs) + 6;
      doc.font('Helvetica').fontSize(fs).fillColor('#111')
        .text(menuText, leftX, y, { width: leftW - 4, height: pageBottom - y, ellipsis: true });
    }

    // Right column: all other sections
    {
      let y = contentTop;
      for (const [title, rows] of RIGHT_SECTIONS) {
        if (y + barH(fs) > pageBottom) break;
        sectionBar(rightX, y, rightW, title);
        y += barH(fs) + 4;
        for (const [label, key] of rows) {
          if (y + fs > pageBottom) break;
          const value = val(b[key]);
          const maxH = pageBottom - y;
          doc.font('Helvetica-Bold').fontSize(fs);
          const lh = doc.heightOfString(label, { width: rLabelW(fs) });
          doc.font('Helvetica').fontSize(fs);
          const vh = doc.heightOfString(value, { width: rValueW(fs) });
          const rowH = Math.min(Math.max(lh, vh), maxH);

          doc.font('Helvetica-Bold').fontSize(fs).fillColor('#555')
            .text(label, rightX, y, { width: rLabelW(fs), height: rowH, ellipsis: true });
          doc.font('Helvetica').fontSize(fs).fillColor('#111')
            .text(value, rightX + rLabelW(fs) + 6, y, { width: rValueW(fs), height: rowH, ellipsis: true });

          const yy = y + rowH + 3;
          doc.moveTo(rightX, yy - 2).lineTo(rightX + rightW, yy - 2)
            .lineWidth(0.4).strokeColor('#eee').stroke();
          y = yy;
        }
        y += 4;
      }
    }

    doc.end();
  });
}

module.exports = { renderBookingPdf };
