// A cylinder showed a margin of -260%.
//
// The margin panel had its own reading of how many sellable things a line
// yields -- qty x stemsPerBu -- which is right for a bunch of flowers and
// nonsense for a vase. One cylinder at $36 became 25 cylinders, so the retail
// it was compared against was a twenty-fifth of the cost.
//
// ctSellableUnits is now the single answer, and it asks ctLineStems, which is
// the same function the counting screen uses. One reading, or the margin panel
// and the counting screen describe two different shops.
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

  var cases = {
    // The reported line. One vase is one thing to sell.
    cylinder: { name: 'Vase Cylinder Clear Glass 8"x4"H', category: 'Glass',
                qty: 1, uom: 'Each', unitPrice: 60.49, total: 60.49 },
    // A hard good bought several at a time is still counted in things.
    threeVases: { name: 'Wombat Vase', category: 'Glass',
                  qty: 3, uom: 'Each', unitPrice: 12, total: 36 },
    // A bunch of flowers yields stems.
    roses: { name: 'Roses Red Freedom', category: 'Flowers', family: 'Roses',
             qty: 2, uom: 'Bunch', stemsPerBu: 25, unitPrice: 32, total: 64 },
    // A family sold by the bunch yields BUNCHES, not stems -- that is the point
    // of answering the question.
    limonium: { name: 'Limonium Misty Pink', category: 'Flowers', family: 'Limonium',
                qty: 3, uom: 'Bunch', unitPrice: 10, total: 30 },
    // A box of twelve vases really is twelve things to sell. What the pack
    // question decides is whether that twelve is STEMS or BUNCHES for the
    // counting screen -- it must never change the COUNT, or answering it would
    // silently move the margin on every line in the family.
    packVases: { name: 'Wombat Boxed Vase', category: 'Glass',
                 qty: 1, uom: 'Box', stemsPerBu: 12, unitPrice: 60, total: 60 }
  };

  var read = function (it) {
    var units = ctSellableUnits(it);
    return { units: units,
             costEach: units ? Math.round((ctLineTotal(it) / units) * 10000) / 10000 : null,
             stems: ctLineStems(it) };
  };

  var seen = {};
  Object.keys(cases).forEach(function (k) { seen[k] = read(cases[k]); });

  // The pack answer must move the classification and not the count.
  var pv = cases.packVases;
  ctSetPackCounts(pv.name, 'stems');
  var asStems = read(pv);
  ctSetPackCounts(pv.name, 'bunches');
  var asBunches = read(pv);
  ctSetPackCounts(pv.name, '');
  var packAnswer = { asStems: asStems, asBunches: asBunches };

  // Nothing in the book should yield zero sellable units off a line that cost
  // money -- that is a divide-by-nothing and the shape the -260% came from.
  var zeroUnits = [];
  ctData.invoices.forEach(function (inv) { (inv.items || []).forEach(function (it) {
    if (!(ctLineTotal(it) > 0)) return;
    if (ctSellableUnits(it) <= 0) zeroUnits.push(it.name + ' (' + it.qty + ' ' + it.uom + ')');
  }); });

  // And the margin panel and the counting screen must agree line for line.
  var disagreements = [];
  ctData.invoices.forEach(function (inv) { (inv.items || []).forEach(function (it) {
    var s = ctLineStems(it);
    var expect = s.stems || s.bunches || (Number(it.qty) || 0);
    if (ctSellableUnits(it) !== expect) disagreements.push(it.name);
  }); });

  __OUT__({ seen: seen, packAnswer: packAnswer, zeroUnits: zeroUnits, disagreements: disagreements,
            lines: ctData.invoices.reduce(function (n, inv) {
              return n + (inv.items || []).length; }, 0) });
})();`, sb, { filename: 'ct.js' });

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };
const o = out, s = o.seen;

console.log('the reported line: one cylinder, $60.49');
t('is one thing to sell, not twenty-five', s.cylinder.units === 1, s.cylinder.units + ' units');
t('so it costs $60.49 each, and the margin is against that',
  s.cylinder.costEach === 60.49, '$' + s.cylinder.costEach);

console.log('\nand the other shapes a line comes in');
t('three vases are three things', s.threeVases.units === 3 && s.threeVases.costEach === 12,
  s.threeVases.units + ' at $' + s.threeVases.costEach);
t('two bunches of 25 roses are 50 stems', s.roses.units === 50 && s.roses.costEach === 1.28,
  s.roses.units + ' at $' + s.roses.costEach);
t('but limonium, sold by the bunch, is 3 bunches — not stems',
  s.limonium.units === 3 && s.limonium.costEach === 10,
  s.limonium.units + ' at $' + s.limonium.costEach);
t('a box of twelve is twelve things to sell, at $5 each',
  s.packVases.units === 12 && s.packVases.costEach === 5,
  s.packVases.units + ' at $' + s.packVases.costEach);
t('and the pack answer moves the classification, never the count',
  o.packAnswer.asStems.units === 12 && o.packAnswer.asBunches.units === 12 &&
  o.packAnswer.asStems.stems.stems === 12 && o.packAnswer.asBunches.stems.bunches === 12,
  'stems ' + o.packAnswer.asStems.units + ', bunches ' + o.packAnswer.asBunches.units);

console.log('\nacross the whole book (' + o.lines + ' lines)');
t('no line that cost money yields nothing to sell',
  o.zeroUnits.length === 0, o.zeroUnits.slice(0, 3).join('; ') || 'none');
t('and the margin panel agrees with the counting screen on every line',
  o.disagreements.length === 0, o.disagreements.slice(0, 3).join('; ') || 'none');

console.log(fail.length ? '\n' + fail.length + ' FAILURES:\n' + fail.join('\n') : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
