// Unified Trends: the target tracker, the shape of the year, and the notes.
//
// Every figure on that page is restated to one basis, month by month, so the
// suite pins the restatement first: a deposits year gains its fees and loses
// its tax in proportion to each month's deposits, and sales tax paid is taken
// out of expenses (it was filed under Taxes through 2025, but was never a
// cost). Summed over a year that must equal the like-for-like figure Yearly
// Summary already shows, or the two pages would disagree about the same year.
//
// Then what is built on it: which months count as complete, the pace line,
// the three projections, one-off costs put back, and that drawing the page
// writes nothing to the book while saving the settings writes exactly them.
//
// A made-up book, so every expected figure can be worked out by hand. If the
// real backup is on this machine, the restatement is also checked against it
// for agreement with Yearly Summary -- consistency only, no figures from it.
const F = require('./fixtures');
const vm = require('vm');

const els = {};
const charts = [];
const sb = F.sandbox({ setTimeout: () => 0, clearTimeout: () => {} });
sb.document.getElementById = id => els[id] || (els[id] = { id, innerHTML: '', style: {}, getContext: () => ({}) });
sb.document.querySelector = () => null;
sb.navigator = { userAgent: 'test' };
sb.Chart = function (ctx, cfg) { charts.push(cfg); return { destroy() {} }; };
let saves = 0;
vm.createContext(sb);
vm.runInContext(F.src(['config.js', 'utils.js', 'daily-sales.js', 'ledger.js', 'reports.js', 'trends.js']), sb, { filename: 'bb.js' });
sb.__SAVE__ = () => { saves++; };
vm.runInContext('saveData = function () { __SAVE__(); }; notify = function () {}; updateYearSelects = function () {};', sb);
const S = code => vm.runInContext(code, sb);
const J = code => JSON.parse(S('JSON.stringify(' + code + ')'));

// ---- the book ---------------------------------------------------------------
const base = [30000, 60000, 28000, 33000, 65000, 35000, 24000, 22000, 30000, 32000, 31000, 34000];
let id = 0;
const row = (y, m, desc, category, amount, type) => ({ id: 'r' + (++id), date: `${y}-${String(m + 1).padStart(2, '0')}-15`,
  desc, category, vendor: desc, amount, type: type || 'out' });
const book = { years: [2023, 2024, 2025, 2026], activeYear: 2026, rules: [], dailyRevenueFrom: '2026-01',
  basisAdjust: { 2024: { fees: 1200, tax: 2400 }, 2025: { fees: 1800, tax: 3000 } },
  transactions: {}, dailySales: {} };
const put = (y, m, r) => { (book.transactions[`${y}-${m}`] = book.transactions[`${y}-${m}`] || []).push(r); };
// 2023: trading, but no fee or tax figure entered -- cannot be stated.
[9, 10, 11].forEach(m => put(2023, m, row(2023, m, 'Card', 'Revenue', 20000, 'in')));
[2024, 2025].forEach((y, yi) => base.forEach((rev, m) => {
  const r = rev * (1 + yi * 0.05);
  put(y, m, row(y, m, 'Card', 'Revenue', r, 'in'));
  put(y, m, row(y, m, 'Wholesale', 'Supplies & Materials - COGS', r * 0.4));
  put(y, m, row(y, m, 'Landlord', 'Rent', 2000));
  put(y, m, row(y, m, 'Gusto', 'Payroll', r * 0.25));
  if (m % 3 === 2) put(y, m, row(y, m, 'NYS DTF SALES TAX', 'Taxes', 900));
}));
put(2024, 9, row(2024, 9, 'Van', 'Transpo', 5000));
for (let m = 0; m <= 8; m++) {
  const r = base[m] * 1.1;
  const days = {};
  if (m < 8) days['10'] = { counter: { s: r } };
  else days['14'] = { counter: { s: 12000 } };           // September: part of a month
  book.dailySales[`2026-${m}`] = days;
  put(2026, m, row(2026, m, 'Wholesale', 'Supplies & Materials - COGS', (m < 8 ? r : 12000) * 0.35));
  put(2026, m, row(2026, m, 'Landlord', 'Rent', 2000));
  put(2026, m, row(2026, m, 'Gusto', 'Payroll', (m < 8 ? r : 12000) * 0.27));
  put(2026, m, row(2026, m, 'Stripe', 'Payment Processing', (m < 8 ? r : 12000) * 0.02));
  if (m === 2 || m === 5) put(2026, m, row(2026, m, 'NYS DTF SALES TAX', 'Sales Tax Remitted', 1200));
}
sb.__B__ = book;
S('appData = __B__;');

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };
const near = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 0.01 : tol);

