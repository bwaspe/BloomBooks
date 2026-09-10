const F = require('./fixtures');
// Venmo's statement carries a real per-sale tax figure -- it charged it and
// itemised it -- which is what makes these days worth importing rather than
// deriving. Three real statements, checked row by row.
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

const TAIL = `
;(function(){
  appData = __BOOK__;
  var months = { Jun: __JUN__, Jul: __JUL__, Aug: __AUG__ };
  var parsed = {}, cmp = {};
  Object.keys(months).forEach(function (m) {
    parsed[m] = vmParseStatement(months[m]);
    vmStatement = parsed[m];
    cmp[m] = vmCompare(parsed[m]);
  });

  // Every card row should land on an exact round dollar. That is what confirms
  // "total is net of the fee" is the right reading of the column.
  var cards = [], notRound = [];
  Object.keys(parsed).forEach(function (m) {
    parsed[m].rows.forEach(function (r) {
      if (r.basis !== 'itemised') return;
      cards.push(r.sale);
      if (Math.abs(r.sale - Math.round(r.sale)) > 0.005) notRound.push(m + ' ' + r.date + ' ' + r.sale);
    });
  });

  var taxOff = parsed.Jul.rows.filter(function (r) {
    return r.basis === 'itemised' &&
           Math.abs(r.tax - Math.round(r.sale * DS_TAX_RATE * 100) / 100) > 0.011; });

  // Write a month, then read it back through the sales-tax report.
  vmStatement = parsed.Jul;
  var beforeVen = dsTaxReport(2026, 2).byChannel.venmo;
  vmApplyAll();
  var afterVen = dsTaxReport(2026, 2).byChannel.venmo;
  var julyCell = vmDayCell('2026-07-12');

  __OUT__({
    counts: { Jun: parsed.Jun.rows.length, Jul: parsed.Jul.rows.length, Aug: parsed.Aug.rows.length },
    skipped: parsed.Jun.skipped,
    julSale: parsed.Jul.sale, julTax: parsed.Jul.tax,
    cards: cards.length, notRound: notRound, taxOff: taxOff.length,
    refund: parsed.Jun.rows.filter(function (r) { return r.refund; })
              .map(function (r) { return { sale: r.sale, tax: r.tax }; }),
    inclusive: parsed.Jun.rows.filter(function (r) { return r.basis === 'inclusive' && !r.refund; })
              .map(function (r) { return r.total + '->' + r.sale; }),
    junCompare: {
      off: cmp.Jun.off.map(function (r) { return r.date + ' book $' + r.book + ' vs $' + r.day.sale; }),
      orphans: cmp.Jun.orphans.map(function (o) { return o.date + ' $' + o.book; }),
      missing: cmp.Jun.missing.length },
    julCompare: { off: cmp.Jul.off.length, orphans: cmp.Jul.orphans.length, missing: cmp.Jul.missing.length },
    augCompare: { off: cmp.Aug.off.length, orphans: cmp.Aug.orphans.length, missing: cmp.Aug.missing.length },
    julyCell: julyCell,
    venBefore: { derived: Math.round(beforeVen.derivedTax * 100) / 100,
                 checked: Math.round(beforeVen.checkedTaxable * 100) / 100 },
    venAfter: { derived: Math.round(afterVen.derivedTax * 100) / 100,
                checked: Math.round(afterVen.checkedTaxable * 100) / 100 },
    csvQuoting: vmParseCsv('a,"b,c","he said ""hi""",d')[0],
    money: [vmMoney('+ $26.38'), vmMoney('- $1.08'), vmMoney('0.71'), vmMoney(''), vmMoney('$0.20')],
    junkRejected: vmParseStatement('some,random' + String.fromCharCode(10) + 'file,here') === null,
    looksLike: [vmLooksLikeVenmo(months.Jun), vmLooksLikeVenmo('hello world')]
  });
})();`;

