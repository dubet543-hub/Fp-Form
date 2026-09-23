/* Function Booking frontend SPA. Talks to the backend JSON API. */

// Backend API base URL.
// In production (Vercel) set VITE_API_BASE to the deployed backend URL
// (e.g. https://fp-form-backend.onrender.com). In local dev it falls back
// to localhost:3001 to stay same-site with the Vite dev server.
const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '');
const VENUES = [
  ['centre_point_amravati', 'Centre Point Amravati'],
  ['centre_point_nagpur', 'Centre Point Nagpur'],
  ['dali', 'Dali'],
  ['centre_point_navi_mumbai', 'Centre Point Navi Mumbai'],
  ['pablo', 'Pablo The Art Cafe'],
];
const VENUE_CODES = new Set(VENUES.map(([code]) => code));
let propertyCode = '';
try {
  const savedCode = localStorage.getItem('fp_property_code') || '';
  if (VENUE_CODES.has(savedCode)) propertyCode = savedCode;
} catch (e) { /* ignore storage errors */ }

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
    credentials: 'include', // send/receive the session cookie cross-origin
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'X-Property-Code': propertyCode,
      ...(opts.headers || {}),
    },
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
        <a href="#" id="changeVenue" class="logout-link">Change Venue</a>
        <a href="#" id="logout" class="logout-link">Logout</a>
      </div>`;
    document.getElementById('changeVenue').onclick = async (e) => {
      e.preventDefault();
      // Logout using the current venue header before clearing the selection.
      await api('/logout', { method: 'POST' });
      state.me = { loggedIn: false };
      state.options = null;
      propertyCode = '';
      try {
        localStorage.removeItem('fp_property_code');
        localStorage.removeItem('fp_login');
      } catch (err) { /* ignore storage errors */ }
      applyBranding();
      renderNav();
      if (location.hash === '#/login') route();
      else location.hash = '#/login';
    };
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
  // Restore remembered credentials if the user opted in previously.
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('fp_login') || '{}'); } catch (e) { /* ignore */ }
  const selectedVenue = propertyCode || (VENUE_CODES.has(saved.propertyCode) ? saved.propertyCode : '');
  $app.innerHTML = `
    <div class="card auth-card">
      <h1>Admin Login</h1>
      <p class="subtitle">Sign in to open the Function Booking Form.</p>
      <div class="alert" id="err" style="display:none"></div>
      <form id="loginForm" novalidate>
        <div class="field">
          <label for="propertyCode">Venue</label>
          <select id="propertyCode" name="propertyCode" required>
            <option value="">Select venue…</option>
            ${VENUES.map(([code, name]) =>
              `<option value="${code}"${code === selectedVenue ? ' selected' : ''}>${esc(name)}</option>`
            ).join('')}
          </select>
        </div>
        <div class="field">
          <label for="username">Username</label>
          <input type="text" id="username" name="username" value="${esc(saved.username || '')}" autofocus>
        </div>
        <div class="field">
          <label for="password">Password</label>
          <div class="password-wrap">
            <input type="password" id="password" name="password" value="${esc(saved.password || '')}">
            <button type="button" id="togglePw" class="pw-toggle" aria-label="Show password">Show</button>
          </div>
        </div>
        <label class="inline remember">
          <input type="checkbox" id="remember"${saved.username ? ' checked' : ''}> Remember my ID &amp; password
        </label>
        <button type="submit" class="btn btn-block">Log in</button>
      </form>
    </div>`;
  if (msg) showErr(msg);

  // Show/hide password toggle.
  const pw = document.getElementById('password');
  const toggle = document.getElementById('togglePw');
  toggle.onclick = () => {
    const reveal = pw.type === 'password';
    pw.type = reveal ? 'text' : 'password';
    toggle.textContent = reveal ? 'Hide' : 'Show';
    toggle.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
  };

  document.getElementById('propertyCode').onchange = async (e) => {
    propertyCode = e.target.value;
    try { localStorage.setItem('fp_property_code', propertyCode); } catch (err) {}
    if (!propertyCode) return applyBranding();
    const result = await api('/options');
    if (result.ok) {
      state.options = result.data;
      applyBranding(result.data.propertyName);
    }
  };

  document.getElementById('loginForm').onsubmit = async (e) => {
    e.preventDefault();
    propertyCode = document.getElementById('propertyCode').value;
    const username = document.getElementById('username').value.trim();
    const password = pw.value;
    if (!VENUE_CODES.has(propertyCode)) return showErr('Select a venue.');
    try { localStorage.setItem('fp_property_code', propertyCode); } catch (err) {}
    // Save or clear remembered credentials based on the checkbox.
    try {
      if (document.getElementById('remember').checked) {
        localStorage.setItem('fp_login', JSON.stringify({ username, password, propertyCode }));
      } else {
        localStorage.removeItem('fp_login');
      }
    } catch (e) { /* ignore storage errors */ }
    const { ok, data } = await api('/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    if (ok) {
      const optionsResult = await api('/options');
      if (optionsResult.ok) {
        state.options = optionsResult.data;
        applyBranding(optionsResult.data.propertyName);
      }
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

// Changing the hash to its current value fires no hashchange event, so render
// the route directly in that case.
function goTo(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
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

// Plain text / select / textarea fields keyed by their `name`. (Mode of
// payment and other charges are handled separately — they are radio/checkbox
// groups.)
const SIMPLE_FIELDS = [
  'reservation_no', 'date', 'function_type', 'venue', 'mg', 'expected_pax',
  'time_slot', 'menu', 'party_name', 'company_name', 'gst_no', 'pan_no',
  'address', 'contact_person', 'telephone', 'email', 'seating_arrangement',
  'add_on_rooms', 'rate', 'hall_rent', 'advance_amt', 'transaction_details',
  'board_to_read', 'details_amount', 'billing_instruction', 'housekeeping',
  'fnb', 'kitchen',
];

// Fill the booking form's fields from an existing booking (edit mode).
function populateForm(b) {
  const form = document.getElementById('bookingForm');
  if (!form) return;

  SIMPLE_FIELDS.forEach((name) => {
    const el = form.querySelector(`[name="${name}"]`);
    if (el && b[name] != null) el.value = b[name];
  });

  // Mode of payment (radio group).
  const pay = form.querySelector(
    `[name="mode_of_payment"][value="${(b.mode_of_payment || '').replace(/"/g, '\\"')}"]`
  );
  if (pay) pay.checked = true;

  // Other charges (checkbox group) — stored as a comma-joined string.
  const charges = (b.other_charges || '').split(',').map((s) => s.trim());
  form.querySelectorAll('[name="other_charges"]').forEach((cb) => {
    cb.checked = charges.includes(cb.value);
  });

  // Allow keeping/choosing any date when editing (booking may already be past).
  const dateEl = form.querySelector('[name="date"]');
  if (dateEl) dateEl.removeAttribute('min');
}

