// The year card's growth figure and the table beneath it must say the same
// thing.
//
// The card computed YoY from raw recorded revenue: deposits (net of fees,
// carrying sales tax) against the day book (gross, tax-exclusive), and a whole
// year against the part of one that has happened. On the owner's book the 2026
// card read DOWN 19.0% directly above a table reading UP 19.9% to the same
// date. It now uses the table's own like-for-like figures.
const F = require('./fixtures');
const vm = require('vm');

const grid = { innerHTML: '' };
const sb = F.sandbox({});
// The panel draws a chart after the cards; give it a canvas to draw on, since
// setBasisAdjust re-renders the whole panel.
const canvas = { getContext: () => ({}) };
sb.document.getElementById = id =>
  id === 'yearly-grid-content' ? grid : /Chart$/.test(id) ? canvas : null;
let out = null;
sb.grid = grid;
sb.__OUT__ = o => { out = o; };

vm.runInNewContext(F.src(['config.js', 'utils.js', 'daily-sales.js', 'ledger.js', 'reports.js']) + `
;(function(){
  appData = { years: [2024, 2025, 2026], activeYear: 2026,
              transactions: {}, dailySales: {}, dailyRevenueFrom: '2026-01' };
  appData.transactions['2024-1'] = [{ date: '2024-02-14', type: 'in', amount: 50000, category: 'Revenue', vendor: 'Card' }];
  appData.transactions['2024-10'] = [{ date: '2024-11-20', type: 'in', amount: 30000, category: 'Revenue', vendor: 'Card' }];
  appData.transactions['2025-1'] = [{ date: '2025-02-14', type: 'in', amount: 60000, category: 'Revenue', vendor: 'Card' }];
  appData.transactions['2025-10'] = [{ date: '2025-11-20', type: 'in', amount: 40000, category: 'Revenue', vendor: 'Card' }];
  appData.dailySales['2026-1'] = { '14': { counter: { s: 50000 } } };
  appData.dailySales['2026-8'] = { '11': { counter: { s: 20000 } } };

  // Returns the rendered HTML; it is parsed outside the sandbox, where regex
  // escapes are not at the mercy of a template literal.
  var card = function () {
    try { renderYearlyPanel(); } catch (e) { /* the chart canvas is absent here */ }
    return grid.innerHTML;
  };

  var bare = card();                         // nothing entered for the deposits years

  // Straight into the map: setBasisAdjust re-renders the whole panel, charts
  // and all, which this suite has no reason to stand up.
  basisAdjustMap()[2024] = { fees: 4000, tax: 6000 };
  basisAdjustMap()[2025] = { fees: 5000, tax: 8000 };
  var filled = card();

  var cut = ytdCutoff(appData.years);
  var table = {
    y25full: (comparableRevenue(2025, 100000) - comparableRevenue(2024, 80000)) / comparableRevenue(2024, 80000) * 100,
    y26ytd: (comparableRevenueThrough(2026, cut.md) - comparableRevenueThrough(2025, cut.md)) /
            comparableRevenueThrough(2025, cut.md) * 100
  };
  var raw26 = (70000 - 100000) / 100000 * 100;
  __OUT__({ bare: bare, filled: filled, table: table, raw26: raw26 });
})();`, sb, { filename: 'bb.js' });

function parseCards(html) {
  const res = {};
  html.split('class="year-card"').slice(1).forEach(c => {
    const text = c.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const yr = (text.match(/(20\d\d) Revenue/) || [])[1];
    const g = text.match(/(YoY[^▲▼]*?)\s*([▲▼])\s*([\d.]+)%/);
    res[yr] = g ? { label: g[1].trim(), pct: (g[2] === '▼' ? -1 : 1) * parseFloat(g[3]) } : null;
  });
  return res;
}
out.bare = parseCards(out.bare);
out.filled = parseCards(out.filled);

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };
const o = out;
const near = (a, b) => a != null && Math.abs(a - Math.round(b * 10) / 10) < 0.051;

console.log('with nothing entered for the deposits years');
t('the card states no growth rather than the raw figure',
  o.bare['2025'] === null && o.bare['2026'] === null,
  '2025 ' + JSON.stringify(o.bare['2025']) + ', 2026 ' + JSON.stringify(o.bare['2026']));

console.log('\nonce the adjustments are in');
t('a complete year compares whole years, like for like, as the table does',
  o.filled['2025'] && o.filled['2025'].label === 'YoY Growth' && near(o.filled['2025'].pct, o.table.y25full),
  JSON.stringify(o.filled['2025']) + ' vs table ' + o.table.y25full.toFixed(1) + '%');
t('the year in progress is measured to the date its data reaches',
  o.filled['2026'] && o.filled['2026'].label === 'YoY to 11 Sep',
  o.filled['2026'] && o.filled['2026'].label);
t('  and matches the table\'s to-date row',
  o.filled['2026'] && near(o.filled['2026'].pct, o.table.y26ytd),
  (o.filled['2026'] || {}).pct + '% vs table ' + o.table.y26ytd.toFixed(1) + '%');
t('  where the raw figure would have pointed the other way',
  o.raw26 < 0 && o.filled['2026'] && o.filled['2026'].pct > 0,
  'raw ' + o.raw26.toFixed(1) + '%, like for like +' + (o.filled['2026'] || {}).pct + '%');

console.log(fail.length ? '\n' + fail.length + ' FAILURES:\n' + fail.join('\n') : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
