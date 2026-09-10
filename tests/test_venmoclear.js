const F = require('./fixtures');
// Taking the statement as the authority cuts both ways. Writing only the days
// it covers left $595 of June standing on two days Venmo has no record of --
// so the books would still not match the report that was declared the truth.
const fs = require('fs'), vm = require('vm');
const BK = 'bloom-books-backup-2026-09-08-1904.json';
const __raw = F.file(BK);
if (!__raw) F.skip('needs ' + BK + ' — put it in Downloads or set BLOOMBOOKS_FIXTURES');
const j = JSON.parse(__raw);
const src = ['config.js', 'utils.js', 'daily-sales.js', 'venmo.js']
  .map(f => fs.readFileSync(F.APP + '/' + f, 'utf8')).join('\n');
const CSV = m => {
  const t = F.file('VenmoStatement_' + m + '_2026.csv');
  if (!t) F.skip('needs the Venmo statements — put them in Downloads or set BLOOMBOOKS_FIXTURES');
  return t;
};

const el = () => ({ innerHTML: '', value: '', style: {}, classList: { add() {}, remove() {} },
                    appendChild() {}, addEventListener() {}, querySelectorAll: () => [] });
const sb = { console, notify() {}, saveData() {}, switchPanel() {},
  escHtml: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
  fmt: n => '$' + Number(n).toFixed(2),
  Chart: function () { return { destroy() {} }; },
  document: { getElementById: () => null, querySelector: () => null,
              querySelectorAll: () => [], createElement: el },
  localStorage: { store: {}, getItem(k) { return this.store[k] || null; },
                  setItem(k, v) { this.store[k] = v; } } };
sb.window = sb;
let out = null;
sb.__OUT__ = o => { out = o; };
let confirmed = true, asked = null;
sb.confirm = msg => { asked = msg; return confirmed; };

const TAIL = `
;(function(){
  appData = __BOOK__;
  var jun = appData.dailySales['2026-5'];
  var snap = JSON.stringify(jun);

  vmStatement = vmParseStatement(__JUN__);
  var before = vmCompare(vmStatement);

  // What the whole month reads as, through the sales tax page, at each stage.
  var venmoQ = function () {
    var b = dsTaxReport(2026, 2).byChannel.venmo || { sales: 0, tax: 0, checkedTaxable: 0, derivedTax: 0 };
    return { sales: Math.round(b.sales*100)/100, tax: Math.round(b.tax*100)/100,
             checked: Math.round(b.checkedTaxable*100)/100,
             derived: Math.round(b.derivedTax*100)/100 }; };
  var qBefore = venmoQ();

  vmApplyAll();
  var afterWrite = vmCompare(vmStatement);
  var qAfterWrite = venmoQ();
  var stillThere = ['9','10'].map(function (d) {
    return jun[d] && jun[d].venmo ? jun[d].venmo.s : null; });

  // Refusing at the prompt must change nothing.
  __SET_CONFIRM__(false);
  vmClearOrphans();
  var afterRefuse = ['9','10'].map(function (d) {
    return jun[d] && jun[d].venmo ? jun[d].venmo.s : null; });
  var refuseAsked = __ASKED__();

  __SET_CONFIRM__(true);
  vmClearOrphans();
  var afterClear = vmCompare(vmStatement);
  var qAfterClear = venmoQ();
  var cleared = ['9','10'].map(function (d) {
    return jun[d] && jun[d].venmo ? jun[d].venmo.s : null; });

  // The rest of those days must survive -- only the Venmo figure goes.
  var day9 = jun['9'] ? Object.keys(jun['9']).sort() : null;

  // A day whose ONLY entry was Venmo should leave no empty day behind.
  appData.dailySales['2026-5']['28'] = { venmo: { s: 12, t: 1 } };
  vmClearDay('2026-06-28');
  var emptyDayGone = appData.dailySales['2026-5']['28'] === undefined;

  var clearMissing = vmClearDay('2026-06-05');   // no venmo on that day

  __OUT__({
    orphansBefore: before.orphans.map(function (o) { return o.date + ' $' + o.book; }),
    stillThereAfterWrite: stillThere,
    afterRefuse: afterRefuse, refuseAsked: refuseAsked,
    cleared: cleared,
    orphansAfter: afterClear.orphans.length,
    offAfter: afterClear.off.length, missingAfter: afterClear.missing.length,
    day9: day9,
    emptyDayGone: emptyDayGone,
    clearMissing: clearMissing,
    qBefore: qBefore, qAfterWrite: qAfterWrite, qAfterClear: qAfterClear,
    stmtSale: vmStatement.sale, stmtTax: vmStatement.tax,
    untouched: JSON.parse(snap)
  });
})();`;

