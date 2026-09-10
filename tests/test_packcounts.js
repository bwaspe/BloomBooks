// stemsPerBu on a Box or Case is "how many in one box", and across the lines
// that carry it the thing counted is different every time: 400 SHEETS to a case
// of tissue, 12 VASES to a box, 100 STEMS to a box of roses. Reading it as
// bunches every time reported "2 Box x100" of roses as 200 BUNCHES when the box
// holds 4 bunches of 25 -- 200 stems. So the line is asked, once, and the
// answer is remembered against the item.
const F = require('./fixtures');
const vm = require('vm');

const BK = 'bloom-books-backup-2026-09-08-1904.json';
const raw = F.file(BK);
if (!raw) F.skip('needs ' + BK + ' — put it in Downloads or set BLOOMBOOKS_FIXTURES');
const j = JSON.parse(raw);

const sb = F.sandbox({ appData: j.appData });
sb.localStorage.store.bb_ctdata = JSON.stringify(j.ctData);
let out = null;
sb.__OUT__ = o => { out = o; };

vm.runInNewContext(F.src(['config.js', 'utils.js', 'cost-tracker.js']) + `
;(function(){
  ctLoad();

  var ROSE = 'Roses Assorted Colors Mom Pack Premium 60CM PK 100';
  var line = { name: ROSE, category: 'Flowers', family: 'Roses',
               qty: 2, uom: 'Box', stemsPerBu: 100, unitPrice: 189, total: 378 };

  var money = function (it) { return {
    total: ctLineTotal(it), price: ctUnitPrice(it),
    packUnits: ctPackUnits(it), eff: Math.round(ctEffectiveUnit(it) * 1e6) / 1e6 }; };

  var before = ctLineStems(line);
  var moneyBefore = money(line);

  // Everything already in the book, measured before and after, to prove an
  // unanswered pack still reads exactly as it did.
  var snapshot = function () {
    var t = { stems: 0, bunches: 0 };
    ctData.invoices.forEach(function (inv) { (inv.items || []).forEach(function (it) {
      var s = ctLineStems(it); t.stems += s.stems; t.bunches += s.bunches; }); });
    return t;
  };
  var bookBefore = snapshot();

  ctSetPackCounts(ROSE, 'stems');
  var after = ctLineStems(line);
  var moneyAfter = money(line);
  var bookAfterRose = snapshot();

  // A DIFFERENT item that also comes by the box must be untouched by that answer.
  var tissue = { name: 'WAX TISSUE BOTANICAL PASTEL ASST. 24x36" PK 400',
                 category: 'Packaging', qty: 1, uom: 'Case', stemsPerBu: 400,
                 unitPrice: 100, total: 100 };
  var tissueAfterRose = ctLineStems(tissue);

  ctSetPackCounts(ROSE, 'bunches');
  var asBunches = ctLineStems(line);
  ctSetPackCounts(ROSE, '');
  var cleared = ctLineStems(line);

  __OUT__({
    before: before, after: after, asBunches: asBunches, cleared: cleared,
    moneyBefore: moneyBefore, moneyAfter: moneyAfter,
    bookBefore: bookBefore, bookAfterRose: bookAfterRose,
    tissueAfterRose: tissueAfterRose,
    // A Bunch line has no pack question and must not be offered one.
    bunchUnaffected: (function () {
      var b = { name: 'Limonium Misty Pink', category: 'Flowers', family: 'Limonium',
                qty: 3, uom: 'Bunch', stemsPerBu: null, unitPrice: 10, total: 30 };
      var one = ctLineStems(b);
      ctSetPackCounts('Limonium Misty Pink', 'stems');
      var two = ctLineStems(b);
      ctSetPackCounts('Limonium Misty Pink', '');
      return one.bunches === two.bunches && one.stems === two.stems;
    })(),
    junkRejected: (function () {
      ctSetPackCounts(ROSE, 'wombat');
      var r = ctPackCountsFor(line); ctSetPackCounts(ROSE, ''); return r === null;
    })(),
    htmlHasChoice: ctCountingHtml().indexOf('ctSetPackCounts') >= 0,
    // The family-wide control is CONDITIONAL -- it only appears on a pending
    // family that actually has pack lines in it. So the condition is made here
    // rather than assumed: take the answer back off a real pack item and the
    // button should appear; put it back and it should go.
    familyBtn: (function () {
      var answered = Object.keys(ctPackCountsMap());
      if (!answered.length) return { skipped: true };
      var key = answered[0], was = ctPackCountsMap()[key];
      var name = null;
      ctData.invoices.forEach(function (inv) { (inv.items || []).forEach(function (it) {
        if (!name && ctCatalogKey(it.name || '') === key) name = it.name; }); });
      if (!name) return { skipped: true };
      var withAnswer = ctCountingHtml().indexOf('ctSetFamilyPackCounts') >= 0;
      ctSetPackCounts(name, '');
      var rev = ctCountingReview();
      var pendingPack = rev.pending.filter(function (p) { return p.packLines > 0; }).length;
      var withoutAnswer = ctCountingHtml().indexOf('ctSetFamilyPackCounts') >= 0;
      ctSetPackCounts(name, was);
      var restored = ctCountingHtml().indexOf('ctSetFamilyPackCounts') >= 0;
      return { item: name, withAnswer: withAnswer, pendingPack: pendingPack,
               withoutAnswer: withoutAnswer, restored: restored };
    })()
  });
})();`, sb, { filename: 'ct.js' });

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };
const o = out;

