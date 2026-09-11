// Chase puts the account holder's name in the ACH description, so
// "IND NAME:BARAMI WASPE" turns up on ordinary supplier payments the owner
// authorised. A rule keyed on the bare name therefore matches things that are
// not draws at all -- in one real statement, a $230.29 Delaware Valley flower
// purchase and two American Express payments.
//
// As an ignore rule that silently discarded a COGS purchase. Changed to a
// categorising rule it would have booked one as an owner draw, which is worse:
// wrong and visible instead of wrong and absent.
//
// Every description below is copied verbatim from a real Chase export. That is
// the point of this suite -- the previous version of the rule was reasoned
// about rather than tested against the bank's actual wording.
const F = require('./fixtures');
const vm = require('vm');

const sb = F.sandbox({});
let out = null;
sb.__OUT__ = o => { out = o; };

// Verbatim from Chase3398_Activity_20260902.csv
const REAL = {
  draw1: 'Zelle payment to Barami Waspe 30515148228',
  draw2: 'Zelle payment to Barami Waspe 30427625671',
  dvflora: 'ORIG CO NAME:DELAWARE VALLEY        ORIG ID:4222779770 DESC DATE:B26238 ' +
           'CO ENTRY DESCR:8564687000SEC:WEB    TRACE#:091000012738289 EED:260827   ' +
           'IND ID:2WSVGXZSEMU5VCO              IND NAME:BARAMI WASPE TRN: 2392738289TC',
  amex: 'ORIG CO NAME:AMERICAN EXPRESS       ORIG ID:20050321 IND NAME:BARAMI WASPE',
  // The shape a contribution would take.
  contribution: 'Zelle payment from Barami Waspe 30515148999'
};

vm.runInNewContext(F.src(['config.js', 'utils.js', 'import-trainer.js']) + `
;(function(){
  appData = { years: [2026], activeYear: 2026, rules: [], transactions: {}, dailySales: {} };
  var R = function (desc, sign) {
    var hit = resolveRules(desc.toUpperCase(), sign || 'out');
    if (!hit) return '(uncategorised)';
    if (hit.ignore) return '(ignored)';
    return hit.category;
  };
  var REAL = __REAL__;
  __OUT__({
    draw1:        R(REAL.draw1),
    draw2:        R(REAL.draw2),
    dvflora:      R(REAL.dvflora),
    amex:         R(REAL.amex),
    contribution: R(REAL.contribution, 'in'),
    // A draw taken some other way must not be guessed at.
    cheque:       R('CHECK # 1092 BARAMI WASPE'),
    // And the owner rules must sit last, so a named supplier always wins.
    ownerRuleIndexes: BUILTIN_RULES.map(function (r, i) {
      return /barami/i.test(r.keyword || '') ? i : -1; }).filter(function (i) { return i >= 0; }),
    supplierRuleIndexes: BUILTIN_RULES.map(function (r, i) {
      return /DELAWARE VALLEY|PERRI|MAIN WHOLESALE/i.test(r.keyword || '') ? i : -1; })
      .filter(function (i) { return i >= 0; }),
    total: BUILTIN_RULES.length,
    // Nothing may key on the bare name again.
    bareName: BUILTIN_RULES.filter(function (r) {
      return /^barami\\s+waspe$/i.test(String(r.keyword || '').trim()); }).length
  });
})();`, Object.assign(sb, { __REAL__: REAL }), { filename: 'bb.js' });

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };
const o = out;

console.log('real descriptions, copied from the bank');
t('"Zelle payment to Barami Waspe" is a draw', o.draw1 === 'Owner Draw', o.draw1);
t('and the second one too', o.draw2 === 'Owner Draw', o.draw2);
t('money the other way is a contribution, not revenue',
  o.contribution === 'Owner Contribution', o.contribution);

console.log('\nand the three that only carry the name because he authorised them');
t('the $230.29 Delaware Valley purchase is COGS, not a draw',
  o.dvflora === 'Supplies & Materials - COGS', o.dvflora);
t('the American Express payments are not draws either',
  o.amex !== 'Owner Draw', o.amex);

console.log('\nand a draw taken some other way is left to be looked at');
t('a cheque is not guessed at', o.cheque === '(uncategorised)', o.cheque);

console.log('\nthe rules sit where they must');
t('the owner rules are LAST, after every named supplier',
  o.ownerRuleIndexes.length === 2 &&
  Math.min.apply(null, o.ownerRuleIndexes) > Math.max.apply(null, o.supplierRuleIndexes),
  'owner at ' + o.ownerRuleIndexes.join(',') + ' of ' + o.total +
  '; suppliers up to ' + Math.max.apply(null, o.supplierRuleIndexes));
t('and nothing keys on the bare name any more', o.bareName === 0);

console.log(fail.length ? '\n' + fail.length + ' FAILURES:\n' + fail.join('\n') : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
