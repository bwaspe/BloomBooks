// Which way the money went, and what that does to a category total.
//
// The yearly card put 2026 expenses at $282,843.48 and the yearly table put
// them at $288,802.92 -- $5,959.44 apart, on the same screen, with no row on
// either one adding up to the difference.
//
// Two separate faults, both about direction.
//
// A row facing against its category's natural side is a REVERSAL: a returned
// purchase, a payroll-tax credit from Gusto, a refunded sale. All three of the
// app's category summers added it instead of subtracting it, so a $6,000
// credit read as $6,000 more cost. The card compounded it by dropping inflows
// entirely, which is why the two differed by TWICE the credit.
//
// And money out under Revenue is not an expense of any category. On the
// deposits basis it nets off revenue -- the sale was reversed. On the day-book
// basis revenue comes from the day book, so the row is real cash that belongs
// in a cost category nobody has chosen; it used to be swept into the expense
// total, where nothing itemised it.
const F = require('./fixtures');
const vm = require('vm');

const sb = F.sandbox({});
let out = null;
sb.__OUT__ = o => { out = o; };

vm.runInNewContext(F.src(['config.js', 'utils.js', 'daily-sales.js', 'ledger.js', 'reports.js']) + `
;(function(){
  renderYearlyPanel = function () {};

  // 2025 on the deposits basis, 2026 on the day book.
  appData = { years: [2025, 2026], activeYear: 2026,
              transactions: {}, dailySales: {}, dailyRevenueFrom: '2026-01' };

  appData.transactions['2025-0'] = [
    { date: '2025-01-10', type: 'in',  amount: 10000, category: 'Revenue', vendor: 'Card' },
    // A refunded sale on the deposits basis.
    { date: '2025-01-20', type: 'out', amount: 250,   category: 'Revenue', vendor: 'Refund' },
    { date: '2025-01-15', type: 'out', amount: 4000,  category: 'Supplies & Materials - COGS', vendor: 'DV' },
    // A returned delivery of flowers: money back, under a cost.
    { date: '2025-01-16', type: 'in',  amount: 600,   category: 'Supplies & Materials - COGS', vendor: 'DV' }
  ];

  appData.dailySales['2026-0'] = { '15': { counter: { s: 20000 } } };
  appData.transactions['2026-0'] = [
    { date: '2026-01-15', type: 'out', amount: 3000, category: 'Payroll1', vendor: 'cash' },
    // The shape that started this: a credit under a cost category.
    { date: '2026-01-01', type: 'in',  amount: 500,  category: 'Payroll1', vendor: 'cash' },
    { date: '2026-01-05', type: 'in',  amount: 40.27, category: 'Payroll', vendor: 'Gusto (Payroll Tax)' },
    { date: '2026-01-08', type: 'out', amount: 900,  category: 'Payroll', vendor: 'Gusto' },
    // A processor debit filed under Revenue, on a day-book year.
    { date: '2026-01-02', type: 'out', amount: 5,    category: 'Revenue', vendor: 'Merchant Settlement' },
    { date: '2026-01-03', type: 'out', amount: 20.12, category: 'Revenue', vendor: 'Merchant Settlement' },
    // A capital purchase partly returned, to prove it is not a special case.
    { date: '2026-01-20', type: 'out', amount: 10000, category: 'Capital Expenditure', vendor: 'Lange' },
    { date: '2026-01-22', type: 'in',  amount: 1500,  category: 'Capital Expenditure', vendor: 'Lange' }
  ];

  var y25 = calcMonth(2025, 0), y26 = calcMonth(2026, 0);

  // The table's side: calcMonth's own breakdown, which is what it now reads.
  var tableExp = function (c) {
    return Math.round(CATEGORIES.filter(function (k) {
      return k !== 'Revenue' && !isNonExpenseCat(k) && !isNonRevenueInCat(k); })
      .reduce(function (s, k) { return s + (c.byCategory[k] || 0); }, 0) * 100) / 100;
  };
  // And categoryTotalsFor, which the Tax Summary reads. Same rule, or the
  // accountant's figure and the owner's disagree.
  var tax26 = categoryTotalsFor(2026, { withPayroll1: true, withCashRevenue: true });

  // The repair. Its rows must be the SAME set the figure totals, or the button
  // moves something the red line never counted.
  var rows = ledgerUnfiledRows();
  var rowTotal = Math.round(rows.reduce(function (s, r) { return s + r.tx.amount; }, 0) * 100) / 100;
  var refused = false;
  ledgerFileUnfiled('Nonsense Category');
  refused = ledgerUnfiledRows().length === rows.length;

  ledgerFileUnfiled('Payment Processing');
  var after = calcMonth(2026, 0), after25 = calcMonth(2025, 0);

  __OUT__({
    repair: { found: rows.length, total: rowTotal, refused: refused,
              leftUnfiled: after.unfiledOut,
              processing: after.byCategory['Payment Processing'],
              expenses: after.expenses,
              revenue26: after.revenue,
              y25Revenue: after25.revenue, y25Expenses: after25.expenses },
    y25: { revenue: y25.revenue, cogs: y25.cogs, expenses: y25.expenses,
           unfiled: y25.unfiledOut, tableExp: tableExp(y25) },
    y26: { revenue: y26.revenue, expenses: y26.expenses, unfiled: y26.unfiledOut,
           capital: y26.capital, tableExp: tableExp(y26),
           payroll1: y26.byCategory['Payroll1'], payroll: y26.byCategory['Payroll'] },
    taxPanel: { payroll1: tax26['Payroll1'], payroll: Math.round(tax26['Payroll'] * 100) / 100,
                capital: tax26['Capital Expenditure'] }
  });
})();`, sb, { filename: 'bb.js' });

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };
const o = out;

