// ===========================================================================
// VENMO — the market statement, against the day book
// ===========================================================================
// Venmo is the farmers market. Unlike the counter card machine, its statement
// carries a REAL per-sale tax figure -- Venmo charged it, itemised it and
// reports it -- so this is a genuine second source rather than the same
// arithmetic written down twice. That is why these days are worth importing
// and the EPX ones are worth deriving: see dsDayTax.
//
// Three kinds of row are money, and they do not agree on what "total" means.
// Both readings below were checked against every row of three real statements:
//
//   Card Payment      the reader at the market. "Amount (total)" is NET of
//                     Venmo's fee, so the sale is (total + fee) - tax. On all
//                     28 card rows that lands on an exact round dollar --
//                     $25.00, $35.00, $40.00 -- which is what confirms the
//                     reading. Reading total as gross gives $24.34 and $34.11.
//
//   Payment           somebody Venmo'ing for a stem on a weekday. Venmo records
//                     no tax and a rate of 0, and "total" is what the sender
//                     sent. $5.42 and $6.50 are $5.00 and $6.00 with the tax
//                     already inside, so it is backed out at the rate.
//
//   Card Payment Refund   carries no tax figure, and "total" is the gross being
//                     returned. Backed out the same way, so it reverses the
//                     sale AND its tax.
//
// Everything else -- Internal Balance Transfer, Standard Transfer -- is money
// moving between the shop's own accounts, not a sale, and is ignored.
// ---------------------------------------------------------------------------

const VM_CHANNEL = 'venmo';
const VM_SALE_TYPES = ['card payment', 'payment', 'card payment refund'];

function vmRate() {
  return typeof DS_TAX_RATE === 'number' ? DS_TAX_RATE : 0.08375;
}

// A comma inside a quoted field is not a delimiter, and Venmo quotes the
// transaction id and any note the customer typed. Splitting on commas put the
// second half of "Lexi - single rose, thanks!" in the From column.
function vmParseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\r') { /* ignore */ }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// "+ $26.38" and "- $1.08" and a bare "0.71" all appear in the same file, and
// the sign lives with the dollar sign rather than on the number.
function vmMoney(raw) {
  const s = String(raw == null ? '' : raw);
  const neg = /-\s*\$?\s*[\d.]/.test(s);
  const n = parseFloat(s.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n)) return 0;
  return neg ? -n : n;
}

