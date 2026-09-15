// ============================================================
// UNIFIED TRENDS — TARGETS, THE SHAPE OF THE YEAR, WHERE THE MONEY GOES
// ============================================================
// Everything here is on ONE basis, month by month, so any two figures on the
// page can be set side by side:
//   - revenue gross of processor fees and without sales tax;
//   - processor fees counted as the expense they are, and sales tax handed to
//     New York left out of expenses -- through 2025 it was filed under Taxes,
//     but it was never a cost;
//   - a trading result only: capital, loan principal and draws stay out, as
//     they do everywhere else in the book.
// From 2026 the day book already reads that way. For a deposits year, the fee
// and tax figures entered on Yearly Summary are spread across its months in
// proportion to each month's deposits, since both move with sales. Checked on
// 15 Sep 2026 against the owner's own trends page: all 38 months agreed on
// revenue, COGS, expenses and net.
//
// No figure is typed into this file; the repository is public. Targets, the
// one-off costs to leave out of "typical" figures, known changes for the rest
// of the year and the notes are the owner's, saved with the book under
// appData.trends.

const TRENDS_CHARTS = {};

// ---- the owner's settings ---------------------------------------------------

// Read without writing, so drawing the page never records a change.
function trendsRead() {
  const s = (appData && appData.trends && typeof appData.trends === 'object' && !Array.isArray(appData.trends)) ? appData.trends : {};
  return {
    targets: (s.targets && typeof s.targets === 'object') ? s.targets : {},
    oneOffs: Array.isArray(s.oneOffs) ? s.oneOffs : [],
    adjustments: Array.isArray(s.adjustments) ? s.adjustments : [],
    notes: typeof s.notes === 'string' ? s.notes : ''
  };
}
function trendsWrite() {
  const r = trendsRead();
  appData.trends = Object.assign({}, appData.trends || {}, r);
  return appData.trends;
}
function trendsNum(v) {
  const n = parseFloat(String(v == null ? '' : v).replace(/[$,\s]/g, ''));
  return isFinite(n) ? n : null;
}
function trendsMonthKey(y, m) { return y + '-' + String(m + 1).padStart(2, '0'); }
function trendsOneOffIn(y, m) {
  const key = trendsMonthKey(y, m);
  return trendsRead().oneOffs.reduce((s, o) => s + (o && o.month === key ? (trendsNum(o.amount) || 0) : 0), 0);
}

// ---- the figures --------------------------------------------------------------

function trendsSalesTaxIn(year, month, filedAsTaxesOnly) {
  return getTransactions(year, month)
    .filter(t => !t._vault && isSalesTax(t) && (!filedAsTaxesOnly || t.category === 'Taxes'))
    .reduce((s, t) => s + catSigned(t), 0);
}

// Every month of every year on the common basis. A deposits year with no fee or
// tax figure entered cannot be stated, and is marked rather than shown raw.
function trendsBook() {
  const years = (appData.years || []).slice().sort((a, b) => a - b);
  const adjust = appData.basisAdjust || {};
  const months = [], byKey = {};
  years.forEach(y => {
    const calcs = [], dayBook = [];
    let depositRev = 0;
    for (let m = 0; m < 12; m++) {
      const c = calcMonth(y, m);
      const db = typeof dsRevenueMonth === 'function' && !!dsRevenueMonth(y, m);
      calcs.push(c); dayBook.push(db);
      if (!db) depositRev += c.revenue;
    }
    const a = adjust[y] || {};
    const fees = Number(a.fees) || 0, tax = Number(a.tax) || 0;
    const needsAdjust = dayBook.some((db, m) => !db && Math.abs(calcs[m].revenue) > 0.005);
    const ok = !needsAdjust || !!(fees || tax);
    for (let m = 0; m < 12; m++) {
      let row;
      if (!ok) row = { y, m, ok: false };
      else {
        const c = calcs[m];
        const share = (!dayBook[m] && depositRev) ? c.revenue / depositRev : 0;
        const feeShare = fees * share, taxShare = tax * share;
        const salesTaxAsExpense = trendsSalesTaxIn(y, m, true);
        const rev = c.revenue + feeShare - taxShare;
        const exp = c.expenses + feeShare - salesTaxAsExpense;
        const cat = Object.assign({}, c.byCategory);
        cat.Taxes = (cat.Taxes || 0) - salesTaxAsExpense;
        cat['Payment Processing'] = (cat['Payment Processing'] || 0) + feeShare;
        cat.Revenue = rev;
        row = { y, m, ok: true, rev, cogs: c.cogs, exp, net: rev - exp, cat,
                salesTaxPaid: trendsSalesTaxIn(y, m, false) };
      }
      months.push(row);
      byKey[y * 12 + m] = row;
    }
  });

  const first = months.find(x => x.ok && x.rev > 0.005) || null;
  let latest = null;
  months.forEach(x => { if (x.ok && x.rev > 0.005) latest = x.y; });

  // The year in progress counts only its complete months: a month still being
  // entered carries a fortnight of revenue and few of its bills.
  let lastComplete = 11, partial = null, cut = null;
  if (latest != null && typeof ytdCutoff === 'function') {
    cut = ytdCutoff([latest]);
    if (cut) {
      const cm = +cut.iso.slice(5, 7) - 1, cd = +cut.iso.slice(8, 10);
      const monthEnd = new Date(Date.UTC(latest, cm + 1, 0)).getUTCDate();
      lastComplete = cd >= monthEnd ? cm : cm - 1;
      partial = cd >= monthEnd ? null : cm;
    }
  }
  const startKey = first ? first.y * 12 + first.m : Infinity;
  const endKey = latest == null ? -1 : latest * 12 + lastComplete;
  months.forEach(x => {
    const k = x.y * 12 + x.m;
    x.complete = !!x.ok && k >= startKey && k <= endKey;
    x.partial = !!x.ok && x.y === latest && x.m === partial;
  });
  const unstated = years.filter(y => months.some(x => x.y === y && !x.ok));
  return { years, months, byKey, first, latest, lastComplete, partial, cut, unstated };
}

