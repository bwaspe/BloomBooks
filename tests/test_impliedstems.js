const F = require('./fixtures');
// Perri price roses per STEM and put the number of BUNCHES in the quantity
// column, so a line reads "1 Stem @ $1.39" with a total of $34.75. Read
// literally that is one stem -- and a Mother's Day upload of forty rose lines
// comes in as 1s and 2s instead of 25s and 50s.
const fs = require('fs'), vm = require('vm');
const BK = 'bloom-books-backup-2026-09-02-1936.json';
const __raw = F.file(BK);
if (!__raw) F.skip('needs ' + BK + ' — put it in Downloads or set BLOOMBOOKS_FIXTURES');
const j = JSON.parse(__raw);
const src = fs.readFileSync(F.APP + '/cost-tracker.js', 'utf8');
const el = () => ({ innerHTML: '', value: '', options: { length: 0 }, style: {},
                    classList: { add(){}, remove(){} }, appendChild(){},
                    addEventListener(){}, querySelectorAll: () => [], getContext: () => ({}) });
const sb = { appData: j.appData, console, notify: () => {}, saveData: () => {}, switchPanel: () => {},
  escHtml: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
  fmt: n => '$' + Number(n).toFixed(2),
  Chart: function () { return { destroy() {} }; }, easterSunday: y => new Date(Date.UTC(y, 3, 5)),
  document: { getElementById: () => null, querySelector: () => null,
              querySelectorAll: () => [], createElement: el },
  localStorage: { store: { bb_ctdata: JSON.stringify(j.ctData) },
                  getItem(k) { return this.store[k] || null; },
                  setItem(k, v) { this.store[k] = v; } } };
sb.window = sb;
let out = null; sb.__OUT__ = o => { out = o; };

vm.runInNewContext(src + `
;(function(){
  ctLoad();
  const C = o => Object.assign({ name: 'Roses Red Freedom 60cm', category: 'Flowers',
                                 family: 'Roses', uom: 'Stem', qty: 1 }, o);

  const cases = {
    perri25:  ctImpliedStemsPerBunch(C({ unitPrice: 1.39, total: 34.75 })),
    perri50:  ctImpliedStemsPerBunch(C({ qty: 2, unitPrice: 1.39, total: 69.50 })),
    realOne:  ctImpliedStemsPerBunch(C({ unitPrice: 1.39, total: 1.39 })),
    real25:   ctImpliedStemsPerBunch(C({ qty: 25, unitPrice: 1.39, total: 34.75 })),
    already:  ctImpliedStemsPerBunch(C({ unitPrice: 1.39, total: 34.75, stemsPerBu: 10 })),
    notExact: ctImpliedStemsPerBunch(C({ unitPrice: 1.39, total: 34.60 })),
    hardGood: ctImpliedStemsPerBunch(C({ category: 'Glass', unitPrice: 3, total: 36 })),
    bunchUom: ctImpliedStemsPerBunch(C({ uom: 'Bunch', unitPrice: 1.39, total: 34.75 })),
    huge:     ctImpliedStemsPerBunch(C({ unitPrice: 0.01, total: 35 })),
    zeroCost: ctImpliedStemsPerBunch(C({ unitPrice: 0, total: 35 })),
    noTotal:  ctImpliedStemsPerBunch(C({ unitPrice: 1.39 }))
  };

  // End to end: the line as it arrives, then as the card prepares it.
  const raw = C({ unitPrice: 1.39, total: 34.75 });
  const before = { stems: ctLineStems(raw).stems, issues: ctLineIssues(raw).length };
  const prepared = Object.assign({}, raw,
    { stemsPerBu: raw.stemsPerBu || ctImpliedStemsPerBunch(raw) || null });
  const after = {
    per: prepared.stemsPerBu,
    stems: ctLineStems(prepared).stems,
    total: ctLineTotal(prepared),
    price: ctUnitPrice(prepared),
    warned: ctLineIssues(prepared).some(i => /Counted in bunches/.test(i.text)),
    warnText: (ctLineIssues(prepared).find(i => /Counted in bunches/.test(i.text)) || {}).text
  };

  // The two faults that wear the same shape. Calling both "the price is per
  // bunch" was wrong: on the owner's real line the price column says $1.29,
  // which is plainly a stem price -- the total simply does not match either
  // reading, and the total is the sound figure.
  const M = it => (ctLineIssues(it).find(x => x.fixUom) || {}).text || '';
  const messages = {
    pricePerBunch: M(C({ qty: 4, stemsPerBu: 25, unitPrice: 32.00, total: 128.00 })),
    neitherFits:   M(C({ qty: 4, stemsPerBu: 25, unitPrice: 1.29,  total: 128.00 }))
  };

  // The false positive the owner caught. Fifty stems at $1.55 is $77.50 --
  // internally consistent, and $1.55 is plainly a stem price. It was flagged
  // because a stems-per-bunch had been carried over from an earlier invoice of
  // the same rose, and the first rule looked only at the arithmetic.
  const suspect = {
    fiftyStems: ctSuspectStemUnit(C({ qty: 50, stemsPerBu: 25, unitPrice: 1.55, total: 77.50 })),
    fourAt129:  ctSuspectStemUnit(C({ qty: 4,  stemsPerBu: 25, unitPrice: 1.29, total: 128.00 })),
    fourAt32:   ctSuspectStemUnit(C({ qty: 4,  stemsPerBu: 25, unitPrice: 32.00, total: 128.00 })),
    noHistory:  ctSuspectStemUnit(C({ family: 'Wombat Flower', qty: 4, stemsPerBu: 25,
                                      unitPrice: 32.00, total: 128.00 })),
    roseMedian: ctFamilyStemCost('Roses')
  };

  __OUT__({ cases: cases, before: before, after: after, messages: messages, suspect: suspect });
})();`, sb, { filename: 'ct.js' });

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log(`  ${c ? 'PASS' : 'FAIL'}  ${l}${d !== undefined ? '  [' + d + ']' : ''}`); };
const o = out, C = o.cases;