console.log('the common basis');
{
  const Bk = J(`(function(){ var B = trendsBook(); return { months: B.months.map(function(x){ return { y:x.y, m:x.m, ok:x.ok, complete:x.complete, partial:x.partial, rev:x.rev, exp:x.exp, net:x.net, cogs:x.cogs }; }),
    latest: B.latest, lastComplete: B.lastComplete, partial: B.partial, unstated: B.unstated }; })()`);
  const yr = y => Bk.months.filter(x => x.y === y);
  const sum = (xs, k) => xs.reduce((s, x) => s + x[k], 0);
  const raw = J(`[2024, 2025].map(function (y) { var r = 0, e = 0; for (var m = 0; m < 12; m++) { var c = calcMonth(y, m); r += c.revenue; e += c.expenses; } return { r: r, e: e }; })`);
  const cmp = J(`[2024, 2025].map(function (y, i) { return comparableRevenue(y, ${JSON.stringify(raw)}[i].r); })`);
  t('a deposits year, summed, is exactly the like-for-like revenue Yearly Summary shows',
    near(sum(yr(2024), 'rev'), cmp[0]) && near(sum(yr(2025), 'rev'), cmp[1]), sum(yr(2025), 'rev').toFixed(2) + ' vs ' + cmp[1]);
  t('  fees and tax spread by each month\'s deposits: February carries twice January\'s share',
    near((yr(2025)[1].rev - base[1] * 1.05) / (yr(2025)[0].rev - base[0] * 1.05), 2, 1e-9));
  t('  sales tax paid comes out of expenses, and the fees go in',
    near(sum(yr(2025), 'exp'), raw[1].e - 4 * 900 + 1800), sum(yr(2025), 'exp').toFixed(2));
  t('a day-book year is taken as it stands; its sales tax category never was an expense',
    near(yr(2026)[2].rev, base[2] * 1.1) && near(yr(2026)[2].exp, base[2] * 1.1 * (0.35 + 0.27 + 0.02) + 2000));
  t('a year with no fee or tax figure cannot be stated, and says so rather than showing raw deposits',
    yr(2023).every(x => !x.ok) && JSON.stringify(Bk.unstated) === '[2023]');
  t('the year in progress counts complete months only: cut on 14 Sep, August is the last',
    Bk.latest === 2026 && Bk.lastComplete === 7 && Bk.partial === 8 &&
    yr(2026)[7].complete && !yr(2026)[8].complete && yr(2026)[8].partial);
}

