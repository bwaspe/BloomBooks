// Yearly COGS %, on the year cards and the annual chart.
//
// Monthly COGS % was skewed by a house account paid in arrears: FloraNext
// booked $14,589 of funeral work on 11 Sep 2026, the day the cheques arrived,
// for orders delivered May to August -- whose flowers were paid for in the
// months they were used. September read 10%, the summer months read high. A
// year is long enough for that to wash out, which is the whole point.
//
// Two decisions are pinned. The share is taken of LIKE-FOR-LIKE revenue, as
// everything else on the page is (deposits carry sales tax, which would flatter
// the earlier years by about two points). And the year in progress is measured
// to the date its data reaches, because a year's share by mid-September
// differs from its full-year figure by about two points either way.
const F = require('./fixtures');
const vm = require('vm');

function makeApp(book) {
  const grid = { innerHTML: '' };
  const canvas = { getContext: () => ({}) };
  const charts = [];
  const sb = F.sandbox({ setTimeout: () => {} });
  sb.Chart = function (ctx, cfg) { charts.push(cfg); return { destroy() {} }; };
  sb.document.getElementById = id => id === 'yearly-grid-content' ? grid : /Chart$/.test(id) ? canvas : null;
  vm.createContext(sb);
  vm.runInContext(F.src(['config.js', 'utils.js', 'daily-sales.js', 'ledger.js', 'reports.js']), sb, { filename: 'bb.js' });
  sb.__B__ = book;
  vm.runInContext('appData = __B__;', sb);
  return { sb, grid, charts };
}

function cards(html) {
  const res = {};
  html.split('class="year-card"').slice(1).forEach(c => {
    const text = c.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const yr = (text.match(/(20\d\d) Revenue/) || [])[1];
    const m = text.match(/(COGS %[^%]*?)\s+([\d.]+)%/);
    res[yr] = m ? { label: m[1].trim(), pct: parseFloat(m[2]) } : null;
  });
  return res;
}

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };
const cogsRow = (date, amount) => ({ date, amount, type: 'out', category: 'Supplies & Materials - COGS', vendor: 'DV' });

// ------------------------------------------------------------------
console.log('the house account paid in arrears');
{
  const book = { years: [2025, 2026], activeYear: 2026, rules: [], dailyRevenueFrom: '2026-01',
    transactions: {}, dailySales: {},
    basisAdjust: { 2025: { fees: 2000, tax: 6000 } } };
  // 2025, on deposits: $100,000 deposited, $40,000 of flowers. Revenue and
  // flowers spread so that mid-September is NOT a pro-rata cut of the year.
  book.transactions['2025-1'] = [{ date: '2025-02-10', amount: 70000, type: 'in', category: 'Revenue' }, cogsRow('2025-02-05', 30000)];
  book.transactions['2025-10'] = [{ date: '2025-11-10', amount: 30000, type: 'in', category: 'Revenue' }, cogsRow('2025-11-05', 10000)];
  // 2026, on the day book: summer orders delivered and their flowers paid for
  // in May-July, but $14,000 of the revenue booked on 11 Sep when the account paid.
  book.dailySales['2026-4'] = { '15': { fn: { s: 6000 } } };
  book.dailySales['2026-5'] = { '15': { fn: { s: 6000 } } };
  book.dailySales['2026-6'] = { '15': { fn: { s: 6000 } } };
  book.dailySales['2026-8'] = { '11': { fn: { s: 14000 } } };
  book.transactions['2026-4'] = [cogsRow('2026-05-14', 5000)];
  book.transactions['2026-5'] = [cogsRow('2026-06-14', 5000)];
  book.transactions['2026-6'] = [cogsRow('2026-07-14', 5000)];
  book.transactions['2026-8'] = [cogsRow('2026-09-09', 1000)];

  const app = makeApp(book);
  const s = app.sb;
  const monthly = [4, 5, 6, 8].map(m => Math.round(s.calcMonth(2026, m).cogsRatio));
  t('month by month the timing distorts it — high in summer, near nothing in September',
    monthly[0] > 80 && monthly[3] < 10, 'May-Jul ' + monthly.slice(0, 3).join('%, ') + '%, Sep ' + monthly[3] + '%');

  const cut = s.ytdCutoff(book.years);
  const y26 = s.cogsShare(2026, cut);
  t('the year to date takes both halves together: $16,000 of flowers on $32,000 of sales',
    Math.abs(y26.pct - 50) < 0.001 && y26.toDate && y26.label === 'COGS % to 11 Sep',
    y26.pct.toFixed(1) + '% · ' + y26.label);

  const y25 = s.cogsShare(2025, cut);
  t('a complete year is taken whole, on like-for-like revenue: $40,000 on $96,000',
    Math.abs(y25.pct - 40000 / 96000 * 100) < 0.001 && !y25.toDate && y25.label === 'COGS %',
    y25.pct.toFixed(1) + '% (on raw deposits it would read ' + (40000 / 100000 * 100).toFixed(1) + '%)');

  delete book.basisAdjust[2025];
  t('with nothing entered for a deposits year, it states nothing rather than the raw figure',
    s.cogsShare(2025, cut) === null);
  book.basisAdjust[2025] = { fees: 2000, tax: 6000 };

  try { s.renderYearlyPanel(); } catch (e) { /* the supplier pie is not drawn here */ }
  const c = cards(app.grid.innerHTML);
  t('the cards show it, labelled by what they measure',
    c['2025'] && c['2025'].label === 'COGS %' && Math.abs(c['2025'].pct - 41.7) < 0.051 &&
    c['2026'] && c['2026'].label === 'COGS % to 11 Sep' && c['2026'].pct === 50,
    JSON.stringify(c));

  const annual = app.charts.find(cfg => (cfg.data.datasets || []).some(d => d.yAxisID === 'pct'));
  const line = annual && annual.data.datasets.find(d => d.yAxisID === 'pct');
  t('and the annual chart draws the same figures as a line on its own axis',
    line && line.type === 'line' && line.data[0] === 41.7 && line.data[1] === 50 &&
    annual.options.scales.pct && annual.options.scales.pct.position === 'right',
    line && JSON.stringify(line.data));
}

// ------------------------------------------------------------------
console.log('\nagainst the owner\'s real book');
const REAL = F.book('bloom-books-backup-2026-09-12-1952.json');
if (!REAL) {
  console.log('  (no 12 Sep 19:52 backup to hand — skipping)');
} else {
  const app = makeApp(REAL.appData || REAL);
  const s = app.sb;
  const book = REAL.appData || REAL;
  const same = book.years.every(y => {
    let sum = 0;
    for (let m = 0; m < 12; m++) sum += s.calcMonth(y, m).cogs;
    return Math.abs(s.cogsThrough(y, '12-31') - sum) < 0.005;
  });
  t('every year, COGS cut at 31 Dec equals what the month panels add up to', same);

  const cut = s.ytdCutoff(book.years);
  const got = book.years.map(y => { const c = s.cogsShare(y, cut); return c ? c.pct.toFixed(1) : '—'; });
  t('2023-25 whole and like for like, 2026 to 11 Sep: ' + got.join(' / '),
    got.join('/') === '40.7/41.7/42.7/34.6');
  const sep = s.calcMonth(2026, 8).cogsRatio;
  t('while September on its own reads ' + sep.toFixed(1) + '%, the month the cheques landed', sep < 15);
}

console.log(fail.length ? '\n' + fail.length + ' FAILURES:\n' + fail.join('\n') : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