function vmIso(mmddyyyy) {
  const m = String(mmddyyyy || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

const vmR2 = n => Math.round(n * 100) / 100;

function vmLooksLikeVenmo(text) {
  const t = String(text || '').slice(0, 4000);
  return /Amount \(total\)/.test(t) && /Transaction ID/.test(t);
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------
function vmParseStatement(text) {
  const rows = vmParseCsv(text);
  const head = rows.find(r => r.indexOf('Amount (total)') >= 0);
  if (!head) return null;
  const H = {};
  head.forEach((h, i) => { H[String(h).trim()] = i; });
  const need = ['Date', 'Type', 'Amount (total)', 'Amount (tax)', 'Amount (fee)'];
  if (need.some(k => H[k] == null)) return null;

  const rate = vmRate();
  const out = [], skipped = {};
  let started = false;

  rows.forEach(r => {
    if (r === head) { started = true; return; }
    if (!started) return;
    const type = String(r[H['Type']] || '').trim();
    if (!type) return;
    const key = type.toLowerCase();
    const date = vmIso(r[H['Date']]);
    if (VM_SALE_TYPES.indexOf(key) < 0 || !date) {
      if (type) skipped[type] = (skipped[type] || 0) + 1;
      return;
    }

    const total = vmMoney(r[H['Amount (total)']]);
    const fee = Math.abs(vmMoney(r[H['Amount (fee)']]));
    const tax = vmMoney(r[H['Amount (tax)']]);
    const note = String(r[H['Note']] == null ? '' : r[H['Note']]).trim();
    const from = String(r[H['From']] == null ? '' : r[H['From']]).trim();

    let sale, taxAmt, basis;
    if (key === 'card payment') {
      // The fee is deducted from what the customer was charged, so add it back
      // before taking the tax out. Venmo's own tax figure is used as given.
      const gross = total + (total < 0 ? -fee : fee);
      taxAmt = tax;
      sale = vmR2(gross - taxAmt);
      basis = 'itemised';
    } else {
      // No tax figure and a rate of 0: the amount is what the customer paid,
      // tax already inside it.
      sale = vmR2(total / (1 + rate));
      taxAmt = vmR2(total - sale);
      basis = 'inclusive';
    }
    out.push({ date, type, from, note, total, fee,
               sale: sale, tax: vmR2(taxAmt), basis,
               refund: key === 'card payment refund' });
  });

  if (!out.length) return null;
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const days = {};
  out.forEach(r => {
    const d = days[r.date] || (days[r.date] = { date: r.date, sale: 0, tax: 0, rows: [], inclusive: 0 });
    d.sale += r.sale; d.tax += r.tax; d.rows.push(r);
    if (r.basis === 'inclusive') d.inclusive++;
  });
  Object.keys(days).forEach(k => { days[k].sale = vmR2(days[k].sale); days[k].tax = vmR2(days[k].tax); });

  return { rows: out, days,
           from: out[0].date, to: out[out.length - 1].date,
           skipped, rate,
           sale: vmR2(out.reduce((s, r) => s + r.sale, 0)),
           tax: vmR2(out.reduce((s, r) => s + r.tax, 0)) };
}

// ---------------------------------------------------------------------------
// Against the day book
// ---------------------------------------------------------------------------
function vmDayCell(iso) {
  if (typeof appData === 'undefined' || !appData.dailySales || !iso) return null;
  const d = new Date(iso + 'T00:00:00Z');
  const month = appData.dailySales[`${d.getUTCFullYear()}-${d.getUTCMonth()}`];
  const rec = month && month[String(d.getUTCDate())];
  const cell = rec && rec[VM_CHANNEL];
  return cell && typeof cell === 'object' ? cell : null;
}

// Every day the statement covers, plus any day already in the book inside that
// span that the statement says nothing about. The second half is the point: a
// day recorded as Venmo takings with no Venmo behind it is the finding, and
// dropping it would hide exactly the thing worth seeing.
function vmCompare(parsed) {
  if (!parsed) return null;
  const seen = {};
  const rows = Object.keys(parsed.days).sort().map(iso => {
    seen[iso] = 1;
    const cell = vmDayCell(iso);
    const day = parsed.days[iso];
    const book = cell ? Number(cell.s) || 0 : null;
    return { date: iso, day, book,
             bookTax: cell && cell.t != null ? Number(cell.t) || 0 : null,
             diff: book == null ? null : vmR2(book - day.sale) };
  });

  const orphans = [];
  if (typeof appData !== 'undefined' && appData.dailySales) {
    const start = new Date(parsed.from + 'T00:00:00Z'), end = new Date(parsed.to + 'T00:00:00Z');
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      if (seen[iso]) continue;
      const cell = vmDayCell(iso);
      if (cell && Number(cell.s)) orphans.push({ date: iso, book: Number(cell.s) });
    }
  }

  const off = rows.filter(r => r.book != null && Math.abs(r.diff) > 0.005);
  const missing = rows.filter(r => r.book == null);
  return { rows, orphans, off, missing,
           bookTotal: vmR2(rows.reduce((s, r) => s + (r.book || 0), 0)),
           stmtTotal: parsed.sale, stmtTax: parsed.tax };
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------
// The statement is the authority on what Venmo took and taxed, so a day it
// covers is written whole: sale, tax, and the taxable base. Only the Venmo
// channel of that day is touched.
function vmSetDay(iso, sale, tax) {
  if (typeof appData === 'undefined' || !iso) return false;
  const d = new Date(iso + 'T00:00:00Z');
  const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
  const day = String(d.getUTCDate());
  if (!appData.dailySales) appData.dailySales = {};
  if (!appData.dailySales[key]) appData.dailySales[key] = {};
  const rec = appData.dailySales[key][day] || (appData.dailySales[key][day] = {});
  rec[VM_CHANNEL] = { s: vmR2(sale), t: vmR2(tax), x: vmR2(sale) };
  return true;
}

function vmApplyDay(iso) {
  const p = vmStatement;
  if (!p || !p.days[iso]) return;
  vmSetDay(iso, p.days[iso].sale, p.days[iso].tax);
  saveData();
  notify(`${iso} Venmo set to ${fmt(p.days[iso].sale)} plus ${fmt(p.days[iso].tax)} tax`);
  vmRender();
  if (typeof renderDailySalesPanel === 'function') renderDailySalesPanel();
}

// Days the statement and the book already agree on are still written, because
// agreeing on the sale says nothing about the tax -- which is the figure that
// was missing in the first place.
function vmApplyAll() {
  const p = vmStatement;
  if (!p) return;
  let n = 0;
  Object.keys(p.days).forEach(iso => { if (vmSetDay(iso, p.days[iso].sale, p.days[iso].tax)) n++; });
  if (n) saveData();
  notify(`${n} Venmo day${n === 1 ? '' : 's'} written from the statement`);
  vmRender();
  if (typeof renderDailySalesPanel === 'function') renderDailySalesPanel();
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
let vmStatement = null;

function vmRender() {
  const el = document.getElementById('venmo-report');
  if (el) el.innerHTML = vmReportHtml();
}

function vmReportHtml() {
  const p = vmStatement;
  if (!p) {
    return `<div style="font-size:0.78rem;color:var(--mist);padding:8px 0">
      No statement loaded. Download the month from Venmo — Statements → CSV — and upload it here.
      Unlike the card machine, Venmo itemises the tax on each sale, so these days come in with a
      real tax figure rather than one worked out from the total.</div>`;
  }

  const c = vmCompare(p);
  const bad = c.off.length + c.missing.length + c.orphans.length;
  // A refund is backed out at the rate too, but it is not somebody sending for
  // a stem and must not be offered as an example of one.
  const inclusive = p.rows.filter(r => r.basis === 'inclusive' && !r.refund);
  const refunds = p.rows.filter(r => r.refund);

  const dayRows = c.rows.map(r => {
    const wrong = r.book != null && Math.abs(r.diff) > 0.005;
    const colour = r.book == null ? 'var(--red)' : (wrong ? 'var(--amber, #b8860b)' : 'var(--mist)');
    const act = (wrong || r.book == null || r.bookTax == null)
      ? `<button class="btn btn-outline btn-sm no-print" style="font-size:0.65rem;padding:1px 6px"
           onclick="vmApplyDay('${r.date}')"
           title="Write ${escHtml(fmt(r.day.sale))} plus ${escHtml(fmt(r.day.tax))} tax to ${r.date}"
           >use ${escHtml(fmt(r.day.sale))}</button>`
      : '';
    return `<tr>
      <td>${escHtml(r.date.slice(5))}</td>
      <td style="text-align:right">${r.day.rows.length}</td>
      <td style="text-align:right">${fmt(r.day.sale)}</td>
      <td style="text-align:right">${fmt(r.day.tax)}</td>
      <td style="text-align:right">${r.book == null ? '—' : fmt(r.book)}</td>
      <td style="text-align:right;color:${colour}">${
        r.book == null ? 'nothing in the book'
          : (wrong ? `${fmt(Math.abs(r.diff))} ${r.diff > 0 ? 'more' : 'less'} in the book`
                   : 'agrees')}</td>
      <td style="text-align:right">${act}</td>
    </tr>`;
  }).join('');

  const orphanRows = c.orphans.map(o => `<tr>
      <td>${escHtml(o.date.slice(5))}</td>
      <td style="text-align:right">—</td><td style="text-align:right">—</td><td style="text-align:right">—</td>
      <td style="text-align:right">${fmt(o.book)}</td>
      <td style="text-align:right;color:var(--red)">no Venmo that day</td>
      <td></td></tr>`).join('');

  return `
    <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;font-size:0.78rem">
      <strong>${escHtml(p.from)} to ${escHtml(p.to)}</strong>
      <span style="color:var(--mist)">${p.rows.length} sales · ${fmt(p.sale)} plus ${fmt(p.tax)} tax</span>
      <button class="btn btn-outline btn-sm no-print" style="margin-left:auto;font-size:0.68rem"
              onclick="vmApplyAll()"
              title="Write every day this statement covers, sale and tax">
        Write all ${Object.keys(p.days).length} days</button>
    </div>

    ${inclusive.length ? `
      <div style="font-size:0.72rem;color:var(--ink-soft);margin-top:8px;
                  padding:6px 9px;border-left:2px solid var(--border)">
        ${inclusive.length} of these carry no tax figure of their own — somebody sending for a stem
        rather than tapping the reader. Venmo records the rate as 0, so the amount is read as the
        price with the tax already inside and it is taken back out at ${(p.rate * 100).toFixed(3)}%:
        ${escHtml(inclusive.slice(0, 3).map(r => fmt(r.total) + ' → ' + fmt(r.sale)).join(', '))}${
          inclusive.length > 3 ? ', …' : ''}.
        ${refunds.length ? `${refunds.length} refund${refunds.length === 1 ? '' : 's'}
          ${refunds.length === 1 ? 'is' : 'are'} read the same way, reversing the sale and its tax.` : ''}
      </div>` : ''}

    <div style="font-size:0.72rem;color:${bad ? 'var(--red)' : 'var(--mist)'};margin-top:8px">
      ${bad ? `${bad} day${bad === 1 ? '' : 's'} to look at`
            : 'every day matches what is already in the book'}
    </div>

    <div style="max-height:280px;overflow:auto;margin-top:6px">
      <table style="width:100%;font-size:0.73rem">
        <thead><tr style="color:var(--mist)">
          <th style="text-align:left">Day</th><th style="text-align:right">Payments</th>
          <th style="text-align:right">Statement</th><th style="text-align:right">Tax</th>
          <th style="text-align:right">Day book</th><th style="text-align:right">Difference</th><th></th>
        </tr></thead>
        <tbody>${dayRows}${orphanRows}</tbody>
      </table>
    </div>

    ${Object.keys(p.skipped || {}).length ? `
      <div style="font-size:0.7rem;color:var(--mist);margin-top:6px">
        Ignored, as money moving between your own accounts rather than a sale:
        ${escHtml(Object.keys(p.skipped).map(k => `${k} (${p.skipped[k]})`).join(', '))}.
      </div>` : ''}`;
}

function vmPanelHtml() {
  return `
    <div class="ledger-wrap" style="margin-top:18px">
      <div class="ledger-header" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <h3 style="margin:0">Check the month against Venmo</h3>
        <span style="font-size:0.7rem;color:var(--mist)">
          The market statement. Venmo itemises the tax on every sale it takes, so these days
          come in with a figure rather than one worked out from the total.
        </span>
        <button class="btn btn-outline btn-sm" style="margin-left:auto"
                onclick="document.getElementById('venmo-file').click()">Upload statement</button>
        <input type="file" id="venmo-file" accept=".csv,text/csv" style="display:none"
               onchange="vmHandleFile(event)">
      </div>
      <div id="venmo-report" style="padding:0 16px 14px">${vmReportHtml()}</div>
    </div>`;
}

async function vmHandleFile(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    if (!vmLooksLikeVenmo(text)) {
      notify('That does not look like a Venmo statement — expected the CSV export', true);
      return;
    }
    const parsed = vmParseStatement(text);
    if (!parsed) { notify('No sales found in that statement', true); return; }
    vmStatement = parsed;
    notify(`${parsed.rows.length} sales read, ${parsed.from} to ${parsed.to}`);
    vmRender();
  } catch (e) {
    notify('Could not read that file: ' + (e && e.message ? e.message : e), true);
  }
}
