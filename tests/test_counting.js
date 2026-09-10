// The counting screen, which decides which families are still unresolved.
//
// Two things were wrong with it before. The link to it was unreachable -- 84
// families were waiting and none had ever been answered, because there was no
// way in. And once reachable it offered exactly ONE action, "sold by the
// bunch", on a screen whose whole job is deciding how a line is counted.
//
// What it must do now: group on the NORMALISED family (or one spelling becomes
// two rows, one of them permanently unanswerable), separate answered from
// unanswered, and offer every answer the line could need.
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
  var review = ctCountingReview();
  var html = ctCountingHtml();

  var key = function (r) { return ctFamilyKey(r.family); };
  var pendKeys = review.pending.map(key);
  var settKeys = review.settled.map(key);

  // A family cannot be in both lists, and no key may repeat -- that is the
  // shape of the "two rows for one family" bug.
  var dupes = pendKeys.concat(settKeys).filter(function (k, i, a) { return a.indexOf(k) !== i; });
  var inBoth = pendKeys.filter(function (k) { return settKeys.indexOf(k) >= 0; });

  // Every settled family is settled BECAUSE it was answered.
  var settledUnanswered = review.settled
    .filter(function (r) { return !ctIsByTheBunch(r.family); })
    .map(function (r) { return r.family; });
  // And nothing pending has been answered already.
  var pendingAnswered = review.pending
    .filter(function (r) { return ctIsByTheBunch(r.family); })
    .map(function (r) { return r.family; });

  // Answering one moves exactly that one across, and nothing else.
  var moved = null;
  if (review.pending.length) {
    var target = review.pending[0].family;
    var beforeP = review.pending.length, beforeS = review.settled.length;
    ctSetByTheBunch(target, true);
    var mid = ctCountingReview();
    ctSetByTheBunch(target, false);
    var back = ctCountingReview();
    moved = { family: target,
              pending: [beforeP, mid.pending.length, back.pending.length],
              settled: [beforeS, mid.settled.length, back.settled.length] };
  }

  // Only Flowers and Greens are asked about -- a case of vases is not a
  // counting question.
  var offCategory = review.pending.concat(review.settled)
    .filter(function (r) { return r.cat !== 'Flowers' && r.cat !== 'Greens'; })
    .map(function (r) { return r.family + ' (' + r.cat + ')'; });

  // Nothing with no family to hang an answer on should reach the list at all.
  var nameless = review.pending.concat(review.settled)
    .filter(function (r) { return !String(r.family || '').trim(); }).length;

  __OUT__({
    pending: review.pending.length, settled: review.settled.length,
    dupes: dupes, inBoth: inBoth,
    settledUnanswered: settledUnanswered, pendingAnswered: pendingAnswered,
    moved: moved, offCategory: offCategory, nameless: nameless,
    topPending: review.pending.slice(0, 3).map(function (r) {
      return r.family + ' ' + r.bunches + 'bu/' + r.lines + 'ln'; }),
    actions: {
      byTheBunch: html.indexOf('ctSetByTheBunch') >= 0,
      stemsPerBunch: html.indexOf('ctApplyFamilyStems') >= 0,
      packCount: html.indexOf('ctSetPackCounts') >= 0 ||
                 html.indexOf('ctSetFamilyPackCounts') >= 0,
      openTheLine: html.indexOf('ctOpenInvoice') >= 0
    }
  });
})();`, sb, { filename: 'ct.js' });

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };
const o = out;

console.log('the screen groups on the normalised family');
t('no family appears twice', o.dupes.length === 0, o.dupes.join(', ') || 'none');
t('and none is both answered and waiting', o.inBoth.length === 0, o.inBoth.join(', ') || 'none');
t('nothing without a family to answer for reaches the list', o.nameless === 0);
t('and only Flowers and Greens are asked about',
  o.offCategory.length === 0, o.offCategory.slice(0, 3).join('; ') || 'none');

console.log('\nanswered and waiting mean what they say');
t('every settled family was actually answered',
  o.settledUnanswered.length === 0, o.settledUnanswered.join(', ') || 'none');
t('and nothing already answered is still being asked',
  o.pendingAnswered.length === 0, o.pendingAnswered.join(', ') || 'none');
console.log('      (' + o.pending + ' waiting: ' + (o.topPending.join(', ') || 'none') + ')');

console.log('\nanswering one moves that one, and only that one');
if (!o.moved) {
  t('nothing left waiting to test with', true, 'skipped');
} else {
  t('it leaves the waiting list', o.moved.pending[1] === o.moved.pending[0] - 1,
    o.moved.pending.join(' -> ') + '  (' + o.moved.family + ')');
  t('and joins the settled one', o.moved.settled[1] === o.moved.settled[0] + 1,
    o.moved.settled.join(' -> '));
  t('un-answering puts it back exactly',
    o.moved.pending[2] === o.moved.pending[0] && o.moved.settled[2] === o.moved.settled[0]);
}

console.log('\nand the screen offers more than one answer');
t('sold by the bunch', o.actions.byTheBunch);
t('how many stems in a bunch', o.actions.stemsPerBunch);
t('what a box multiplier is counting', o.actions.packCount);
t('and a way through to the line itself', o.actions.openTheLine);

console.log(fail.length ? '\n' + fail.length + ' FAILURES:\n' + fail.join('\n') : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
