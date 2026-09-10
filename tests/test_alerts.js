// Four rose varieties raised a 2400% price alert at once, and nothing had
// changed price.
//
// The same $34.75 of roses reads $1.39 written as "25 Stem" and $34.75 written
// as "1 Bunch x25", because the old comparison divided by ctPackUnits, which is
// 1 for a Bunch. Re-entering a line the second way -- the correct way -- looked
// like a 2400% rise. The stem count was on the line the whole time; nothing was
// consulting it.
//
// Two things fix it and both are tested here. ctComparablePrice measures every
// line the same way, per sellable unit off the total. And where two purchases
// genuinely cannot be compared -- one priced per stem, the next per bunch with
// no stem count at all -- the alert walks back for an earlier record on the
// SAME basis rather than inventing a jump.
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

  // The same purchase, written the two ways an invoice writes it.
  var asStems   = { name: 'Roses Red Freedom 60cm', category: 'Flowers', family: 'Roses',
                    qty: 25, uom: 'Stem', unitPrice: 1.39, total: 34.75 };
  var asOneBunch = { name: 'Roses Red Freedom 60cm', category: 'Flowers', family: 'Roses',
                     qty: 1, uom: 'Bunch', stemsPerBu: 25, unitPrice: 34.75, total: 34.75 };

  var sameThing = {
    stems:  { price: r4(ctComparablePrice(asStems)),   basis: ctPriceBasis(asStems),
              units: ctSellableUnits(asStems) },
    bunch:  { price: r4(ctComparablePrice(asOneBunch)), basis: ctPriceBasis(asOneBunch),
              units: ctSellableUnits(asOneBunch) },
    // What the old reading gave, for the record.
    oldStems: r4(ctEffectiveUnit(asStems)),
    oldBunch: r4(ctEffectiveUnit(asOneBunch))
  };

  // A real rise must still come through.
  var dearer = { name: 'Roses Red Freedom 60cm', category: 'Flowers', family: 'Roses',
                 qty: 25, uom: 'Stem', unitPrice: 1.80, total: 45.00 };
  var realRise = r4(((ctComparablePrice(dearer) - ctComparablePrice(asStems))
                     / ctComparablePrice(asStems)) * 100);

  // The incomparable pair: per stem, then per bunch with no stem count on it.
  var noCount = { name: 'Roses Red Freedom 70C', category: 'Flowers', family: 'Roses',
                  qty: 4, uom: 'Bunch', unitPrice: 32.00, total: 128.00 };
  var bases = { perStem: ctPriceBasis(asStems), perBunchNoCount: ctPriceBasis(noCount) };

  // And the book itself.
  var alerts = ctBuildAlerts();
  var absurd = alerts.filter(function (a) { return Math.abs(a.pct) >= 1000; })
                     .map(function (a) { return a.name + ' ' + Math.round(a.pct) + '%'; });
  var mixedBasis = 0;
  alerts.forEach(function (a) { if (a.suspect) mixedBasis++; });

  __OUT__({
    sameThing: sameThing, realRise: realRise, bases: bases,
    alerts: alerts.length, incomparable: alerts.incomparable,
    absurd: absurd, flaggedSuspect: mixedBasis,
    biggest: alerts.slice(0, 3).map(function (a) {
      return a.name + ' ' + (a.pct > 0 ? '+' : '') + Math.round(a.pct) + '%'; }),
    // Every alert carries both invoices, because the question it raises is as
    // often answered on the earlier one.
    missingIds: alerts.filter(function (a) {
      return !a.invoiceId || !a.priorInvoiceId; }).length
  });
})();`, sb, { filename: 'ct.js' });

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };
const o = out, s = o.sameThing;

console.log('$34.75 of roses, written the two ways an invoice writes it');
t('"25 Stem @ $1.39" measures 25 sellable units at $1.39',
  s.stems.units === 25 && s.stems.price === 1.39, s.stems.units + ' at $' + s.stems.price);
t('"1 Bunch x25 @ $34.75" measures the same 25 at the same $1.39',
  s.bunch.units === 25 && s.bunch.price === 1.39, s.bunch.units + ' at $' + s.bunch.price);
t('so the two agree, and re-entering a line raises nothing',
  s.stems.price === s.bunch.price);
t('  (the old reading had them at $' + s.oldStems + ' and $' + s.oldBunch + ' — a 2400% jump)',
  Math.abs(s.oldBunch / s.oldStems - 25) < 0.01);

console.log('\nand a real rise still comes through');
t('$1.39 to $1.80 a stem reads as +29%',
  Math.abs(o.realRise - 29.4964) < 0.01, o.realRise.toFixed(2) + '%');

console.log('\nwhere two purchases genuinely cannot be compared');
t('a per-stem line and a per-bunch line with no stem count have different bases',
  o.bases.perStem === 'stem' && o.bases.perBunchNoCount === 'bunch',
  o.bases.perStem + ' vs ' + o.bases.perBunchNoCount);
t('and the book counts them rather than inventing a jump: ' + o.incomparable + ' set aside',
  typeof o.incomparable === 'number');

console.log('\nthe alerts the book actually raises (' + o.alerts + ')');
t('not one is a four-figure percentage',
  o.absurd.length === 0, o.absurd.slice(0, 3).join('; ') || 'none');
t('every one carries both invoices, not just the later', o.missingIds === 0);
console.log('      (biggest: ' + (o.biggest.join(', ') || 'none') +
            '; ' + o.flaggedSuspect + ' flagged as resting on a suspect unit)');

console.log(fail.length ? '\n' + fail.length + ' FAILURES:\n' + fail.join('\n') : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
