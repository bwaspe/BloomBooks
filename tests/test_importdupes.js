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

const A = F.file('Chase3398_Activity_20260720 (1).csv');   // 1-15 Jul
const B = F.file('Chase3398_Activity_20260803.csv');       // 15-31 Jul, overlapping on the 15th
if (!A || !B) F.skip('needs the 20 Jul and 3 Aug Chase3398_Activity downloads');

function makeApp() {
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
  vm.runInContext(`appData = { years: [2026], activeYear: 2026, rules: [], transactions: {}, dailySales: {} };
                   renderStagingTable = function () {};`, sb);
  return {
    sb,
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

console.log('\ntwo genuinely identical charges on one day');
{
  // Same day, same amount, same payee: two real transactions, not one twice.
  const T = String.fromCharCode(9);
  const line = ['09/14/2026', 'ORIG CO NAME:EXAMPLE FEES        ORIG ID:1', '-5.00', 'ACH_DEBIT', ''].join(T);
  const text = [line, line].join(String.fromCharCode(10));

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

console.log(fail.length ? '\n' + fail.length + ' FAILURES:\n' + fail.join('\n') : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
