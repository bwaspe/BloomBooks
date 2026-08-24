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

// FloraNext is ONE channel, not a Web/POS split. Its daily report gives the
// tax-exclusive breakdown (products, delivery, tax) for the whole day, but
// splits by payment method only on figures that INCLUDE tax. The two cannot be
// reconciled: tax cannot be apportioned across payment methods when a large and
// varying share of sales is exempt, so splitting would mean inventing the
// division. The web-versus-counter breakdown lives in FloraNext's own report,
// and returns properly at POS cutover, where channel and tax are per order.
//
// Keeping FN combined also matches the history, which recorded it that way, so
// there is no change of shape partway through.
const DEFAULT_CHANNELS = [
  { id: 'fn',    label: 'FloraNext', active: true  },
  { id: 'cash',  label: 'Cash',      active: true  },
  { id: 'epx',   label: 'EPX',       active: true  },
  { id: 'venmo', label: 'Venmo',     active: true  },
  // Retired: kept so historical months still display, hidden from entry.
  { id: 'web',   label: 'Web',       active: false },
  { id: 'tf',    label: 'TF',        active: false },
];

const DS_CHANNELS_VERSION = 2;

function dsChannels() {
  if (!Array.isArray(appData.channels) || !appData.channels.length) {
    appData.channels = DEFAULT_CHANNELS.map(c => ({ ...c }));
    appData.channelsVersion = DS_CHANNELS_VERSION;
    return appData.channels;
  }
  // v1 seeded Web and POS as separate active channels, before it was clear
  // FloraNext cannot report them tax-exclusively. Correct that once, without
  // disturbing any channel added by hand.
  if ((appData.channelsVersion || 1) < 2) {
    const find = id => appData.channels.find(c => c.id === id);
    const fn = find('fn'); if (fn) { fn.active = true; fn.label = 'FloraNext'; }
    else appData.channels.unshift({ id: 'fn', label: 'FloraNext', active: true });
    const web = find('web'); if (web) web.active = false;
    appData.channels = appData.channels.filter(c => c.id !== 'pos');
    appData.channelsVersion = DS_CHANNELS_VERSION;
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

// Delivery tips are kept by the business, so they ARE revenue -- unlike
// collected sales tax, which is owed to New York State and merely passes
// through. They are recorded on their own line rather than folded into the
// channel figure for two reasons: "how much did we take in tips" is a question
// worth being able to answer, and if delivery tips ever start going to a driver
// instead, the treatment flips by excluding this one line rather than by
// unpicking it from a year of combined totals.
//
// Designers are usually tipped in cash, direct. That money never reaches the
// bank or the FloraNext report, and correctly appears nowhere in the books.
function dsSetTips(year, month, day, value) {
  const d = dsDay(year, month, day);
  const raw = String(value).trim();
  if (raw === '') delete d._tips; else d._tips = dsNum(raw);
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

// The day's revenue: channel sales plus tips. Tax is never included.
function dsDayTotal(year, month, day, field) {
  const d = dsMonth(year, month)[day] || {};
  const channels = Object.keys(d).reduce((s, k) => k.startsWith('_') ? s : s + dsNum((d[k] || {})[field || 's']), 0);
  return (field && field !== 's') ? channels : channels + dsNum(d._tips);
}

// Month totals, and the figure the books should treat as revenue: sales only,
// never tax.
function dsMonthTotals(year, month) {
  const days = dsMonth(year, month);
  let sales = 0, tax = 0, tips = 0;
  const byChannel = {};
  Object.keys(days).forEach(day => {
    const d = days[day] || {};
    tips += dsNum(d._tips);
    Object.keys(d).forEach(k => {
      if (k.startsWith('_')) return;
      const s = dsNum((d[k] || {}).s), t = dsNum((d[k] || {}).t);
      sales += s; tax += t;
      if (!byChannel[k]) byChannel[k] = { s: 0, t: 0 };
      byChannel[k].s += s; byChannel[k].t += t;
    });
  });
  // sales   = channel figures only
  // tips    = kept by the business, so revenue, but shown separately
  // revenue = what the books should count. Tax is in neither.
  return { sales, tax, tips, revenue: sales + tips, byChannel };
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
// SALES TAX — QUARTERLY
// ============================================================
// The New York filing asks for SALES, split taxable and exempt -- not for what
// was collected. The tax figure is therefore a cross-check rather than the
// answer: taxable x rate should land on what the registers actually took, and a
// gap means something is miscoded.
//
// Where the taxable split comes from, per channel:
//   'detail' — the taxable base recorded per order by the FloraNext import
//              (Product + Delivery + Wire Out Fee + Markup - Discount). This is
//              the only source that knows about exempt sales, which for this
//              shop are mostly house accounts.
//   'all'    — every sale taxable. The sensible default for figures typed by
//              hand: cash and card takings over the counter.
//   'exempt' — none taxable.
//
// A channel with mode 'detail' but no recorded base -- a FloraNext month
// entered by hand before the importer existed -- is reported as UNCLASSIFIED
// rather than guessed at. A filing built on a guess is worse than one with a
// visible hole in it.
const DS_TAX_RATE = 0.08375;          // NY state + Westchester

const dsFnIds = () => new Set(Object.values(FN_METHOD_CHANNEL).concat(['fn']));

function dsTaxMode(ch) {
  if (ch && (ch.taxMode === 'all' || ch.taxMode === 'detail' || ch.taxMode === 'exempt')) return ch.taxMode;
  return dsFnIds().has((ch || {}).id) ? 'detail' : 'all';
}

function dsSetTaxMode(id, mode) {
  const c = dsChannels().find(x => x.id === id);
  if (!c) return;
  c.taxMode = mode;
  saveData();
  renderSalesTaxPanel();
}

// New York's sales tax quarters are offset from calendar quarters: they run
// Dec-Feb, Mar-May, Jun-Aug, Sep-Nov. The first therefore spans a year
// boundary, so each month carries a year offset -- selecting 2026 Q1 means
// December 2025 through February 2026. Using calendar quarters would put
// December in the wrong return.
const DS_QUARTERS = [
  { label: 'Dec – Feb', months: [[-1, 11], [0, 0], [0, 1]] },
  { label: 'Mar – May', months: [[0, 2], [0, 3], [0, 4]] },
  { label: 'Jun – Aug', months: [[0, 5], [0, 6], [0, 7]] },
  { label: 'Sep – Nov', months: [[0, 8], [0, 9], [0, 10]] },
];

// Tips are revenue but never a taxable receipt, so they sit in exempt.
function dsTaxReport(year, quarter) {
  const spec = DS_QUARTERS[quarter] || DS_QUARTERS[0];
  const months = spec.months.map(([off, m]) => ({ y: year + off, m }));
  const byChannel = {};
  const byMonth = {};
  let tips = 0;

  months.forEach(({ y, m }) => {
    const mt = byMonth[`${y}-${m}`] = { y, m, sales: 0, taxable: 0, exempt: 0, tax: 0, unknown: 0 };
    const days = dsMonth(y, m);
    Object.keys(days).forEach(dk => {
      const d = days[dk] || {};
      const dayTips = dsNum(d._tips);
      tips += dayTips;
      mt.sales += dayTips; mt.exempt += dayTips;
      Object.keys(d).forEach(k => {
        if (k.startsWith('_')) return;
        const rec = d[k] || {};
        const s = dsNum(rec.s), t = dsNum(rec.t);
        const mode = dsTaxMode(dsChannels().find(c => c.id === k) || { id: k });
        let taxable = null;
        if (mode === 'exempt') taxable = 0;
        else if (mode === 'all') taxable = s;
        else if (rec.x != null) taxable = dsNum(rec.x);

        const b = byChannel[k] || (byChannel[k] = { sales: 0, taxable: 0, exempt: 0, tax: 0, unknown: 0, mode });
        b.sales += s; b.tax += t;
        if (Math.abs(t) > 0.005) b.hasTax = true;
        mt.sales += s; mt.tax += t;
        if (taxable === null) { b.unknown += s; mt.unknown += s; }
        else {
          b.taxable += taxable; b.exempt += s - taxable;
          mt.taxable += taxable; mt.exempt += s - taxable;
        }
      });
    });
  });

  // The cross-check can only compare channels whose tax was actually recorded.
  // Cash, EPX and Venmo are typed by hand and carry sales but no tax figure, so
  // including their taxable sales in "expected" produces a permanent shortfall
  // of exactly the tax on them -- a warning that fires every quarter and means
  // nothing. Their taxable sales are reported separately as unchecked instead.
  const tot = { sales: tips, taxable: 0, exempt: tips, tax: 0, unknown: 0,
                checkedTaxable: 0, uncheckedTaxable: 0, uncheckedChannels: [] };
  Object.values(byChannel).forEach(b => {
    tot.sales += b.sales; tot.taxable += b.taxable;
    tot.exempt += b.exempt; tot.tax += b.tax; tot.unknown += b.unknown;
  });
  Object.keys(byChannel).forEach(k => {
    const b = byChannel[k];
    if (!b.taxable) return;
    if (b.hasTax) tot.checkedTaxable += b.taxable;
    else { tot.uncheckedTaxable += b.taxable; tot.uncheckedChannels.push(k); }
  });
  return { months, byChannel, byMonth, tips, tot };
}

let stYear = null, stQuarter = null;
function stSetView(y, q) {
  stYear = parseInt(y, 10); stQuarter = parseInt(q, 10);
  renderSalesTaxPanel();
}

function renderSalesTaxPanel() {
  const el = document.getElementById('sales-tax-content');
  if (!el) return;
  if (stYear == null) stYear = appData.activeYear;
  if (stQuarter == null) stQuarter = Math.floor(new Date().getMonth() / 3);

  const r = dsTaxReport(stYear, stQuarter);
  const r2 = n => Math.round(n * 100) / 100;
  const expected = r2(r.tot.checkedTaxable * DS_TAX_RATE);
  const gap = r2(r.tot.tax - expected);
  const label0 = id => (dsChannels().find(c => c.id === id) || {}).label || id;
  const qRange = (y, i) => {
    const ms = DS_QUARTERS[i].months;
    const a = ms[0], b = ms[ms.length - 1];
    return `${MONTHS_SHORT[a[1]]} ${y + a[0]} – ${MONTHS_SHORT[b[1]]} ${y + b[0]}`;
  };
  const label = id => (dsChannels().find(c => c.id === id) || {}).label || id;
  const modeSel = id => {
    const m = dsTaxMode(dsChannels().find(c => c.id === id) || { id });
    return `<select onchange="dsSetTaxMode('${id}', this.value)"
              style="font-size:0.68rem;border:1px solid var(--border);border-radius:4px;padding:2px 4px;background:var(--surface);font-family:Inter,sans-serif">
      <option value="detail" ${m === 'detail' ? 'selected' : ''}>per order</option>
      <option value="all" ${m === 'all' ? 'selected' : ''}>all taxable</option>
      <option value="exempt" ${m === 'exempt' ? 'selected' : ''}>all exempt</option>
    </select>`;
  };

  el.innerHTML = `
    <div class="staging-controls">
      <div class="form-group" style="min-width:110px"><label>Year</label>
        <select onchange="stSetView(this.value, ${stQuarter})">
          ${(appData.years || []).map(y => `<option value="${y}" ${y === stYear ? 'selected' : ''}>${y}</option>`).join('')}
        </select></div>
      <div class="form-group" style="min-width:210px"><label>Quarter</label>
        <select onchange="stSetView(${stYear}, this.value)">
          ${DS_QUARTERS.map((q, i) => `<option value="${i}" ${i === stQuarter ? 'selected' : ''}>Q${i + 1} — ${qRange(stYear, i)}</option>`).join('')}
        </select></div>
      <div style="align-self:flex-end;font-size:0.72rem;color:var(--mist)">
        New York's quarters, not calendar ones
      </div>
    </div>

    <div class="kpi-row">
      <div class="kpi-card revenue"><div class="kpi-label">Taxable sales</div>
        <div class="kpi-value">${fmt(r.tot.taxable)}</div>
        <div class="kpi-sub">what the filing asks for</div></div>
      <div class="kpi-card cogs"><div class="kpi-label">Exempt sales</div>
        <div class="kpi-value">${fmt(r.tot.exempt)}</div>
        <div class="kpi-sub">${r.tips ? 'incl. ' + fmt(r.tips) + ' tips' : 'house accounts, wire, tips'}</div></div>
      <div class="kpi-card profit"><div class="kpi-label">Tax collected</div>
        <div class="kpi-value">${fmt(r.tot.tax)}</div>
        <div class="kpi-sub">expected ${fmt(expected)} on ${fmt(r.tot.checkedTaxable)} of checkable sales</div></div>
    </div>

    ${r.tot.uncheckedTaxable ? `
      <div style="margin-bottom:16px;padding:10px;border-radius:6px;background:var(--paper);border:1px solid var(--border)">
        <strong style="font-size:0.8rem">${fmt(r.tot.uncheckedTaxable)} of taxable sales cannot be cross-checked</strong>
        <div style="font-size:0.75rem;color:var(--ink-soft);margin-top:4px">
          ${r.tot.uncheckedChannels.map(id => escHtml(label0(id))).join(', ')} —
          these are typed by hand and carry no tax figure, so there is nothing to compare against.
          They still count towards taxable sales for the filing; only the check below excludes them.
          At ${(DS_TAX_RATE * 100).toFixed(3)}% they would account for about ${fmt(r.tot.uncheckedTaxable * DS_TAX_RATE)} of tax.
        </div>
      </div>` : ''}

    ${r.tot.unknown ? `
      <div style="margin-bottom:16px;padding:10px;border-radius:6px;background:#fff3cd;border:1px solid #ffc107">
        <strong style="font-size:0.8rem">${fmt(r.tot.unknown)} of sales are unclassified</strong>
        <div style="font-size:0.75rem;color:var(--ink-soft);margin-top:4px">
          These channels are set to read the taxable split from each order, but no split was recorded —
          months entered by hand before the FloraNext import. They are left out of both columns rather than
          guessed at. Either import that period, or set the channel below to “all taxable”.
        </div>
      </div>` : ''}

    ${Math.abs(gap) > 1 ? `
      <div style="margin-bottom:16px;padding:10px;border-radius:6px;background:${Math.abs(gap) > 25 ? 'var(--red-light);border:1px solid var(--red)' : 'var(--paper);border:1px solid var(--border)'}">
        <strong style="font-size:0.8rem">Collected is ${gap > 0 ? 'over' : 'under'} expected by ${fmt(Math.abs(gap))}</strong>
        <div style="font-size:0.75rem;color:var(--ink-soft);margin-top:4px">
          Expected is taxable sales at ${(DS_TAX_RATE * 100).toFixed(3)}%. Small differences are rounding on each
          order; a large one means something is on the wrong side of the taxable line.
        </div>
      </div>` : ''}

    <div class="ledger-wrap">
      <div class="ledger-header"><h3>By channel</h3></div>
      <div class="staging-table-wrap">
        <table>
          <thead><tr><th>Channel</th><th>Taxable split</th><th style="text-align:right">Sales</th>
            <th style="text-align:right">Taxable</th><th style="text-align:right">Exempt</th>
            <th style="text-align:right">Unclassified</th><th style="text-align:right">Tax collected</th></tr></thead>
          <tbody>
            ${Object.keys(r.byChannel).sort((a, b) => r.byChannel[b].sales - r.byChannel[a].sales).map(id => {
              const b = r.byChannel[id];
              return `<tr>
                <td><strong>${escHtml(label(id))}</strong></td>
                <td>${modeSel(id)}</td>
                <td style="text-align:right">${fmt(b.sales)}</td>
                <td style="text-align:right" class="${b.taxable ? 'amount-in' : ''}">${b.taxable ? fmt(b.taxable) : '—'}</td>
                <td style="text-align:right;color:var(--mist)">${b.exempt ? fmt(b.exempt) : '—'}</td>
                <td style="text-align:right;color:${b.unknown ? 'var(--red)' : 'var(--mist)'}">${b.unknown ? fmt(b.unknown) : '—'}</td>
                <td style="text-align:right">${b.tax ? fmt(b.tax) : '—'}</td>
              </tr>`;
            }).join('')}
            ${r.tips ? `<tr><td><strong>Tips</strong></td><td style="font-size:0.7rem;color:var(--mist)">never taxable</td>
              <td style="text-align:right">${fmt(r.tips)}</td><td style="text-align:right">—</td>
              <td style="text-align:right;color:var(--mist)">${fmt(r.tips)}</td>
              <td style="text-align:right">—</td><td style="text-align:right">—</td></tr>` : ''}
            <tr style="font-weight:600;border-top:2px solid var(--blue-light)">
              <td>Total</td><td></td>
              <td style="text-align:right">${fmt(r.tot.sales)}</td>
              <td style="text-align:right" class="amount-in">${fmt(r.tot.taxable)}</td>
              <td style="text-align:right">${fmt(r.tot.exempt)}</td>
              <td style="text-align:right;color:${r.tot.unknown ? 'var(--red)' : 'var(--mist)'}">${r.tot.unknown ? fmt(r.tot.unknown) : '—'}</td>
              <td style="text-align:right">${fmt(r.tot.tax)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="ledger-wrap" style="margin-top:16px">
      <div class="ledger-header"><h3>By month</h3></div>
      <table>
        <thead><tr><th>Month</th><th style="text-align:right">Sales</th><th style="text-align:right">Taxable</th>
          <th style="text-align:right">Exempt</th><th style="text-align:right">Tax collected</th>
          <th style="text-align:right">Expected</th></tr></thead>
        <tbody>
          ${r.months.map(({ y, m }) => {
            const b = r.byMonth[`${y}-${m}`];
            const exp = r2(b.taxable * DS_TAX_RATE);
            return `<tr>
              <td><strong>${MONTHS_SHORT[m]} ${y}</strong></td>
              <td style="text-align:right">${fmt(b.sales)}</td>
              <td style="text-align:right">${fmt(b.taxable)}</td>
              <td style="text-align:right;color:var(--mist)">${fmt(b.exempt)}</td>
              <td style="text-align:right">${fmt(b.tax)}</td>
              <td style="text-align:right;color:var(--mist)">${fmt(exp)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>

    <p style="font-size:0.72rem;color:var(--mist);margin-top:12px">
      Figures come from the Daily Sales book. Sales are tax-exclusive throughout; collected tax is
      recorded but never counted as revenue, since it is owed to New York State.
    </p>
  `;
}

// ============================================================
// USING THE DAY BOOK AS REVENUE
// ============================================================
// A single switch-over month, stored as 'YYYY-MM'. From it onwards calcMonth()
// takes revenue from here and stops counting bank credits, which are
// settlements of sales already recorded. Expressed as a start month rather
// than a list, so months that do not exist yet are covered without anyone
// remembering to switch them on.
//
// Deliberately kept as one setting and nothing else: no transaction is
// rewritten, marked or deleted, so clearing it restores the previous
// behaviour exactly. That matters for a change to somebody's books.

function dsRevenueMonth(year, month) {
  const from = appData.dailyRevenueFrom;
  if (!from) return false;
  const m = String(from).match(/^(\d{4})-(\d{1,2})$/);
  if (!m) return false;
  const fy = +m[1], fm = +m[2] - 1;
  return year > fy || (year === fy && month >= fm);
}

// What each month of a year looks like before and after the switch.
function dsRevenueComparison(year) {
  // getTransactions lives in ledger.js. Both load in the browser, but a render
  // path that throws when one script is missing takes the whole panel with it,
  // so the comparison degrades to "no deposits known" instead.
  const readTxs = (y, m) => (typeof getTransactions === 'function' ? getTransactions(y, m) : []) || [];
  const rows = [];
  for (let m = 0; m < 12; m++) {
    const txs = readTxs(year, m).filter(t => !t._vault);
    const deposits = txs.filter(t => t.category === 'Revenue' && t.type === 'in');
    const fromBank = deposits.reduce((s, t) => s + t.amount, 0);
    const fromDayBook = dsMonthTotals(year, m).revenue;
    rows.push({
      month: m, label: MONTHS_SHORT[m],
      fromBank, fromDayBook, deposits: deposits.length,
      diff: Math.round((fromDayBook - fromBank) * 100) / 100,
      active: dsRevenueMonth(year, m),
    });
  }
  return rows;
}

function dsSetRevenueFrom(value) {
  appData.dailyRevenueFrom = value || null;
  saveData();
  renderDailySalesPanel();
  notify(value ? `Revenue now comes from the day book from ${value} onwards`
               : 'Revenue is back to being counted from bank deposits');
}

function dsRevenueHtml() {
  const year = dsViewYear == null ? appData.activeYear : dsViewYear;
  const rows = dsRevenueComparison(year);
  const anyData = rows.some(r => r.fromDayBook || r.fromBank);
  if (!anyData) return '';
  const from = appData.dailyRevenueFrom || '';
  const totalBank = rows.reduce((s, r) => s + r.fromBank, 0);
  const totalBook = rows.reduce((s, r) => s + r.fromDayBook, 0);

  return `
    <div class="staging-area" style="margin-top:16px">
      <h3>Revenue source — ${year}</h3>
      <p style="color:var(--mist);font-size:0.75rem;margin-bottom:10px">
        Bank deposits are net of Stripe's fees and include collected sales tax, so they understate and
        overstate revenue at the same time. The day book records what was earned, excluding tax.
        Switching over also stops bank credits counting, since they settle sales already recorded here.
        Nothing is rewritten — clearing this puts everything back.
      </p>
      <div class="staging-table-wrap">
        <table>
          <thead><tr><th>Month</th><th style="text-align:right">From deposits</th>
            <th style="text-align:right">From day book</th><th style="text-align:right">Difference</th><th></th></tr></thead>
          <tbody>
            ${rows.filter(r => r.fromBank || r.fromDayBook).map(r => `
              <tr>
                <td><strong>${r.label}</strong></td>
                <td style="text-align:right;color:var(--mist)">${r.fromBank ? fmt(r.fromBank) : '—'}</td>
                <td style="text-align:right" class="${r.fromDayBook ? 'amount-in' : ''}">${r.fromDayBook ? fmt(r.fromDayBook) : '—'}</td>
                <td style="text-align:right;font-size:0.78rem;color:${r.diff > 0 ? 'var(--green)' : r.diff < 0 ? 'var(--red)' : 'var(--mist)'}">
                  ${r.fromBank && r.fromDayBook ? (r.diff > 0 ? '+' : '') + fmt(r.diff) : ''}</td>
                <td style="font-size:0.7rem;color:var(--mist)">${r.active ? 'day book' : (r.deposits ? r.deposits + ' deposits' : '')}</td>
              </tr>`).join('')}
            <tr style="font-weight:600;border-top:2px solid var(--blue-light)">
              <td>Year</td>
              <td style="text-align:right;color:var(--mist)">${fmt(totalBank)}</td>
              <td style="text-align:right" class="amount-in">${fmt(totalBook)}</td>
              <td style="text-align:right">${totalBank && totalBook ? (totalBook - totalBank > 0 ? '+' : '') + fmt(totalBook - totalBank) : ''}</td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div style="margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        ${from
          ? `<span style="font-size:0.8rem">Day book is the revenue source from <strong>${escHtml(from)}</strong> onwards.</span>
             <button class="btn btn-outline btn-sm" onclick="dsSetRevenueFrom('')">Undo — go back to deposits</button>`
          : `<button class="btn btn-primary" onclick="dsSetRevenueFrom('${year}-01')">Use the day book for ${year} onwards</button>
             <span style="font-size:0.72rem;color:var(--mist)">Earlier years are left exactly as they are.</span>`}
      </div>
    </div>`;
}

// ============================================================
// IMPORT A FLORANEXT EXPORT
// ============================================================
// FloraNext's Sales Report exports one row per order, with the figures needed
// to fill the day book exactly. Verified against 2 Jan 2026: the eleven orders
// that day give 1,110.49, matching the figure already in the book to the penny.
//
//   sales   = Grand Total - Tax - Tips      (what the owner has always recorded)
//   tips    = Tips                          (kept by the business, so revenue,
//                                            but entered on its own line)
//   taxable = Product + Delivery + Wire Out Fee + Markup - Discount
//
// Delivery and wire fees are taxable; tips are not. Every order in the 2026
// export reconciles on both counts.
//
// WHICH ROWS COUNT
//
// "House Account Payment" rows ARE orders, not payments against orders. Their
// order numbers appear nowhere else -- 210 of them, none overlapping a Sale --
// so excluding them on the strength of the label would silently lose $29,684
// across 2026, and the shop's largest accounts with it. This is the same trap
// the original FloraNext history import fell into.
//
// Refunds and Adjustments do share order numbers with Sales, which is correct:
// they are reversals carried as negatives, and both rows belong.
//
// Proposals are included because the owner's own records include them: matching
// the day book day by day, all-types-including-proposals fits 179 of 216 days,
// against 135 for sales alone.
const FN_TYPES = new Set(['Sale', 'House Account Payment', 'Refund', 'Adjustment', 'proposal']);

// Order Method -> channel. Kept granular deliberately: collapsing columns later
// is arithmetic, splitting a combined one is impossible -- which is exactly why
// 2023-2025 is stuck as a single combined figure.
const FN_METHOD_CHANNEL = {
  'phone': 'phone',
  'walk-in': 'counter',
  'website': 'web',
  'subscription / standing order': 'standing',
  'florist-to-florist': 'wire',
  '': 'events',                       // proposals carry no order method
};

const FN_MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
                    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

function fnParseDate(s) {
  const m = String(s || '').trim().match(/^([A-Za-z]{3})[a-z]*\s+(\d{1,2}),\s*(\d{4})$/);
  if (!m) return null;
  const mo = FN_MONTHS[m[1].toLowerCase()];
  if (mo === undefined) return null;
  return { y: +m[3], m: mo, d: +m[2] };
}

const fnMoney = v => {
  const n = parseFloat(String(v == null ? '' : v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

let fnImport = null;

function fnLoadExport(evt) {
  const file = evt.target.files && evt.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try { fnBuildImport(String(e.target.result)); }
    catch (err) { notify('Could not read that export: ' + (err && err.message || err), true); }
  };
  reader.onerror = () => notify('Could not read that file', true);
  reader.readAsText(file);
  evt.target.value = '';
}

function fnBuildImport(text) {
  const rows = parseDelimited(text);          // shared with the statement importer
  if (rows.length < 2) { notify('That file had no rows', true); return; }
  const head = rows[0].map(h => String(h).replace(/^﻿/, '').trim().toLowerCase());
  const col = name => head.indexOf(name);
  const need = ['order date', 'grand total', 'tax', 'tips', 'order method', 'transaction type'];
  const missing = need.filter(n => col(n) < 0);
  if (missing.length) {
    notify('That does not look like a FloraNext export — missing: ' + missing.join(', '), true);
    return;
  }
  const iDate = col('order date'), iGrand = col('grand total'), iTax = col('tax'),
        iTips = col('tips'), iMethod = col('order method'), iType = col('transaction type'),
        iProd = col('product total'), iDeliv = col('delivery'), iWire = col('wire out fee'),
        iMark = col('product markup'), iDisc = col('discount');

  const days = {};            // 'y-m' -> { day -> { ch -> {s,t,x}, _tips } }
  const skipped = {};
  const methods = {};
  let counted = 0, minD = null, maxD = null;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !(r[iDate] || '').trim()) continue;
    const type = String(r[iType] || '').trim();
    if (!FN_TYPES.has(type)) { skipped[type || '(blank)'] = (skipped[type || '(blank)'] || 0) + 1; continue; }
    const dt = fnParseDate(r[iDate]);
    if (!dt) { skipped['unreadable date'] = (skipped['unreadable date'] || 0) + 1; continue; }

    const method = String(r[iMethod] || '').trim().toLowerCase();
    const ch = FN_METHOD_CHANNEL[method];
    if (!ch) { skipped['order method "' + (r[iMethod] || '') + '"'] = (skipped['order method "' + (r[iMethod] || '') + '"'] || 0) + 1; continue; }
    methods[method] = (methods[method] || 0) + 1;

    const grand = fnMoney(r[iGrand]), tax = fnMoney(r[iTax]), tips = fnMoney(r[iTips]);
    // Discount is exported ALREADY NEGATIVE, so it is added, not subtracted.
    // Subtracting it added discounts to the taxable base instead of removing
    // them, which made taxable exceed sales and produced negative exempt totals.
    // With the right sign the identity closes to the cent across the year:
    // taxable + nontaxable delivery = grand - tax - tips.
    const taxable = fnMoney(r[iProd]) + fnMoney(r[iDeliv]) + fnMoney(r[iWire])
                  + fnMoney(r[iMark]) + fnMoney(r[iDisc]);

    const key = `${dt.y}-${dt.m}`;
    if (!days[key]) days[key] = {};
    if (!days[key][dt.d]) days[key][dt.d] = {};
    const day = days[key][dt.d];
    if (!day[ch]) day[ch] = { s: 0, t: 0, x: 0 };
    // An order that was charged no tax is exempt, however taxable its contents
    // look: house accounts are the bulk of it here, and they carry a full
    // product total against zero tax. Counting their base as taxable inflates
    // the figure the filing asks for -- by $29.5k across 2026, which is the
    // house account total almost exactly. Refunds carry negative tax, so the
    // test is on magnitude.
    const taxed = Math.abs(tax) > 0.005;
    day[ch].s += grand - tax - tips;
    day[ch].t += tax;
    day[ch].x += taxed ? taxable : 0;
    day._tips = (day._tips || 0) + tips;

    counted++;
    const iso = `${dt.y}-${String(dt.m + 1).padStart(2, '0')}-${String(dt.d).padStart(2, '0')}`;
    if (!minD || iso < minD) minD = iso;
    if (!maxD || iso > maxD) maxD = iso;
  }

  // Round once, at the end, so a month of additions cannot drift.
  const round2 = n => Math.round(n * 100) / 100;
  Object.values(days).forEach(month => Object.values(month).forEach(day => {
    Object.keys(day).forEach(k => {
      if (k === '_tips') { day._tips = round2(day._tips); return; }
      day[k].s = round2(day[k].s); day[k].t = round2(day[k].t); day[k].x = round2(day[k].x);
    });
    if (!day._tips) delete day._tips;
  }));

  // What would change? Compare against the FloraNext-side channels already held.
  const fnChannels = new Set(Object.values(FN_METHOD_CHANNEL).concat(['fn']));
  const changes = [];
  Object.keys(days).forEach(key => {
    const [y, m] = key.split('-').map(Number);
    Object.keys(days[key]).forEach(d => {
      const now = ((appData.dailySales || {})[key] || {})[d] || {};
      const had = Object.keys(now).filter(k => fnChannels.has(k))
        .reduce((s, k) => s + dsNum((now[k] || {}).s), 0) + dsNum(now._tips);
      const will = Object.keys(days[key][d]).filter(k => k !== '_tips')
        .reduce((s, k) => s + days[key][d][k].s, 0) + (days[key][d]._tips || 0);
      if (Math.abs(had - will) > 0.02) changes.push({ key, d, had: round2(had), will: round2(will) });
    });
  });

  const totals = {};
  Object.values(days).forEach(month => Object.values(month).forEach(day =>
    Object.keys(day).forEach(k => {
      if (k === '_tips') { totals._tips = (totals._tips || 0) + day._tips; return; }
      totals[k] = (totals[k] || 0) + day[k].s;
    })));

  fnImport = { days, totals, skipped, methods, counted, minD, maxD, changes };
  renderDailySalesPanel();
}

function fnApplyImport() {
  if (!fnImport) return;
  if (!appData.dailySales) appData.dailySales = {};
  const fnChannels = new Set(Object.values(FN_METHOD_CHANNEL).concat(['fn']));
  let n = 0;
  Object.keys(fnImport.days).forEach(key => {
    if (!appData.dailySales[key]) appData.dailySales[key] = {};
    Object.keys(fnImport.days[key]).forEach(d => {
      const src = fnImport.days[key][d];
      const day = appData.dailySales[key][d] || (appData.dailySales[key][d] = {});
      // Replace every FloraNext-side channel for that day, so a re-import is a
      // correction rather than an addition. Cash, EPX and Venmo are typed by
      // hand and are never touched.
      Object.keys(day).forEach(k => { if (fnChannels.has(k)) delete day[k]; });
      Object.keys(src).forEach(k => {
        if (k === '_tips') { day._tips = src._tips; return; }
        day[k] = { s: src[k].s, t: src[k].t, x: src[k].x };
      });
      if (!src._tips) delete day._tips;
      n++;
    });
  });
  // Any channel the export produced must exist AND be active. Reactivating
  // matters as much as adding: 'web' already exists as a retired channel from
  // the days when FloraNext could not be split, so only adding the missing ones
  // would file every website sale under a channel still marked retired.
  const LABEL = { phone: 'Phone', counter: 'Walk-in', web: 'Website',
                  standing: 'Standing', wire: 'Wire out', events: 'Events' };
  Object.keys(fnImport.totals).forEach(id => {
    if (id === '_tips') return;
    const existing = dsChannels().find(c => c.id === id);
    if (existing) existing.active = true;
    else dsChannels().push({ id, label: LABEL[id] || id, active: true });
  });
  // The combined pre-split channel has no place in the years now split out.
  const fn = dsChannels().find(c => c.id === 'fn');
  if (fn) fn.active = false;

  fnImport = null;
  saveData();
  renderDailySalesPanel();
  notify(`Imported ${n} days from the FloraNext export`);
}

function fnDismissImport() { fnImport = null; renderDailySalesPanel(); }

function fnImportHtml() {
  if (!fnImport) {
    return `
      <div class="staging-area" style="margin-top:16px">
        <h3>Import a FloraNext export</h3>
        <p style="color:var(--mist);font-size:0.75rem;margin-bottom:10px">
          Takes the Sales Report CSV straight from FloraNext, for a single day or any date range.
          Sales, tax and tips are read per order and split by how the order was taken.
          Cash, EPX and Venmo are never touched. Nothing is written until you approve it.
        </p>
        <button class="btn btn-outline" onclick="document.getElementById('fn-export-file').click()">📂 Choose export</button>
        <input type="file" id="fn-export-file" accept=".csv,.txt" style="display:none" onchange="fnLoadExport(event)">
      </div>`;
  }
  const { totals, skipped, counted, minD, maxD, changes } = fnImport;
  const dayCount = Object.values(fnImport.days).reduce((s, m) => s + Object.keys(m).length, 0);
  const chanLabel = id => (dsChannels().find(c => c.id === id) || {}).label
    || ({ phone: 'Phone', counter: 'Walk-in', web: 'Website', standing: 'Standing',
          wire: 'Wire out', events: 'Events' })[id] || id;
  const grand = Object.keys(totals).filter(k => k !== '_tips').reduce((s, k) => s + totals[k], 0);

  // The reassurance that nothing has been written belongs HERE, on the preview,
  // not only on the screen before a file is chosen -- this is the moment it
  // matters, and a preview that looks finished is easy to walk away from
  // believing the import happened.
  return `
    <div class="staging-area" style="margin-top:16px;border:2px solid var(--accent2)">
      <h3>FloraNext export — ${counted} orders, ${minD} to ${maxD}</h3>
      <div style="margin:-4px 0 12px;padding:8px 10px;border-radius:6px;background:var(--blue-light);
                  font-size:0.78rem;color:var(--ink)">
        <strong>Nothing has been saved yet.</strong> This is what the import would do —
        press <em>Import ${Object.values(fnImport.days).reduce((s, m) => s + Object.keys(m).length, 0)} days</em> at the bottom to apply it.
      </div>
      <div class="staging-table-wrap">
        <table>
          <thead><tr><th>Channel</th><th style="text-align:right">Sales</th></tr></thead>
          <tbody>
            ${Object.keys(totals).filter(k => k !== '_tips')
              .sort((a, b) => totals[b] - totals[a]).map(id => `
              <tr><td><strong>${escHtml(chanLabel(id))}</strong></td>
                  <td class="amount-in" style="text-align:right">${fmt(totals[id])}</td></tr>`).join('')}
            ${totals._tips ? `<tr><td>Tips</td><td style="text-align:right">${fmt(totals._tips)}</td></tr>` : ''}
            <tr style="font-weight:600;border-top:2px solid var(--blue-light)">
              <td>${dayCount} days</td>
              <td class="amount-in" style="text-align:right">${fmt(grand + (totals._tips || 0))}</td>
            </tr>
          </tbody>
        </table>
      </div>

      ${Object.keys(skipped).length ? `
        <div style="margin-top:12px;padding:10px;border-radius:6px;background:var(--paper);border:1px solid var(--border)">
          <strong style="font-size:0.8rem">Rows not counted</strong>
          <ul style="margin:6px 0 0 18px;font-size:0.75rem;color:var(--ink-soft)">
            ${Object.keys(skipped).map(k => `<li>${escHtml(k)} — ${skipped[k]}</li>`).join('')}
          </ul>
        </div>` : ''}

      ${changes.length ? `
        <div style="margin-top:12px;padding:10px;border-radius:6px;background:#fff3cd;border:1px solid #ffc107">
          <strong style="font-size:0.8rem">${changes.length} day${changes.length === 1 ? '' : 's'} will change</strong>
          <div style="font-size:0.72rem;color:var(--ink-soft);margin-top:4px">
            FloraNext-side figures are replaced for every day in the export. Cash, EPX and Venmo are untouched.
          </div>
          <ul style="margin:6px 0 0 18px;font-size:0.75rem;color:var(--ink-soft);max-height:160px;overflow:auto">
            ${changes.slice(0, 60).map(c => {
              const [y, m] = c.key.split('-');
              return `<li>${y}-${String(+m + 1).padStart(2, '0')}-${String(c.d).padStart(2, '0')}:
                      ${fmt(c.had)} → ${fmt(c.will)} <span style="color:${c.will > c.had ? 'var(--green)' : 'var(--red)'}">
                      (${c.will > c.had ? '+' : ''}${fmt(c.will - c.had)})</span></li>`;
            }).join('')}
            ${changes.length > 60 ? `<li>…and ${changes.length - 60} more</li>` : ''}
          </ul>
        </div>` : ''}

      <div style="margin-top:12px;display:flex;gap:8px">
        <button class="btn btn-primary" onclick="fnApplyImport()">Import ${dayCount} days</button>
        <button class="btn btn-outline" onclick="fnDismissImport()">Cancel</button>
      </div>
    </div>`;
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
    <div class="staging-area" style="margin-top:16px;border:2px solid var(--accent2)">
      <h3>Sales ${year} — what this would bring in</h3>
      <div style="margin:-4px 0 12px;padding:8px 10px;border-radius:6px;background:var(--blue-light);
                  font-size:0.78rem;color:var(--ink)">
        <strong>Nothing has been saved yet.</strong> Press <em>Import ${dayCount} days</em> at the bottom to apply it.
      </div>
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

// How the grid is laid out is a view preference, not business data, so it lives
// in localStorage rather than appData -- no sync, no allowlist, nothing to lose.
function dsPref(name) {
  try { return localStorage.getItem('bb_ds_' + name) === '1'; } catch (e) { return false; }
}
function dsTogglePref(name) {
  try { localStorage.setItem('bb_ds_' + name, dsPref(name) ? '0' : '1'); } catch (e) {}
  renderDailySalesPanel();
}

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
  const allChans = dsChannelsFor(year, month);
  const len = new Date(year, month + 1, 0).getDate();
  const totals = dsMonthTotals(year, month);
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // The FloraNext split is six channels wide, and with a tax cell each that is
  // eighteen inputs a row -- enough to push the day's total off the screen,
  // which is the one number worth seeing at a glance. So the FloraNext side
  // collapses to a single computed column by default, and tax is hidden
  // entirely unless asked for: it is imported rather than typed, and is never
  // part of revenue.
  const fnExpanded = dsPref('fnExpanded');
  const showTax = dsPref('showTax');
  const fnIds = new Set(Object.values(FN_METHOD_CHANNEL).concat(['fn']));
  const fnChans = allChans.filter(c => fnIds.has(c.id));
  const manualChans = allChans.filter(c => !fnIds.has(c.id));
  const shownChans = fnExpanded ? fnChans.concat(manualChans) : manualChans;

  const fnDayTotal = day => {
    const d = dsMonth(year, month)[day] || {};
    return fnChans.reduce((s, c) => s + dsNum((d[c.id] || {}).s), 0);
  };
  const fnMonthTotal = fnChans.reduce((s, c) => s + ((totals.byChannel[c.id] || {}).s || 0), 0);

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
      <div style="align-self:flex-end;display:flex;gap:6px">
        <button class="btn btn-outline btn-sm" onclick="dsTogglePref('fnExpanded')">
          ${fnExpanded ? '▾ Collapse FloraNext' : '▸ Expand FloraNext'}
        </button>
        <button class="btn btn-outline btn-sm" onclick="dsTogglePref('showTax')"
                title="Tax is recorded but never counted as revenue">
          ${showTax ? '✓ Tax' : 'Show tax'}
        </button>
      </div>
      <div style="align-self:flex-end;margin-left:auto;text-align:right">
        <div style="font-size:0.7rem;color:var(--mist);text-transform:uppercase;letter-spacing:0.08em">Month revenue (ex tax)</div>
        <div class="kpi-value" style="font-size:1.3rem">${fmt(totals.revenue)}</div>
        <div style="font-size:0.72rem;color:var(--mist)">
          ${totals.tips ? `incl. ${fmt(totals.tips)} tips · ` : ''}tax collected ${fmt(totals.tax)} (not revenue)
        </div>
      </div>
    </div>

    <div class="ledger-wrap">
      <div class="staging-table-wrap">
        <table class="ds-table">
          <thead>
            <tr>
              <th rowspan="2" style="text-align:left">Day</th>
              ${fnExpanded ? '' : `<th rowspan="2" style="text-align:right">
                <button class="ds-group-toggle" onclick="dsTogglePref('fnExpanded')"
                        title="Show the FloraNext channels separately">▸ FloraNext</button></th>`}
              ${shownChans.map(c => `<th colspan="${showTax ? 2 : 1}" style="text-align:center${c.active ? '' : ';opacity:0.6'}">${escHtml(c.label)}${c.active ? '' : ' <span style="font-size:0.6rem">(retired)</span>'}</th>`).join('')}
              <th rowspan="2" title="Delivery tips, which you keep — counted as revenue">Tips</th>
              <th rowspan="2">Total</th>
              <th rowspan="2" style="text-align:left">Note</th>
            </tr>
            <tr>
              ${shownChans.map(() => showTax
                  ? `<th style="font-size:0.6rem">sales</th><th style="font-size:0.6rem">tax</th>`
                  : `<th style="font-size:0.6rem">sales</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${Array.from({ length: len }, (_, i) => i + 1).map(day => {
              const dow = DOW[new Date(year, month, day).getDay()];
              const tot = dsDayTotal(year, month, day, 's');
              const note = (dsMonth(year, month)[day] || {})._note || '';
              const weekend = dow === 'Sun';
              const fnT = fnDayTotal(day);
              return `<tr${weekend ? ' style="background:var(--paper)"' : ''}>
                <td style="white-space:nowrap"><strong>${day}</strong> <span style="color:var(--mist);font-size:0.72rem">${dow}</span></td>
                ${fnExpanded ? '' : `<td style="text-align:right;white-space:nowrap;color:var(--ink-soft)">${fnT ? fmt(fnT) : ''}</td>`}
                ${shownChans.map(c => showTax
                    ? `<td>${cell(day, c, 's')}</td><td>${cell(day, c, 't')}</td>`
                    : `<td>${cell(day, c, 's')}</td>`).join('')}
                <td><input type="number" step="0.01" class="ds-cell" inputmode="decimal"
                     value="${(dsMonth(year, month)[day] || {})._tips == null ? '' : (dsMonth(year, month)[day] || {})._tips}"
                     onchange="dsSetTips(${year},${month},${day},this.value)"></td>
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
              ${fnExpanded ? '' : `<td style="text-align:right;white-space:nowrap">${fnMonthTotal ? fmt(fnMonthTotal) : ''}</td>`}
              ${shownChans.map(c => {
                const b = totals.byChannel[c.id] || { s: 0, t: 0 };
                return `<td style="text-align:right;white-space:nowrap">${b.s ? fmt(b.s) : ''}</td>`
                     + (showTax ? `<td style="text-align:right;white-space:nowrap;color:var(--mist)">${b.t ? fmt(b.t) : ''}</td>` : '');
              }).join('')}
              <td style="text-align:right;white-space:nowrap">${totals.tips ? fmt(totals.tips) : ''}</td>
              <td class="amount-in" style="text-align:right;white-space:nowrap">${fmt(totals.revenue)}</td>
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

    ${dsRevenueHtml()}
    ${fnImportHtml()}
    ${dsImportHtml()}
  `;
}
