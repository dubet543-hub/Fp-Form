/* Amravti FP — frontend SPA. Talks to the backend JSON API (separate origin). */

// Backend API base URL.
// In production (Vercel) set VITE_API_BASE to the deployed backend URL
// (e.g. https://fp-form-backend.onrender.com). In local dev it falls back
// to localhost:3001 to stay same-site with the Vite dev server.
const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '');

const state = { me: { loggedIn: false }, options: null };

const $app = document.getElementById('app');
const $nav = document.getElementById('nav');

// --- Helpers ----------------------------------------------------------------

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function api(path, opts = {}) {
  const res = await fetch(API_BASE + '/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include', // send/receive the session cookie cross-origin
    ...opts,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }
  return { ok: res.ok, status: res.status, data };
}

function opts(list, selected) {
  return ['<option value="">Select…</option>']
    .concat(
      list.map(
        (o) =>
          `<option value="${esc(o)}"${o === selected ? ' selected' : ''}>${esc(o)}</option>`
      )
    )
    .join('');
}

// --- Nav --------------------------------------------------------------------

function renderNav() {
  // Which page (tab) is currently active, derived from the route.
  const path = (location.hash.slice(1).split('?')[0]) || '/';
  const isForm = path === '/' || path === '/form';
  const isBookings = path === '/bookings' || /^\/booking\//.test(path);

  if (state.me.loggedIn) {
    $nav.innerHTML = `
      <div class="tabs">
        <a href="#/form" class="tab${isForm ? ' active' : ''}">New Booking</a>
        <a href="#/bookings" class="tab${isBookings ? ' active' : ''}">Bookings</a>
      </div>
      <div class="nav-right">
        <span class="nav-user">${esc(state.me.username)}</span>
        <a href="#" id="logout" class="logout-link">Logout</a>
      </div>`;
    document.getElementById('logout').onclick = async (e) => {
      e.preventDefault();
      await api('/logout', { method: 'POST' });
      state.me = { loggedIn: false };
      renderNav();
      location.hash = '#/login';
    };
  } else {
    $nav.innerHTML = `<div class="tabs"><a href="#/login" class="tab active">Login</a></div>`;
  }
}

// --- Views ------------------------------------------------------------------

function viewLogin(msg) {
  $app.innerHTML = `
    <div class="card auth-card">
      <h1>Admin Login</h1>
      <p class="subtitle">Sign in to open the Function Booking Form.</p>
      <div class="alert" id="err" style="display:none"></div>
      <form id="loginForm" novalidate>
        <div class="field">
          <label for="username">Username</label>
          <input type="text" id="username" name="username" autofocus>
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input type="password" id="password" name="password">
        </div>
        <button type="submit" class="btn btn-block">Log in</button>
      </form>
    </div>`;
  if (msg) showErr(msg);
  document.getElementById('loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const { ok, data } = await api('/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    if (ok) {
      state.me = { loggedIn: true, username: data.username };
      // If the hash is already '#/form' (the login form is shown there),
      // changing it fires no hashchange event, so render the form directly.
      if (location.hash === '#/form') route();
      else location.hash = '#/form';
    } else {
      showErr((data && data.error) || 'Login failed.');
    }
  };
}

function showErr(text) {
  const el = document.getElementById('err');
  if (el) { el.textContent = text; el.style.display = 'block'; }
}

// Live, auto-populated timestamp shown on the form.
function startClock() {
  stopClock();
  const tick = () => {
    const el = document.getElementById('timestamp');
    if (el) el.value = new Date().toLocaleString();
  };
  tick();
  window.__clock = setInterval(tick, 1000);
}
function stopClock() {
  if (window.__clock) { clearInterval(window.__clock); window.__clock = null; }
}

// Today's date as YYYY-MM-DD in the user's local time (for date input `min`).
function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function field(label, name, type = 'text', required = false, value = '', attrs = '') {
  return `
    <div class="field">
      <label>${label}${required ? ' <span class="req">*</span>' : ''}</label>
      <input type="${type}" name="${name}" value="${esc(value)}" ${attrs}>
    </div>`;
}

