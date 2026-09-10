// Three families would not clear however many times "sold by the bunch" was
// pressed: Acacia Knifeblade, Explosion Grass, Israeli Ruscus.
//
// Two faults wearing one symptom. A line with a BLANK family field had the flag
// written under the name the app guessed and then read back off the blank
// field, so the answer never found its way home. And a PACK line never
// consulted the flag at all, so a family answered on its bunch lines still had
// its boxes piled up as unresolved.
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

  // One place decides what family a line is in, and both grouping AND reading
  // the flag go through it. Two readings is what let an answer be filed under
  // one name and looked for under another.
  var resolution = {
    blankFallsBackToTheGuess: ctItemFamily({ name: 'Israeli Ruscus', family: '' }),
    explicitWins:             ctItemFamily({ name: 'Israeli Ruscus', family: 'Ruscus' }),
    nothingAtAll:             ctItemFamily({ name: '', family: '' }),
    nullItem:                 ctItemFamily(null)
  };

  // ...and the key it is filed under is normalised, or "Limonium" and
  // "limonium " become two rows, one permanently unanswerable.
  var keys = {
    spacing: ctFamilyKey('  Israeli   Ruscus  '),
    caseFold: ctFamilyKey('ISRAELI RUSCUS'),
    same: ctFamilyKey('  Israeli   Ruscus  ') === ctFamilyKey('israeli ruscus')
  };

  // The round trip that was broken: answer it on a line whose family is blank,
  // and the same line must read as settled afterwards.
  var FAM = 'Wombat Grass';
  var blankLine = { name: FAM, category: 'Greens', family: '',
                    qty: 4, uom: 'Bunch', unitPrice: 6, total: 24 };
  var packLine  = { name: FAM, category: 'Greens', family: '',
                    qty: 2, uom: 'Box', stemsPerBu: 10, unitPrice: 60, total: 120 };
  // ctGuessFamily may not know this name, so pin it the way the app does.
  ctData.family = ctData.family || {};
  ctData.family[ctCatalogKey(FAM)] = FAM;

  var before = { bunch: ctLineStems(blankLine), pack: ctLineStems(packLine) };
  ctSetByTheBunch(ctItemFamily(blankLine), true);
  var after = { bunch: ctLineStems(blankLine), pack: ctLineStems(packLine) };
  var flagFound = ctIsByTheBunch(ctItemFamily(blankLine));
  ctSetByTheBunch(ctItemFamily(blankLine), false);
  var cleared = ctLineStems(blankLine);
  delete ctData.family[ctCatalogKey(FAM)];

  // And in the real book: nothing already answered is still sitting pending.
  var review = ctCountingReview();
  var flagged = Object.keys(ctByTheBunchMap());
  var stillPending = review.pending
    .filter(function (p) { return ctIsByTheBunch(p.family); })
    .map(function (p) { return p.family; });

  __OUT__({
    resolution: resolution, keys: keys,
    before: before, after: after, cleared: cleared, flagFound: flagFound,
    flaggedCount: flagged.length,
    threeNamed: ['israeli ruscus', 'explosion grass', 'acacia knifeblade']
      .map(function (f) { return f + ': ' + (ctIsByTheBunch(f) ? 'answered' : 'NOT answered'); }),
    stillPending: stillPending,
    pendingCount: review.pending.length,
    settledCount: review.settled.length
  });
})();`, sb, { filename: 'ct.js' });

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };
const o = out;

console.log('one place decides what family a line is in');
t('a blank family falls back to the guessed one',
  o.resolution.blankFallsBackToTheGuess === 'Israeli Ruscus', o.resolution.blankFallsBackToTheGuess);
t('an explicit family wins over the guess',
  o.resolution.explicitWins === 'Ruscus', o.resolution.explicitWins);
t('and nothing at all stays nothing, rather than becoming a family',
  o.resolution.nothingAtAll === '' && o.resolution.nullItem === '');

console.log('\nand the key it is filed under is normalised');
t('runs of spaces collapse', o.keys.spacing === 'israeli ruscus', o.keys.spacing);
t('case folds', o.keys.caseFold === 'israeli ruscus');
t('so two spellings cannot become two unanswerable rows', o.keys.same);

console.log('\nthe round trip that was broken — answered on a line with no family set');
t('before, four bunches are unresolved',
  o.before.bunch.bunches === 4 && !o.before.bunch.byDesign, JSON.stringify(o.before.bunch));
t('the flag is found again through the same resolution that wrote it', o.flagFound);
t('after, the same line reads as settled rather than pending',
  o.after.bunch.bunches === 4 && o.after.bunch.byDesign === true, JSON.stringify(o.after.bunch));
t('and the PACK line settles too — the half that never consulted the flag',
  o.after.pack.byDesign === true, JSON.stringify(o.after.pack));
t('un-answering puts it back', !o.cleared.byDesign, JSON.stringify(o.cleared));

console.log('\nand in the real book');
t('families answered so far: ' + o.flaggedCount, o.flaggedCount > 0);
o.threeNamed.forEach(function (line) {
  t('  ' + line, /: answered$/.test(line));
});
t('NOTHING answered is still sitting in the pending list',
  o.stillPending.length === 0, o.stillPending.join(', ') || 'none');
console.log('      (' + o.pendingCount + ' pending, ' + o.settledCount + ' settled)');

console.log(fail.length ? '\n' + fail.length + ' FAILURES:\n' + fail.join('\n') : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