function viewForm(editBooking) {
  const o = state.options;
  const editing = !!editBooking;
  // A draft is an unfinished booking: it can be saved with anything filled in
  // so far, carries no booking number yet and has not been emailed.
  const isDraft = editing && editBooking.status === 'draft';
  const series = editing
    ? esc(editBooking.series_no) || String(editBooking.id).padStart(3, '0')
    : '';
  const bookingNo = isDraft
    ? 'Assigned when submitted'
    : editing
    ? series
    : 'Auto (e.g. 001)';
  const heading = !editing
    ? 'Function Booking Form'
    : isDraft
    ? 'Edit Draft'
    : 'Edit Booking No ' + series;
  $app.innerHTML = `
    <div class="card">
      <h1>${heading}${isDraft ? ' <span class="badge badge-draft">Draft</span>' : ''}</h1>
      <p class="subtitle">${isDraft ? 'Saved' : 'Submitted'} by <strong>${esc(state.me.username)}</strong></p>
      <div class="alert" id="formErr" style="display:none"></div>
      <form id="bookingForm" novalidate>
        <div class="grid">
          <div class="field">
            <label>Booking No</label>
            <input type="text" value="${bookingNo}" readonly class="readonly">
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

        <div class="form-actions">
          <button type="submit" class="btn">${
            editing
              ? isDraft
                ? 'Submit Booking'
                : 'Update Booking'
              : 'Submit &amp; Save Booking'
          }</button>
          ${
            editing && !isDraft
              ? ''
              : `<button type="button" id="saveDraftBtn" class="btn btn-ghost">${
                  editing ? 'Save Draft' : 'Save as Draft'
                }</button>`
          }
        </div>
        ${
          editing && !isDraft
            ? ''
            : `<p class="hint">Saving a draft keeps whatever you have filled in
               so far — nothing is required and no email is sent. The booking
               number is issued when you submit it.</p>`
        }
      </form>
    </div>`;

  if (editing) {
    stopClock();
    const ts = document.getElementById('timestamp');
    if (ts) ts.value = new Date(editBooking.created_at).toLocaleString();
    populateForm(editBooking);
  } else {
    startClock();
  }

  const form = document.getElementById('bookingForm');

  // Both buttons save the same form; `status` decides whether this is a draft
  // (saved as-is, no email) or a real submission (validated + emailed).
  const save = async (status) => {
    const saveAsDraft = status === 'draft';
    const err = document.getElementById('formErr');
    err.style.display = 'none';
    form.querySelectorAll('.input-error').forEach((el) => el.classList.remove('input-error'));

    const fd = new FormData(form);
    const payload = { status };
    for (const [k, v] of fd.entries()) {
      if (k === 'other_charges') {
        (payload.other_charges = payload.other_charges || []).push(v);
      } else {
        payload[k] = v;
      }
    }
    const { ok, data } = await api(editing ? '/bookings/' + editBooking.id : '/bookings', {
      method: editing ? 'PUT' : 'POST',
      body: JSON.stringify(payload),
    });
    if (ok) {
      const id = editing ? editBooking.id : data.id;
      // Banner: a brand new draft, a newly submitted booking, or a plain edit.
      const flag = saveAsDraft ? '?draft=1' : editing && !isDraft ? '' : '?created=1';
      goTo('#/booking/' + id + flag);
      return;
    }
    if (data && data.errors) {
      err.textContent = saveAsDraft
        ? 'Could not save the draft — fill in at least one detail first.'
        : 'Please fill in all required fields marked with *.';
      err.style.display = 'block';
      // Highlight the missing fields.
      Object.keys(data.errors).forEach((name) => {
        const inp = form.querySelector(`[name="${name}"]`);
        if (inp) inp.classList.add('input-error');
      });
    } else {
      err.textContent = (data && data.error) || 'Could not save. Please try again.';
      err.style.display = 'block';
    }
    window.scrollTo(0, 0);
  };

  form.onsubmit = (e) => {
    e.preventDefault();
    save('submitted');
  };
  const draftBtn = document.getElementById('saveDraftBtn');
  if (draftBtn) draftBtn.onclick = () => save('draft');
}

