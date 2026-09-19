// Fetching the rest of a month means downloading a range that overlaps what is
// already imported. That only works if the importer recognises the overlap.
//
// Save All always did. The per-row Save button did not: on the owner's real
// book, saving one row of an already-imported September download added it a
// second time. This pins both paths to the same rule, on a real overlapping
// pair of downloads, and checks the rule still lets genuinely identical charges
// through.
const F = require('./fixtures');
const vm = require('vm');

const A = F.file('Chase*_Activity_20260720 (1).csv');   // 1-15 Jul
const B = F.file('Chase*_Activity_20260803.csv');       // 15-31 Jul, overlapping on the 15th
if (!A || !B) F.skip('needs the 20 Jul and 3 Aug Chase checking Activity downloads');

// live: keep the real staging table, so what it draws can be read back.
function makeApp(live) {
  const els = {
    'import-text': { value: '' }, 'import-source-sel': { value: 'bank' },
    'import-year-sel': { value: '2026' }, 'import-month-sel': { value: '6' },
    'reconcile-area': { innerHTML: '' }, 'staging-table-area': { innerHTML: '' }
  };
  const sb = F.sandbox({});
  sb.document.getElementById = id => els[id] || null;
  vm.createContext(sb);
  vm.runInContext(F.src(['config.js', 'utils.js', 'ledger.js', 'import-trainer.js', 'reconcile.js']), sb,
                  { filename: 'bb.js' });
  vm.runInContext(`appData = { years: [2026], activeYear: 2026, rules: [], transactions: {}, dailySales: {} };` +
                  (live ? '' : 'renderStagingTable = function () {};'), sb);
  return {
    sb, els,
    stage(text) { els['import-text'].value = text; sb.parseImport(); return vm.runInContext('stagingRows', sb); },
    stageCsv(csv) { return this.stage(sb.normalizeStatement(sb.parseDelimited(csv), 'bank')); },
    rows() { return Object.values(vm.runInContext('appData.transactions', sb)).reduce((n, a) => n + a.length, 0); }
  };
}

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };

console.log('an overlapping download, one row at a time');
{
  const app = makeApp();
  app.stageCsv(A);
  app.sb.saveAllStaged();
  const after1 = app.rows();

  const staged = app.stageCsv(B);
  const overlap = staged.filter(r => r.date === '2026-07-15');
  const inBook = app.sb.reconcileStatement(B).match.found;
  overlap.forEach(r => app.sb.saveStagedRow(r._id));
  t('saving a row the ledger already has, by its own button, adds nothing',
    app.rows() === after1 && overlap.every(r => r.status === 'dupe'),
    overlap.length + ' overlapping rows, ledger ' + after1 + ' -> ' + app.rows());

  const fresh = staged.find(r => r.date > '2026-07-15');
  app.sb.saveStagedRow(fresh._id);
  t('while a row it does not have still saves', app.rows() === after1 + 1 && fresh.status === 'saved');

  app.sb.saveAllStaged();
  const r = app.sb.reconcileStatement(B);
  t('and finishing with Save All leaves the statement reconciled, nothing twice',
    r.clean && r.match.duplicates.length === 0 && inBook === overlap.length,
    r.match.found + ' found, ' + r.match.duplicates.length + ' duplicates');
}

console.log('\nthe overlap is shown before anything is saved');
{
  // Pulling a statement from the 1st every time means most of each upload is
  // already in the book. That used to be discovered only by Save All.
  const app = makeApp(true);
  app.stageCsv(A);
  app.sb.saveAllStaged();
  const before = app.rows();

  const staged = app.stageCsv(B);
  const dupes = staged.filter(r => r.status === 'dupe');
  const fresh = staged.filter(r => r.status === 'review');
  const inBook = app.sb.reconcileStatement(B).match.found;
  t('the rows the ledger has are marked the moment the file is read',
    dupes.length > 0 && dupes.length === inBook && app.rows() === before,
    dupes.length + ' marked, the statement check finds ' + inBook + ' in the book');
  t('they are exactly the overlapping day, and every other row is new',
    dupes.every(r => r.date === '2026-07-15') && fresh.length + dupes.length === staged.length &&
    fresh.every(r => r.date > '2026-07-15'));

  const html = app.els['staging-table-area'].innerHTML;
  const parts = html.split('Already in your ledger (' + dupes.length + ')');
  const rowTag = r => 'id="stage-row-' + r._id + '"';
  const listed = parts.length === 2 ? (parts[1].match(/<tr>\s*<td/g) || []).length : -1;
  t('the table lists them apart, under "Already in your ledger"',
    parts.length === 2 && dupes.every(r => html.indexOf(rowTag(r)) < 0) &&
    fresh.every(r => parts[0].indexOf(rowTag(r)) >= 0) && listed === dupes.length,
    listed + ' listed there, ' + dupes.length + ' marked');
  t('and the new list counts only the new rows',
    html.indexOf('New Transactions (' + fresh.length + ' to review)') >= 0);

  app.sb.saveAllStaged();
  t('Save All then adds exactly the rows shown as new',
    app.rows() === before + fresh.length && fresh.every(r => r.status === 'saved'),
    before + ' -> ' + app.rows());

  const again = app.stageCsv(B);
  t('and the same file read a third time has nothing new, and says so',
    again.every(r => r.status === 'dupe') &&
    app.els['staging-table-area'].innerHTML.indexOf('Nothing new on this statement') >= 0);
}

