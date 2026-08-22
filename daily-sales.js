// ============================================================
// DAILY SALES
// ============================================================
// The daily takings book, moved out of the "Sales <year>" spreadsheets and
// into BloomBooks. Figures here are TAX-EXCLUSIVE: what was actually earned,
// with tax recorded alongside but never counted as revenue, because collected
// sales tax is owed to New York State and was never income.
//
// Why move it at all: every difficulty reading those spreadsheets came from
// them being spreadsheets. Sales 2023 begins in July; Sales 2026's Sep-Dec
// tabs hold byte-identical copies of 2025's; Dec 9 2023 has no Total formula
// so $775 of real sales vanished from the daily row; recorded tax ranges from
// 0.63% to 7.18% of sales month to month. Owning the data removes that class
// of problem rather than defending against it.
//
// Channels are DATA, not code. TF is already legacy, Venmo becomes legacy once
// the farmer's market goes through the POS, and FN has just split into Web and
// POS. Hardcoding the list guarantees this same migration again in a year.

const DEFAULT_CHANNELS = [
  { id: 'web',   label: 'Web',   active: true  },
  { id: 'pos',   label: 'POS',   active: true  },
  { id: 'cash',  label: 'Cash',  active: true  },
  { id: 'epx',   label: 'EPX',   active: true  },
  { id: 'venmo', label: 'Venmo', active: true  },
  // Retired: kept so historical months still display, hidden from entry.
  // FN predates the Web/POS split and cannot be divided retrospectively.
  { id: 'fn',    label: 'FN',    active: false },
  { id: 'tf',    label: 'TF',    active: false },
];

function dsChannels() {
  if (!Array.isArray(appData.channels) || !appData.channels.length) {
    appData.channels = DEFAULT_CHANNELS.map(c => ({ ...c }));
  }
  return appData.channels;
}

// Channels worth showing for a given month: the active ones, plus any retired
// one that actually carries a figure that month. A retired channel must never
// silently hide money that was recorded under it.
function dsChannelsFor(year, month) {
  const all = dsChannels();
  const days = dsMonth(year, month);
  const used = new Set();
  Object.values(days).forEach(day => {
    Object.keys(day || {}).forEach(k => {
      if (k.startsWith('_')) return;
      const v = day[k];
      if (v && (Number(v.s) || Number(v.t))) used.add(k);
    });
  });
  return all.filter(c => c.active || used.has(c.id));
}

const dsKey = (year, month) => `${year}-${month}`;

function dsMonth(year, month) {
  if (!appData.dailySales) appData.dailySales = {};
  const k = dsKey(year, month);
  if (!appData.dailySales[k]) appData.dailySales[k] = {};
  return appData.dailySales[k];
}

function dsDay(year, month, day) {
  const m = dsMonth(year, month);
  if (!m[day]) m[day] = {};
  return m[day];
}

