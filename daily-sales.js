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

// ============================================================
// IMPORT FROM THE OLD SALES SHEETS
// ============================================================
// One-time migration of 2023-2026. Reuses the workbook reader the Holiday
// Revenue refresh uses, so the calendar validation that catches a tab holding
// another year's figures applies here too.
//
// Row labels are matched case-insensitively and drift between months --
// December 2025 writes "fsn" where every other month writes "FN" -- so
// anything unrecognised is REPORTED rather than dropped. An unmapped label is
// a whole channel of takings going missing, which would look like a quiet,
// plausible shortfall rather than an error.
//
// Sales only. Historical tax is deliberately not imported: it is already paid,
// so there is nothing left to track, and the recorded figures are patchy.
const DS_LABEL_MAP = {
  fn: 'fn', fsn: 'fn',          // pre-split combined channel
  cc: 'epx',                    // "CC" is the EPX card machine
  web: 'web',
  c: 'cash',
  tf: 'tf',
  venmo: 'venmo',
};

let dsImport = null;   // { year, days, months, byChannel, unknown, problems, existing }

async function dsRunImport(year) {
  year = parseInt(year, 10);
  if (!accessToken) { notify('Sign in to sync first', true); return; }
  const sheetId = getSalesSheetId(year);
  if (!sheetId) { notify(`No Sales workbook set for ${year} — add it on the Holiday Revenue page`, true); return; }

  dsImport = { year, loading: true };
  renderDailySalesPanel();

  const problems = [];
  let byChannel, dailyTotals;
  try {
    ({ byChannel, daily: dailyTotals } = await readSalesWorkbook(sheetId, year, problems));
  } catch (e) {
    dsImport = null;
    renderDailySalesPanel();
    notify('Could not read that workbook: ' + describeSheetError(e), true);
    return;
  }

  const days = {};          // 'YYYY-MM-DD' -> { channelId: sales }
  const totals = {};        // channelId -> sales
  const unknown = {};       // raw label -> total amount that would be lost
  const months = new Set();

  Object.keys(byChannel).forEach(iso => {
    const row = byChannel[iso];
    Object.keys(row).forEach(label => {
      const id = DS_LABEL_MAP[label.trim().toLowerCase()];
      const amt = row[label];
      if (!id) { unknown[label] = (unknown[label] || 0) + amt; return; }
      if (!days[iso]) days[iso] = {};
      days[iso][id] = (days[iso][id] || 0) + amt;
      totals[id] = (totals[id] || 0) + amt;
      months.add(iso.slice(0, 7));
    });
  });

  // Does each day's Total row agree with the channel rows beneath it? The
  // import takes the channels, because that is the breakdown being migrated,
  // but the Total is what the sheet has always shown and what the Holiday
  // Revenue figures were read from. Where they disagree, money exists in one
  // view and not the other, and the difference would vanish without a word.
  // Real case: 24 Dec 2025 totals $1,285.00 while its channels add to
  // $1,245.00, leaving $40 attributed to nothing.
  const mismatches = [];
  Object.keys(dailyTotals || {}).forEach(iso => {
    const total = dailyTotals[iso];
    const summed = Object.keys(byChannel[iso] || {}).reduce((s, k) => s + byChannel[iso][k], 0);
    if (Math.abs(total - summed) > 0.005) {
      mismatches.push({ iso, total, summed, diff: Math.round((total - summed) * 100) / 100 });
    }
  });

  // Which months already hold figures? Importing must not silently overwrite
  // anything entered by hand since the migration began.
  const existing = [];
  months.forEach(ym => {
    const [y, m] = ym.split('-');
    const key = dsKey(+y, +m - 1);
    const have = (appData.dailySales || {})[key];
    if (have && Object.keys(have).length) existing.push(ym);
  });

  dsImport = { year, days, totals, unknown, problems, mismatches, months: [...months].sort(), existing, loading: false };
  renderDailySalesPanel();
}

function dsApplyImport() {
  if (!dsImport || dsImport.loading) return;
  if (!appData.dailySales) appData.dailySales = {};
  let n = 0;
  Object.keys(dsImport.days).forEach(iso => {
    const [y, m, d] = iso.split('-').map(Number);
    const day = dsDay(y, m - 1, d);
    Object.keys(dsImport.days[iso]).forEach(id => {
      if (!day[id]) day[id] = {};
      day[id].s = Math.round(dsImport.days[iso][id] * 100) / 100;
    });
    n++;
  });
  // Any legacy channel that arrived with figures must exist, or its takings
  // would be stored but never displayed.
  const known = new Set(dsChannels().map(c => c.id));
  Object.keys(dsImport.totals).forEach(id => {
    if (known.has(id)) return;
    dsChannels().push({ id, label: id.toUpperCase(), active: false });
  });
  const year = dsImport.year;
  dsImport = null;
  saveData();
  dsViewYear = year;
  renderDailySalesPanel();
  notify(`Imported ${n} days from Sales ${year}`);
}

function dsDismissImport() { dsImport = null; renderDailySalesPanel(); }