console.log('a credit under a cost category reduces that cost');
t('a $600 return against $4,000 of flowers leaves $3,400 of COGS',
  o.y25.cogs === 3400, '$' + o.y25.cogs);
t('Gusto crediting $40.27 of payroll tax leaves $859.73, not $940.27',
  o.y26.payroll === 859.73, '$' + o.y26.payroll);
t('$500 back against $3,000 of cash payroll leaves $2,500',
  o.y26.payroll1 === 2500, '$' + o.y26.payroll1);
t('and capital is no special case — $1,500 returned of $10,000',
  o.y26.capital === 8500, '$' + o.y26.capital);

console.log('\nand the Tax Summary applies the same rule');
t('so the accountant gets the same figures the owner sees',
  o.taxPanel.payroll1 === 2500 && o.taxPanel.payroll === 859.73 &&
  o.taxPanel.capital === 8500,
  'Payroll1 $' + o.taxPanel.payroll1 + ', Payroll $' + o.taxPanel.payroll +
  ', Capital $' + o.taxPanel.capital);

console.log('\nmoney out under Revenue');
t('on the deposits basis a $250 refund nets off revenue',
  o.y25.revenue === 9750, '$' + o.y25.revenue);
t('  and is not an expense, and is not left unfiled',
  o.y25.expenses === 3400 && o.y25.unfiled === 0,
  '$' + o.y25.expenses + ' of costs, $' + o.y25.unfiled + ' unfiled');
t('on the day-book basis revenue is untouched by it',
  o.y26.revenue === 20000, '$' + o.y26.revenue);
t('  the $25.12 of processor debits is reported, not buried in the expenses',
  o.y26.unfiled === 25.12 && Math.abs(o.y26.expenses - 3359.73) < 0.005,
  '$' + o.y26.unfiled + ' unfiled, expenses $' + o.y26.expenses);

console.log('\nand the card and the table read one source');
t('the yearly card total equals the table\'s own rows, 2025',
  Math.abs(o.y25.expenses - o.y25.tableExp) < 0.005,
  '$' + o.y25.expenses + ' vs $' + o.y25.tableExp);