function select(label, name, list, required, value = '') {
  return `
    <div class="field">
      <label>${label}${required ? ' <span class="req">*</span>' : ''}</label>
      <select name="${name}">${opts(list, value)}</select>
    </div>`;
}

function textarea(label, name, wide = true) {
  return `
    <div class="field ${wide ? 'wide' : ''}">
      <label>${label}</label>
      <textarea name="${name}" rows="2"></textarea>
    </div>`;
}

function viewForm() {
  const o = state.options;
  $app.innerHTML = `
    <div class="card">
      <h1>Function Booking Form</h1>
      <p class="subtitle">Submitted by <strong>${esc(state.me.username)}</strong></p>
      <div class="alert" id="formErr" style="display:none"></div>
      <form id="bookingForm" novalidate>
        <div class="grid">
          <div class="field">
            <label>Booking No</label>
            <input type="text" value="Auto (e.g. 001)" readonly class="readonly">
          </div>
          <div class="field">
            <label>Timestamp</label>
            <input type="text" id="timestamp" readonly class="readonly">
          </div>
          ${field('Reservation No', 'reservation_no')}
        </div>

        <h2 class="section-title">Function Prospectus</h2>
        <div class="grid">
          ${field('Date', 'date', 'date', true, '', `min="${todayStr()}"`)}
          ${select('Type of Function', 'function_type', o.functionTypes, true)}
          ${select('Venue', 'venue', o.venues, true)}
          ${field('MG', 'mg')}
          ${field('Expected Pax', 'expected_pax', 'number')}
          ${select('Time Slot', 'time_slot', o.timeSlots, true)}
        </div>

        <table class="form-table">
          <thead>
            <tr>
              <th>Menu <span class="req">*</span></th>
              <th>Party Details</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="menu-cell">
                <textarea name="menu" class="menu-input"
                  placeholder="Enter the full menu here…"></textarea>
              </td>
              <td class="party-cell">
                ${field('Name of Party', 'party_name', 'text', true)}
                ${field('Company Name', 'company_name')}
                ${field('GST No', 'gst_no')}
                ${field('PAN No', 'pan_no')}
                <div class="field">
                  <label>Address</label>
                  <input type="text" name="address">
                </div>
                ${field('Contact Person', 'contact_person')}
                ${field('Telephone / Mobile', 'telephone', 'tel', true)}
                ${field('Email', 'email', 'email')}
                ${field('Seating Arrangement', 'seating_arrangement')}
                ${field('Add on Rooms', 'add_on_rooms')}
              </td>
            </tr>
          </tbody>
        </table>

        <h2 class="section-title">Billing</h2>
        <div class="grid">
          ${field('Rate', 'rate', 'text', true)}
          ${field('Hall Rent', 'hall_rent')}
          ${field('Advance Amt', 'advance_amt')}
          <div class="field wide">
            <label>Mode of Payment</label>
            <div class="radio-row">
              ${o.paymentModes
                .map(
                  (p) =>
                    `<label class="inline"><input type="radio" name="mode_of_payment" value="${esc(p)}"> ${esc(p)}</label>`
                )
                .join('')}
            </div>
          </div>
          ${textarea('Transaction Details', 'transaction_details')}
        </div>

        <h2 class="section-title">Additional Services</h2>
        ${textarea('Board to Read', 'board_to_read', false)}
        <div class="field">
          <label>Other Charges</label>
          <div class="radio-row">
            ${o.otherCharges
              .map(
                (c) =>
                  `<label class="inline"><input type="checkbox" name="other_charges" value="${esc(c)}"> ${esc(c)}</label>`
              )
              .join('')}
          </div>
        </div>
        ${textarea('Details / Amount', 'details_amount', false)}

        <h2 class="section-title">Instructions</h2>
        <div class="grid">
          ${textarea('Billing Instruction', 'billing_instruction')}
          ${textarea('Housekeeping', 'housekeeping')}
          ${textarea('F&amp;B', 'fnb')}
          ${textarea('Kitchen', 'kitchen')}
        </div>

        <button type="submit" class="btn">Submit &amp; Save Booking</button>
      </form>
    </div>`;

  startClock();

  document.getElementById('bookingForm').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {};
    for (const [k, v] of fd.entries()) {
      if (k === 'other_charges') {
        (payload.other_charges = payload.other_charges || []).push(v);
      } else {
        payload[k] = v;
      }
    }
    const { ok, data } = await api('/bookings', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (ok) {
      location.hash = '#/booking/' + data.id + '?created=1';
    } else if (data && data.errors) {
      const el = document.getElementById('formErr');
      el.textContent = 'Please fill in all required fields marked with *.';
      el.style.display = 'block';
      // Highlight the missing fields.
      Object.keys(data.errors).forEach((name) => {
        const inp = e.target.querySelector(`[name="${name}"]`);
        if (inp) inp.classList.add('input-error');
      });
      window.scrollTo(0, 0);
    }
  };
}

