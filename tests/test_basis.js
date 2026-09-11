// The yearly table read as a four-year trend and was not one.
//
// Revenue comes from bank DEPOSITS up to the switch-over and from the DAY BOOK
// after it. Deposits are net of the processor's cut and carry the sales tax the
// customer paid; the day book is gross of fees and tax-exclusive. Two different
// measures in one row.
//
// Restating was rejected: 2023 and 2024 have no day book to restate TO, and
// moving 2025 across would need a year of processor fees entered as expenses or
// profit jumps by the whole year's Stripe cut. So the data stays and the
// adjustment is reported, from two figures the owner supplies per year.
//
// The rule that matters most here: a year with no adjustment shows NOTHING. A
// raw deposits figure sitting under a heading that says like-for-like is worse
// than a blank, because it reads as an answer.
const F = require('./fixtures');
const vm = require('vm');

const sb = F.sandbox({});
let out = null;
sb.__OUT__ = o => { out = o; };

vm.runInNewContext(F.src(['config.js', 'utils.js', 'daily-sales.js', 'ledger.js', 'reports.js']) + `
;(function(){
  renderYearlyPanel = function () {};
  appData = { years: [2024, 2025, 2026], activeYear: 2026,
              transactions: {}, dailySales: {}, dailyRevenueFrom: '2026-01' };

  // Four quarterly remittances, the shape the relabelled ledger now carries:
  // paid in Mar/Jun/Sep/Dec, so a calendar year's payments cover December
  // through November -- which is why this is offered and not substituted.
  appData.transactions['2025-2']  = [{ date:'2025-03-04', type:'out', amount:7125.19, category:'Taxes', vendor:'Sales Tax' }];
  appData.transactions['2025-5']  = [{ date:'2025-06-10', type:'out', amount:8387.98, category:'Taxes', vendor:'Sales Tax' }];
  appData.transactions['2025-8']  = [{ date:'2025-09-12', type:'out', amount:4661.77, category:'Taxes', vendor:'Sales Tax' }];
  appData.transactions['2025-11'] = [{ date:'2025-12-03', type:'out', amount:5919.45, category:'Sales Tax Remitted', vendor:'Sales Tax' }];
  // A payroll tax payment in the same category must NOT be swept in.
  appData.transactions['2025-6']  = [{ date:'2025-07-15', type:'out', amount:1200, category:'Taxes', vendor:'Gusto', desc:'payroll tax' }];

  var basis = { y2024: revenueBasis(2024), y2025: revenueBasis(2025), y2026: revenueBasis(2026) };

  // Nothing entered yet.
  var blank = {
    depositsYear: comparableRevenue(2025, 448202.72),
    dayBookYear:  comparableRevenue(2026, 346589.44)
  };

  // The owner enters 2025: Stripe took 8,900 and the deposits carried 30,100
  // of sales tax.
  setBasisAdjust(2025, 'fees', '8900');
  setBasisAdjust(2025, 'tax', '30,100.00');      // typed with a comma and a $ sign
  setBasisAdjust(2024, 'fees', '$7,400');
  setBasisAdjust(2024, 'tax', '28000');
  var filled = {
    y2024: comparableRevenue(2024, 426969.11),
    y2025: comparableRevenue(2025, 448202.72),
    y2026: comparableRevenue(2026, 346589.44)
  };

  // Half-entered is still not an answer... but one of the two IS enough to
  // state, since a missing figure is zero rather than unknown once the owner
  // has touched the year at all.
  setBasisAdjust(2025, 'tax', '');
  var halfEntered = comparableRevenue(2025, 448202.72);

  // Clearing both puts it back to unknown.
  setBasisAdjust(2025, 'fees', '');
  var cleared = comparableRevenue(2025, 448202.72);
  var mapAfterClear = JSON.stringify(basisAdjustMap()[2025] || null);

  // Junk is refused rather than stored as NaN.
  setBasisAdjust(2026, 'fees', 'wombat');
  var junk = JSON.stringify(basisAdjustMap()[2026] || null);

  __OUT__({ basis: basis, blank: blank, filled: filled,
            halfEntered: halfEntered, cleared: cleared,
            mapAfterClear: mapAfterClear, junk: junk,
            remitted2025: Math.round(salesTaxRemitted(2025) * 100) / 100,
            remitted2026: Math.round(salesTaxRemitted(2026) * 100) / 100 });
})();`, sb, { filename: 'bb.js' });

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };
const o = out;

console.log('which basis each year reports on');
t('2024 and 2025 are on deposits',
  o.basis.y2024 === 'deposits' && o.basis.y2025 === 'deposits');
t('2026 is on the day book', o.basis.y2026 === 'day book');

console.log('\nwith nothing entered');
t('a deposits year states NOTHING rather than its raw figure',
  o.blank.depositsYear === null, String(o.blank.depositsYear));
t('and a day-book year is already on the common basis',
  o.blank.dayBookYear === 346589.44, '$' + o.blank.dayBookYear);

console.log('\nonce the two figures are given');
t('2025: deposits + fees - tax',
  o.filled.y2025 === 448202.72 + 8900 - 30100, '$' + o.filled.y2025);
t('2024 too, typed with dollar signs and commas',
  o.filled.y2024 === 426969.11 + 7400 - 28000, '$' + o.filled.y2024);
t('and the day-book year is left alone', o.filled.y2026 === 346589.44);
console.log('      (so the comparison runs $' + o.filled.y2024.toFixed(2) + ' → $' +
            o.filled.y2025.toFixed(2) + ' → $' + o.filled.y2026.toFixed(2) + ')');

console.log('\nand the figures can be taken back out');
t('one of the two still states a figure — a blank field is zero, not unknown',
  o.halfEntered === 448202.72 + 8900, '$' + o.halfEntered);
t('clearing both returns it to unknown', o.cleared === null, String(o.cleared));
t('and leaves nothing behind in the book', o.mapAfterClear === 'null', o.mapAfterClear);
t('junk is refused rather than stored as NaN', o.junk === 'null', o.junk);

console.log('\nand the tax half can now be suggested from the ledger');
const fourQuarters = 7125.19 + 8387.98 + 4661.77 + 5919.45;
t('the four quarterly remittances add up, across both category shapes',
  o.remitted2025 === fourQuarters, '$' + o.remitted2025);
t('and a payroll tax payment filed under Taxes is NOT swept in',
  o.remitted2025 !== fourQuarters + 1200, 'the $1,200 Gusto row stayed out');
t('a year with no payments suggests nothing rather than zero-as-an-answer',
  o.remitted2026 === 0, '$' + o.remitted2026);
console.log('      (offered, never substituted — remitting trails collecting by a quarter,');
console.log('       so a calendar year of payments covers December through November)');

console.log(fail.length ? '\n' + fail.length + ' FAILURES:\n' + fail.join('\n') : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