// Status pill used in the bookings list and on a booking's page.
function statusBadge(b) {
  return b.status === 'draft'
    ? '<span class="badge badge-draft">Draft</span>'
    : '<span class="badge badge-ok">Submitted</span>';
}

async function viewBookings() {
  document.body.classList.add('wide');
  // Render a loading placeholder immediately so the previous view (e.g. the
  // New Booking form) doesn't linger on screen while the API request is in
  // flight — noticeable when the backend is waking from a cold start.
  $app.innerHTML = `
    <div class="card">
      <div class="card-head"><h1>Bookings</h1></div>
      <p class="subtitle">Loading bookings…</p>
    </div>`;
  const { ok, data } = await api('/bookings');
  if (!ok) return (location.hash = '#/login');

  const drafts = data.filter((b) => b.status === 'draft');
  const submitted = data.filter((b) => b.status !== 'draft');
  const GROUPS = {
    all: data,
    draft: drafts,
    submitted: submitted,
  };
  let filter = 'all';

  const row = (b) => `
      <tr class="row-link${b.status === 'draft' ? ' row-draft' : ''}" data-id="${b.id}">
        <td>${
          b.series_no
            ? `<strong>${esc(b.series_no)}</strong>`
            : '<span class="muted-cell">—</span>'
        }</td>
        <td>${statusBadge(b)}</td>
        <td>${esc(b.reservation_no) || '—'}</td>
        <td class="nowrap">${esc(b.date) || '—'}</td>
        <td>${esc(b.function_type) || '—'}</td>
        <td>${esc(b.venue) || '—'}</td>
        <td>${esc(b.party_name) || '—'}</td>
        <td class="nowrap">${esc(b.telephone) || '—'}</td>
        <td>${esc(b.submitted_by)}</td>
      </tr>`;

  const filters = [
    ['all', 'All', data.length],
    ['draft', 'Drafts', drafts.length],
    ['submitted', 'Submitted', submitted.length],
  ];

  $app.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h1>Bookings</h1>
        <a class="btn btn-sm" href="#/form">New Booking</a>
      </div>
      ${
        data.length
          ? `<div class="filter-row">
               ${filters
                 .map(
                   ([key, label, count]) =>
                     `<button type="button" class="filter-btn" data-filter="${key}">${label} (${count})</button>`
                 )
                 .join('')}
             </div>
             <table class="bookings-table">
              <thead><tr><th>Series No</th><th>Status</th><th>Res. No</th><th>Date</th>
              <th>Type</th><th>Venue</th><th>Party</th><th>Telephone</th>
              <th>By</th></tr></thead>
              <tbody id="bookingRows"></tbody></table>
             <p class="hint">Tip: click any row to view or download the booking.
             Drafts have no booking number until they are submitted.</p>`
          : `<p class="subtitle">No bookings yet. <a href="#/form">Create the first one</a>.</p>`
      }
    </div>`;

  if (!data.length) return;

  // Whole row navigates to the booking detail — no separate "View" column.
  const paint = () => {
    const rows = GROUPS[filter];
    const body = document.getElementById('bookingRows');
    body.innerHTML = rows.length
      ? rows.map(row).join('')
      : `<tr><td colspan="9" class="muted-cell">No ${filter === 'draft' ? 'drafts' : 'submitted bookings'} yet.</td></tr>`;
    body.querySelectorAll('tr.row-link').forEach((tr) => {
      tr.onclick = () => (location.hash = '#/booking/' + tr.dataset.id);
    });
    $app.querySelectorAll('.filter-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.filter === filter);
    });
  };

  $app.querySelectorAll('.filter-btn').forEach((btn) => {
    btn.onclick = () => {
      filter = btn.dataset.filter;
      paint();
    };
  });
  paint();
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

async function viewBooking(id, banner) {
  $app.innerHTML = `<div class="card"><p class="subtitle">Loading booking…</p></div>`;
  const { ok, data } = await api('/bookings/' + id);
  if (!ok) return (location.hash = '#/login');
  const b = data;
  const isDraft = b.status === 'draft';
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

  const banners = {
    created: `<div class="card center success-banner">
                <div class="checkmark">&#10003;</div>
                <h1>Booking saved</h1>
                <p class="subtitle">Booking No <strong>${series}</strong> has been recorded and emailed.</p>
              </div>`,
    draft: `<div class="card center success-banner draft-banner">
              <div class="checkmark">&#9998;</div>
              <h1>Draft saved</h1>
              <p class="subtitle">Nothing has been emailed yet. Come back any time to
              add the rest and submit it.</p>
            </div>`,
  };

  $app.innerHTML = `
    ${banners[banner] || ''}
    <div class="card">
      <div class="card-head">
        <h1>${isDraft ? 'Draft Booking' : 'Booking No ' + series} ${statusBadge(b)}</h1>
        <div class="card-actions">
          ${
            isDraft
              ? `<a class="btn btn-sm" href="#/booking/${b.id}/edit">Continue Editing</a>
                 <button class="btn btn-sm btn-ghost" id="submitDraftBtn">Submit Booking</button>
                 <button class="btn btn-sm btn-ghost" id="pdfBtn">Download PDF (A4)</button>`
              : `<button class="btn btn-sm" id="pdfBtn">Download PDF (A4)</button>
                 <button class="btn btn-sm btn-ghost" id="resendBtn">Resend Email</button>
                 <a class="btn btn-sm btn-ghost" href="#/booking/${b.id}/edit">Edit</a>`
          }
          <a class="btn btn-sm btn-ghost" href="#/form">New Booking</a>
        </div>
      </div>
      <p class="subtitle">${
        isDraft
          ? `Saved by <strong>${esc(b.submitted_by)}</strong> · last saved ${esc(new Date(b.updated_at || b.created_at).toLocaleString())}`
          : `Submitted by <strong>${esc(b.submitted_by)}</strong> · ${esc(new Date(b.created_at).toLocaleString())}`
      }</p>
      ${
        isDraft
          ? `<p class="hint">This draft has no booking number yet and has not been
             emailed. Its PDF is stamped DRAFT. Submitting it issues the next
             booking number and sends the email.</p>`
          : ''
      }
      ${sections}
    </div>`;

  document.getElementById('pdfBtn').onclick = () => printBooking(b);

  // Submit a draft straight from here, using the values already saved. If
  // anything required is still missing, open the form so it can be completed.
  const submitDraftBtn = document.getElementById('submitDraftBtn');
  if (submitDraftBtn) {
    submitDraftBtn.onclick = async () => {
      if (!confirm('Submit this booking? It will be given a booking number and emailed to the internal recipient list.')) return;
      submitDraftBtn.disabled = true;
      submitDraftBtn.textContent = 'Submitting…';
      const payload = { status: 'submitted', mode_of_payment: b.mode_of_payment || '' };
      SIMPLE_FIELDS.forEach((key) => { payload[key] = b[key] || ''; });
      payload.other_charges = (b.other_charges || '')
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      const result = await api('/bookings/' + b.id, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      submitDraftBtn.disabled = false;
      submitDraftBtn.textContent = 'Submit Booking';
      if (result.ok) return goTo('#/booking/' + b.id + '?created=1');
      alert(
        (result.data && result.data.errors)
          ? 'Some required details are still missing — opening the form so you can complete them.'
          : 'Could not submit: ' + ((result.data && result.data.error) || 'unknown error')
      );
      if (result.data && result.data.errors) location.hash = '#/booking/' + b.id + '/edit';
    };
  }

  const resendBtn = document.getElementById('resendBtn');
  if (resendBtn) {
    resendBtn.onclick = async () => {
      if (!confirm('Email this booking PDF to the internal recipient list now?')) return;
      resendBtn.disabled = true;
      resendBtn.textContent = 'Sending…';
      const { ok, data } = await api('/bookings/' + b.id + '/resend', { method: 'POST' });
      resendBtn.disabled = false;
      resendBtn.textContent = 'Resend Email';
      if (ok) alert(`Email sent to ${data.recipients} recipient(s).`);
      else alert('Email failed: ' + ((data && data.error) || 'unknown error'));
    };
  }
}

// Loads a booking, then opens the form pre-filled for editing.
async function viewEditBooking(id) {
  $app.innerHTML = `<div class="card"><p class="subtitle">Loading booking…</p></div>`;
  const { ok, data } = await api('/bookings/' + id);
  if (!ok) return (location.hash = '#/login');
  viewForm(data);
}

// Downloads the booking's single-page A4 PDF from the backend (same layout that
// is emailed). Uses a credentialed blob fetch + temporary link so it works even
// when pop-ups are blocked, instead of the old window.open()/window.print().
async function printBooking(b) {
  const btn = document.getElementById('pdfBtn');
  const label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Preparing…'; }
  try {
    const res = await fetch(API_BASE + '/api/bookings/' + b.id + '/pdf', {
      credentials: 'include',
      headers: { 'X-Property-Code': propertyCode },
    });
    if (!res.ok) {
      let msg = 'HTTP ' + res.status;
      try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (e) {}
      throw new Error(msg);
    }
    const blob = await res.blob();
    const series = esc(b.series_no) || String(b.id).padStart(3, '0');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = b.status === 'draft' ? `Draft-${b.id}.pdf` : `Booking-${series}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert('Could not download PDF: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = label; }
  }
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
  const em = path.match(/^\/booking\/(\d+)\/edit$/);
  if (em) return viewEditBooking(em[1]);
  const m = path.match(/^\/booking\/(\d+)$/);
  if (m) {
    const q = query || '';
    return viewBooking(
      m[1],
      /created=1/.test(q) ? 'created' : /draft=1/.test(q) ? 'draft' : ''
    );
  }
  if (path === '/login') return (location.hash = '#/form');
  viewForm();
}

// --- Init -------------------------------------------------------------------

// The backend resolves the selected venue code to a trusted venue name.
// Replace the generic index.html branding once /api/options has answered.
function applyBranding(name) {
  const propertyName = name || 'Function Booking';
  document.title = name ? `${propertyName} — Function Booking` : propertyName;
  document.getElementById('brand').textContent = propertyName;
  document.getElementById('footer-brand').textContent = `© ${propertyName}`;
}

async function init() {
  if (!propertyCode) {
    state.me = { loggedIn: false };
    applyBranding();
    renderNav();
    window.addEventListener('hashchange', route);
    route();
    return;
  }
  const [me, options] = await Promise.all([
    api('/me').then((r) => r.data),
    api('/options').then((r) => r.data),
  ]);
  state.me = me;
  state.options = options;
  applyBranding(options && options.propertyName);
  renderNav();
  window.addEventListener('hashchange', route);
  route();
}

init();
