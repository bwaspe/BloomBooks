// A quantity that contradicts its own line total.
//
// Perri's invoice has four columns where the parser expects two: Qty, UofM,
// Pack and Units. Qty is the number of PACKS -- 1 box, 4 bunches -- and Units
// is the real count. The extraction prompt asks for "qty", so Claude reads the
// column headed Qty, which is the honest answer to the question asked and the
// wrong number. A bunch of roses came through as 1 stem, four bunches of red
// as 4, a box of sixteen bunches of alstroemeria as 1. Fixed by hand every
// week since the scanner was built.
//
// The figures below are the real 5 October 2026 invoice, which is the point:
// every one of them resolves to a whole number exactly.
const F = require('./fixtures');
const vm = require('vm');

function app() {
  const sb = F.sandbox({ setTimeout: () => 0 });
  sb.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  vm.createContext(sb);
  vm.runInContext(F.src(['config.js', 'utils.js', 'ledger.js', 'cost-tracker.js']), sb, { filename: 'bb.js' });
  return sb;
}

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };

const sb = app();
const clean = items => sb.ctCleanItems(items);

console.log("Perri's Qty column, as it really arrives");
{
  // Qty / UofM / Pack / Units / Price / Total, with Claude reading Qty.
  const got = clean([
    { name: 'Roses Lavender Moody Blues PR', qty: 1, uom: 'Stem', unit_price: 1.39, total: 34.75 },
    { name: 'Roses Red Freedom Premium 60C', qty: 4, uom: 'Stem', unit_price: 1.28, total: 128.00 },
    { name: 'Alstroemeria Assortment Perfection Box PK 16', qty: 1, uom: 'Bunch', unit_price: 7.67, total: 122.72 },
    { name: 'Pompon CDN Assortment Box PK', qty: 1, uom: 'Bunch', unit_price: 3.58, total: 64.44 },
    { name: 'Lemon Leaf Box Packed 20', qty: 1, uom: 'Bunch', unit_price: 8.49, total: 169.80 }
  ]);
  t('a bunch of roses becomes 25 stems, not 1', got[0].qty === 25, got[0].qty);
  t('four bunches of red become 100 stems', got[1].qty === 100, got[1].qty);
  t('a box of alstroemeria becomes 16 bunches', got[2].qty === 16, got[2].qty);
  t('the CDN box becomes 18', got[3].qty === 18, got[3].qty);
  t('and the lemon leaf box 20', got[4].qty === 20, got[4].qty);

  // Kept, so the review card can say what moved rather than quietly differing
  // from the paper in front of whoever is checking it.
  t('each one records what it was', got.every(i => i._qtyWas === 1 || i._qtyWas === 4),
    JSON.stringify(got.map(i => i._qtyWas)));
  t('and that the total is where it came from', got.every(i => i._qtyFrom === 'total'));

  // The money is never touched: it is the one figure on a scan that reconciles.
  t('no line total is altered',
    got[0].total === 34.75 && got[1].total === 128 && got[2].total === 122.72);
  t('and no price', got[0].unit_price === 1.39 && got[1].unit_price === 1.28);
}

console.log('\nlines that already agree are left alone');
{
  const got = clean([
    { name: 'Aster Purple Carnival/Mardi G', qty: 3, uom: 'Bunch', unit_price: 8.69, total: 26.07 },
    { name: 'Hydrangea Blue Select', qty: 10, uom: 'Stem', unit_price: 1.81, total: 18.10 },
    { name: 'Curly Willow Tips', qty: 2, uom: 'Bunch', unit_price: 10.98, total: 21.96 },
    { name: 'Balloon Mylar 18" Happy Anniversary', qty: 1, uom: 'Each', unit_price: 5.49, total: 5.49 }
  ]);
  t('three bunches of aster stay three', got[0].qty === 3, got[0].qty);
  t('ten stems of hydrangea stay ten', got[1].qty === 10);
  t('two bunches of willow stay two', got[2].qty === 2);
  t('one balloon stays one', got[3].qty === 1);
  t('and none of them is marked as moved', got.every(i => i._qtyWas === undefined));
}

console.log('\na discount is not a wrong quantity');
{
  // The other direction entirely: the total is BELOW qty x price because money
  // was taken off. Rewriting the quantity there would destroy a real discount
  // -- the deepest in the book is 39.5%.
  const got = clean([
    { name: 'Rose Freedom', qty: 100, uom: 'Stem', unit_price: 1.28, total: 115.20 },   // 10% off
    { name: 'Deep discount', qty: 50, uom: 'Stem', unit_price: 2.00, total: 60.50 }     // 39.5% off
  ]);
  t('a 10% discount leaves the quantity alone', got[0].qty === 100, got[0].qty);
  t('and so does a deep one', got[1].qty === 50, got[1].qty);
  t('neither is marked as repaired', got.every(i => i._qtyWas === undefined));
}

console.log('\nand it refuses to guess');
{
  // A fractional answer means something else is going on -- a surcharge folded
  // into the line, a misread price -- and a guess would be worse than the
  // number that came in.
  const got = clean([
    { name: 'Odd one', qty: 1, uom: 'Stem', unit_price: 1.39, total: 40.00 },      // 28.77...
    { name: 'No price', qty: 1, uom: 'Stem', unit_price: 0, total: 34.75 },
    { name: 'No total', qty: 1, uom: 'Stem', unit_price: 1.39, total: 0 },
    { name: 'Negative', qty: 1, uom: 'Stem', unit_price: 1.39, total: -34.75 }
  ]);
  t('a quantity that does not divide out is left as it came', got[0].qty === 1, got[0].qty);
  t('no price, no repair', got[1].qty === 1);
  t('no total, no repair', got[2].qty === 1);
  t('a credit line is left alone', got[3].qty === 1);
  t('and none of them claims to have been repaired', got.every(i => i._qtyWas === undefined));
}

console.log('\nthe whole invoice still adds up afterwards');
{
  // The repair must not move the money. If the lines summed to the invoice
  // before, they sum to it after.
  const lines = [
    { name: 'Roses Lavender', qty: 1, uom: 'Stem', unit_price: 1.39, total: 34.75 },
    { name: 'Roses Red', qty: 4, uom: 'Stem', unit_price: 1.28, total: 128.00 },
    { name: 'Alstroemeria', qty: 1, uom: 'Bunch', unit_price: 7.67, total: 122.72 },
    { name: 'Aster Purple', qty: 3, uom: 'Bunch', unit_price: 8.69, total: 26.07 }
  ];
  const before = lines.reduce((s, i) => s + i.total, 0);
  const after = clean(lines).reduce((s, i) => s + i.total, 0);
  t('the line totals are identical', Math.abs(before - after) < 0.005,
    before.toFixed(2) + ' -> ' + after.toFixed(2));
}

console.log(fail.length ? '\n' + fail.length + ' FAILED' : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
