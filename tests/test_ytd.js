// A full-year row compares nine months of this year against twelve of last, so
// it reported a FALL on a year that is running well ahead: -14.0% against
// +22.2% once both are cut at the same date.
//
// Two things had to be right for that to mean anything.
//
// The cut is the last date the CURRENT year has data for, not today. The day
// book runs to the 11th; measuring to today would dock this year for days
// nobody has entered.
//
// And the basis adjustment is scaled by each year's own REVENUE share of
// itself, not by elapsed days. The processor's cut and the tax collected both
// move with sales, and this shop's sales are not spread evenly -- February and
// May carry the year. On 2023 that is the difference between 70% (calendar) and
// 33% (actual), because the business only opened that July.
const F = require('./fixtures');
const vm = require('vm');

const sb = F.sandbox({});
let out = null;
sb.__OUT__ = o => { out = o; };

vm.runInNewContext(F.src(['config.js', 'utils.js', 'daily-sales.js', 'ledger.js', 'reports.js']) + `
;(function(){
  renderYearlyPanel = function () {};
  appData = { years: [2025, 2026], activeYear: 2026,
              transactions: {}, dailySales: {}, dailyRevenueFrom: '2026-01' };

  // 2025 on the DEPOSITS basis: two deposits, one inside the window and one
  // after it, so the windowing is observable.
  appData.transactions['2025-1'] = [
    { date: '2025-02-14', type: 'in', amount: 60000, category: 'Revenue', vendor: 'Card' }];
  appData.transactions['2025-10'] = [
    { date: '2025-11-20', type: 'in', amount: 40000, category: 'Revenue', vendor: 'Card' }];

  // 2026 on the DAY BOOK, ending 11 September.
  appData.dailySales['2026-1'] = { '14': { counter: { s: 50000 }, _tips: 500 } };
  appData.dailySales['2026-8'] = { '11': { counter: { s: 20000 } } };

  var cut = ytdCutoff([2025, 2026]);

  // 2025: Stripe took 5,000 and the deposits carried 8,000 of tax.
  setBasisAdjust(2025, 'fees', '5000');
  setBasisAdjust(2025, 'tax', '8000');

  var y25full = revenueThrough(2025, '12-31');
  var y25ytd  = revenueThrough(2025, cut.md);
  var share   = y25ytd / y25full;

  var res = {
    cut: cut,
    y25: { full: y25full, ytd: y25ytd, share: Math.round(share * 1000) / 1000 },
    // deposits + (fees - tax) x share
    y25comparable: comparableRevenueThrough(2025, cut.md),
    y26comparable: comparableRevenueThrough(2026, cut.md),
    // A complete year cut at 31 Dec must equal its own full-year figure --
    // that is the check that the row and the table read one source.
    sameSource: {
      viaCalcMonth: (function () { var s = 0;
        for (var m = 0; m < 12; m++) s += calcMonth(2025, m).revenue;
        return Math.round(s * 100) / 100; })(),
      viaThrough: Math.round(revenueThrough(2025, '12-31') * 100) / 100
    },
    // Scaling by DAYS instead would give a different answer, and this is by
    // how much on these figures.
    ifScaledByDays: Math.round((y25ytd + (5000 - 8000) * (254 / 365)) * 100) / 100
  };

  // With no adjustment entered, a deposits year states nothing.
  setBasisAdjust(2025, 'fees', '');
  setBasisAdjust(2025, 'tax', '');
  res.y25noAdjust = comparableRevenueThrough(2025, cut.md);

  // And a year that runs to 31 December has nothing to cut.
  appData.dailySales['2026-11'] = { '31': { counter: { s: 1 } } };
  res.completeYear = ytdCutoff([2025, 2026]);

  __OUT__(res);
})();`, sb, { filename: 'bb.js' });

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };
const o = out;

console.log('where the cut falls');
t('the last date the current year has data for, not today',
  o.cut && o.cut.iso === '2026-09-11', o.cut && o.cut.iso);
t('and a year running to 31 December has nothing to cut',
  o.completeYear === null, String(o.completeYear));

console.log('\nwindowing a deposits year');
t('the whole year is $100,000', o.y25.full === 100000, '$' + o.y25.full);
t('to 11 Sep it is $60,000 — the November deposit is outside',
  o.y25.ytd === 60000, '$' + o.y25.ytd);
t('so that year is 60% of itself by then', o.y25.share === 0.6, o.y25.share);

console.log('\nand the adjustment is scaled by revenue, not by the calendar');
t('60% of (fees $5,000 - tax $8,000) applied to $60,000',
  o.y25comparable === 60000 + (5000 - 8000) * 0.6, '$' + o.y25comparable);
t('  scaling by days instead would have said $' + o.ifScaledByDays,
  o.ifScaledByDays !== o.y25comparable,
  '$' + Math.abs(o.ifScaledByDays - o.y25comparable).toFixed(2) + ' apart on these figures');
t('a day-book year needs no adjustment — it is already on the basis',
  o.y26comparable === 70500, '$' + o.y26comparable + ' (incl. $500 tips)');

console.log('\nand the rule that has held all along');
t('with nothing entered, a deposits year states NOTHING',
  o.y25noAdjust === null, String(o.y25noAdjust));

console.log('\nand the row reads the same source as the table');
t('a complete year cut at 31 Dec equals its own full-year revenue',
  Math.abs(o.sameSource.viaCalcMonth - o.sameSource.viaThrough) < 0.02,
  '$' + o.sameSource.viaCalcMonth + ' vs $' + o.sameSource.viaThrough);

console.log(fail.length ? '\n' + fail.length + ' FAILURES:\n' + fail.join('\n') : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
