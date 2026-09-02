// ============================================================
// TAX SUMMARY PANEL
// ============================================================
function getYearTx(yr) {
  // Flatten all non-vault transactions for the year (or vault if no real tx)
  let all = [];
  MONTHS_SHORT.forEach((_, mi) => {
    const allTxs = getTransactions(yr, mi);
    const hasReal = allTxs.some(t => !t._vault);
    const txs = hasReal ? allTxs.filter(t => !t._vault) : allTxs;
    all = all.concat(txs);
  });
  return all;
}

function isCashRevenue(t) {
  if (t.category !== 'Revenue') return false;
  const d = (t.desc || '').toLowerCase();
  const v = (t.vendor || '').toLowerCase();
  return d === 'cash' || v === 'cash';
}

function isPayrollTax(t) {
  // Gusto payroll-tax draft (ID 9138864001) — identified by vendor tag or description
  const v = (t.vendor || '').toLowerCase();
  const d = (t.desc || '').toLowerCase();
  return v.includes('gusto') && (v.includes('payroll tax') || d.includes('9138864001'));
}

// Sales tax has lived in two places. Through 2025 it was an expense under
// Taxes; from January 2026 it has its own pass-through category, excluded from
// the profit and loss because the money was never the shop's.
//
// This function feeds the accountant's tax breakdown, which has to show the
// remittance whichever way it is filed -- looking only under Taxes reported
// $0.00 of sales tax for 2026 against $17,868.14 actually paid to New York.
function isSalesTax(t) {
  if (t.category === 'Sales Tax Remitted') return true;
  if (t.category !== 'Taxes') return false;
  const d = (t.desc || '').toLowerCase();
  const v = (t.vendor || '').toLowerCase();
  return d.includes('sales tax') || d.includes('sw2620818643') || v.includes('sales tax');
}

// Whether the year's sales tax sits outside the expense totals, which decides
// what the breakdown must say about it.
function salesTaxIsPassthrough(allTx) {
  return allTx.some(t => t.category === 'Sales Tax Remitted');
}

// What customers were CHARGED, as opposed to what was handed over. The two are
// different questions and the accountant needs both: collected is inside the
// 1099-K gross, so it is what reconciles the forms to income; remitted is the
// cash that left. They differ by a quarter's timing -- June to August is paid
// in September -- so at any year end one quarter is collected and not yet sent.
//
// Only part of it is keyed. On EPX, cash and Venmo the tax is derived from the
// taxable total rather than entered, so taking the day book's tax column alone
// understates it. Derived here the same way the sales tax return does.
function salesTaxCollected(year) {
  if (typeof dsMonth !== 'function' || typeof dsTaxMode !== 'function') return null;
  const rate = typeof DS_TAX_RATE === 'number' ? DS_TAX_RATE : 0.08375;
  let entered = 0, derived = 0, sawAny = false;
  for (let m = 0; m < 12; m++) {
    const days = dsMonth(year, m) || {};
    Object.keys(days).forEach(day => {
      const d = days[day] || {};
      Object.keys(d).forEach(k => {
        if (k.startsWith('_')) return;
        // Cash is kept out of every sales-tax figure -- see
        // DS_TAX_EXCLUDED_CHANNELS. Excluded, not treated as exempt.
        if (typeof dsExcludedFromTax === 'function' && dsExcludedFromTax(k)) return;
        const rec = d[k] || {};
        const s = Number(rec.s) || 0, t = Number(rec.t) || 0;
        if (!s && !t) return;
        sawAny = true;
        if (Math.abs(t) > 0.005) { entered += t; return; }
        const chan = (typeof dsChannels === 'function'
          ? dsChannels().find(c => c.id === k) : null) || { id: k };
        const mode = dsTaxMode(chan);
        const taxable = mode === 'exempt' ? 0
                      : mode === 'all' ? s
                      : (rec.x != null ? Number(rec.x) || 0 : 0);
        derived += taxable * rate;
      });
    });
  }
  if (!sawAny) return null;          // no day book for that year — nothing to derive from
  return { entered, derived, total: entered + derived };
}

function isPropertyTax(t) {
  if (t.category !== 'Taxes') return false;
  const d = (t.desc || '').toLowerCase();
  const v = (t.vendor || '').toLowerCase();
  return d.includes('property') || v.includes('property');
}

