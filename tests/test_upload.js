// Uploading a statement instead of pasting it, run against the owner's real
// Chase and Amex exports rather than invented ones.
//
// Two things are being proved. That the file goes in whole -- a pasted CSV
// loses the quoting that holds a Chase description together, and the two
// parsers disagree about what a positive number means, so feeding an Amex
// export to the bank parser books every purchase as revenue.
//
// And that the BALANCE column survives. It was being dropped on the way in. It
// is the whole basis of reconciling against the statement by arithmetic: where
// the balance steps by an amount no transaction explains, a row is missing --
// and the size of the step is the missing amount.
const F = require('./fixtures');
const vm = require('vm');

const CHASE = F.file('Chase3398_Activity_20260902.csv');
const AMEX = F.file('activity (13).csv');
if (!CHASE) F.skip('needs Chase3398_Activity_20260902.csv — put it in Downloads or set BLOOMBOOKS_FIXTURES');

const sb = F.sandbox({});
let out = null;
sb.__OUT__ = o => { out = o; };

vm.runInNewContext(F.src(['config.js', 'utils.js', 'import-trainer.js']) + `
;(function(){
  appData = { years: [2026], activeYear: 2026, rules: [], transactions: {}, dailySales: {} };

  var chaseRows = parseDelimited(__CHASE__);
  var chaseSrc  = detectStatementSource(chaseRows);
  var chaseTsv  = normalizeStatement(chaseRows, 'bank');
  var chaseLines = chaseTsv.split('\\n').filter(Boolean);
  var firstCols = chaseLines[0].split('\\t');

  // Every row's balance must come through as a number.
  var withBal = 0, badBal = [];
  chaseLines.forEach(function (l) {
    var c = l.split('\\t');
    if (c[4] && !isNaN(parseFloat(c[4]))) withBal++;
    else badBal.push(l.slice(0, 50));
  });

  // The chain itself: sorted oldest-first, each balance is the one before it
  // plus this row's amount. Chase writes newest-first.
  var chain = chaseLines.map(function (l) {
    var c = l.split('\\t');
    return { date: c[0], amt: parseFloat(String(c[2]).replace(/[$,]/g, '')), bal: parseFloat(c[4]) };
  }).filter(function (r) { return !isNaN(r.amt) && !isNaN(r.bal); }).reverse();

  var breaks = [];
  for (var i = 1; i < chain.length; i++) {
    var expect = Math.round((chain[i - 1].bal + chain[i].amt) * 100) / 100;
    if (Math.abs(expect - chain[i].bal) > 0.005) {
      breaks.push(chain[i].date + ': expected ' + expect + ', statement says ' + chain[i].bal);
    }
  }

  // Chase descriptions run to 327 characters and are quoted. None happens to
  // contain a comma, so that is not the risk here -- but a naive comma-split
  // still mis-counts the fields on every row, which is what puts the balance
  // in the wrong column. The quote-aware reader is what keeps both right.
  var longest = chaseLines.map(function (l) { return l.split('\\t')[1] || ''; })
                          .sort(function (a, b) { return b.length - a.length; })[0];
  var naiveFields = __CHASE__.split('\\n')[1].split(',').length;
  var realFields  = chaseRows[0].length;

  var amex = null;
  if (__AMEX__) {
    var aRows = parseDelimited(__AMEX__);
    amex = { detected: detectStatementSource(aRows),
             cols: normalizeStatement(aRows, 'amex').split('\\n')[0].split('\\t').length };
  }

  __OUT__({
    chaseSrc: chaseSrc, rows: chaseLines.length, cols: firstCols.length,
    withBal: withBal, badBal: badBal,
    chainLength: chain.length, breaks: breaks,
    first: { date: firstCols[0], amt: firstCols[2], type: firstCols[3], bal: firstCols[4] },
    longestDesc: longest.length, naiveFields: naiveFields, realFields: realFields,
    amex: amex
  });
})();`, Object.assign(sb, { __CHASE__: CHASE, __AMEX__: AMEX || null }), { filename: 'bb.js' });

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };
const o = out;

console.log('the real Chase export, uploaded whole');
t('recognised as a bank file without touching the dropdown',
  o.chaseSrc === 'bank', o.chaseSrc);
t(o.rows + ' rows read, five columns each', o.cols === 5, o.cols + ' columns');
t('a 327-character ACH description arrives in one piece',
  o.longestDesc > 300, o.longestDesc + ' chars');
t('and the quoted reader gets the field count right where a naive split does not',
  o.realFields === 7 && o.naiveFields !== o.realFields,
  'quoted ' + o.realFields + ' vs naive ' + o.naiveFields);
console.log('      (first row: ' + o.first.date + '  ' + o.first.amt + '  ' +
            o.first.type + '  balance ' + o.first.bal + ')');

console.log('\nthe balance column survives the trip');
t('every row carries a balance', o.badBal.length === 0,
  o.withBal + ' of ' + o.rows + (o.badBal.length ? '; missing: ' + o.badBal[0] : ''));

console.log('\nand the chain it makes possible');
t('read oldest-first, every balance is the one before plus this row',
  o.breaks.length === 0,
  o.breaks.length ? o.breaks.slice(0, 2).join(' | ') : o.chainLength + ' rows, unbroken');
console.log('      (an unbroken chain here is what proves the statement is complete —');
console.log('       a break would name a missing row and its exact amount)');

if (!o.amex) {
  console.log('\nno Amex export to hand — skipping that half');
} else {
  console.log('\nand the Amex export is told apart from it');
  t('recognised as Amex, not as a bank file', o.amex.detected === 'amex', o.amex.detected);
  t('and normalised into the six columns its parser reads', o.amex.cols === 6, o.amex.cols);
}

console.log(fail.length ? '\n' + fail.length + ' FAILURES:\n' + fail.join('\n') : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