t('and 2026, which is where they were $5,959.44 apart',
  Math.abs(o.y26.expenses - o.y26.tableExp) < 0.005,
  '$' + o.y26.expenses + ' vs $' + o.y26.tableExp);

console.log('');
console.log('and the red line can be acted on');
t('the rows it would move are exactly the ones it counts',
  o.repair.found === 2 && Math.abs(o.repair.total - 25.12) < 0.005,
  o.repair.found + ' rows, $' + o.repair.total);
t('a category that does not exist is refused, nothing moved',
  o.repair.refused === true);
t('filing them under Payment Processing clears the flag',
  o.repair.leftUnfiled === 0, '$' + o.repair.leftUnfiled + ' left unfiled');
t('  the money lands in that category',
  Math.abs(o.repair.processing - 25.12) < 0.005, '$' + o.repair.processing);
t('  and joins the expense total, which rose by exactly that',
  Math.abs(o.repair.expenses - 3384.85) < 0.005,
  '$3359.73 -> $' + o.repair.expenses);
t('  revenue is untouched — it comes from the day book',
  o.repair.revenue26 === 20000, '$' + o.repair.revenue26);
t('and a refund on a DEPOSITS year is left alone, not swept up',
  o.repair.y25Revenue === 9750 && o.repair.y25Expenses === 3400,
  '2025 still nets the $250 off revenue');

// 2023, 2024 and 2025 are filed and closed. Netting reversals is a correction,
// so the one thing it must not do is restate a year that has already gone to
// the state. It does not -- every reversal in the book is in 2026 -- but that
// wants a test rather than luck, because the next one might not be.
const BOOK = 'bloom-books-2026-09-12.json';
const bk = F.book(BOOK);
if (!bk) {
  console.log('\nno ' + BOOK + ' to hand -- skipping the closed-year check');
} else {
  const sb2 = F.sandbox({});
  let real = null;
  sb2.__OUT__ = o => { real = o; };
  sb2.__BOOK__ = bk.appData || bk;
  vm.runInNewContext(F.src(['config.js', 'utils.js', 'daily-sales.js', 'ledger.js', 'reports.js']) + `
;(function(){
  renderYearlyPanel = function () {};
  appData = __BOOK__;
  var res = {};
  (appData.years || []).forEach(function (yr) {
    var rev = 0, exp = 0, unfiled = 0;
    for (var m = 0; m < 12; m++) {
      var c = calcMonth(yr, m);
      rev += c.revenue; exp += c.expenses; unfiled += c.unfiledOut || 0;
    }
    res[yr] = { rev: Math.round(rev * 100) / 100, exp: Math.round(exp * 100) / 100,
                unfiled: Math.round(unfiled * 100) / 100 };
  });
  __OUT__(res);
})();`, sb2, { filename: 'bb.js' });

  console.log('\nagainst the real book, the closed years are untouched');
  // The figures on the owner's screen before any of this changed.
  [[2023, 174922.28, 157415.61], [2024, 426969.11, 395954.06],
   [2025, 448202.72, 408942.56]].forEach(function (row) {
    var yr = row[0], rev = row[1], exp = row[2];
    var r = real[yr] || {};
    t(yr + ' still reports $' + rev.toFixed(2) + ' and $' + exp.toFixed(2),
      Math.abs(r.rev - rev) < 0.005 && Math.abs(r.exp - exp) < 0.005,
      '$' + (r.rev || 0).toFixed(2) + ' revenue, $' + (r.exp || 0).toFixed(2) + ' costs');
    t('  and has nothing sitting unfiled', r.unfiled === 0, '$' + r.unfiled);
  });
  console.log('      (2026 is the only year holding a reversal, which is why only it moved)');
}

console.log(fail.length ? '\n' + fail.length + ' FAILURES:\n' + fail.join('\n') : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
