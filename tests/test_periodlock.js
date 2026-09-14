// The period lock. 2023-2025 are filed; nothing used to stop them changing.
//
// Two ways this can fail, and both are tested. It can let a filed year change
// -- through any of the dozen-plus paths that write rows or the day book. Or
// it can cry wolf: if loading, vault totals or simply drawing a screen touch a
// closed year, every save would say "not saved" and the lock would be ignored
// within a day. The second half runs the owner's real book through a normal
// session to prove it stays quiet.
const F = require('./fixtures');
const vm = require('vm');

function makeApp() {
  const notes = [];
  const sb = F.sandbox({ setTimeout: () => 0, clearTimeout: () => {} });
  sb.notify = (msg, warn) => notes.push(msg);
  sb.document.getElementById = () => null;
  sb.document.body = { classList: { toggle() {}, contains: () => false } };
  vm.createContext(sb);
  vm.runInContext(F.src(['config.js', 'utils.js', 'sync.js', 'periodlock.js', 'ledger.js', 'reports.js',
                         'daily-sales.js', 'import-trainer.js']), sb, { filename: 'bb.js' });
  // The sandbox's own notify stub is defined before the app source; re-point it.
  vm.runInContext('notify = function (m, w) { __NOTE__(m); }', Object.assign(sb, { __NOTE__: m => notes.push(m) }));
  const S = code => vm.runInContext(code, sb);
  return { sb, S, notes, load(obj) { sb.__D__ = JSON.parse(JSON.stringify(obj)); S('appData = normalizeAppData(__D__);'); } };
}

const row = (id, date, amount, category, type) => ({ id, date, desc: id, category, vendor: 'V', amount, type: type || 'out' });
const book = () => ({
  years: [2025, 2026], activeYear: 2026, rules: [], dailyRevenueFrom: '2026-01',
  transactions: {
    '2025-2': [row('a', '2025-03-10', 100, 'Office'), row('b', '2025-03-12', 250, 'Supplies & Materials - COGS')],
    '2026-2': [row('c', '2026-03-10', 80, 'Office')]
  },
  dailySales: { '2025-4': { '10': { counter: { s: 500 } } }, '2026-4': { '10': { counter: { s: 700 } } } },
  basisAdjust: { 2025: { tax: 1000 } }
});

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };

// ------------------------------------------------------------------
console.log('which years are closed');
{
  const a = makeApp(); a.load(book());
  t('a book that has never been locked starts with the filed years closed',
    a.S('JSON.stringify(appData.lockedYears)') === '[2023,2024,2025]');
  const b = makeApp(); b.load(Object.assign(book(), { lockedYears: [] }));
  t('but a deliberate empty list is kept', b.S('JSON.stringify(appData.lockedYears)') === '[]');
}

console.log('\na closed year refuses every kind of change');
{
  const a = makeApp(); a.load(book());
  a.S("updateTransaction(2025, 2, 'a', { amount: 999 })");
  t('an edited amount is put back', a.S("appData.transactions['2025-2'][0].amount") === 100);
  t('  and the copy written to the browser has the original', /"id":"a"[^}]*"amount":100/.test(a.sb.localStorage.store.bloombooks_v2));
  t('  and the owner is told why', a.notes.some(n => /2025 is closed, so that change was not saved/.test(n)), a.notes[a.notes.length - 1]);

  a.S("addTransaction(2025, 2, " + JSON.stringify(row('new', '2025-03-20', 40, 'Office')) + ")");
  t('an added row is taken back out', a.S("appData.transactions['2025-2'].length") === 2);

  a.S("deleteTransaction(2025, 2, 'b')");
  t('a deleted row comes back', a.S("appData.transactions['2025-2'].some(function (t) { return t.id === 'b'; })"));

  a.S("appData.dailySales['2025-4']['10'].counter.s = 1; saveData();");
  t('a change to its day book is put back', a.S("appData.dailySales['2025-4']['10'].counter.s") === 500);

  a.S("var r = appData.transactions['2025-2'].shift(); r.date = '2026-03-01'; appData.transactions['2026-2'].push(r); saveData();");
  t('a row moved out into an open year goes back, and only once',
    a.S("appData.transactions['2025-2'].filter(function (t) { return t.id === 'a'; }).length") === 1 &&
    a.S("appData.transactions['2026-2'].filter(function (t) { return t.id === 'a'; }).length") === 0);
}

console.log('\nwhile an open year and the settings stay editable');
{
  const a = makeApp(); a.load(book());
  a.S("updateTransaction(2026, 2, 'c', { amount: 85 })");
  a.S("appData.dailySales['2026-4']['10'].counter.s = 750; saveData();");
  a.S("setBasisAdjust = setBasisAdjust; basisAdjustMap()[2025].fees = 500; saveData();");
  t('2026 edits save', a.S("appData.transactions['2026-2'][0].amount") === 85 && a.S("appData.dailySales['2026-4']['10'].counter.s") === 750);
  t('2025 like-for-like figures still save — they change nothing that was filed', a.S('appData.basisAdjust[2025].fees') === 500);
  t('  and none of it raised a warning', a.notes.length === 0, a.notes.join(' / '));
}