// Average revenue, and net with one-off costs put back, for each calendar month
// over every complete month on record.
function trendsSeasonality(B) {
  return MONTHS_SHORT.map((name, m) => {
    const xs = B.months.filter(x => x.complete && x.m === m);
    const n = xs.length;
    return { m, name, n, years: xs.map(x => x.y),
             avgRev: n ? xs.reduce((s, x) => s + x.rev, 0) / n : 0,
             avgNet: n ? xs.reduce((s, x) => s + x.net + trendsOneOffIn(x.y, x.m), 0) / n : 0 };
  });
}

function trendsSum(B, y, fromM, toM, f) {
  let s = 0;
  for (let m = fromM; m <= toM; m++) {
    const x = B.byKey[y * 12 + m];
    if (!x || !x.complete) return null;
    s += f(x);
  }
  return s;
}

// Target, pace and where the year could end.
function trendsTracker(B) {
  const Y = B.latest;
  if (Y == null) return null;
  const S = trendsRead();
  const t = S.targets[Y] || {};
  const targetRev = trendsNum(t.rev) || 0, targetNet = trendsNum(t.net) || 0;
  const L = B.lastComplete;
  const season = trendsSeasonality(B);
  const running = a => { let s = 0; return a.map(v => (s += v)); };
  const totRev = season.reduce((s, x) => s + x.avgRev, 0);
  const totNet = season.reduce((s, x) => s + x.avgNet, 0);
  const paceRev = targetRev && totRev > 0 ? running(season.map(x => x.avgRev)).map(v => targetRev * v / totRev) : null;
  const paceNet = targetNet && totNet > 0 ? running(season.map(x => x.avgNet)).map(v => targetNet * v / totNet) : null;

  const actualRev = [], actualNet = [];
  let ytdRev = 0, ytdNet = 0;
  for (let m = 0; m < 12; m++) {
    const x = B.byKey[Y * 12 + m];
    if (m <= L && x && x.complete) {
      ytdRev += x.rev; ytdNet += x.net;
      actualRev.push(ytdRev); actualNet.push(ytdNet);
    } else { actualRev.push(null); actualNet.push(null); }
  }

  const rest = [];
  for (let m = L + 1; m < 12; m++) rest.push(m);
  const prior = B.years.filter(p => p < Y).map(p => {
    if (!rest.length) return null;
    const rev = trendsSum(B, p, rest[0], 11, x => x.rev);
    const net = trendsSum(B, p, rest[0], 11, x => x.net + trendsOneOffIn(x.y, x.m));
    return rev == null ? null : { y: p, rev, net };
  }).filter(Boolean);
  const lastYear = prior.find(p => p.y === Y - 1) || null;
  const lastYtd = L >= 0 ? trendsSum(B, Y - 1, 0, L, x => x.rev) : null;
  const growth = lastYtd ? ytdRev / lastYtd - 1 : null;
  const known = S.adjustments.reduce((s, a) => s + (trendsNum(a && a.amount) || 0), 0);

  let projections = null;
  if (!rest.length) {
    projections = { complete: true };
  } else if (lastYear && growth != null && prior.length) {
    const best = prior.reduce((a, b) => (b.net > a.net ? b : a));
    const avgNet = prior.reduce((s, p) => s + p.net, 0) / prior.length;
    projections = {
      conservative: { rev: ytdRev + lastYear.rev * (1 + Math.min(growth, 0)), net: ytdNet + avgNet },
      base:         { rev: ytdRev + lastYear.rev * (1 + growth / 2),          net: ytdNet + lastYear.net + known },
      optimistic:   { rev: ytdRev + lastYear.rev * (1 + Math.max(growth, 0)), net: ytdNet + best.net + known },
      prior, lastYear, best, growth, known
    };
  }
  return { Y, L, targetRev, targetNet, paceRev, paceNet, actualRev, actualNet, ytdRev, ytdNet, rest, projections, season };
}

// ---- formatting ---------------------------------------------------------------

function trMoney(n) {
  if (n == null || !isFinite(n)) return '—';
  return (n < 0 ? '−$' : '$') + Math.round(Math.abs(n)).toLocaleString('en-US');
}
function trK(n) { return (n < 0 ? '−$' : '$') + Math.round(Math.abs(n) / 1000) + 'k'; }
function trPct(n) { return (n >= 0 ? '+' : '−') + Math.abs(n).toFixed(1) + '%'; }
function trSpan(L) { return L < 0 ? 'nothing yet' : L === 0 ? 'Jan' : 'Jan–' + MONTHS_SHORT[L]; }
function trChart(id, cfg) {
  if (TRENDS_CHARTS[id]) { try { TRENDS_CHARTS[id].destroy(); } catch (e) {} }
  delete TRENDS_CHARTS[id];
  const el = document.getElementById(id);
  if (!el || typeof Chart !== 'function' || !el.getContext) return;
  TRENDS_CHARTS[id] = new Chart(el.getContext('2d'), cfg);
}
const TR_BOX = 'background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px;min-width:0';
const TR_GRID = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px';
const TR_MUTED = 'font-size:0.74rem;color:var(--mist)';
const trAxis = money => ({ ticks: { font: { family: 'Inter', size: 10 }, callback: money ? (v => trK(v)) : undefined }, grid: { color: '#eeeef4' } });