console.log('\ntracker and projections');
{
  S(`appData.trends = { targets: { 2026: { rev: 500000, net: 60000 } }, oneOffs: [{ label: 'Van', month: '2024-10', amount: 5000 }],
                        adjustments: [{ label: 'Cancelled service', amount: 3000 }], notes: '' };`);
  const T = J(`(function(){ var B = trendsBook(); var T = trendsTracker(B); return { T: T, B: { months: B.months.filter(function(x){return x.complete;}).map(function(x){ return { y:x.y, m:x.m, rev:x.rev, net:x.net }; }) } }; })()`);
  const tr = T.T, cm = T.B.months;
  const get = (y, m) => cm.find(x => x.y === y && x.m === m);
  t('the pace lines end the year exactly on target', near(tr.paceRev[11], 500000) && near(tr.paceNet[11], 60000));
  const janAvg = ([2024, 2025, 2026].map(y => get(y, 0).rev).reduce((a, b) => a + b, 0)) / 3;
  const totAvg = tr.season.reduce((s, x) => s + x.avgRev, 0);
  t('  shaped by the average of every complete month: January is its share, not a twelfth',
    near(tr.paceRev[0], 500000 * janAvg / totAvg, 0.01) && !near(tr.paceRev[0], 500000 / 12, 100));
  const octNetAvg = (get(2024, 9).net + 5000 + get(2025, 9).net) / 2;
  t('  with a one-off cost put back into its month', near(tr.season[9].avgNet, octNetAvg), tr.season[9].avgNet.toFixed(2));

  const ytdRev = [0,1,2,3,4,5,6,7].reduce((s, m) => s + get(2026, m).rev, 0);
  const ytdNet = [0,1,2,3,4,5,6,7].reduce((s, m) => s + get(2026, m).net, 0);
  const lastYtd = [0,1,2,3,4,5,6,7].reduce((s, m) => s + get(2025, m).rev, 0);
  const g = ytdRev / lastYtd - 1;
  const rest = y => [8, 9, 10, 11].reduce((s, m) => s + get(y, m).net + (y === 2024 && m === 9 ? 5000 : 0), 0);
  const restRev = [8, 9, 10, 11].reduce((s, m) => s + get(2025, m).rev, 0);
  const P = tr.projections;
  t('year to date and growth against the same months last year',
    near(tr.ytdRev, ytdRev) && near(tr.ytdNet, ytdNet) && near(P.growth, g, 1e-9), (g * 100).toFixed(2) + '%');
  t('conservative: the average Sep–Dec of earlier years, one-off put back; revenue flat on last year',
    near(P.conservative.net, ytdNet + (rest(2024) + rest(2025)) / 2) && near(P.conservative.rev, ytdRev + restRev));
  t('base: last year\'s Sep–Dec plus the known change; revenue at half this year\'s growth',
    near(P.base.net, ytdNet + rest(2025) + 3000) && near(P.base.rev, ytdRev + restRev * (1 + g / 2)));
  t('optimistic: the best Sep–Dec on record plus the known change; revenue at this year\'s growth',
    near(P.optimistic.net, ytdNet + Math.max(rest(2024), rest(2025)) + 3000) && near(P.optimistic.rev, ytdRev + restRev * (1 + g)));
  t('a year that cannot be stated is not taken as a "best" year', P.prior.every(p => p.y !== 2023));
}