// Same day, same amount, same payee: two real transactions, not one twice.
const T = String.fromCharCode(9);
const line = ['09/14/2026', 'ORIG CO NAME:EXAMPLE FEES        ORIG ID:1', '-5.00', 'ACH_DEBIT', ''].join(T);
const text = [line, line].join(String.fromCharCode(10));

console.log('\ntwo genuinely identical charges on one day');
{
  const app = makeApp();
  let staged = app.stage(text);
  app.sb.saveStagedRow(staged[1]._id);     // the second one first
  app.sb.saveStagedRow(staged[0]._id);
  t('both save, whichever is pressed first', app.rows() === 2 && staged.every(r => r.status === 'saved'),
    app.rows() + ' in the ledger');

  staged = app.stage(text);                // the same two, downloaded again
  staged.forEach(r => app.sb.saveStagedRow(r._id));
  t('and downloading them again adds neither', app.rows() === 2 && staged.every(r => r.status === 'dupe'),
    app.rows() + ' in the ledger');

  const app2 = makeApp();
  app2.stage(line);
  app2.sb.saveAllStaged();                 // the ledger holds one
  staged = app2.stage(text);               // a download that has both
  staged.forEach(r => app2.sb.saveStagedRow(r._id));
  t('a download holding both, over a ledger holding one, adds exactly the other',
    app2.rows() === 2 && staged.filter(r => r.status === 'saved').length === 1,
    app2.rows() + ' in the ledger');
}

console.log('\nthe pair again, decided before saving');
{
  const app = makeApp();
  app.stage(line);
  app.sb.saveAllStaged();                  // the ledger holds one
  const staged = app.stage(text);
  t('one shows as new and one as already in the ledger',
    staged.filter(r => r.status === 'review').length === 1 && staged.filter(r => r.status === 'dupe').length === 1);

  const fresh = staged.find(r => r.status === 'review');
  app.sb.rejectStagedRow(fresh._id);
  t('rejecting the new one does not bring its twin forward as new',
    staged.filter(r => r.status === 'dupe').length === 1 && !staged.some(r => r.status === 'review'));
  app.sb.saveAllStaged();
  t('so Save All adds nothing', app.rows() === 1, app.rows() + ' in the ledger');

  app.sb.saveStagedRow(fresh._id);
  t('and Save on the rejected row is a change of mind: it goes in',
    app.rows() === 2 && fresh.status === 'saved', app.rows() + ' in the ledger');
}

console.log('\na corrected amount is checked again');
{
  const app = makeApp();
  app.stage(line);
  app.sb.saveAllStaged();                  // the ledger holds the $5.00 row
  const six = ['09/14/2026', 'ORIG CO NAME:EXAMPLE FEES        ORIG ID:1', '-6.00', 'ACH_DEBIT', ''].join(T);
  const staged = app.stage(six);
  t('a $6.00 row is new', staged[0].status === 'review');
  app.sb.updateStageRow(staged[0]._id, 'amount', 5);
  t('typed as $5.00 it is the row the ledger already has', staged[0].status === 'dupe');
  app.sb.saveAllStaged();
  t('and is not saved a second time', app.rows() === 1, app.rows() + ' in the ledger');
}

console.log(fail.length ? '\n' + fail.length + ' FAILURES:\n' + fail.join('\n') : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