// ---- the top of the page: targets, pace, projections, notes -------------------

function renderTrendsExtras() {
  const top = document.getElementById('trends-top');
  const more = document.getElementById('trends-more');
  if (!top && !more) return;
  const B = trendsBook();
  if (B.latest == null) {
    if (top) top.innerHTML = '';
    if (more) more.innerHTML = '';
    return;
  }
  if (top) {
    top.innerHTML = `
      <div id="trends-tracker"></div>
      <div id="trends-settings"></div>
      <div class="chart-wrap">
        <h3>📝 Notes</h3>
        <div style="${TR_MUTED};margin-bottom:8px">What the numbers can't say on their own — a purchase, a change of supplier, someone joining. Saved with the book when you click away.</div>
        <textarea id="trends-notes" rows="8" onchange="trendsSaveNotes(this.value)"
          style="width:100%;box-sizing:border-box;font:inherit;font-size:0.84rem;line-height:1.5;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--ink);resize:vertical"
          placeholder="e.g. Bought a van in October 2024 — a one-off, left out of the projections below.">${escHtml(trendsRead().notes)}</textarea>
      </div>`;
    renderTrendsTracker(B);
    renderTrendsSettings(B);
  }
  if (more) renderTrendsMore(B);
}

function renderTrendsTracker(B) {
  const el = document.getElementById('trends-tracker');
  if (!el) return;
  B = B || trendsBook();
  const T = trendsTracker(B);
  if (!T) { el.innerHTML = ''; return; }
  const Y = T.Y, L = T.L;
  const paceAt = (pace) => (pace && L >= 0 ? pace[L] : null);
  const bar = (label, actual, target, pace, colour) => {
    if (!target) return '';
    const fill = Math.max(0, Math.min(100, actual / target * 100));
    const mark = pace != null ? Math.max(0, Math.min(100, pace / target * 100)) : null;
    const delta = pace != null ? actual - pace : null;
    return `
      <div style="${TR_BOX}">
        <div style="${TR_MUTED};text-transform:uppercase;letter-spacing:0.05em;font-weight:600">${label} toward ${trMoney(target)}</div>
        <div style="position:relative;height:14px;background:var(--border-soft, #eeeef4);border-radius:99px;margin:20px 0 8px">
          <div style="position:absolute;left:0;top:0;height:100%;width:${fill}%;border-radius:99px;background:${delta != null && delta >= 0 ? 'var(--green)' : colour}"></div>
          ${mark != null ? `<div style="position:absolute;top:-5px;left:${mark}%;width:2px;height:24px;background:var(--ink)"><span style="position:absolute;top:-15px;left:50%;transform:translateX(-50%);font-size:0.6rem;color:var(--mist);white-space:nowrap">pace</span></div>` : ''}
        </div>
        <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:0.78rem">
          <span>${trMoney(actual)} through ${L >= 0 ? MONTHS_SHORT[L] : '—'}</span>
          ${delta != null ? `<span class="${delta >= 0 ? 'growth-up' : 'growth-down'}">${delta >= 0 ? '+' : '−'}${trMoney(Math.abs(delta))} vs pace</span>` : ''}
        </div>
      </div>`;
  };

  const P = T.projections;
  let projHtml = '';
  if (P && P.complete) {
    projHtml = `<div style="${TR_MUTED}">${Y} is complete: ${trMoney(T.ytdRev)} revenue, ${trMoney(T.ytdNet)} net.</div>`;
  } else if (P) {
    const restLabel = MONTHS_SHORT[T.rest[0]] + (T.rest.length > 1 ? '–' + MONTHS_SHORT[11] : '');
    const knownLine = P.known ? ` plus the known changes below (${P.known >= 0 ? '+' : '−'}${trMoney(Math.abs(P.known))})` : '';
    const card = (name, p, desc) => `
      <div style="${TR_BOX}">
        <div style="${TR_MUTED};text-transform:uppercase;letter-spacing:0.05em;font-weight:600">${name} · full year ${Y}</div>
        <div style="font-size:1.3rem;font-weight:700;margin-top:4px">${trMoney(p.net)} <span style="font-size:0.7rem;color:var(--mist);font-weight:600">net</span></div>
        <div style="${TR_MUTED}">${trMoney(p.rev)} revenue${T.targetNet ? ` · ${p.net >= T.targetNet ? 'meets' : 'short of'} the net target` : ''}</div>
        <div style="font-size:0.76rem;color:var(--ink-soft, #444466);margin-top:6px">${desc}</div>
      </div>`;
    const g = P.growth * 100;
    projHtml = `
      <div style="${TR_MUTED};margin:18px 0 8px">Where ${Y} could end: ${trSpan(L)} as it stands, plus ${restLabel} from earlier years.
        ${Y} is running ${trPct(g)} on revenue against ${trSpan(L)} ${Y - 1}.</div>
      <div style="${TR_GRID}">
        ${card('Conservative', P.conservative, `The average ${restLabel} net of ${P.prior.map(p => p.y).join(', ')}, with one-off costs put back. Revenue: ${Y - 1}'s ${restLabel}${g < 0 ? `, down ${Math.abs(g).toFixed(1)}%` : ', flat'}.`)}
        ${card('Base case', P.base, `${Y - 1}'s ${restLabel} net again${knownLine}. Revenue: ${Y - 1}'s ${restLabel} at half this year's growth.`)}
        ${card('Optimistic', P.optimistic, `The best ${restLabel} on record (${P.best.y})${knownLine}. Revenue: ${Y - 1}'s ${restLabel} ${g > 0 ? `up ${g.toFixed(1)}%, this year's growth holding` : 'flat'}.`)}
      </div>`;
  }

  const unstated = B.unstated.length
    ? `<div style="${TR_MUTED};margin-top:6px">${B.unstated.join(', ')} can't be shown on this basis until ${B.unstated.length === 1 ? 'its' : 'their'} processor fees and sales tax are entered on Yearly Summary.</div>` : '';

  el.innerHTML = `
    <div class="chart-wrap">
      <h3>🎯 ${Y} target tracker</h3>
      <div style="${TR_MUTED};margin-bottom:12px">Every year on one basis: revenue before processor fees and without sales tax, and sales tax paid left out of expenses — so ${Y} and earlier years compare directly. Complete months only; ${B.partial != null ? MONTHS_SHORT[B.partial] + ' is still being entered.' : 'the year so far.'}</div>
      ${unstated}
      ${T.targetRev || T.targetNet ? `
        <div style="${TR_GRID}">
          ${bar('Revenue', T.ytdRev, T.targetRev, paceAt(T.paceRev), 'var(--blue)')}
          ${bar('Net income', T.ytdNet, T.targetNet, paceAt(T.paceNet), 'var(--blue)')}
        </div>
        <div style="${TR_MUTED};margin-top:8px">The pace marker follows the shape of a typical year, not a straight line: each month's share of the year is its average over every complete month on record, with one-off costs put back. February and May carry far more than their twelfth.</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px;margin-top:14px">
          <div class="chart-container" style="height:260px"><canvas id="trTrackRev"></canvas></div>
          <div class="chart-container" style="height:260px"><canvas id="trTrackNet"></canvas></div>
        </div>`
      : `<div style="${TR_BOX};font-size:0.84rem">Set a revenue and net income target for ${Y} under <strong>Targets and adjustments</strong> below to see it tracked against the year's usual pace.
          So far: ${trMoney(T.ytdRev)} revenue and ${trMoney(T.ytdNet)} net, ${trSpan(L)}.</div>`}
      ${projHtml}
    </div>`;

  ['trTrackRev', 'trTrackNet'].forEach(id => {
    if (TRENDS_CHARTS[id] && !document.getElementById(id)) { try { TRENDS_CHARTS[id].destroy(); } catch (e) {} delete TRENDS_CHARTS[id]; }
  });
  if (T.targetRev || T.targetNet) {
    const line = (label, data, colour, dash) => ({ type: 'line', label, data, borderColor: colour, backgroundColor: colour,
      borderDash: dash || [], pointRadius: dash ? 0 : 2, tension: 0.2, spanGaps: false });
    const opts = title => ({ responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top', labels: { boxWidth: 12, font: { family: 'Inter', size: 10 } } },
                 title: { display: true, text: title, font: { family: 'Inter', size: 12 } },
                 tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${trMoney(c.parsed.y)}` } } },
      scales: { x: { ticks: { font: { family: 'Inter', size: 10 } }, grid: { display: false } }, y: trAxis(true) } });
    if (T.targetRev) trChart('trTrackRev', { data: { labels: MONTHS_SHORT, datasets: [
      line('Actual', T.actualRev, '#1a5fa8'),
      ...(T.paceRev ? [line('Usual pace', T.paceRev, '#888899', [5, 4])] : []),
      line('Target', MONTHS_SHORT.map(() => T.targetRev), '#c0392b', [2, 3])] }, options: opts('Revenue, running total') });
    if (T.targetNet) trChart('trTrackNet', { data: { labels: MONTHS_SHORT, datasets: [
      line('Actual', T.actualNet, '#2a7a4f'),
      ...(T.paceNet ? [line('Usual pace', T.paceNet, '#888899', [5, 4])] : []),
      line('Target', MONTHS_SHORT.map(() => T.targetNet), '#c0392b', [2, 3])] }, options: opts('Net income, running total') });
  }
}

function renderTrendsSettings(B) {
  const el = document.getElementById('trends-settings');
  if (!el) return;
  B = B || trendsBook();
  const Y = B.latest;
  const S = trendsRead();
  const t = S.targets[Y] || {};
  const input = (attrs, value, width) => `<input ${attrs} value="${escHtml(value == null ? '' : value)}"
    style="font:inherit;font-size:0.8rem;padding:4px 8px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--ink);width:${width}">`;
  el.innerHTML = `
    <details class="chart-wrap" style="padding-top:12px;padding-bottom:12px">
      <summary style="cursor:pointer;font-weight:600;font-size:0.9rem">Targets and adjustments</summary>
      <div style="${TR_GRID};margin-top:14px">
        <label style="font-size:0.8rem">${Y} revenue target<br>${input(`inputmode="decimal" onchange="trendsSetTarget(${+Y}, 'rev', this.value)"`, t.rev, '140px')}</label>
        <label style="font-size:0.8rem">${Y} net income target<br>${input(`inputmode="decimal" onchange="trendsSetTarget(${+Y}, 'net', this.value)"`, t.net, '140px')}</label>
      </div>

      <div style="margin-top:18px;font-size:0.84rem;font-weight:600">One-off costs to leave out of "typical" figures</div>
      <div style="${TR_MUTED};margin-bottom:6px">A cost that won't recur — a vehicle bought outright, say. Put back into that month's net for the usual pace and the projections; the month itself is shown as it happened.</div>
      ${S.oneOffs.map((o, i) => `
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:6px">
          ${input(`placeholder="What it was" onchange="trendsSetItem('oneOffs', ${i}, 'label', this.value)"`, o.label, '220px')}
          ${input(`type="month" onchange="trendsSetItem('oneOffs', ${i}, 'month', this.value)"`, o.month, '150px')}
          ${input(`inputmode="decimal" placeholder="Amount" onchange="trendsSetItem('oneOffs', ${i}, 'amount', this.value)"`, o.amount, '110px')}
          <button class="btn btn-outline btn-xs" onclick="trendsRemoveItem('oneOffs', ${i})">Remove</button>
        </div>`).join('')}
      <button class="btn btn-outline btn-sm" onclick="trendsAddItem('oneOffs')">+ Add a one-off cost</button>

      <div style="margin-top:18px;font-size:0.84rem;font-weight:600">Known changes for the rest of the year</div>
      <div style="${TR_MUTED};margin-bottom:6px">Money the rest of ${Y} will differ by from last year for a known reason — a cancelled service is a saving (+), a new lease a cost (−). Added to the base and optimistic projections.</div>
      ${S.adjustments.map((a, i) => `
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:6px">
          ${input(`placeholder="What changed" onchange="trendsSetItem('adjustments', ${i}, 'label', this.value)"`, a.label, '220px')}
          ${input(`inputmode="decimal" placeholder="+ or − amount" onchange="trendsSetItem('adjustments', ${i}, 'amount', this.value)"`, a.amount, '130px')}
          <button class="btn btn-outline btn-xs" onclick="trendsRemoveItem('adjustments', ${i})">Remove</button>
        </div>`).join('')}
      <button class="btn btn-outline btn-sm" onclick="trendsAddItem('adjustments')">+ Add a known change</button>
    </details>`;
}

// Saving. The form is left alone while it is being filled in -- only the
// figures it feeds are redrawn -- so moving from one box to the next is not
// undone by a redraw.
function trendsChanged() {
  saveData();
  renderTrendsTracker();
}
function trendsSetTarget(year, field, value) {
  const s = trendsWrite();
  const n = trendsNum(value);
  const rec = Object.assign({}, s.targets[year] || {});
  if (n == null) delete rec[field]; else rec[field] = n;
  s.targets = Object.assign({}, s.targets);
  if (Object.keys(rec).length) s.targets[year] = rec; else delete s.targets[year];
  trendsChanged();
}
function trendsSetItem(list, i, field, value) {
  if (list !== 'oneOffs' && list !== 'adjustments') return;
  const s = trendsWrite();
  const rows = s[list].slice();
  if (!rows[i]) return;
  const row = Object.assign({}, rows[i]);
  if (field === 'amount') { const n = trendsNum(value); if (n == null) delete row.amount; else row.amount = n; }
  else if (field === 'month') { if (/^\d{4}-\d{2}$/.test(value)) row.month = value; else delete row.month; }
  else if (field === 'label') row.label = String(value || '').slice(0, 120);
  else return;
  rows[i] = row;
  s[list] = rows;
  trendsChanged();
}
function trendsAddItem(list) {
  if (list !== 'oneOffs' && list !== 'adjustments') return;
  const s = trendsWrite();
  s[list] = s[list].concat([{ label: '' }]);
  saveData();
  renderTrendsSettings();
  const d = document.querySelector('#trends-settings details');
  if (d) d.open = true;
}
function trendsRemoveItem(list, i) {
  if (list !== 'oneOffs' && list !== 'adjustments') return;
  const s = trendsWrite();
  s[list] = s[list].filter((_, k) => k !== i);
  trendsChanged();
  renderTrendsSettings();
  const d = document.querySelector('#trends-settings details');
  if (d) d.open = true;
}
function trendsSaveNotes(value) {
  const s = trendsWrite();
  s.notes = String(value || '');
  saveData();
  if (typeof notify === 'function') notify('Notes saved');
}

// ---- lower down: the months, the seasons, the years, where money goes --------

function renderTrendsMore(B) {
  const el = document.getElementById('trends-more');
  if (!el) return;
  const Y = B.latest, L = B.lastComplete;
  const shown = B.months.filter(x => x.complete || x.partial);
  const complete = B.months.filter(x => x.complete);
  const season = trendsSeasonality(B);
  const avgMonth = season.filter(s => s.n).reduce((s, x) => s + x.avgRev, 0) / Math.max(1, season.filter(s => s.n).length);

  // Full-year table
  const yearRows = B.years.map(y => {
    const xs = complete.filter(x => x.y === y);
    if (!xs.length) return null;
    const rev = xs.reduce((s, x) => s + x.rev, 0), cogs = xs.reduce((s, x) => s + x.cogs, 0);
    const exp = xs.reduce((s, x) => s + x.exp, 0), net = rev - exp;
    return { y, n: xs.length, from: xs[0].m, to: xs[xs.length - 1].m, rev, cogs, exp, net };
  }).filter(Boolean);

  el.innerHTML = `
    <div class="chart-wrap">
      <h3>Revenue &amp; net income, month by month</h3>
      <div style="${TR_MUTED};margin-bottom:8px">Every month since trading began, on the same basis as the tracker.${B.partial != null ? ` ${MONTHS_SHORT[B.partial]} ${Y} is lighter: it is still being entered, and a part month carries revenue before most of its bills.` : ''}</div>
      <div class="chart-container" style="height:320px"><canvas id="trMonthly"></canvas></div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:20px">
      <div class="chart-wrap">
        <h3>Seasonality</h3>
        <div style="${TR_MUTED};margin-bottom:8px">Average revenue for each calendar month, over every complete month on record. Green is above an average month.</div>
        <div class="chart-container" style="height:260px"><canvas id="trSeason"></canvas></div>
      </div>
      <div class="chart-wrap">
        <h3>Year by year</h3>
        <div style="${TR_MUTED};margin-bottom:8px">Complete months only. A part year is not comparable with a whole one on margin: the months it holds decide it.</div>
        <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:0.82rem;min-width:460px">
          <tr style="${TR_MUTED};text-align:right"><th style="text-align:left;padding:6px">Year</th><th style="padding:6px">Months</th><th style="padding:6px">Revenue</th><th style="padding:6px">COGS %</th><th style="padding:6px">Expenses</th><th style="padding:6px">Net</th><th style="padding:6px">Margin</th></tr>
          ${yearRows.map(r => `
            <tr style="border-top:1px solid var(--border);text-align:right">
              <td style="text-align:left;padding:6px">${r.y}${r.n < 12 ? ` <span class="badge" style="background:#fff3cd;color:#8a6a10">${MONTHS_SHORT[r.from]}–${MONTHS_SHORT[r.to]}</span>` : ''}</td>
              <td style="padding:6px">${r.n}</td>
              <td style="padding:6px">${trMoney(r.rev)}</td>
              <td style="padding:6px">${r.rev ? (r.cogs / r.rev * 100).toFixed(1) + '%' : '—'}</td>
              <td style="padding:6px">${trMoney(r.exp)}</td>
              <td style="padding:6px" class="${r.net >= 0 ? 'growth-up' : 'growth-down'}">${trMoney(r.net)}</td>
              <td style="padding:6px" class="${r.net >= 0 ? 'growth-up' : 'growth-down'}">${r.rev ? (r.net / r.rev * 100).toFixed(1) + '%' : '—'}</td>
            </tr>`).join('')}
        </table></div>
      </div>
    </div>

    <div class="chart-wrap">
      <h3>What the numbers show</h3>
      <div style="${TR_MUTED};margin-bottom:10px">Worked out from the book each time the page opens. Your own explanations go in Notes, above.</div>
      <div style="${TR_GRID}">${trendsFindings(B, season, avgMonth).map(f => `
        <div style="border-left:3px solid ${f.tone === 'good' ? 'var(--green)' : f.tone === 'warn' ? 'var(--red)' : 'var(--accent2)'};background:var(--paper);border-radius:0 8px 8px 0;padding:10px 12px">
          <div style="font-weight:700;font-size:0.84rem">${escHtml(f.t)}</div>
          <div style="font-size:0.79rem;color:var(--ink-soft, #444466)">${escHtml(f.d)}</div>
        </div>`).join('')}</div>
    </div>

    <div class="chart-wrap">
      <h3>Where expense dollars go</h3>
      <div style="${TR_MUTED};margin-bottom:8px">Each cost as a share of that year's revenue. Payroll includes Payroll1; Taxes excludes sales tax.</div>
      <div class="chart-container" style="height:320px"><canvas id="trCost"></canvas></div>
    </div>

    ${trendsCostTrackerHtml()}`;

  // Month by month
  const labels = shown.map(x => MONTHS_SHORT[x.m] + " '" + String(x.y).slice(2));
  trChart('trMonthly', { data: { labels, datasets: [
    { type: 'bar', label: 'Revenue', data: shown.map(x => x.rev), order: 2, borderRadius: 3,
      backgroundColor: shown.map(x => x.partial ? '#c9c9e8' : '#4a4a8a') },
    { type: 'line', label: 'Net income', data: shown.map(x => x.net), order: 1, borderColor: '#2a7a4f', backgroundColor: '#2a7a4f',
      pointRadius: 2, tension: 0.25, segment: { borderDash: c => (shown[c.p1DataIndex] && shown[c.p1DataIndex].partial ? [5, 4] : undefined) } }
  ] }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
    plugins: { legend: { position: 'top', labels: { boxWidth: 12, font: { family: 'Inter', size: 11 } } },
               tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${trMoney(c.parsed.y)}${shown[c.dataIndex] && shown[c.dataIndex].partial ? ' (so far)' : ''}` } } },
    scales: { x: { ticks: { font: { family: 'Inter', size: 9 }, maxRotation: 90, minRotation: 90 }, grid: { display: false } }, y: trAxis(true) } } });

  // Seasonality
  trChart('trSeason', { type: 'bar', data: { labels: season.map(s => s.name), datasets: [{ label: 'Average revenue',
    data: season.map(s => s.n ? s.avgRev : null), borderRadius: 4,
    backgroundColor: season.map(s => s.avgRev >= avgMonth ? '#2a7a4f' : '#c9c9e8') }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false },
      tooltip: { callbacks: { label: c => { const s = season[c.dataIndex]; return ` ${trMoney(s.avgRev)} average over ${s.years.join(', ')} (${Math.round(s.avgRev / avgMonth * 100)}% of an average month)`; } } } },
      scales: { x: { ticks: { font: { family: 'Inter', size: 10 } }, grid: { display: false } }, y: trAxis(true) } } });

  // Cost structure: the last two whole years, and this year to date
  const full = yearRows.filter(r => r.n === 12).slice(-2);
  const cols = full.map(r => ({ label: String(r.y), y: r.y, to: 11 }));
  if (Y != null && L >= 0 && L < 11) cols.push({ label: Y + ' ' + trSpan(L), y: Y, to: L });
  const isCost = c => isKnownCat(c) && c !== 'Revenue' && !isNonExpenseCat(c) && !isNonRevenueInCat(c) &&
                      PASSTHROUGH_CATEGORIES.indexOf(c) < 0;
  const shares = cols.map(col => {
    const xs = complete.filter(x => x.y === col.y && x.m <= col.to);
    const rev = xs.reduce((s, x) => s + x.rev, 0);
    const out = {};
    xs.forEach(x => Object.keys(x.cat).forEach(c => {
      if (!isCost(c)) return;
      const k = c === 'Payroll1' ? 'Payroll' : c;
      out[k] = (out[k] || 0) + x.cat[c];
    }));
    Object.keys(out).forEach(k => { out[k] = rev ? out[k] / rev * 100 : 0; });
    return out;
  });
  // Ordered by the latest whole year, which is the steadiest reference.
  const ref = shares[full.length ? full.length - 1 : 0] || {};
  const cats = Object.keys(Object.assign({}, ...shares)).filter(c => shares.some(s => (s[c] || 0) >= 0.5))
    .sort((a, b) => (ref[b] || 0) - (ref[a] || 0)).slice(0, 10);
  const fullColours = ['#c9c9e8', '#4a4a8a'].slice(-full.length);
  const colour = i => (i < full.length ? fullColours[i] : '#c0392b');
  trChart('trCost', { type: 'bar', data: { labels: cats.map(c => c === 'Supplies & Materials - COGS' ? 'COGS' : c),
    datasets: cols.map((col, i) => ({ label: col.label, data: cats.map(c => +(shares[i][c] || 0).toFixed(2)),
      backgroundColor: colour(i), borderRadius: 3 })) },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top', labels: { boxWidth: 12, font: { family: 'Inter', size: 11 } } },
                 tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${c.parsed.y.toFixed(1)}% of revenue` } } },
      scales: { x: { ticks: { font: { family: 'Inter', size: 10 } }, grid: { display: false } },
                y: { ticks: { font: { family: 'Inter', size: 10 }, callback: v => v + '%' }, grid: { color: '#eeeef4' } } } } });

  trendsCostTrackerCharts();
}

// Findings worked out from the figures. Plain statements, no guesses at why.
function trendsFindings(B, season, avgMonth) {
  const out = [];
  const complete = B.months.filter(x => x.complete);
  if (!complete.length) return out;
  const Y = B.latest, L = B.lastComplete;
  const label = x => MONTHS_SHORT[x.m] + ' ' + x.y;

  const best = complete.reduce((a, b) => (b.rev > a.rev ? b : a));
  out.push({ tone: 'good', t: 'Best month: ' + label(best), d: `${trMoney(best.rev)} in revenue, the most of any complete month on record.` });

  const worst = complete.reduce((a, b) => (b.net < a.net ? b : a));
  out.push({ tone: 'warn', t: 'Toughest month: ' + label(worst),
             d: `Net ${trMoney(worst.net)} on ${trMoney(worst.rev)} of revenue, with COGS at ${worst.rev ? (worst.cogs / worst.rev * 100).toFixed(1) : '—'}% of it.` });

  const feb = season[1], may = season[4];
  if (feb.n && may.n && avgMonth) {
    out.push({ tone: '', t: 'February and May carry the year',
               d: `An average February brings in ${Math.round(feb.avgRev / avgMonth * 100)}% of an average month and May ${Math.round(may.avgRev / avgMonth * 100)}%. Between them, about ${Math.round((feb.avgRev + may.avgRev) / season.reduce((s, x) => s + x.avgRev, 0) * 100)}% of a typical year's revenue.` });
  }

  const losses = complete.filter(x => x.net < 0);
  if (losses.length) {
    const byMonth = {};
    losses.forEach(x => { byMonth[x.m] = (byMonth[x.m] || 0) + 1; });
    const common = Object.keys(byMonth).sort((a, b) => byMonth[b] - byMonth[a]).slice(0, 3).map(m => MONTHS_SHORT[m]);
    out.push({ tone: losses.length / complete.length > 0.3 ? 'warn' : '', t: `${losses.length} of ${complete.length} months ran a loss`,
               d: `${Math.round(losses.length / complete.length * 100)}% of complete months. Most often in ${common.join(', ')}.` });
  }

  if (L >= 0) {
    const span = trSpan(L);
    const stretch = B.years.map(y => {
      const rev = trendsSum(B, y, 0, L, x => x.rev);
      if (rev == null || !rev) return null;
      return { y, rev,
               cogs: trendsSum(B, y, 0, L, x => x.cogs),
               payroll: trendsSum(B, y, 0, L, x => (x.cat.Payroll || 0) + (x.cat.Payroll1 || 0)),
               marketing: trendsSum(B, y, 0, L, x => x.cat.Marketing || 0) };
    }).filter(Boolean);
    if (stretch.length >= 2) {
      out.push({ tone: '', t: `COGS, ${span} each year`,
                 d: stretch.map(s => `${s.y} ${(s.cogs / s.rev * 100).toFixed(1)}%`).join(' · ') + ' of revenue.' });
      const a = stretch[stretch.length - 2], b = stretch[stretch.length - 1];
      if (b.y === Y && a.payroll) {
        const pg = (b.payroll / a.payroll - 1) * 100, rg = (b.rev / a.rev - 1) * 100;
        out.push({ tone: pg > rg ? 'warn' : 'good', t: `Payroll ${pg >= 0 ? 'up' : 'down'} ${Math.abs(pg).toFixed(1)}%, ${span}`,
                   d: `${trMoney(a.payroll)} in ${a.y} to ${trMoney(b.payroll)} in ${b.y}, against revenue ${trPct(rg)}: ${(a.payroll / a.rev * 100).toFixed(1)}% of revenue then, ${(b.payroll / b.rev * 100).toFixed(1)}% now. Includes Payroll1.` });
        out.push({ tone: '', t: `Marketing, ${span}`,
                   d: stretch.map(s => `${s.y} ${(s.marketing / s.rev * 100).toFixed(1)}%`).join(' · ') + ' of revenue.' });
      }
    }
  }

  const fullYears = B.years.filter(y => trendsSum(B, y, 0, 11, x => x.rev));
  if (fullYears.length) {
    const lines = fullYears.slice(-2).map(y => {
      const rev = trendsSum(B, y, 0, 11, x => x.rev), paid = trendsSum(B, y, 0, 11, x => x.salesTaxPaid);
      return { y, pct: rev ? paid / rev * 100 : 0, paid };
    }).filter(l => l.paid > 0);
    if (lines.length) {
      const byMonth = {};
      B.months.filter(x => x.complete && fullYears.indexOf(x.y) >= 0 && x.salesTaxPaid > 0)
        .forEach(x => { byMonth[x.m] = (byMonth[x.m] || 0) + x.salesTaxPaid; });
      const when = Object.keys(byMonth).sort((a, b) => byMonth[b] - byMonth[a]).slice(0, 4).sort((a, b) => a - b).map(m => MONTHS_SHORT[m]);
      out.push({ tone: '', t: 'Sales tax still leaves the bank',
                 d: `Not a cost, so it is out of every figure here — but it is paid mostly in ${when.join(', ')}: ` +
                    lines.map(l => `${(l.pct).toFixed(1)}% of revenue in ${l.y}`).join(', ') + '.' });
    }
  }
  return out;
}