vm.runInNewContext(src + TAIL, Object.assign(sb, {
  __BOOK__: j.appData, __JUN__: CSV('Jun'),
  __SET_CONFIRM__: v => { confirmed = v; },
  __ASKED__: () => asked
}), { filename: 'vm.js' });

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };
const o = out;

console.log('the gap: writing the statement does not clear what it is silent about');
t('June has two days Venmo never touched',
  o.orphansBefore.join(', ') === '2026-06-09 $105, 2026-06-10 $490', o.orphansBefore.join(', '));
t('and "write all" leaves them exactly where they were',
  o.stillThereAfterWrite[0] === 105 && o.stillThereAfterWrite[1] === 490,
  JSON.stringify(o.stillThereAfterWrite));

console.log('\nremoving them is its own act, and it asks first');
t('saying no changes nothing',
  o.afterRefuse[0] === 105 && o.afterRefuse[1] === 490, JSON.stringify(o.afterRefuse));
t('and the question names the days, the money and what it means',
  /2026-06-09/.test(o.refuseAsked) && /\$595\.00/.test(o.refuseAsked) &&
  /not Venmo/.test(o.refuseAsked), '$595.00 named: ' + /\$595\.00/.test(o.refuseAsked));
t('saying yes removes both', o.cleared[0] === null && o.cleared[1] === null);
t('and the book then agrees with the statement, day for day',
  o.orphansAfter === 0 && o.offAfter === 0 && o.missingAfter === 0,
  o.orphansAfter + ' orphans, ' + o.offAfter + ' off, ' + o.missingAfter + ' missing');

console.log('\nand it removes the Venmo figure only');
t('the rest of 9 June is untouched — the counter, phone and web takings stay',
  o.day9 && o.day9.indexOf('venmo') < 0 && o.day9.indexOf('counter') >= 0 &&
  o.day9.indexOf('phone') >= 0 && o.day9.indexOf('web') >= 0, (o.day9 || []).join(','));
t('a day that held nothing but Venmo leaves no empty day behind', o.emptyDayGone);
t('and a day with no Venmo on it is a no-op', o.clearMissing === false);

console.log('\nwhat the quarter reads as, at each stage');
console.log('      before:      $' + o.qBefore.sales + ' sales, $' + o.qBefore.tax + ' tax (all worked out)');
console.log('      written:     $' + o.qAfterWrite.sales + ' sales, $' + o.qAfterWrite.tax + ' tax');
console.log('      cleared:     $' + o.qAfterClear.sales + ' sales, $' + o.qAfterClear.tax + ' tax');
t('before, none of the tax was a recorded figure',
  o.qBefore.checked === 0 && o.qBefore.derived > 0, '$' + o.qBefore.derived + ' derived');
t('after, June is a recorded figure straight off the statement',
  o.qAfterClear.checked >= o.stmtSale, '$' + o.qAfterClear.checked + ' checkable');
t('and June\'s sales now equal what Venmo says it took',
  Math.abs((o.qAfterClear.sales - o.qAfterWrite.sales) + 595) < 0.02,
  '$595.00 came out');

console.log(fail.length ? '\n' + fail.length + ' FAILURES:\n' + fail.join('\n') : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