const dsNum = v => {
  const n = parseFloat(String(v == null ? '' : v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

// field is 's' (sales, tax-exclusive) or 't' (tax collected)
function dsSet(year, month, day, chId, field, value) {
  const d = dsDay(year, month, day);
  const raw = String(value).trim();
  if (!d[chId]) d[chId] = {};
  if (raw === '') delete d[chId][field]; else d[chId][field] = dsNum(raw);
  if (!Object.keys(d[chId]).length) delete d[chId];
  if (!Object.keys(d).length) delete dsMonth(year, month)[day];
  saveData();
  renderDailySalesPanel();
}

function dsSetNote(year, month, day, value) {
  const d = dsDay(year, month, day);
  const v = String(value).trim();
  if (v) d._note = v; else delete d._note;
  if (!Object.keys(d).length) delete dsMonth(year, month)[day];
  saveData();
}

function dsDayTotal(year, month, day, field) {
  const d = dsMonth(year, month)[day] || {};
  return Object.keys(d).reduce((s, k) => k.startsWith('_') ? s : s + dsNum((d[k] || {})[field || 's']), 0);
}

// Month totals, and the figure the books should treat as revenue: sales only,
// never tax.
function dsMonthTotals(year, month) {
  const days = dsMonth(year, month);
  let sales = 0, tax = 0;
  const byChannel = {};
  Object.keys(days).forEach(day => {
    const d = days[day] || {};
    Object.keys(d).forEach(k => {
      if (k.startsWith('_')) return;
      const s = dsNum((d[k] || {}).s), t = dsNum((d[k] || {}).t);
      sales += s; tax += t;
      if (!byChannel[k]) byChannel[k] = { s: 0, t: 0 };
      byChannel[k].s += s; byChannel[k].t += t;
    });
  });
  return { sales, tax, byChannel };
}

// ---- channel admin ----------------------------------------
function dsToggleChannel(id) {
  const c = dsChannels().find(x => x.id === id);
  if (!c) return;
  c.active = !c.active;
  saveData();
  renderDailySalesPanel();
}

function dsAddChannel() {
  const label = (prompt('Name for the new channel (e.g. "Square")') || '').trim();
  if (!label) return;
  const id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!id) { notify('That name has no letters or numbers in it', true); return; }
  if (dsChannels().some(c => c.id === id)) { notify('There is already a channel with that name', true); return; }
  dsChannels().push({ id, label, active: true });
  saveData();
  renderDailySalesPanel();
}

// ---- rendering --------------------------------------------
let dsViewYear = null, dsViewMonth = null;

function dsSetView(year, month) {
  dsViewYear = parseInt(year, 10);
  dsViewMonth = parseInt(month, 10);
  renderDailySalesPanel();
}

function renderDailySalesPanel() {
  const el = document.getElementById('daily-sales-content');
  if (!el) return;

  if (dsViewYear == null) dsViewYear = appData.activeYear;
  if (dsViewMonth == null) dsViewMonth = new Date().getMonth();

  const year = dsViewYear, month = dsViewMonth;
  const chans = dsChannelsFor(year, month);
  const len = new Date(year, month + 1, 0).getDate();
  const totals = dsMonthTotals(year, month);
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const cell = (day, ch, field) => {
    const v = ((dsMonth(year, month)[day] || {})[ch.id] || {})[field];
    return `<input type="number" step="0.01" value="${v == null ? '' : v}"
      onchange="dsSet(${year},${month},${day},'${ch.id}','${field}',this.value)"
      class="ds-cell" inputmode="decimal">`;
  };

  el.innerHTML = `
    <div class="staging-controls">
      <div class="form-group" style="min-width:120px">
        <label>Year</label>
        <select onchange="dsSetView(this.value, ${month})">
          ${(appData.years || []).map(y => `<option value="${y}" ${y === year ? 'selected' : ''}>${y}</option>`).join('')}
        </select>
      </div>
      <div class="form-group" style="min-width:140px">
        <label>Month</label>
        <select onchange="dsSetView(${year}, this.value)">
          ${MONTHS.map((m, i) => `<option value="${i}" ${i === month ? 'selected' : ''}>${m}</option>`).join('')}
        </select>
      </div>
      <div style="align-self:flex-end;margin-left:auto;text-align:right">
        <div style="font-size:0.7rem;color:var(--mist);text-transform:uppercase;letter-spacing:0.08em">Month sales (ex tax)</div>
        <div class="kpi-value" style="font-size:1.3rem">${fmt(totals.sales)}</div>
        <div style="font-size:0.72rem;color:var(--mist)">tax collected ${fmt(totals.tax)}</div>
      </div>
    </div>

    <div class="ledger-wrap">
      <div class="staging-table-wrap">
        <table class="ds-table">
          <thead>
            <tr>
              <th rowspan="2" style="text-align:left">Day</th>
              ${chans.map(c => `<th colspan="2" style="text-align:center${c.active ? '' : ';opacity:0.6'}">${escHtml(c.label)}${c.active ? '' : ' <span style="font-size:0.6rem">(retired)</span>'}</th>`).join('')}
              <th rowspan="2">Total</th>
              <th rowspan="2" style="text-align:left">Note</th>
            </tr>
            <tr>
              ${chans.map(() => `<th style="font-size:0.6rem">sales</th><th style="font-size:0.6rem">tax</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${Array.from({ length: len }, (_, i) => i + 1).map(day => {
              const dow = DOW[new Date(year, month, day).getDay()];
              const tot = dsDayTotal(year, month, day, 's');
              const note = (dsMonth(year, month)[day] || {})._note || '';
              const weekend = dow === 'Sun';
              return `<tr${weekend ? ' style="background:var(--paper)"' : ''}>
                <td style="white-space:nowrap"><strong>${day}</strong> <span style="color:var(--mist);font-size:0.72rem">${dow}</span></td>
                ${chans.map(c => `<td>${cell(day, c, 's')}</td><td>${cell(day, c, 't')}</td>`).join('')}
                <td class="${tot ? 'amount-in' : ''}" style="text-align:right;white-space:nowrap">${tot ? fmt(tot) : ''}</td>
                <td><input type="text" value="${escHtml(note)}" placeholder="—"
                     onchange="dsSetNote(${year},${month},${day},this.value)"
                     style="width:100%;min-width:120px;border:1px solid var(--border);border-radius:4px;padding:3px 6px;font-family:Inter,sans-serif;font-size:0.75rem"></td>
              </tr>`;
            }).join('')}
          </tbody>
          <tfoot>
            <tr style="font-weight:600;border-top:2px solid var(--blue-light)">
              <td>Total</td>
              ${chans.map(c => {
                const b = totals.byChannel[c.id] || { s: 0, t: 0 };
                return `<td style="text-align:right;white-space:nowrap">${b.s ? fmt(b.s) : ''}</td>
                        <td style="text-align:right;white-space:nowrap;color:var(--mist)">${b.t ? fmt(b.t) : ''}</td>`;
              }).join('')}
              <td class="amount-in" style="text-align:right;white-space:nowrap">${fmt(totals.sales)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>

    <div class="staging-area" style="margin-top:16px">
      <h3>Channels</h3>
      <p style="color:var(--mist);font-size:0.75rem;margin-bottom:10px">
        Retiring a channel hides it from entry but keeps every figure already recorded under it,
        and it reappears on any month that used it.
      </p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        ${dsChannels().map(c => `
          <button class="btn btn-sm ${c.active ? 'btn-primary' : 'btn-outline'}"
                  onclick="dsToggleChannel('${c.id}')"
                  title="${c.active ? 'Retire this channel' : 'Bring this channel back'}">
            ${escHtml(c.label)}${c.active ? '' : ' · retired'}
          </button>`).join('')}
        <button class="btn btn-outline btn-sm" onclick="dsAddChannel()">+ Add channel</button>
      </div>
    </div>
  `;
}