// ---- the cost tracker, briefly ----------------------------------------------

function trendsCostTrackerData() {
  if (typeof ctData === 'undefined' || !ctData || !Array.isArray(ctData.invoices) || !ctData.invoices.length) return null;
  const byCat = {}, bySupplier = {};
  let total = 0, earliest = null, latest = null;
  ctData.invoices.forEach(inv => {
    const d = (typeof ctEffDate === 'function' ? ctEffDate(inv) : (inv.deliveryDate || inv.date)) || '';
    if (d && (!earliest || d < earliest)) earliest = d;
    if (d && (!latest || d > latest)) latest = d;
    const supplier = typeof ctCanonicalSupplier === 'function' ? ctCanonicalSupplier(inv.supplier) : (inv.supplier || 'Unknown');
    (inv.items || []).forEach(it => {
      const v = typeof ctLineTotal === 'function' ? ctLineTotal(it) : (it.total != null ? it.total : (it.qty || 0) * (it.unitPrice || 0));
      if (!isFinite(v)) return;
      total += v;
      const c = it.category || 'Other';
      byCat[c] = (byCat[c] || 0) + v;
      bySupplier[supplier] = (bySupplier[supplier] || 0) + v;
    });
  });
  return { byCat, bySupplier, total, count: ctData.invoices.length, earliest, latest };
}