console.log('\ndrawing the page, and saving');
{
  S('delete appData.trends;');
  saves = 0; charts.length = 0;
  S('renderTrendsExtras();');
  t('drawing it writes nothing into the book', S('appData.trends === undefined') === true && saves === 0);
  t('  and without targets it asks for them rather than drawing a pace',
    /Set a revenue and net income target/.test(els['trends-tracker'].innerHTML) && !/trTrackRev/.test(els['trends-tracker'].innerHTML));
  t('  the lower sections draw: month by month, seasonality, year by year, costs',
    ['trMonthly', 'trSeason', 'trCost'].every(idc => /id="/.test(els['trends-more'].innerHTML) && els['trends-more'].innerHTML.includes(idc)) &&
    charts.length >= 3);
  const monthly = charts.find(c => c.data && c.data.labels && c.data.labels[0] === "Jan '24");
  t('  every complete month since trading began, and the part month lighter at the end',
    monthly && monthly.data.labels.length === 24 + 9 && monthly.data.labels[monthly.data.labels.length - 1] === "Sep '26" &&
    monthly.data.datasets[0].backgroundColor[monthly.data.labels.length - 1] === '#c9c9e8', monthly && monthly.data.labels.length);

  saves = 0;
  S(`trendsSetTarget(2026, 'rev', '$500,000'); trendsSetTarget(2026, 'net', '65,000');`);
  t('a target saves, as a number, and redraws the tracker with a pace',
    J('appData.trends.targets[2026]').rev === 500000 && J('appData.trends.targets[2026]').net === 65000 && saves === 2 &&
    /trTrackRev/.test(els['trends-tracker'].innerHTML));
  S(`trendsAddItem('oneOffs'); trendsSetItem('oneOffs', 0, 'label', '<img src=x onerror=alert(1)>'); trendsSetItem('oneOffs', 0, 'month', '2024-10'); trendsSetItem('oneOffs', 0, 'amount', '5,000');`);
  const o = J('appData.trends.oneOffs[0]');
  t('a one-off cost saves its label, month and amount', o.month === '2024-10' && o.amount === 5000 && /img/.test(o.label));
  S('renderTrendsSettings();');
  t('  and its label is shown as text, not markup',
    !/<img src=x/.test(els['trends-settings'].innerHTML) && /&lt;img src=x/.test(els['trends-settings'].innerHTML));
  S(`trendsSetItem('oneOffs', 0, 'month', 'not a month'); trendsSetItem('nope', 0, 'label', 'x');`);
  t('  a bad month is dropped, and an unknown list is refused', J('appData.trends.oneOffs[0]').month === undefined && S('appData.trends.nope') === undefined);
  S(`trendsRemoveItem('oneOffs', 0);`);
  t('  and it can be removed', J('appData.trends.oneOffs').length === 0);

  S(`trendsSaveNotes('Van bought Oct 2024.\\n</textarea><script>alert(1)</script>');`);
  S('renderTrendsExtras();');
  t('notes save with the book, line breaks and all', /Van bought Oct 2024\.\n/.test(J('appData.trends.notes')));
  t('  and cannot close the box they are shown in', !/<\/textarea><script>/.test(els['trends-top'].innerHTML) && /&lt;\/textarea&gt;/.test(els['trends-top'].innerHTML));
  const findings = els['trends-more'].innerHTML;
  t('the findings are worked out from the book: the best month is the biggest one',
    /Best month: May 2026/.test(findings) && /COGS, Jan–Aug each year/.test(findings),
    (findings.match(/Best month: [A-Za-z]+ \d+/) || [''])[0]);
}

console.log('\nthe real book, if it is here');
{
  const raw = F.file('bloom-books-backup-2026-09-15-1714.json');
  if (!raw) console.log('  (not on this machine: skipped)');
  else {
    const j = JSON.parse(raw);
    sb.__R__ = j.appData;
    S('appData = __R__; if (typeof ensureVaultData === "function") {}');
    const r = J(`(function(){ var B = trendsBook(); return B.years.map(function (y) {
      var xs = B.months.filter(function (x) { return x.y === y && x.ok; }); if (xs.length < 12) return null;
      var rawRev = 0; for (var m = 0; m < 12; m++) rawRev += calcMonth(y, m).revenue;
      var cmp = comparableRevenue(y, Math.round(rawRev * 100) / 100);
      var sum = xs.reduce(function (s, x) { return s + x.rev; }, 0);
      var bad = xs.some(function (x) { return !isFinite(x.rev) || !isFinite(x.exp); });
      return { y: y, sum: sum, cmp: cmp, bad: bad };
    }).filter(Boolean); })()`);
    t('every year agrees with Yearly Summary\'s like-for-like revenue, to the cent',
      r.length && r.every(x => x.cmp != null && near(x.sum, x.cmp, 0.02) && !x.bad), r.map(x => x.y).join(', '));
  }
}

console.log(fail.length ? '\n' + fail.length + ' FAILURES:\n' + fail.join('\n') : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
