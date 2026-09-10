// The margin tracker suggested $0.09 retail on a carnation costing $0.59 a stem.
//
// Perri price carnations and roses PER STEM while recording one BUNCH, so
// "1 Bunch / x25 / $0.59 / $14.75" has a price column that is already per stem.
// Dividing it by the stem count ran the division twice: $0.59 became $0.0236,
// and at a 4x markup that is the $0.09 the owner was looking at.
//
// The fix takes the cost off the TOTAL, which is what the invoice actually
// charged and is therefore sound whichever convention the price column follows.
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
  var r4 = function (n) { return Math.round(n * 10000) / 10000; };

  // The reported line, exactly as it appears.
  var carnation = { name: 'Carnations Pink Sun Touched', category: 'Flowers',
                    family: 'Carnation', qty: 1, uom: 'Bunch', stemsPerBu: 25,
                    unitPrice: 0.59, total: 14.75 };

  // A genuinely per-BUNCH line, where both readings must agree: $8.50 for a
  // bunch of ten is 85c a stem whichever way it is read.
  var perBunch = { name: 'Wombat Flower', category: 'Flowers', family: 'Wombat',
                   qty: 1, uom: 'Bunch', stemsPerBu: 10,
                   unitPrice: 8.50, total: 8.50 };

  // No total at all -- the convention is then genuinely unknowable and the
  // price column is the only thing there is.
  var noTotal = { name: 'Wombat Flower', category: 'Flowers', family: 'Wombat',
                  qty: 1, uom: 'Bunch', stemsPerBu: 10, unitPrice: 8.50 };

  var markup = ctData.markup['Flowers'];

  __OUT__({
    markup: markup,
    carnation: { perStem: r4(ctPerStemCost(carnation)),
                 retail:  r4(ctSuggestedRetail(carnation)),
                 isPerStem: ctIsPerStem(carnation),
                 theOldWrongWay: r4((carnation.unitPrice / carnation.stemsPerBu) * markup) },
    perBunch:  { perStem: r4(ctPerStemCost(perBunch)),
                 retail:  r4(ctSuggestedRetail(perBunch)),
                 fromPrice: r4(perBunch.unitPrice / perBunch.stemsPerBu) },
    noTotal:   { perStem: r4(ctPerStemCost(noTotal)) },
    // Not per-stem at all: a vase is priced as invoiced.
    hardGood:  (function () {
      var v = { name: 'Vase Cylinder Clear Glass 8"x4"H', category: 'Glass',
                qty: 1, uom: 'Each', unitPrice: 60.49, total: 60.49 };
      return { isPerStem: ctIsPerStem(v), perStem: r4(ctPerStemCost(v)),
               retail: r4(ctSuggestedRetail(v)), markup: ctData.markup['Glass'] };
    })(),
    // And across the whole book: no flower line should suggest a retail below
    // a penny. That is the shape of the bug, whatever caused it.
    absurd: (function () {
      var bad = [];
      ctData.invoices.forEach(function (inv) { (inv.items || []).forEach(function (it) {
        if ((it.category || '') !== 'Flowers') return;
        if (!ctIsPerStem(it)) return;
        var rt = ctSuggestedRetail(it);
        if (rt > 0 && rt < 0.01) bad.push(it.name + ' -> ' + rt.toFixed(4));
      }); });
      return bad;
    })(),
    perStemLines: (function () {
      var n = 0;
      ctData.invoices.forEach(function (inv) { (inv.items || []).forEach(function (it) {
        if ((it.category || '') === 'Flowers' && ctIsPerStem(it)) n++; }); });
      return n;
    })()
  });
})();`, sb, { filename: 'ct.js' });

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };
const o = out;

console.log('the reported line: 1 Bunch x25 @ $0.59, total $14.75, markup ' + o.markup + 'x');
t('the cost comes off the total, so a stem is 59 cents',
  o.carnation.perStem === 0.59, '$' + o.carnation.perStem);
t('and the suggested retail is $2.36, not $0.09',
  o.carnation.retail === 2.36, '$' + o.carnation.retail);
t('  ($0.09 being what dividing twice gives)',
  Math.abs(o.carnation.theOldWrongWay - 0.0944) < 0.0001, '$' + o.carnation.theOldWrongWay);

console.log('\na genuinely per-bunch line — both readings have to agree here');
t('$8.50 a bunch of ten is 85c a stem', o.perBunch.perStem === 0.85, '$' + o.perBunch.perStem);
t('which is what the price column alone gives too',
  o.perBunch.perStem === o.perBunch.fromPrice);
t('and the retail follows', o.perBunch.retail === 3.4, '$' + o.perBunch.retail);

console.log('\nand where there is no total the price column is all there is');
t('it falls back rather than returning nothing', o.noTotal.perStem === 0.85, '$' + o.noTotal.perStem);

console.log('\na hard good is priced as invoiced, not per stem');
t('a cylinder is not a per-stem line', !o.hardGood.isPerStem);
t('its cost is the price', o.hardGood.perStem === 60.49, '$' + o.hardGood.perStem);
t('and its retail is the price at the Glass markup',
  o.hardGood.retail === 60.49 * o.hardGood.markup,
  '$' + o.hardGood.retail + ' at ' + o.hardGood.markup + 'x');

console.log('\nand across the whole book (' + o.perStemLines + ' per-stem flower lines)');
t('not one suggests a retail under a penny',
  o.absurd.length === 0, o.absurd.slice(0, 3).join('; ') || 'none');

console.log(fail.length ? '\n' + fail.length + ' FAILURES:\n' + fail.join('\n') : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