console.log('the number comes out of the line\'s own arithmetic');
t('"1 Stem @ $1.39, $34.75" implies 25 a bunch', C.perri25 === 25, C.perri25);
t('"2 Stem @ $1.39, $69.50" implies 25 as well', C.perri50 === 25, C.perri50);

console.log('\nand it refuses everything it is not sure about');
t('a genuine single stem is left alone', C.realOne === 0);
t('a line already counted in stems is left alone', C.real25 === 0);
t('a count somebody already set is never overwritten', C.already === 0);
t('an inexact division is refused — a cent out is not 25', C.notExact === 0);
t('hard goods are out of scope', C.hardGood === 0);
t('a Bunch line is out of scope', C.bunchUom === 0);
t('an absurd multiple is refused', C.huge === 0);
t('a zero price cannot divide, and a missing total cannot either',
  C.zeroCost === 0 && C.noTotal === 0);

console.log('\nend to end, on the line the owner is looking at');
t('before, it reads as ONE stem and says nothing',
  o.before.stems === 1 && o.before.issues === 0, o.before.stems + ' stem');
t('after, it is 25', o.after.stems === 25, o.after.stems + ' stems at ' + o.after.per + '/bu');
t('and the card SAYS so rather than changing the number quietly',
  o.after.warned, o.after.warnText);
t('no money moved — the total and the price are untouched',
  o.after.total === 34.75 && o.after.price === 1.39,
  '$' + o.after.total + ' at $' + o.after.price);

console.log('\nit judges against what a stem of that flower actually costs');
t('a rose stem has a median to judge by',
  o.suspect.roseMedian > 0.5 && o.suspect.roseMedian < 5,
  '$' + o.suspect.roseMedian.toFixed(2));
t('"50 Stem x25 @ $1.55" is NOT flagged — that is a stem price', !o.suspect.fiftyStems);
t('"4 Stem x25 @ $1.29 = $128" is — $32 a stem is not', o.suspect.fourAt129);
t('"4 Stem x25 @ $32.00" is', o.suspect.fourAt32);
t('a flower with no history stays quiet rather than guessing', !o.suspect.noHistory);

console.log('\nand it says WHICH fault it is, not one message for both');
t('a genuine bunch price is named as one',
  o.messages.pricePerBunch.indexOf('is a bunch price') >= 0, o.messages.pricePerBunch);
t('a total that fits neither reading says so, and gives the figure that does',
  o.messages.neitherFits.indexOf('is not 4') >= 0 &&
  o.messages.neitherFits.indexOf('1.28 each') >= 0, o.messages.neitherFits);

console.log(fail.length ? `\n${fail.length} FAILURES:\n` + fail.join('\n') : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