function dsImportHtml() {
  if (!dsImport) {
    return `
      <div class="staging-area" style="margin-top:16px">
        <h3>Import from the old Sales sheets</h3>
        <p style="color:var(--mist);font-size:0.75rem;margin-bottom:10px">
          Brings the daily figures across from the “Sales &lt;year&gt;” workbooks. Sales only —
          historical tax is not imported, since it has already been paid. Nothing is written until you approve it.
        </p>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${(appData.years || []).slice().sort((a, b) => a - b).map(y =>
            `<button class="btn btn-outline btn-sm" onclick="dsRunImport(${y})">Read Sales ${y}</button>`).join('')}
        </div>
      </div>`;
  }
  if (dsImport.loading) {
    return `<div class="staging-area" style="margin-top:16px"><h3>Reading Sales ${dsImport.year}…</h3></div>`;
  }

  const { year, totals, unknown, problems, months, existing, mismatches } = dsImport;
  const chanLabel = id => (dsChannels().find(c => c.id === id) || {}).label || id.toUpperCase();
  const unknownKeys = Object.keys(unknown);
  const dayCount = Object.keys(dsImport.days).length;

  return `
    <div class="staging-area" style="margin-top:16px">
      <h3>Sales ${year} — what this would bring in</h3>
      <div class="staging-table-wrap">
        <table>
          <thead><tr><th>Channel</th><th style="text-align:right">Sales</th></tr></thead>
          <tbody>
            ${Object.keys(totals).sort((a, b) => totals[b] - totals[a]).map(id => `
              <tr><td><strong>${escHtml(chanLabel(id))}</strong></td>
                  <td class="amount-in" style="text-align:right">${fmt(totals[id])}</td></tr>`).join('')}
            <tr style="font-weight:600;border-top:2px solid var(--blue-light)">
              <td>${dayCount} days across ${months.length} month${months.length === 1 ? '' : 's'}</td>
              <td class="amount-in" style="text-align:right">${fmt(Object.values(totals).reduce((a, b) => a + b, 0))}</td>
            </tr>
          </tbody>
        </table>
      </div>

      ${unknownKeys.length ? `
        <div style="margin-top:12px;padding:10px;border-radius:6px;background:var(--red-light);border:1px solid var(--red)">
          <strong style="font-size:0.8rem;color:var(--red)">Unrecognised rows — these would NOT be imported</strong>
          <ul style="margin:6px 0 0 18px;font-size:0.75rem;color:var(--ink-soft)">
            ${unknownKeys.map(k => `<li>“${escHtml(k)}” — ${fmt(unknown[k])}</li>`).join('')}
          </ul>
          <div style="font-size:0.72rem;color:var(--ink-soft);margin-top:6px">
            Tell Claude about these rather than importing without them.
          </div>
        </div>` : ''}

      ${mismatches && mismatches.length ? `
        <div style="margin-top:12px;padding:10px;border-radius:6px;background:#fff3cd;border:1px solid #ffc107">
          <strong style="font-size:0.8rem">The day's Total disagrees with its channels (${mismatches.length})</strong>
          <div style="font-size:0.72rem;color:var(--ink-soft);margin-top:4px">
            Only the channel figures are imported, so the difference is not carried across.
            Add it to whichever channel it belongs to after importing.
          </div>
          <ul style="margin:6px 0 0 18px;font-size:0.75rem;color:var(--ink-soft)">
            ${mismatches.slice(0, 10).map(m =>
              `<li>${escHtml(m.iso)} — total ${fmt(m.total)}, channels ${fmt(m.summed)}, ${m.diff > 0 ? 'missing' : 'over by'} ${fmt(Math.abs(m.diff))}</li>`).join('')}
            ${mismatches.length > 10 ? `<li>…and ${mismatches.length - 10} more</li>` : ''}
          </ul>
        </div>` : ''}

      ${existing.length ? `
        <div style="margin-top:12px;padding:10px;border-radius:6px;background:#fff3cd;border:1px solid #ffc107">
          <strong style="font-size:0.8rem">Already has figures — importing overwrites these months</strong>
          <div style="font-size:0.75rem;margin-top:4px">${existing.map(escHtml).join(', ')}</div>
        </div>` : ''}

      ${problems.length ? `
        <div style="margin-top:12px;padding:10px;border-radius:6px;background:var(--paper);border:1px solid var(--border)">
          <strong style="font-size:0.8rem">Notes from the workbook (${problems.length})</strong>
          <ul style="margin:6px 0 0 18px;font-size:0.72rem;color:var(--ink-soft)">
            ${problems.slice(0, 12).map(p => `<li>${escHtml(p)}</li>`).join('')}
            ${problems.length > 12 ? `<li>…and ${problems.length - 12} more</li>` : ''}
          </ul>
        </div>` : ''}

      <div style="margin-top:12px;display:flex;gap:8px">
        <button class="btn btn-primary" onclick="dsApplyImport()" ${dayCount ? '' : 'disabled'}>
          ${dayCount ? `Import ${dayCount} days` : 'Nothing to import'}
        </button>
        <button class="btn btn-outline" onclick="dsDismissImport()">Cancel</button>
      </div>
    </div>`;
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

    ${dsImportHtml()}
  `;
}