function renderTaxPanel() {
  const yr = appData.activeYear;
  const el = document.getElementById('tax-summary-content');
  const allTx = getYearTx(yr);

  // Category totals, but: exclude cash revenue from Revenue, and drop Payroll1 entirely
  const totals = {};
  CATEGORIES.forEach(c => totals[c] = 0);
  allTx.forEach(t => {
    if (totals[t.category] === undefined) return;
    if (t.category === 'Payroll1') return;          // excluded from accountant view
    if (isCashRevenue(t)) return;                    // cash revenue excluded
    // Sales tax remitted is money held for the state, not an expense. Excluded
    // here too, so the accountant's view and the monthly P&L agree.
    if (PASSTHROUGH_CATEGORIES.indexOf(t.category) >= 0) return;
    totals[t.category] += t.amount;
  });

  // Tax sub-line breakdown
  const payrollTax = allTx.filter(isPayrollTax).reduce((s,t) => s + t.amount, 0);
  const salesTax   = allTx.filter(isSalesTax).reduce((s,t) => s + t.amount, 0);
  const propertyTax= allTx.filter(isPropertyTax).reduce((s,t) => s + t.amount, 0);

  const revenue = totals['Revenue'] || 0;
  const totalExp = CATEGORIES.filter(c => c !== 'Revenue' && c !== 'Payroll1').reduce((s,c) => s + (totals[c]||0), 0);
  const net = revenue - totalExp;

  el.innerHTML = `
    <div style="display:flex;gap:12px;margin-bottom:24px;flex-wrap:wrap">
      <div class="kpi-card revenue" style="min-width:160px"><div class="kpi-label">Total Revenue</div><div class="kpi-value">${fmt(revenue)}</div></div>
      <div class="kpi-card expense" style="min-width:160px"><div class="kpi-label">Total Expenses</div><div class="kpi-value">${fmt(totalExp)}</div></div>
      <div class="kpi-card profit" style="min-width:160px"><div class="kpi-label">Net Income</div><div class="kpi-value" style="color:${net>=0?'var(--green)':'var(--red)'}">${fmt(net)}</div></div>
    </div>

    <div class="ledger-wrap" style="margin-bottom:20px">
      <div class="ledger-header"><h3>🧾 Tax Breakdown (for accountant)</h3></div>
      <table>
        <thead><tr><th>Tax Type</th><th>Annual Total</th></tr></thead>
        <tbody>
          <tr><td><span class="badge">Payroll Tax</span></td><td class="amount-out">${fmt(payrollTax)}</td></tr>
          ${(() => {
            const coll = salesTaxCollected(yr);
            if (!coll) return '';
            return `
              <tr><td><span class="badge">Sales Tax collected</span>
                <div style="font-size:0.68rem;color:var(--mist);margin-top:2px">
                  What customers were charged. This sits inside the 1099-K gross figures,
                  so it is the number that reconciles the forms to revenue — revenue itself
                  excludes it.${coll.derived > 0.5 ? ` Includes ${fmt(coll.derived)} derived
                  from taxable sales on channels where the tax is not keyed in.` : ''}
                  Cash is excluded from this figure. The filed New York returns are the
                  authority.</div></td>
                <td class="amount-in">${fmt(coll.total)}</td></tr>`;
          })()}
          <tr><td><span class="badge">Sales Tax remitted</span>${
            salesTaxIsPassthrough(allTx)
              ? `<div style="font-size:0.68rem;color:var(--mist);margin-top:2px">
                   Paid to New York — a pass-through, already excluded from the category
                   totals below. Do not deduct it again. It trails what was collected by a
                   quarter: June to August is remitted in September.</div>`
              : `<div style="font-size:0.68rem;color:var(--mist);margin-top:2px">
                   Booked as an expense this year, and inside the Taxes total below.</div>`
            }</td><td class="amount-out">${fmt(salesTax)}</td></tr>
          <tr><td><span class="badge">Property Tax</span></td><td class="amount-out">${fmt(propertyTax)}</td></tr>
        </tbody>
      </table>
    </div>

    <div class="ledger-wrap">
      <div class="ledger-header">
        <h3>📊 ${yr} Category Totals</h3>
        <button class="btn btn-outline btn-xs" onclick="exportTaxCSV(${yr})">⬇ Export CSV</button>
      </div>
      <table>
        <thead><tr><th>Category</th><th>Annual Total</th><th>% of Revenue</th><th>Monthly Avg</th></tr></thead>
        <tbody>
          ${CATEGORIES.filter(c => c !== 'Payroll1' && totals[c] > 0).map(c => {
            const pct = revenue > 0 ? (totals[c]/revenue*100).toFixed(1) : '—';
            const avg = totals[c] / 12;
            return `<tr>
              <td><span class="badge">${c}</span></td>
              <td class="${c==='Revenue'?'amount-in':'amount-out'}">${fmt(totals[c])}</td>
              <td>${pct}%</td>
              <td>${fmt(avg)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

function exportTaxCSV(yr) {
  const allTx = getYearTx(yr);
  const totals = {};
  CATEGORIES.forEach(c => totals[c] = 0);
  allTx.forEach(t => {
    if (totals[t.category] === undefined) return;
    if (t.category === 'Payroll1') return;
    if (isCashRevenue(t)) return;
    totals[t.category] += t.amount;
  });
  const payrollTax = allTx.filter(isPayrollTax).reduce((s,t) => s + t.amount, 0);
  const salesTax   = allTx.filter(isSalesTax).reduce((s,t) => s + t.amount, 0);
  const propertyTax= allTx.filter(isPropertyTax).reduce((s,t) => s + t.amount, 0);
  const rev = totals['Revenue'] || 0;

  let csv = 'Section,Item,Annual Total,% of Revenue,Monthly Avg\n';
  csv += `Tax Breakdown,Payroll Tax,${payrollTax.toFixed(2)},,\n`;
  csv += `Tax Breakdown,Sales Tax,${salesTax.toFixed(2)},,\n`;
  csv += `Tax Breakdown,Property Tax,${propertyTax.toFixed(2)},,\n`;
  CATEGORIES.filter(c => c !== 'Payroll1' && totals[c] > 0).forEach(c => {
    const pct = rev > 0 ? (totals[c]/rev*100).toFixed(1) : '0';
    csv += `Category Totals,"${c}",${totals[c].toFixed(2)},${pct}%,${(totals[c]/12).toFixed(2)}\n`;
  });
  const blob = new Blob([csv], {type:'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bloom-books-tax-${yr}.csv`;
  a.click();
  notify('Tax summary exported');
}

// ============================================================
// HOLIDAY REVENUE PANEL
// ============================================================
const HOLIDAYS = [
  { key: 'valentines', label: "Valentine's Day 💕", month: 1 },
  { key: 'mothers',    label: "Mother's Day 🌸",    month: 4 },
  { key: 'christmas',  label: "Christmas 🎄",       month: 11 },
  { key: 'thanksgiving', label: "Thanksgiving 🍂",  month: 10 },
  { key: 'easter',     label: "Easter 🐣",          month: 3 },
  { key: 'other',      label: "Other Holiday",      month: -1 },
];


// ============================================================
// WHAT A HOLIDAY COST
// ============================================================
// The revenue side of a holiday has been tracked for a while. The cost side
// needs two different sources, and showing both is the point rather than a
// hedge: invoices say WHAT was bought, bank payments say how much actually
// went out. Where they disagree, the invoices are incomplete -- which is the
// normal state for a holiday whose paperwork went astray, and worth seeing
// plainly instead of reading a low cost as a good margin.
//
// The buying window is adjustable rather than fixed. Pre-books are placed well
// before a holiday and are not always invoiced then, so no single number is
// right; the payments show the buy ramping from roughly three weeks out.

function hcWindow(year, month) {
  if (typeof ctHolidayDayIso !== 'function') return null;
  const to = ctHolidayDayIso(year, month);
  const from = ctHolidayBuyStart(year, month);
  return to && from ? { from, to, set: !!((appData.holidayBuy || {})[`${year}-${month}`]) } : null;
}

// Invoices dated into the window, and what they were for.
function hcInvoiceCost(year, month) {
  const w = hcWindow(year, month);
  if (!w || typeof ctData === 'undefined' || !ctData.invoices) return null;
  const eff = i => (i.deliveryDate || i.date || '');
  const hit = ctData.invoices.filter(i => eff(i) >= w.from && eff(i) <= w.to);
  const byCat = {}, items = [];
  let total = 0;
  hit.forEach(inv => {
    total += inv.total || 0;
    (inv.items || []).forEach(it => {
      const line = typeof ctLineTotal === 'function' ? ctLineTotal(it)
                 : (it.total != null ? it.total : (it.qty || 0) * (it.unitPrice || 0));
      byCat[it.category || 'Other'] = (byCat[it.category || 'Other'] || 0) + line;
      items.push({ name: it.name, qty: it.qty, uom: it.uom,
                   unit: typeof ctEffectiveUnit === 'function' ? ctEffectiveUnit(it) : it.unitPrice,
                   total: line, supplier: inv.supplier, date: eff(inv) });
    });
  });
  items.sort((a, b) => b.total - a.total);
  return { total, byCat, items, invoices: hit.length, window: w };
}

// What actually left the bank in the same window. Independent of any invoice,
// so it still answers for a holiday whose paperwork was never captured.
function hcPaidInWindow(year, month) {
  const w = hcWindow(year, month);
  if (!w) return null;
  let total = 0, n = 0;
  const by = {};
  Object.keys((appData.transactions) || {}).forEach(k => {
    (appData.transactions[k] || []).forEach(t => {
      if (t._vault || t.type !== 'out' || !t.date) return;
      if (t.category !== 'Supplies & Materials - COGS') return;
      if (t.date < w.from || t.date > w.to) return;
      total += t.amount; n++;
      const v = (t.vendor || t.desc || '?').slice(0, 30);
      by[v] = (by[v] || 0) + t.amount;
    });
  });
  return { total, count: n, by, window: w };
}

let hcOpen = null;
// What was actually bought, counted in stems and grouped by flower -- with
// roses broken out by colour, which is the way a florist thinks about a
// Valentine's or Mother's Day buy.
//
// Only flowers and greens are counted. Plants, containers, ribbon and hard
// goods are real money but are not stems, and folding them in would make the
// column meaningless; they are reported as one line underneath instead.
function hcQtyByType(year, month) {
  const w = hcWindow(year, month);
  if (!w || typeof ctData === 'undefined' || !ctData.invoices) return null;
  const eff = i => (i.deliveryDate || i.date || '');
  const map = ctRoseColorMap();
  const types = {};
  const unresolved = [];
  let otherCost = 0, byBunch = 0;

  ctData.invoices.filter(i => eff(i) >= w.from && eff(i) <= w.to).forEach(inv => {
    (inv.items || []).forEach(it => {
      const cost = ctLineTotal(it);
      const cat = it.category || '';
      if (cat !== 'Flowers' && cat !== 'Greens') { otherCost += cost; return; }
      const fam = it.family || (typeof ctGuessFamily === 'function' ? ctGuessFamily(it.name) : '') || it.name;
      const { stems, bunches } = ctLineStems(it);
      const t = types[fam] || (types[fam] =
        { type: fam, stems: 0, bunches: 0, cost: 0, stemCost: 0, colors: {} });
      t.stems += stems; t.bunches += bunches; t.cost += cost;
      // Cost per stem must divide only the cost of the lines whose stems are
      // actually known. Dividing the WHOLE cost by the PART of it that resolved
      // reported roses at $3.77 a stem against a real figure near $2 -- the
      // unresolved lines brought cost with them and no stems to carry it.
      if (stems) t.stemCost += cost;
      // A family sold by the bunch is settled, not unresolved. Leaving greens in
      // the unresolved pile buried the handful of lines that genuinely were
      // missing a count under 259 bunches of ruscus and gyp.
      const { byDesign } = ctLineStems(it);
      if (bunches && byDesign) byBunch += bunches;
      else if (bunches) {
        unresolved.push({ name: it.name, qty: it.qty, uom: it.uom, per: it.stemsPerBu || null,
                          bunches, cost, type: fam, family: it.family || fam,
                          supplier: inv.supplier, date: eff(inv) });
      }
      if (/rose/i.test(fam)) {
        const c = ctRoseColor(it.name, map) || 'Colour not recorded';
        const b = t.colors[c] || (t.colors[c] =
          { color: c, stems: 0, bunches: 0, cost: 0, stemCost: 0, names: {} });
        b.stems += stems; b.bunches += bunches; b.cost += cost;
        if (stems) b.stemCost += cost;
        if (c === 'Colour not recorded') b.names[ctRoseVariety(it.name) || it.name] = 1;
      }
    });
  });

  const rows = Object.keys(types).map(k => {
    const t = types[k];
    t.colors = Object.keys(t.colors).map(c => t.colors[c]).sort((a, b) => b.cost - a.cost);
    t.colors.forEach(c => { c.names = Object.keys(c.names); });
    return t;
  }).sort((a, b) => b.cost - a.cost);

  unresolved.sort((a, b) => b.cost - a.cost);
  return {
    rows, otherCost, unresolved, byBunch, window: w,
    stems: rows.reduce((n, r) => n + r.stems, 0),
    bunches: rows.reduce((n, r) => n + r.bunches, 0),
    cost: rows.reduce((n, r) => n + r.cost, 0),
    stemCost: rows.reduce((n, r) => n + r.stemCost, 0),
  };
}

// Year over year for one holiday. The question actually asked in January is
// "what did we buy last Valentine's, and what did it cost" -- which needs the
// same holiday across years side by side, not one year alone.
//
// Only years with invoices in the window appear. A year with none is omitted
// rather than shown as zero: zero would read as "we bought nothing", when the
// truth is that nobody uploaded the paperwork.
function hcCompareByType(month) {
  const years = ((typeof appData !== 'undefined' && appData.years) || []).slice().sort();
  const per = {}, have = [];
  years.forEach(y => {
    const q = hcQtyByType(y, month);
    if (!q || !q.rows.length) return;
    have.push(y);
    per[y] = q;
  });
  if (!have.length) return null;

  const rows = {};
  have.forEach(y => {
    per[y].rows.forEach(r => {
      const t = rows[r.type] || (rows[r.type] = { type: r.type, per: {}, colors: {} });
      t.per[y] = { stems: r.stems, bunches: r.bunches, cost: r.cost, stemCost: r.stemCost };
      r.colors.forEach(c => {
        const cc = t.colors[c.color] || (t.colors[c.color] = { color: c.color, per: {} });
        cc.per[y] = { stems: c.stems, bunches: c.bunches, cost: c.cost, stemCost: c.stemCost };
      });
    });
  });
  const latest = have[have.length - 1];
  const cost = (o, y) => ((o.per[y] || {}).cost || 0);
  const list = Object.keys(rows).map(k => {
    const t = rows[k];
    t.colors = Object.keys(t.colors).map(c => t.colors[c])
      .sort((a, b) => cost(b, latest) - cost(a, latest));
    return t;
  }).sort((a, b) => cost(b, latest) - cost(a, latest));

  const totals = {};
  have.forEach(y => {
    totals[y] = { stems: per[y].stems, bunches: per[y].bunches,
                  cost: per[y].cost, stemCost: per[y].stemCost };
  });
  return { years: have, rows: list, totals, latest };
}

function hcHolidayLabel(month) {
  const h = HOLIDAYS.filter(x => x.month === month)[0];
  return h ? h.label.replace(/[^\x20-\x7E]/g, '').trim() : 'Holiday';
}

// One flat row per type and per colour, per year -- the shape a spreadsheet
// wants. Every text field is quoted, so a flower name containing a comma
// cannot shift every column to its right.
function hcExportQty(month) {
  const cmp = hcCompareByType(month);
  if (!cmp) { notify('No invoices in that buying window yet'); return; }
  const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const label = hcHolidayLabel(month);
  let csv = 'Holiday,Year,Buying window,Type,Colour,Stems,Bunches with no stem count,Cost,Cost per stem\n';
  cmp.years.forEach(y => {
    const w = hcWindow(y, month) || {};
    const win = (w.from || '') + ' to ' + (w.to || '');
    const line = (type, colour, d) => {
      if (!d) return;
      csv += [q(label), y, q(win), q(type), q(colour), d.stems, d.bunches,
              d.cost.toFixed(2), d.stems ? (d.stemCost / d.stems).toFixed(4) : ''].join(',') + '\n';
    };
    cmp.rows.forEach(r => {
      line(r.type, '', r.per[y]);
      r.colors.forEach(c => line(r.type, c.color, c.per[y]));
    });
    line('TOTAL', '', cmp.totals[y]);
  });
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bloom-books-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-buying.csv`;
  a.click();
  notify('Holiday buying exported');
}

function hcCompareHtml(month) {
  const cmp = hcCompareByType(month);
  if (!cmp) return '';
  const num = n => (n || 0).toLocaleString('en-US');
  const ys = cmp.years;
  const a = ys[ys.length - 2], b = ys[ys.length - 1];

  // Change is shown only between the two most recent years, and only where both
  // carry a figure. A percentage against a year with no invoices would measure
  // the paperwork, not the buying.
  const change = (pa, pb, key) => {
    if (ys.length < 2 || !pa || !pb || !pa[key] || !pb[key]) return '<span style="color:var(--mist)">—</span>';
    const pct = (pb[key] - pa[key]) / pa[key] * 100;
    if (Math.abs(pct) < 0.5) return '<span style="color:var(--mist)">level</span>';
    return `<span style="color:${pct > 0 ? 'var(--red)' : 'var(--green)'}">${pct > 0 ? '+' : ''}${pct.toFixed(0)}%</span>`;
  };
  const cell = d => d
    ? `${d.stems ? num(d.stems) : '—'}${d.bunches ? ` <span style="color:var(--mist)">+${num(d.bunches)} bu</span>` : ''}`
    : '<span style="color:var(--mist)">—</span>';
  const row = (label, per, indent) => `
    <tr${indent ? ' style="color:var(--mist)"' : ''}>
      <td style="padding-left:${indent ? 18 : 0}px">${escHtml(label)}</td>
      ${ys.map(y => `<td style="text-align:right">${cell(per[y])}</td>`).join('')}
      <td style="text-align:right">${change(per[a], per[b], 'stems')}</td>
      ${ys.map(y => `<td style="text-align:right">${per[y] ? fmt(per[y].cost) : '—'}</td>`).join('')}
      <td style="text-align:right">${change(per[a], per[b], 'cost')}</td>
    </tr>`;

  return `
    <div class="hc-compare" style="margin-top:16px">
      <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap">
        <strong style="font-size:0.8rem">${escHtml(hcHolidayLabel(month))} — what was bought${
          ys.length > 1 ? ', year over year' : ''}</strong>
        <span style="font-size:0.7rem;color:var(--mist)">
          only years with invoices appear${ys.length < 2 ? ' — one so far' : ''}</span>
        <span style="margin-left:auto;display:flex;gap:8px">
          <button class="btn btn-outline btn-sm no-print" onclick="hcExportQty(${month})">Export CSV</button>
          <button class="btn btn-outline btn-sm no-print" onclick="window.print()">Print</button>
        </span>
      </div>
      <div class="staging-table-wrap" style="margin-top:6px">
        <table style="width:100%;font-size:0.74rem">
          <thead>
            <tr style="color:var(--mist)">
              <th style="text-align:left" rowspan="2">Type</th>
              <th colspan="${ys.length + 1}" style="text-align:center">Stems</th>
              <th colspan="${ys.length + 1}" style="text-align:center">Cost</th>
            </tr>
            <tr style="color:var(--mist)">
              ${ys.map(y => `<th style="text-align:right">${y}</th>`).join('')}
              <th style="text-align:right">chg</th>
              ${ys.map(y => `<th style="text-align:right">${y}</th>`).join('')}
              <th style="text-align:right">chg</th>
            </tr>
          </thead>
          <tbody>
            ${cmp.rows.map(r => row(r.type, r.per, false) +
                r.colors.map(c => row(c.color, c.per, true)).join('')).join('')}
            <tr style="font-weight:600;border-top:1px solid var(--border)">
              <td>Total</td>
              ${ys.map(y => `<td style="text-align:right">${cell(cmp.totals[y])}</td>`).join('')}
              <td style="text-align:right">${change(cmp.totals[a], cmp.totals[b], 'stems')}</td>
              ${ys.map(y => `<td style="text-align:right">${fmt(cmp.totals[y].cost)}</td>`).join('')}
              <td style="text-align:right">${change(cmp.totals[a], cmp.totals[b], 'cost')}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>`;
}

function hcQtyHtml(year, month) {
  const q = hcQtyByType(year, month);
  if (!q || !q.rows.length) return '';
  const num = n => n.toLocaleString('en-US');
  const cell = (stems, bunches) => stems
    ? num(stems) + (bunches ? ` <span style="color:var(--mist)">+ ${num(bunches)} bu</span>` : '')
    : (bunches ? `<span style="color:var(--mist)">${num(bunches)} bu</span>` : '—');

  const row = (label, r, indent, isHtml) => `
    <tr${indent ? ' style="color:var(--mist)"' : ''}>
      <td style="padding-left:${indent ? 18 : 0}px">${isHtml ? label : escHtml(label)}</td>
      <td style="text-align:right">${cell(r.stems, r.bunches)}</td>
      <td style="text-align:right">${fmt(r.cost)}</td>
      <td style="text-align:right">${r.stems ? '$' + (r.stemCost / r.stems).toFixed(2) : '—'}${
        r.stems && r.bunches ? '<span style="color:var(--mist)">*</span>' : ''}</td>
    </tr>`;

  // A variety no invoice ever names a colour for is asked about rather than
  // filed under the nearest guess. Answering once teaches it for good.
  const colorLabel = c => {
    if (!c.names || !c.names.length) return escHtml(c.color);
    const links = c.names.slice(0, 6).map(n => {
      const safe = String(n).replace(/[^a-z0-9 ]/gi, '');
      return `<a href="#" onclick="ctSetRoseColor('${safe}');return false"
                 style="color:var(--blue-light)" title="Tell BloomBooks what colour this is">
                ${escHtml(n)}</a>`;
    }).join(', ');
    return escHtml(c.color) + ' — ' + links;
  };

  return `
    <strong style="font-size:0.75rem;display:block;margin-top:14px">
      How many flowers, by type</strong>
    <div style="max-height:340px;overflow:auto;margin-top:4px">
      <table style="width:100%;font-size:0.74rem">
        <thead><tr style="color:var(--mist)">
          <th style="text-align:left">Type</th><th style="text-align:right">Stems</th>
          <th style="text-align:right">Cost</th><th style="text-align:right">Per stem</th>
        </tr></thead>
        <tbody>
          ${q.rows.map(r => row(r.type, r, false) +
              r.colors.map(c => row(colorLabel(c), c, true, true)).join('')).join('')}
          <tr style="font-weight:600;border-top:1px solid var(--border)">
            <td>Total</td><td style="text-align:right">${cell(q.stems, q.bunches)}</td>
            <td style="text-align:right">${fmt(q.cost)}</td>
            <td style="text-align:right">${q.stems ? '$' + (q.stemCost / q.stems).toFixed(2) : '—'}</td></tr>
        </tbody>
      </table>
    </div>
    ${q.bunches ? `
      <div style="font-size:0.7rem;color:var(--mist);margin-top:6px">
        * Cost per stem covers only the lines whose stem count is known.
        ${num(q.unresolved.reduce((n, u) => n + u.bunches, 0))} units below have none on file,
        so they carry cost but no stems and are left out of that figure rather than skewing it.${
          q.byBunch ? ` A further ${num(q.byBunch)} bunches are families you count by the
          bunch, which are settled rather than missing.` : ''}
      </div>
      <details style="margin-top:6px">
        <summary style="font-size:0.72rem;color:var(--blue-light);cursor:pointer">
          Show the ${q.unresolved.length} line${q.unresolved.length === 1 ? '' : 's'}
          with no stem count</summary>
        <div style="max-height:220px;overflow:auto;margin-top:4px">
          <table style="width:100%;font-size:0.72rem">
            <thead><tr style="color:var(--mist)">
              <th style="text-align:left">Item</th><th style="text-align:right">Qty</th>
              <th style="text-align:left">Unit</th><th style="text-align:right">Counted as</th>
              <th style="text-align:right">Cost</th><th style="text-align:left">Date</th>
              <th></th>
            </tr></thead>
            <tbody>
              ${q.unresolved.map(u => `
                <tr><td>${escHtml(String(u.name).slice(0, 40))}</td>
                    <td style="text-align:right">${u.qty}</td>
                    <td>${escHtml(u.uom || '')}${u.per ? ' ×' + u.per : ''}</td>
                    <td style="text-align:right">${num(u.bunches)} bu</td>
                    <td style="text-align:right">${fmt(u.cost)}</td>
                    <td>${escHtml(u.date || '')}</td>
                    <td>${u.family ? `<a href="#" style="color:var(--blue-light);font-size:0.68rem"
                          onclick="ctSetByTheBunch('${escHtml(u.family).replace(/'/g, '')}', true);return false"
                          title="Stop asking for a stem count on ${escHtml(u.family)}">sold by the bunch</a>` : ''}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div style="font-size:0.7rem;color:var(--mist);margin-top:4px">
          If the quantity here is really a stem count, the unit on that line is wrong —
          fix it on the invoice and these fold into the stem totals. If nobody counts
          stems of it at all, say so once and the whole family stops asking.
        </div>
      </details>` : ''}
    ${q.otherCost > 0.005 ? `<div style="font-size:0.7rem;color:var(--mist);margin-top:4px">
      Plus ${fmt(q.otherCost)} of plants, containers and supplies, which are not stems
      and are not counted above.</div>` : ''}`;
}

function hcToggle(key) { hcOpen = (hcOpen === key ? null : key); renderHolidayPanel(); }

function hcCostHtml() {
  const years = appData.years.slice().sort((a, b) => b - a);
  const rows = [];
  years.forEach(yr => {
    HOLIDAYS.forEach(h => {
      if (h.month === -1) return;
      const w = hcWindow(yr, h.month);
      if (!w) return;
      const paid = hcPaidInWindow(yr, h.month);
      const inv = hcInvoiceCost(yr, h.month);
      if (!paid.count && (!inv || !inv.invoices)) return;
      const key = `${yr}-${h.month}`;
      const rev = (appData.holidays || {})[key] || 0;
      rows.push({ yr, h, key, w, paid, inv, rev });
    });
  });
  if (!rows.length) return '';

  return `
    <div class="ledger-wrap" style="margin-top:18px">
      <div class="ledger-header" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <h3 style="margin:0">What the holiday cost</h3>
        <span style="font-size:0.7rem;color:var(--mist)">
          Invoices say what was bought; payments say what left the bank. A gap between
          them means the invoices for that holiday are incomplete, not that it was cheap.
          Set when the buying actually started for each one — it is never the same date twice.
        </span>
      </div>
      <div class="staging-table-wrap">
        <table>
          <thead><tr>
            <th>Holiday</th><th style="text-align:right">Revenue</th>
            <th style="text-align:right">Invoiced</th><th style="text-align:right">Paid out</th>
            <th style="text-align:right">Cost of revenue</th><th></th>
          </tr></thead>
          <tbody>
            ${rows.map(r => {
              const invTot = r.inv ? r.inv.total : 0;
              const pct = r.rev ? (r.paid.total / r.rev * 100) : 0;
              const gap = r.paid.total - invTot;
              return `
              <tr class="clickable-row" onclick="hcToggle('${r.key}')" style="cursor:pointer">
                <td><strong>${escHtml(r.h.label)} ${r.yr}</strong>
                  <div style="font-size:0.68rem;color:var(--mist)" onclick="event.stopPropagation()">
                    buying from
                    <input type="date" value="${escHtml(r.w.from)}" max="${escHtml(r.w.to)}"
                           onchange="ctSetHolidayBuyStart(${r.yr}, ${r.h.month}, this.value)"
                           style="font-size:0.66rem;padding:0 2px"
                           title="When the flowers for this holiday actually started arriving">
                    to ${r.w.to}${r.w.set ? '' : ' <span style="opacity:.7">(default)</span>'}
                  </div></td>
                <td style="text-align:right">${r.rev ? fmt(r.rev) : '—'}</td>
                <td style="text-align:right">${invTot ? fmt(invTot) : '—'}
                  <div style="font-size:0.68rem;color:${gap > 1 ? 'var(--red)' : 'var(--mist)'}">
                    ${gap > 1
                      ? fmt(gap) + ' not invoiced'
                      : (r.inv ? r.inv.invoices : 0) + ' invoice' + (r.inv && r.inv.invoices === 1 ? '' : 's')}
                  </div></td>
                <td style="text-align:right" class="amount-out">${fmt(r.paid.total)}
                  <div style="font-size:0.68rem;color:var(--mist)">${r.paid.count} payments</div></td>
                <td style="text-align:right">${r.rev ? pct.toFixed(0) + '%' : '—'}</td>
                <td style="text-align:right;font-size:0.75rem;color:var(--blue-light)">
                  ${hcOpen === r.key ? 'hide' : 'detail'}</td>
              </tr>
              ${hcOpen === r.key ? `
                <tr><td colspan="6" style="background:var(--paper);padding:12px 16px">
                  ${gap > 1 ? `<div style="font-size:0.75rem;color:var(--red);margin-bottom:8px">
                    ${fmt(gap)} was paid out with no invoice behind it in this window —
                    the detail below is only the part that was captured.</div>` : ''}
                  <div style="display:flex;gap:24px;flex-wrap:wrap">
                    <div style="min-width:230px">
                      <strong style="font-size:0.75rem">Paid, by supplier</strong>
                      <table style="width:100%;font-size:0.74rem;margin-top:4px">
                        ${Object.keys(r.paid.by).sort((a,b)=>r.paid.by[b]-r.paid.by[a]).map(v => `
                          <tr><td>${escHtml(v)}</td>
                              <td style="text-align:right">${fmt(r.paid.by[v])}</td></tr>`).join('')}
                      </table>
                    </div>
                    ${r.inv && r.inv.items.length ? `
                    <div style="min-width:200px">
                      <strong style="font-size:0.75rem">Invoiced, by category</strong>
                      <table style="width:100%;font-size:0.74rem;margin-top:4px">
                        ${Object.keys(r.inv.byCat).sort((a,b)=>r.inv.byCat[b]-r.inv.byCat[a]).map(c => `
                          <tr><td>${escHtml(c)}</td>
                              <td style="text-align:right">${fmt(r.inv.byCat[c])}</td></tr>`).join('')}
                      </table>
                    </div>` : ''}
                  </div>
                  ${hcQtyHtml(r.yr, r.h.month)}
                  ${hcCompareHtml(r.h.month)}
                  ${r.inv && r.inv.items.length ? `
                    <strong style="font-size:0.75rem;display:block;margin-top:12px">
                      What was bought — ${r.inv.items.length} lines</strong>
                    <div style="max-height:280px;overflow:auto;margin-top:4px">
                      <table style="width:100%;font-size:0.74rem">
                        <thead><tr style="color:var(--mist)">
                          <th style="text-align:left">Item</th><th style="text-align:right">Qty</th>
                          <th style="text-align:right">Unit</th><th style="text-align:right">Total</th>
                          <th style="text-align:left">Supplier</th><th style="text-align:left">Date</th>
                        </tr></thead>
                        <tbody>
                          ${r.inv.items.map(it => `
                            <tr><td>${escHtml(String(it.name).slice(0, 38))}</td>
                                <td style="text-align:right">${it.qty} ${escHtml(it.uom || '')}</td>
                                <td style="text-align:right">${fmt(it.unit || 0)}</td>
                                <td style="text-align:right">${fmt(it.total)}</td>
                                <td>${escHtml(String(it.supplier || '').slice(0, 20))}</td>
                                <td>${escHtml(it.date)}</td></tr>`).join('')}
                        </tbody>
                      </table>
                    </div>`
                  : `<div style="font-size:0.75rem;color:var(--mist);margin-top:10px">
                       No invoices captured in this window, so there is no line-item detail —
                       only what left the bank.</div>`}
                </td></tr>` : ''}`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function renderHolidayPanel() {
  const el = document.getElementById('holiday-content');
  if (!appData.holidays) appData.holidays = {};

  const rows = appData.years.map(yr => {
    const data = {};
    HOLIDAYS.forEach(h => {
      const key = `${yr}-${h.month !== -1 ? h.month : 'other'}`;
      data[h.key] = (appData.holidays[key] || 0);
    });
    return { yr, data };
  });

  el.innerHTML = `
    <p style="color:var(--mist);font-size:0.8rem;margin-bottom:16px">Enter the revenue you earned specifically from each holiday, or pull it straight from the Sales sheets below. This helps you understand how dependent your business is on key dates.</p>
    ${holidaySetupHtml()}
    ${holidayRefreshHtml()}
    <div class="ledger-wrap">
      <table>
        <thead>
          <tr>
            <th>Holiday</th>
            ${appData.years.map(y => `<th>${y}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${HOLIDAYS.map(h => `
            <tr>
              <td><strong>${h.label}</strong></td>
              ${appData.years.map(yr => {
                const key = `${yr}-${h.month !== -1 ? h.month : 'other'}`;
                const val = appData.holidays[key] || 0;
                return `<td><input type="number" value="${val}" step="0.01" min="0"
                  style="width:90px;background:var(--border);border:1px solid var(--blue-light);border-radius:4px;padding:4px;font-family:Inter,sans-serif;font-size:0.8rem"
                  onchange="saveHoliday('${key}', this.value)"></td>`;
              }).join('')}
            </tr>`).join('')}
          <tr style="font-weight:600;border-top:2px solid var(--blue-light)">
            <td>Total Holiday Revenue</td>
            ${appData.years.map(yr => {
              const total = HOLIDAYS.reduce((s,h) => {
                const key = `${yr}-${h.month !== -1 ? h.month : 'other'}`;
                return s + (appData.holidays[key] || 0);
              }, 0);
              const yearRev = MONTHS_SHORT.reduce((s,_,mi) => s + getRevenue(yr,mi), 0);
              const pct = yearRev > 0 ? (total/yearRev*100).toFixed(1) : '0';
              return `<td class="amount-in">${fmt(total)}<div style="font-size:0.7rem;color:var(--mist)">${pct}% of revenue</div></td>`;
            }).join('')}
          </tr>
        </tbody>
      </table>
    </div>
    ${hcCostHtml()}`;
}

function saveHoliday(key, val) {
  if (!appData.holidays) appData.holidays = {};
  appData.holidays[key] = parseFloat(val) || 0;
  saveData();
  // Re-render totals row without full re-render
  renderHolidayPanel();
}

// ============================================================
// TRENDS PANEL
// ============================================================
let trendsChartInst = null;
let growthChartInst = null;
let cogsChartInst = null;

function renderTrendsPanel() {
  updateYearSelects();
  renderTrendsChart();
  renderCogsChart();
}

function renderCogsChart() {
  const checkboxes = document.querySelectorAll('#panel-trends input[type=checkbox]');
  const activeYears = Array.from(checkboxes).filter(c => c.checked).map(c => parseInt(c.value)).sort();
  const yearColors = { 2023:'#8b9b8e', 2024:'#c9a84c', 2025:'#4a7c59', 2026:'#c0392b' };
  const defaultColors = ['#7a5c8a','#2980b9','#e67e22','#16a085'];
  let ci = 0;
  function getColor(y) { return yearColors[y] || defaultColors[ci++ % defaultColors.length]; }

  const datasets = activeYears.map(yr => ({
    label: String(yr),
    data: MONTHS_SHORT.map((_, mi) => {
      const rev = getRevenue(yr, mi);
      if (rev === 0) return null;
      const calc = calcMonth(yr, mi);
      return parseFloat(calc.cogsRatio.toFixed(1));
    }),
    borderColor: getColor(yr),
    backgroundColor: getColor(yr) + '33',
    fill: false,
    tension: 0.3,
    pointRadius: 4,
    borderWidth: 2,
    spanGaps: false
  }));

  if (cogsChartInst) cogsChartInst.destroy();
  const ctx = document.getElementById('cogsChart');
  if (!ctx) return;
  cogsChartInst = new Chart(ctx.getContext('2d'), {
    type: 'line',
    data: { labels: MONTHS_SHORT, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { font: { family: 'Inter' } } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y}%` } }
      },
      scales: {
        x: { ticks: { font: { family: 'Inter' } } },
        y: {
          ticks: { font: { family: 'Inter' }, callback: v => v + '%' },
          title: { display: true, text: 'COGS % of Revenue', font: { family: 'Inter' } }
        }
      }
    }
  });
}

function renderTrendsChart() {
  const checkboxes = document.querySelectorAll('#panel-trends input[type=checkbox]');
  const activeYears = Array.from(checkboxes).filter(c => c.checked).map(c => parseInt(c.value)).sort();

  const yearColors = {
    2023: '#8b9b8e',
    2024: '#c9a84c',
    2025: '#4a7c59',
    2026: '#c0392b'
  };
  const defaultColors = ['#7a5c8a','#2980b9','#e67e22','#16a085'];
  let colorIdx = 0;

  function getColor(y) {
    if (yearColors[y]) return yearColors[y];
    return defaultColors[colorIdx++ % defaultColors.length];
  }

  const datasets = activeYears.map(yr => ({
    label: String(yr),
    data: MONTHS_SHORT.map((_, mi) => getRevenue(yr, mi)),
    backgroundColor: getColor(yr) + 'cc',
    borderColor: getColor(yr),
    borderWidth: 1.5,
    borderRadius: 3
  }));

  // Growth annotations (current = last active year vs previous)
  if (trendsChartInst) trendsChartInst.destroy();
  const ctx = document.getElementById('trendsChart').getContext('2d');
  trendsChartInst = new Chart(ctx, {
    type: 'bar',
    data: { labels: MONTHS_SHORT, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { font: { family: 'Inter' }, color: '#1a1a2e' } },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${fmtK(ctx.parsed.y)}`
          }
        }
      },
      scales: {
        x: { grid: { color: '#e8e8f0' }, ticks: { font: { family: 'Inter' } } },
        y: { grid: { color: '#e8e8f0' }, ticks: { font: { family: 'Inter' }, callback: v => fmtK(v) } }
      }
    }
  });

  // Growth chart
  if (growthChartInst) growthChartInst.destroy();
  const growthYears = activeYears.filter(y => activeYears.includes(y - 1));
  const growthDatasets = growthYears.map(yr => ({
    label: `${yr} vs ${yr-1}`,
    data: MONTHS_SHORT.map((_, mi) => {
      const g = calcYoYGrowth(yr, mi);
      return g !== null ? parseFloat(g.toFixed(1)) : 0;
    }),
    backgroundColor: MONTHS_SHORT.map((_, mi) => {
      const g = calcYoYGrowth(yr, mi);
      return g !== null && g >= 0 ? 'rgba(74,124,89,0.7)' : 'rgba(192,57,43,0.7)';
    }),
    borderColor: getColor(yr),
    borderWidth: 1.5,
    borderRadius: 3
  }));

  const ctx2 = document.getElementById('growthChart').getContext('2d');
  growthChartInst = new Chart(ctx2, {
    type: 'bar',
    data: { labels: MONTHS_SHORT, datasets: growthDatasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { font: { family: 'Inter' }, color: '#1a1a2e' } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y}%` } }
      },
      scales: {
        x: { grid: { color: '#e8e8f0' }, ticks: { font: { family: 'Inter' } } },
        y: {
          grid: { color: '#e8e8f0' },
          ticks: { font: { family: 'Inter' }, callback: v => v + '%' },
          suggestedMin: -30, suggestedMax: 30
        }
      }
    }
  });
}

// ============================================================
// YEARLY SUMMARY
// ============================================================
let yearlyChartInst = null;
let yearlyChartInst2 = null;
let yearlySupplierPieInst = null;
let yearlyChartInst3 = null;
const monthSupplierPieInsts = {};

const SUPPLIER_COLORS = [
  '#4a7c59','#c9a84c','#c0392b','#2980b9','#8e44ad',
  '#e67e22','#16a085','#7a5c8a','#d35400','#1abc9c',
  '#e74c3c','#f39c12','#27ae60','#2c3e50','#8b9b8e'
];

function getSupplierData(txs) {
  // Group COGS transactions by vendor
  const vendorTotals = {};
  txs.filter(t => t.category === 'Supplies & Materials - COGS' && t.type === 'out')
    .forEach(t => {
      const v = t.vendor || 'Unknown';
      vendorTotals[v] = (vendorTotals[v] || 0) + t.amount;
    });
  // Sort by amount desc
  const sorted = Object.entries(vendorTotals).sort((a,b) => b[1]-a[1]);
  return sorted;
}

function renderSupplierPie(canvasId, legendId, data) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  if (!data.length) {
    canvas.parentElement.innerHTML = '<div class="empty-state"><div class="empty-icon">🌱</div>No supply purchases yet</div>';
    return;
  }
  const labels = data.map(d => d[0]);
  const values = data.map(d => d[1]);
  const total  = values.reduce((s,v) => s+v, 0);
  const colors = data.map((_,i) => SUPPLIER_COLORS[i % SUPPLIER_COLORS.length]);

  // Destroy existing
  if (Chart.getChart(canvas)) Chart.getChart(canvas).destroy();

  new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 2, borderColor: '#faf7f0' }] },
    options: {
      responsive: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${fmt(ctx.parsed)} (${(ctx.parsed/total*100).toFixed(1)}%)` } }
      }
    }
  });

  // Custom legend
  const legendEl = document.getElementById(legendId);
  if (legendEl) {
    legendEl.innerHTML = data.map((d,i) => `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <div style="width:12px;height:12px;border-radius:2px;background:${colors[i]};flex-shrink:0"></div>
        <span style="flex:1;color:var(--ink)">${d[0]}</span>
        <span style="color:var(--green);font-weight:500">${fmt(d[1])}</span>
        <span style="color:var(--mist)">${(d[1]/total*100).toFixed(1)}%</span>
      </div>`).join('');
  }
}