console.log('\nwhat is not a change');
{
  const a = makeApp(); a.load(book());
  a.S(`appData.transactions['2025-2'].unshift({ id: 'vault-rev-2025-2', date: '2025-03-01', desc: 'Total Revenue (Vault)',
         category: 'Revenue', amount: 5000, type: 'in', _vault: true });
       appData.transactions['2025-2'].reverse();
       var o = appData.transactions['2025-2'][1];
       appData.transactions['2025-2'][1] = { type: o.type, amount: o.amount, vendor: o.vendor, category: o.category, desc: o.desc, date: o.date, id: o.id };
       appData.transactions['2025-7'] = [];
       saveData();`);
  t('vault totals, a re-sorted month, fields in another order, an empty month: no warning',
    a.notes.length === 0, a.notes.join(' / '));
  t('  and the vault row is left where it is', a.S("appData.transactions['2025-2'].some(function (t) { return t._vault; })"));
}

console.log('\nunlocking, for a session');
{
  const a = makeApp(); a.load(book());
  a.S('lockUnlockForSession(2025)');
  a.S("updateTransaction(2025, 2, 'a', { amount: 120 })");
  t('an unlocked year saves the edit', a.S("appData.transactions['2025-2'][0].amount") === 120 && a.notes.every(n => !/not saved/.test(n)));
  t('  and the unlock itself is never saved', JSON.parse(a.sb.localStorage.store.bloombooks_v2).lockedYears.indexOf(2025) >= 0);

  a.S('lockRelock(2025)');
  a.S("updateTransaction(2025, 2, 'a', { amount: 130 })");
  t('locking again keeps what was done while open, and refuses the next change',
    a.S("appData.transactions['2025-2'][0].amount") === 120);

  a.S('lockUnlockForSession(2025)');
  a.load(JSON.parse(a.sb.localStorage.store.bloombooks_v2));
  a.S("lockSessionOpen = {};");   // what a page reload does
  a.S("updateTransaction(2025, 2, 'a', { amount: 140 })");
  t('a reload closes it again', a.S("appData.transactions['2025-2'][0].amount") === 120);
}

console.log('\nclosing and reopening a year');
{
  const a = makeApp(); a.load(book());
  a.S('lockCloseYear(2026)');
  t('closing 2026 is saved', JSON.parse(a.sb.localStorage.store.bloombooks_v2).lockedYears.indexOf(2026) >= 0);
  a.S("updateTransaction(2026, 2, 'c', { amount: 1 })");
  t('  and it then refuses changes', a.S("appData.transactions['2026-2'][0].amount") === 80);
  a.S('lockUnlockForSession(2026); lockReopenYear(2026);');
  a.S("updateTransaction(2026, 2, 'c', { amount: 90 })");
  t('reopened for good, it takes edits again and stays open after saving',
    a.S("appData.transactions['2026-2'][0].amount") === 90 && JSON.parse(a.sb.localStorage.store.bloombooks_v2).lockedYears.indexOf(2026) < 0);
}

console.log('\nthe importer says so instead of claiming it saved');
{
  const a = makeApp(); a.load(book());
  a.S(`renderStagingTable = function () {};
       stagingRows = [
         { _id: 's1', date: '2025-12-30', txYear: 2025, txMonth: 11, desc: 'LATE 2025 ROW', amount: 12, type: 'out', category: 'Office', vendor: '', status: 'review' },
         { _id: 's2', date: '2026-01-02', txYear: 2026, txMonth: 0, desc: 'EARLY 2026 ROW', amount: 34, type: 'out', category: 'Office', vendor: '', status: 'review' }];
       saveAllStaged();`);
  t('a row for a closed year is marked closed, not saved', a.S("stagingRows[0].status") === 'locked' && !a.S("(appData.transactions['2025-11'] || []).length"));
  t('  while the open year row saves', a.S("stagingRows[1].status") === 'saved' && a.S("appData.transactions['2026-0'].length") === 1);
  t('  and the message counts it', a.notes.some(n => /1 in a closed year, not saved/.test(n)), a.notes[a.notes.length - 1]);
}

// ------------------------------------------------------------------
console.log('\na normal session on the owner\'s real book raises no false alarm');
const REAL = F.book('bloom-books-backup-2026-09-14-1809.json');
if (!REAL) {
  console.log('  (no 14 Sep backup to hand — skipping)');
} else {
  const a = makeApp();
  a.load(REAL.appData || REAL);
  const fp = () => JSON.stringify([2023, 2024, 2025].map(y => a.sb.lockFingerprint(a.S('appData'), y)));
  const before = fp();
  const tries = [
    'ensureVaultData()', 'renderYearlyPanel()', 'renderTaxPanel()', 'renderTrendsPanel()', 'renderHolidayPanel()',
    'renderDailySalesPanel()', 'renderSalesTaxPanel()', 'dsChannels()'
  ];
  [2023, 2024, 2025, 2026].forEach(y => { for (let m = 0; m < 12; m++) tries.push('appData.activeYear = ' + y + '; renderMonthPanel(' + m + ')'); });
  tries.forEach(code => { try { a.S(code); } catch (e) { /* a missing canvas in the sandbox, not the lock */ } });
  a.S('saveData()');
  t('loading, vault totals and drawing every screen leave the closed years untouched', fp() === before);
  t('  so the first save afterwards refuses nothing', a.notes.every(n => !/not saved/.test(n)), a.notes.filter(n => /not saved/.test(n)).join(' / '));
  t('  and the filed years are the ones closed', a.S('JSON.stringify(appData.lockedYears)') === '[2023,2024,2025]');
}

console.log(fail.length ? '\n' + fail.length + ' FAILURES:\n' + fail.join('\n') : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
