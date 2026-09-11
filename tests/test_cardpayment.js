// Nothing is discarded any more.
//
// Seven ignore rules threw rows away entirely: the Amex settlements, MP
// Gardens, Country Markets, Amazon tips, mobile payments and card rebates.
// Each discarded row is a hole in the bank's running balance, and a hole looks
// exactly like a missing transaction -- which is the one thing a reconciler
// exists to find. Some of them were the business card used by accident, which
// is a draw, and a draw is money that has to be accounted for.
//
// The Amex settlement is the only one with a real reason not to be an expense,
// and it is a third distinct reason: the money left the bank, but what it
// bought was already recorded from the card's own statement. Counting the
// payment too would charge the same spending twice.
//
// The keyword is the ACH form -- 'CO NAME:AMERICAN EXPRESS' -- because the Amex
// STATEMENT is run through these same rules, and a bare 'AMEX' would catch a
// charge on the card and stop it being an expense.
const F = require('./fixtures');
const vm = require('vm');

const sb = F.sandbox({});
let out = null;
sb.__OUT__ = o => { out = o; };

// Verbatim from Chase3398_Activity_20260902.csv
const REAL = {
  amexAch: 'ORIG CO NAME:AMERICAN EXPRESS       ORIG ID:20050321 IND NAME:BARAMI WASPE',
  // ...and the kind of line that appears on the CARD statement instead.
  amexFee: 'AMEX ANNUAL MEMBERSHIP FEE',
  amexCharge: 'AMEX PLAT CHARGE - OFFICE DEPOT'
};

vm.runInNewContext(F.src(['config.js', 'utils.js', 'import-trainer.js']) + `
;(function(){
  appData = { years: [2026], activeYear: 2026, rules: [], transactions: {}, dailySales: {} };
  var R = function (desc, sign) {
    var hit = resolveRules(desc.toUpperCase(), sign || 'out');
    if (!hit) return '(uncategorised)';
    if (hit.ignore) return '(DISCARDED)';
    return hit.category;
  };
  var REAL = __REAL__;
  __OUT__({
    amexAch:    R(REAL.amexAch),
    amexFee:    R(REAL.amexFee),
    amexCharge: R(REAL.amexCharge),
    // The five that used to vanish.
    mpGardens:  R('MP GARDENS NURSERY'),
    country:    R('COUNTRY MARKETS OF WESTCHESTER'),
    amazonTips: R('AMAZON TIPS*2K4LP'),
    mobile:     R('MOBILE PAYMENT - THANK YOU'),
    reward:     R('YOUR CASH REWARD', 'in'),
    discardedAnywhere: BUILTIN_RULES.filter(function (r) { return r.ignore; })
                                    .map(function (r) { return r.keyword; }),
    isNonExpense: isNonExpenseCat('Credit Card Payment'),
    note: nonExpenseNote('Credit Card Payment')
  });
})();`, Object.assign(sb, { __REAL__: REAL }), { filename: 'bb.js' });

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };
const o = out;

console.log('settling the Amex, as the BANK writes it');
t('is a card payment, not an expense', o.amexAch === 'Credit Card Payment', o.amexAch);
t('and it is excluded from expenses while staying in the ledger', o.isNonExpense);
t('saying why, where it is listed', /card statement/.test(o.note), o.note);

console.log('\nand a charge ON the card is still an expense');
t('an annual fee is not mistaken for a settlement',
  o.amexFee !== 'Credit Card Payment', o.amexFee);
t('nor is a purchase made on it', o.amexCharge !== 'Credit Card Payment', o.amexCharge);

console.log('\nthe five that used to vanish now reach the staging table');
['mpGardens', 'country', 'amazonTips', 'mobile', 'reward'].forEach(function (k) {
  t('  ' + k + ' is no longer discarded', o[k] !== '(DISCARDED)', o[k]);
});

console.log('\nand nothing anywhere is discarded now');
t('not one ignore rule remains', o.discardedAnywhere.length === 0,
  o.discardedAnywhere.join(', ') || 'none — every row reaches the ledger, ' +
  'so the balance chain has nothing to trip over');

console.log(fail.length ? '\n' + fail.length + ' FAILURES:\n' + fail.join('\n') : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
