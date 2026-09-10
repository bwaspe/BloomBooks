// Four van payments dated March, May and June sat in the January bucket.
//
// addManualTx filed by the month PANEL you were standing on and the year
// SELECTOR, while the date came from the box -- so a March payment entered from
// the January screen was filed under January carrying a March date. Right in
// every report that reads the date, wrong in every one that reads the bucket.
//
// The repair only moves a row whose date is in the SAME YEAR as its bucket. A
// row that crosses a year is reported and left alone: moving it would shift two
// annual totals at once, and those years are filed.
const F = require('./fixtures');
const vm = require('vm');

const sb = F.sandbox({});
let out = null;
sb.__OUT__ = o => { out = o; };

vm.runInNewContext(F.src(['config.js', 'utils.js', 'ledger.js']) + `
;(function(){
  var asked = null;
  confirm = function (m) { asked = m; return true; };
  // ledgerRefile re-renders when it is done, which walks into the DOM. The
  // suite is about where the rows land, not about drawing them.
  renderCurrentPanel = function () {};

  appData = { years: [2025, 2026], activeYear: 2026, transactions: {}, dailySales: {} };
  var T = function (date, amount, extra) {
    return Object.assign({ id: date + '-' + amount, date: date, type: 'out',
                           amount: amount, category: 'Loan Repayment', vendor: 'VNB' }, extra || {}); };

  // January 2026's bucket, holding what the bug put there.
  appData.transactions['2026-0'] = [
    T('2026-01-05', 100),      // genuinely January
    T('2026-03-03', 522.39),   // March, misfiled
    T('2026-03-31', 522.39),   // March, misfiled
    T('2026-05-01', 522.39),   // May, misfiled
    T('2026-06-02', 522.39)    // June, misfiled
  ];
  // A row crossing a YEAR, which must not be touched.
  appData.transactions['2025-11'] = [ T('2026-01-02', 250) ];
  // And a row with a date nothing can read.
  appData.transactions['2026-1'] = [ T('not a date', 75) ];

  var before = ledgerMisfiled(2026);
  var janBefore = calcMonth(2026, 0).bankOut;
  var marBefore = calcMonth(2026, 2).bankOut;
  var yearBefore = [0,1,2,3,4,5,6,7,8,9,10,11]
    .reduce(function (s, m) { return s + calcMonth(2026, m).bankOut; }, 0);

  ledgerRefile(2026);

  var after = ledgerMisfiled(2026);
  var janAfter = calcMonth(2026, 0).bankOut;
  var marAfter = calcMonth(2026, 2).bankOut;
  var mayAfter = calcMonth(2026, 4).bankOut;
  var junAfter = calcMonth(2026, 5).bankOut;
  var yearAfter = [0,1,2,3,4,5,6,7,8,9,10,11]
    .reduce(function (s, m) { return s + calcMonth(2026, m).bankOut; }, 0);

  __OUT__({
    beforeSafe: before.thisYear.length, beforeCross: before.crossYear.length,
    afterSafe: after.thisYear.length, afterCross: after.crossYear.length,
    jan: [janBefore, janAfter], mar: [marBefore, marAfter],
    may: mayAfter, jun: junAfter,
    year: [Math.round(yearBefore*100)/100, Math.round(yearAfter*100)/100],
    crossStillThere: (appData.transactions['2025-11'] || []).length,
    unreadableStillThere: (appData.transactions['2026-1'] || []).length,
    asked: asked,

    // And the cause: adding from the wrong screen now files by the date.
    manual: (function () {
      var seen = null;
      document.getElementById = function (id) {
        var v = { 'new-date-0': '2026-04-15', 'new-desc-0': 'typed from January',
                  'new-cat-0': 'Rent', 'new-vendor-0': 'Landlord',
                  'new-amount-0': '900', 'new-type-0': 'out' }[id];
        return { value: v === undefined ? '' : v }; };
      renderMonthPanel = function () {};
      notify = function (m) { seen = m; };
      addManualTx(0);                       // standing on JANUARY
      var apr = (appData.transactions['2026-3'] || []).filter(function (t) {
        return t.date === '2026-04-15'; }).length;
      var jan = (appData.transactions['2026-0'] || []).filter(function (t) {
        return t.date === '2026-04-15'; }).length;
      return { landedInApril: apr, landedInJanuary: jan, said: seen };
    })()
  });
})();`, sb, { filename: 'bb.js' });

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };
const o = out;

console.log('four payments dated March, May and June, sitting in January');
t('all four are found', o.beforeSafe === 4, o.beforeSafe + ' found');
t('and the one crossing a year is kept apart from them',
  o.beforeCross === 1, o.beforeCross + ' cross-year');

console.log('\nre-filing moves them to the month their own date says');
// Computed, not typed. Three of my hand-figures in this session were wrong
// while the code was right, and a test that asserts a number I did in my head
// is testing my arithmetic.
const misfiled = 522.39 * 4, genuinelyJan = 100;
t('January loses them', o.jan[0] === genuinelyJan + misfiled && o.jan[1] === genuinelyJan,
  '$' + o.jan[0] + ' -> $' + o.jan[1] + ' (kept the $' + genuinelyJan + ' that is really January)');
t('March gains its two', o.mar[1] === 522.39 * 2, '$' + o.mar[0] + ' -> $' + o.mar[1]);
t('May gains one', o.may === 522.39, '$' + o.may);
t('June gains one', o.jun === 522.39, '$' + o.jun);
t('and the four moved add up to what January lost',
  Math.abs((o.mar[1] + o.may + o.jun) - misfiled) < 0.005,
  '$' + (o.mar[1] + o.may + o.jun).toFixed(2));
t('and none is left misfiled', o.afterSafe === 0);

console.log('\nand nothing that has been filed with the state can move');
t('the YEAR total is identical before and after',
  o.year[0] === o.year[1], '$' + o.year[0] + ' -> $' + o.year[1]);
t('the row crossing a year is left exactly where it was',
  o.crossStillThere === 1 && o.afterCross === 1);
t('a date nothing can read is left alone rather than guessed at',
  o.unreadableStillThere === 1);
t('and the prompt says so before anything moves',
  /No year total changes/.test(o.asked || ''), 'names ' + (o.asked || '').split('\\n')[0]);

console.log('\nthe cause: a row typed from January, dated April');
t('lands in April', o.manual.landedInApril === 1);
t('not in January', o.manual.landedInJanuary === 0);
t('and it says where it went', /April/.test(o.manual.said || ''), o.manual.said);

console.log(fail.length ? '\n' + fail.length + ' FAILURES:\n' + fail.join('\n') : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