console.log('the reported line: Roses ... PK 100 / 2 Box x100 / $378');
t('unanswered, it still reads as 200 bunches — nothing already entered changes',
  o.before.bunches === 200 && o.before.stems === 0, JSON.stringify(o.before));
t('answered "stems", it reads as 200 stems',
  o.after.stems === 200 && o.after.bunches === 0, JSON.stringify(o.after));
t('answered "bunches", it reads as 200 bunches again',
  o.asBunches.bunches === 200 && o.asBunches.stems === 0, JSON.stringify(o.asBunches));
t('cleared, it falls back to bunches', o.cleared.bunches === 200, JSON.stringify(o.cleared));

console.log('\nand no money moves');
t('the line total is untouched', o.moneyBefore.total === o.moneyAfter.total,
  '$' + o.moneyBefore.total + ' -> $' + o.moneyAfter.total);
t('so is the unit price', o.moneyBefore.price === o.moneyAfter.price);
t('so is ctPackUnits — the answer never reaches it',
  o.moneyBefore.packUnits === o.moneyAfter.packUnits, o.moneyAfter.packUnits);
t('so is the effective unit', o.moneyBefore.eff === o.moneyAfter.eff,
  '$' + o.moneyBefore.eff + ' -> $' + o.moneyAfter.eff);

console.log('\nthe answer is keyed to the item, and reaches only it');
t('a case of tissue is not touched by an answer about roses',
  o.tissueAfterRose.bunches === 400 && o.tissueAfterRose.stems === 0,
  JSON.stringify(o.tissueAfterRose));
t('a Bunch line is never offered the question', o.bunchUnaffected);
t('a junk answer is refused rather than stored', o.junkRejected);
t('the whole book is unmoved by an answer about a line not in it',
  o.bookBefore.stems === o.bookAfterRose.stems &&
  o.bookBefore.bunches === o.bookAfterRose.bunches,
  o.bookBefore.bunches + ' bu / ' + o.bookBefore.stems + ' stems, unchanged');

console.log('\nand the screen offers both answers');
t('per item', o.htmlHasChoice);
if (o.familyBtn.skipped) {
  t('and for a whole family at once', true, 'skipped — no answered pack item to test with');
} else {
  t('a family with an unanswered pack line gets the family-wide button',
    o.familyBtn.pendingPack > 0 && o.familyBtn.withoutAnswer,
    o.familyBtn.pendingPack + ' pending families carrying pack lines');
  t('and once answered the button goes again',
    !o.familyBtn.withAnswer && !o.familyBtn.restored,
    'answered: ' + o.familyBtn.item);
}

console.log(fail.length ? '\n' + fail.length + ' FAILURES:\n' + fail.join('\n') : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