async function viewBookings() {
  document.body.classList.add('wide');
  const { ok, data } = await api('/bookings');
  if (!ok) return (location.hash = '#/login');
  const rows = data
    .map(
      (b) => `
      <tr class="row-link" data-id="${b.id}">
        <td><strong>${esc(b.series_no) || String(b.id).padStart(3, '0')}</strong></td>
        <td>${esc(b.reservation_no) || '—'}</td>
        <td class="nowrap">${esc(b.date)}</td>
        <td>${esc(b.function_type)}</td>
        <td>${esc(b.venue)}</td>
        <td>${esc(b.party_name)}</td>
        <td class="nowrap">${esc(b.telephone)}</td>
        <td>${esc(b.submitted_by)}</td>
      </tr>`
    )
    .join('');
  $app.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h1>Bookings</h1>
        <a class="btn btn-sm" href="#/form">New Booking</a>
      </div>
      ${
        data.length
          ? `<table class="bookings-table">
              <thead><tr><th>Series No</th><th>Res. No</th><th>Date</th>
              <th>Type</th><th>Venue</th><th>Party</th><th>Telephone</th>
              <th>By</th></tr></thead>
              <tbody>${rows}</tbody></table>
             <p class="hint">Tip: click any row to view or download the booking.</p>`
          : `<p class="subtitle">No bookings yet. <a href="#/form">Create the first one</a>.</p>`
      }
    </div>`;

  // Whole row navigates to the booking detail — no separate "View" column.
  $app.querySelectorAll('tr.row-link').forEach((tr) => {
    tr.onclick = () => (location.hash = '#/booking/' + tr.dataset.id);
  });
}

const DETAIL_SECTIONS = [
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

async function viewBooking(id, created) {
  const { ok, data } = await api('/bookings/' + id);
  if (!ok) return (location.hash = '#/login');
  const b = data;
  const series = esc(b.series_no) || String(b.id).padStart(3, '0');
  const sections = DETAIL_SECTIONS.map(
    ([title, rows]) => `
      <h2 class="section-title">${title}</h2>
      ${rows
        .map(
          ([label, key]) =>
            `<div class="detail-row"><span class="detail-label">${esc(label)}</span><span class="detail-val">${esc(b[key]) || '—'}</span></div>`
        )
        .join('')}`
  ).join('');

  $app.innerHTML = `
    ${
      created
        ? `<div class="card center success-banner">
             <div class="checkmark">&#10003;</div>
             <h1>Booking saved</h1>
             <p class="subtitle">Booking No <strong>${series}</strong> has been recorded.</p>
           </div>`
        : ''
    }
    <div class="card">
      <div class="card-head">
        <h1>Booking No ${series}</h1>
        <div class="card-actions">
          <button class="btn btn-sm" id="pdfBtn">Download PDF (A4)</button>
          <a class="btn btn-sm btn-ghost" href="#/form">New Booking</a>
          <button class="btn btn-sm btn-danger" id="delBtn">Delete</button>
        </div>
      </div>
      <p class="subtitle">Submitted by <strong>${esc(b.submitted_by)}</strong> · ${esc(new Date(b.created_at).toLocaleString())}</p>
      ${sections}
    </div>`;

  document.getElementById('pdfBtn').onclick = () => printBooking(b);
  document.getElementById('delBtn').onclick = async () => {
    if (!confirm(`Delete Booking No ${series}? This cannot be undone.`)) return;
    const { ok } = await api('/bookings/' + b.id, { method: 'DELETE' });
    if (ok) location.hash = '#/bookings';
    else alert('Could not delete the booking.');
  };
}

// Opens a print-friendly A4 window and triggers the browser print dialog.
function printBooking(b) {
  const series = esc(b.series_no) || String(b.id).padStart(3, '0');
  const kv = (rows) =>
    rows
      .map(
        (r) =>
          `<tr><td class="k">${esc(r[0])}</td><td>${esc(b[r[1]]) || '—'}</td>` +
          (r[2]
            ? `<td class="k">${esc(r[2])}</td><td>${esc(b[r[3]]) || '—'}</td></tr>`
            : `<td></td><td></td></tr>`)
      )
      .join('');
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>Booking #${b.id} — Centre Point Amravti</title>
    <style>
      @page { size: A4; margin: 14mm; }
      body { font-family: Arial, sans-serif; color:#111; font-size:12px; }
      .head { display:flex; justify-content:space-between; border-bottom:2px solid #111; padding-bottom:8px; margin-bottom:12px; }
      .head h1 { margin:0; font-size:18px; } .meta { text-align:right; font-size:11px; color:#555; }
      h2 { font-size:12px; text-transform:uppercase; background:#f0f0f0; padding:4px 8px; margin:14px 0 6px; border-left:3px solid #111; }
      table { width:100%; border-collapse:collapse; } td { padding:3px 8px; border-bottom:1px solid #eee; vertical-align:top; }
      td.k { width:22%; color:#555; font-weight:bold; }
    </style></head><body>
    <div class="head">
      <div><h1>Centre Point Amravti</h1><div>Function Booking Form</div></div>
      <div class="meta">Booking No ${series}<br>${b.reservation_no ? 'Res. No: ' + esc(b.reservation_no) + '<br>' : ''}Submitted by: ${esc(b.submitted_by)}<br>Timestamp: ${esc(new Date(b.created_at).toLocaleString())}</div>
    </div>
    <h2>Function Prospectus</h2><table>${kv([['Date','date','Type of Function','function_type'],['Venue','venue','MG','mg'],['Expected Pax','expected_pax','Time Slot','time_slot'],['Menu','menu']])}</table>
    <h2>Party Details</h2><table>${kv([['Name of Party','party_name','Company','company_name'],['GST No','gst_no','PAN No','pan_no'],['Address','address'],['Contact Person','contact_person','Telephone','telephone'],['Email','email','Seating','seating_arrangement'],['Add on Rooms','add_on_rooms']])}</table>
    <h2>Billing</h2><table>${kv([['Rate','rate','Hall Rent','hall_rent'],['Mode of Payment','mode_of_payment','Advance Amt','advance_amt'],['Transaction Details','transaction_details']])}</table>
    <h2>Additional Services</h2><table>${kv([['Board to Read','board_to_read'],['Other Charges','other_charges'],['Details / Amount','details_amount']])}</table>
    <h2>Instructions</h2><table>${kv([['Billing','billing_instruction'],['Housekeeping','housekeeping'],['F&B','fnb'],['Kitchen','kitchen']])}</table>
    <script>window.onload=function(){window.print();}<\/script>
    </body></html>`;
  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
}

// --- Router -----------------------------------------------------------------

async function route() {
  stopClock();
  const raw = location.hash.slice(1) || '/';
  const [path, query] = raw.split('?');

  // Keep the tab highlight in sync with the current page.
  renderNav();
  // Only the bookings list uses the wider layout.
  document.body.classList.remove('wide');

  if (!state.me.loggedIn) {
    viewLogin();
    return;
  }

  if (path === '/' || path === '/form') return viewForm();
  if (path === '/bookings') return viewBookings();
  const m = path.match(/^\/booking\/(\d+)$/);
  if (m) return viewBooking(m[1], /created=1/.test(query || ''));
  if (path === '/login') return (location.hash = '#/form');
  viewForm();
}

// --- Init -------------------------------------------------------------------

async function init() {
  const [me, options] = await Promise.all([
    api('/me').then((r) => r.data),
    api('/options').then((r) => r.data),
  ]);
  state.me = me;
  state.options = options;
  renderNav();
  window.addEventListener('hashchange', route);
  route();
}

init();