function renderYearlyPanel() {
  const grid = document.getElementById('yearly-grid-content');
  const yearRows = appData.years.map(yr => {
    const totals = MONTHS_SHORT.reduce((acc, _, mi) => {
      const c = calcMonth(yr, mi);
      acc.revenue += c.revenue;
      acc.expenses += c.expenses;
      acc.net += c.net;
      return acc;
    }, { revenue: 0, expenses: 0, net: 0 });

    // YoY annual growth
    const prevRevTotal = MONTHS_SHORT.reduce((s, _, mi) => s + getRevenue(yr-1, mi), 0);
    const annualGrowth = prevRevTotal > 0 ? ((totals.revenue - prevRevTotal) / prevRevTotal * 100) : null;

    return { yr, ...totals, annualGrowth };
  });

  grid.innerHTML = `
    <div class="yearly-grid">
      ${yearRows.map(r => `
        <div class="year-card" onclick="setActiveYear(${r.yr});switchPanel('month-0')">
          <h4>${r.yr}</h4>
          <div class="stat-row"><span>Revenue</span><span class="amount-in">${fmt(r.revenue)}</span></div>
          <div class="stat-row"><span>Expenses</span><span class="amount-out">${fmt(r.expenses)}</span></div>
          <div class="stat-row"><span>Net Income</span><span style="color:${r.net>=0?'var(--green)':'var(--red)'}">${fmt(r.net)}</span></div>
          ${r.annualGrowth !== null ? `<div class="stat-row"><span>YoY Growth</span><span class="${r.annualGrowth>=0?'growth-up':'growth-down'}">${r.annualGrowth>=0?'▲':'▼'} ${Math.abs(r.annualGrowth).toFixed(1)}%</span></div>` : ''}
        </div>
      `).join('')}
    </div>

    <div class="chart-wrap" style="margin-bottom:20px;">
      <h3>Monthly Revenue — Annual Comparison</h3>
      <div class="chart-container" style="height:380px;"><canvas id="annualComparisonChart"></canvas></div>
    </div>
  `;

  // Annual Comparison grouped bar chart (by month, one bar per year)
  if (yearlyChartInst) yearlyChartInst.destroy();
  const yearColors = { 2023: '#8b9b8e', 2024: '#c9a84c', 2025: '#4a7c59', 2026: '#c0392b' };
  const fallbackColors = ['#7a5c8a','#2980b9','#e67e22','#16a085'];
  let fci = 0;
  const annualDatasets = appData.years.map(yr => {
    const color = yearColors[yr] || fallbackColors[fci++ % fallbackColors.length];
    return {
      label: String(yr),
      data: MONTHS_SHORT.map((_, mi) => getRevenue(yr, mi)),
      backgroundColor: color + 'cc',
      borderColor: color,
      borderWidth: 1.5,
      borderRadius: 3
    };
  });

  const ctx = document.getElementById('annualComparisonChart').getContext('2d');
  yearlyChartInst = new Chart(ctx, {
    type: 'bar',
    data: { labels: MONTHS_SHORT, datasets: annualDatasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { font: { family: 'Inter' }, color: '#1a1a2e' } },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}`
          }
        }
      },
      scales: {
        x: { grid: { color: '#e8e8f0' }, ticks: { font: { family: 'Inter' } } },
        y: { grid: { color: '#e8e8f0' }, ticks: { font: { family: 'Inter' }, callback: v => fmtK(v) }, beginAtZero: true }
      }
    }
  });

  // Annual totals bar chart (below)
  if (yearlyChartInst2) yearlyChartInst2.destroy();
  const annTotals = appData.years.map(yr => {
    const c = MONTHS_SHORT.reduce((acc,_,mi) => { const m = calcMonth(yr,mi); acc.rev+=m.revenue; acc.exp+=m.expenses; return acc; }, {rev:0,exp:0});
    return c;
  });
  const ctx2 = document.getElementById('yearlyChart').getContext('2d');
  yearlyChartInst2 = new Chart(ctx2, {
    type: 'bar',
    data: {
      labels: appData.years.map(String),
      datasets: [
        { label: 'Revenue', data: annTotals.map(t=>t.rev), backgroundColor: 'rgba(74,124,89,0.8)', borderRadius: 4 },
        { label: 'Expenses', data: annTotals.map(t=>t.exp), backgroundColor: 'rgba(192,57,43,0.7)', borderRadius: 4 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { font: { family: 'Inter' } } } },
      scales: {
        x: { ticks: { font: { family: 'Inter' } } },
        y: { ticks: { font: { family: 'Inter' }, callback: v => fmtK(v) } }
      }
    }
  });

  // Annual Category Breakdown — stacked bar by category per year
  if (yearlyChartInst3) yearlyChartInst3.destroy();
  const expCats = CATEGORIES.filter(c => c !== 'Revenue');
  const catColorMap = {
    'Payroll':'#1a5fa8','Payroll1':'#4a8abf','Supplies & Materials - COGS':'#e67e22',
    'Taxes':'#c0392b','Utilities':'#8e44ad','Transpo':'#16a085','Vehicles':'#2980b9',
    'Office':'#7f8c8d','Insurance':'#d35400','FSN':'#27ae60',
    'Repairs/Maintenance':'#8b0000','Rent':'#2c3e50','Phone/Internet':'#6c3483','Marketing':'#e74c3c'
  };
  const catDatasets = expCats.map(cat => ({
    label: cat,
    data: appData.years.map(yr =>
      MONTHS_SHORT.reduce((s, _, mi) => s + (calcMonth(yr, mi).byCategory[cat] || 0), 0)
    ),
    backgroundColor: (catColorMap[cat] || '#888') + 'cc',
    borderWidth: 0
  })).filter(ds => ds.data.some(v => v > 0));

  const ctx3 = document.getElementById('yearlyCatChart').getContext('2d');
  yearlyChartInst3 = new Chart(ctx3, {
    type: 'bar',
    data: { labels: appData.years.map(String), datasets: catDatasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { font: { family: 'Inter' }, boxWidth: 12, fontSize: 11 } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}` } }
      },
      scales: {
        x: { stacked: true, ticks: { font: { family: 'Inter' } } },
        y: { stacked: true, ticks: { font: { family: 'Inter' }, callback: v => fmtK(v) } }
      }
    }
  });

  // Supplier pie — all transactions across active year (exclude vault)
  const allYearTxs = MONTHS_SHORT.reduce((arr, _, mi) => {
    return arr.concat(getTransactions(appData.activeYear, mi).filter(t => !t._vault));
  }, []);
  setTimeout(() => renderSupplierPie('yearlySupplierPie', 'yearlySupplierLegend', getSupplierData(allYearTxs)), 0);
}