function trendsCostTrackerHtml() {
  const d = trendsCostTrackerData();
  if (!d) return '';
  return `
    <div class="chart-wrap">
      <h3>Wholesale spend, from the cost tracker</h3>
      <div style="${TR_MUTED};margin-bottom:8px">${d.count} invoices, ${trMoney(d.total)}, ${escHtml(d.earliest || '')} to ${escHtml(d.latest || '')}. Only as complete as the invoices entered, so read it as a direction rather than a total.</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px">
        <div class="chart-container" style="height:260px"><canvas id="trCtCat"></canvas></div>
        <div class="chart-container" style="height:260px"><canvas id="trCtSupplier"></canvas></div>
      </div>
    </div>`;
}

function trendsCostTrackerCharts() {
  const d = trendsCostTrackerData();
  if (!d) return;
  const cats = Object.entries(d.byCat).sort((a, b) => b[1] - a[1]);
  trChart('trCtCat', { type: 'doughnut', data: { labels: cats.map(e => e[0]), datasets: [{ data: cats.map(e => Math.round(e[1])),
    backgroundColor: ['#4a4a8a', '#7a7ab8', '#a8a8d8', '#2a7a4f', '#6ab08f', '#c0392b', '#e08070', '#888899', '#c9c9d8', '#e0c060', '#8b9b8e', '#c9a84c'] }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { boxWidth: 10, font: { family: 'Inter', size: 10 } } },
      title: { display: true, text: 'By category', font: { family: 'Inter', size: 12 } },
      tooltip: { callbacks: { label: c => ` ${c.label}: ${trMoney(c.parsed)}` } } } } });
  const sup = Object.entries(d.bySupplier).sort((a, b) => b[1] - a[1]).slice(0, 10);
  trChart('trCtSupplier', { type: 'bar', data: { labels: sup.map(e => e[0]), datasets: [{ data: sup.map(e => Math.round(e[1])), backgroundColor: '#2a7a4f', borderRadius: 3 }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false },
      title: { display: true, text: 'By supplier', font: { family: 'Inter', size: 12 } },
      tooltip: { callbacks: { label: c => ` ${trMoney(c.parsed.x)}` } } },
      scales: { x: trAxis(true), y: { ticks: { font: { family: 'Inter', size: 10 } }, grid: { display: false } } } } });
}