vm.runInNewContext(src + TAIL,
  Object.assign(sb, { __BOOK__: j.appData, __JUN__: CSV('Jun'), __JUL__: CSV('Jul'), __AUG__: CSV('Aug') }),
  { filename: 'vm.js' });

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };
const o = out;

console.log('reading three real statements');
t('every sale row is found and nothing else is',
  o.counts.Jun === 21 && o.counts.Jul === 12 && o.counts.Aug === 6, JSON.stringify(o.counts));
t('transfers between your own accounts are ignored',
  JSON.stringify(o.skipped).indexOf('Transfer') >= 0, JSON.stringify(o.skipped));
t('a quoted comma does not become a column',
  o.csvQuoting.length === 4 && o.csvQuoting[1] === 'b,c' && o.csvQuoting[2] === 'he said "hi"',
  JSON.stringify(o.csvQuoting));
t('"+ $26.38", "- $1.08" and a bare number all read correctly',
  JSON.stringify(o.money) === JSON.stringify([26.38, -1.08, 0.71, 0, 0.2]), JSON.stringify(o.money));
t('a file that is not a Venmo statement is refused',
  o.junkRejected && o.looksLike[0] && !o.looksLike[1]);

console.log('\nthe card rows — the reading is confirmed by where they land');
t('all ' + o.cards + ' card sales come out at an exact round dollar',
  o.notRound.length === 0, o.notRound.slice(0, 3).join('; ') || 'none off');
t('and Venmo\'s own tax figure is the rate on that sale', o.taxOff === 0);

console.log('\nthe rows Venmo did not tax');
t('a stem paid for by Venmo is read as tax-inclusive',
  o.inclusive.slice(0, 3).join(', ') === '5.42->5, 5.42->5, 6.5->6', o.inclusive.slice(0, 3).join(', '));
t('a refund reverses the sale AND its tax',
  o.refund.length === 1 && o.refund[0].sale === -1 && o.refund[0].tax === -0.08, JSON.stringify(o.refund));

console.log('\nagainst what is already in the day book');
t('July matches to the cent',
  o.julCompare.off === 0 && o.julCompare.missing === 0 && o.julCompare.orphans === 0,
  JSON.stringify(o.julCompare));
t('so does August',
  o.augCompare.off === 0 && o.augCompare.missing === 0 && o.augCompare.orphans === 0,
  JSON.stringify(o.augCompare));
t('June does NOT — days recorded as Venmo with no Venmo behind them are named',
  o.junCompare.orphans.length === 2, o.junCompare.orphans.join(', '));
t('as are the days recorded at a different figure',
  o.junCompare.off.length >= 2, o.junCompare.off.join('; '));

console.log('\nwriting it, and reading it back through the sales tax page');
// $15.90, not the $15.91 the rate on $190 would give: the tax is the sum of
// what Venmo charged on each of the six sales, which is the point of importing
// it rather than working it out.
t('the day lands with sale, tax and taxable base',
  o.julyCell && o.julyCell.s === 190 && o.julyCell.t === 15.90 && o.julyCell.x === 190,
  JSON.stringify(o.julyCell));
t('and that tax is a real figure, not the rate applied to the day',
  Math.abs(o.julyCell.t - 190 * 0.08375) > 0.005 && Math.abs(o.julyCell.t - 190 * 0.08375) < 0.05,
  '$' + o.julyCell.t + ' charged vs $' + (190 * 0.08375).toFixed(4) + ' computed');
t('before, Venmo tax was worked out from the total',
  o.venBefore.derived > 0 && o.venBefore.checked === 0, '$' + o.venBefore.derived + ' derived');
t('after, it is a recorded figure the page can actually check',
  o.venAfter.checked >= 190 && o.venAfter.derived < o.venBefore.derived,
  '$' + o.venAfter.checked + ' checkable, $' + o.venAfter.derived + ' still derived');

console.log(fail.length ? '\n' + fail.length + ' FAILURES:\n' + fail.join('\n') : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
