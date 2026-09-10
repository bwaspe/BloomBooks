// The van payment auto-files as a Loan Repayment instead of being picked by
// hand every month.
//
// The whole risk is in the keyword. A bare 'VALLEY' would also match DELAWARE
// VALLEY FLORIST -- a real COGS supplier of this shop, appearing in the bank as
// "ORIG CO NAME:DELAWARE VALLEY" -- and would start filing flower invoices as
// loan repayments, taking them out of COGS and out of expenses altogether. So
// the keyword is 'VALLEY BANK', and this suite exists mostly to prove the
// collision does not happen.
const F = require('./fixtures');
const vm = require('vm');

const sb = F.sandbox({});
let out = null;
sb.__OUT__ = o => { out = o; };

vm.runInNewContext(F.src(['config.js', 'utils.js', 'import-trainer.js']) + `
;(function(){
  appData = { years: [2026], activeYear: 2026, rules: [], transactions: {}, dailySales: {} };
  var R = function (desc, sign) { return resolveRules(desc.toUpperCase(), sign || 'out'); };
  var cat = function (hit) { return hit && !hit.ignore ? hit.category : (hit && hit.ignore ? '(ignored)' : null); };

  __OUT__({
    // The real descriptors, as they appear in the bank.
    vanAch:    cat(R('ORIG CO NAME:VALLEY BANK')),
    vanShort:  cat(R('VNB')),
    vanLong:   cat(R('VNB                  Valley Bank')),

    // The collision this keyword exists to avoid.
    dvAch:     cat(R('ORIG CO NAME:DELAWARE VALLEY')),
    dvLong:    cat(R('DELAWARE VALLEY FLORIST')),
    dvShort:   cat(R('DVFG')),

    // Other suppliers that must be untouched.
    perri:     cat(R('A PERRI FARMS INC')),
    main:      cat(R('MAIN WHOLESALE FLORIST')),

    // Direction: a credit from the bank is not a repayment.
    vanIn:     cat(R('ORIG CO NAME:VALLEY BANK', 'in')),

    // And the vendor it stamps.
    vendor:    (R('ORIG CO NAME:VALLEY BANK') || {}).vendor,

    // Nothing already in the rule list answers to 'VALLEY' alone by accident:
    // every builtin keyword containing VALLEY, so a future edit has to look.
    valleyKeywords: BUILTIN_RULES.filter(function (r) {
      return r.keyword && r.keyword.toUpperCase().indexOf('VALLEY') >= 0;
    }).map(function (r) { return r.keyword + ' -> ' + (r.category || 'ignore') + ' [' + (r.sign || '-') + ']'; })
  });
})();`, sb, { filename: 'bb.js' });

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };
const o = out;

console.log('the van payment files itself');
t('"ORIG CO NAME:VALLEY BANK" is a loan repayment',
  o.vanAch === 'Loan Repayment', o.vanAch);
t('so is the short form the ledger sometimes carries',
  o.vanShort === 'Loan Repayment', o.vanShort);
t('and the long one', o.vanLong === 'Loan Repayment', o.vanLong);
t('stamped as Valley Bank', o.vendor === 'Valley Bank', o.vendor);

console.log('\nand — the point of the keyword — the flower supplier is untouched');
t('"ORIG CO NAME:DELAWARE VALLEY" is still COGS',
  o.dvAch === 'Supplies & Materials - COGS', o.dvAch);
t('so is the full name', o.dvLong === 'Supplies & Materials - COGS', o.dvLong);
t('Perri is still COGS', o.perri === 'Supplies & Materials - COGS', o.perri);
t('Main is still COGS', o.main === 'Supplies & Materials - COGS', o.main);

console.log('\nand money coming FROM the bank is not a repayment');
t('a credit does not match', o.vanIn !== 'Loan Repayment', o.vanIn === null ? 'no rule' : o.vanIn);

console.log('\nevery builtin keyword containing VALLEY, so the next edit has to look:');
o.valleyKeywords.forEach(function (k) { console.log('      ' + k); });
t('there are exactly two, and neither is bare "VALLEY"',
  o.valleyKeywords.length === 2 &&
  !o.valleyKeywords.some(function (k) { return /^VALLEY\s+->/.test(k); }),
  o.valleyKeywords.length + ' found');

console.log(fail.length ? '\n' + fail.length + ' FAILURES:\n' + fail.join('\n') : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
