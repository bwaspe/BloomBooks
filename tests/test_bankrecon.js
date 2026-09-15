// Bank reconciliation, run on the owner's four real Chase downloads the way
// they are actually used: upload, save the new rows, upload the next.
//
// The claim being tested is the one the feature exists to make -- that a
// statement which reconciles is one where nothing is missing, nothing is in
// twice, nothing is in the wrong month, and nothing fell between two downloads.
// So the second half breaks each of those on purpose and checks it is caught.
//
// Everything runs through the real importer (parseImport, saveAllStaged) and
// the real reconciler, with only the DOM stubbed.
const F = require('./fixtures');
const vm = require('vm');

const FILES = ['Chase*_Activity_20260720 (1).csv', 'Chase*_Activity_20260803.csv',
               'Chase*_Activity_20260822.csv', 'Chase*_Activity_20260902.csv'];
const CSV = FILES.map(f => F.file(f));
if (CSV.some(c => !c)) F.skip('needs the four Chase checking Activity downloads (Jul 20 - Sep 2) in Downloads');

function makeApp() {
  const els = {
    'import-text': { value: '' }, 'import-source-sel': { value: 'bank' },
    'import-year-sel': { value: '2026' }, 'import-month-sel': { value: '0' },
    'reconcile-area': { innerHTML: '' }, 'staging-table-area': { innerHTML: '' }
  };
  const sb = F.sandbox({});
  sb.document.getElementById = id => els[id] || null;
  vm.createContext(sb);
  vm.runInContext(F.src(['config.js', 'utils.js', 'ledger.js', 'import-trainer.js', 'reconcile.js']), sb,
                  { filename: 'bb.js' });
  vm.runInContext(`
    appData = { years: [2026], activeYear: 2026, rules: [], transactions: {}, dailySales: {} };
    renderStagingTable = function () {};`, sb);
  const app = {
    sb, els,
    get book() { return vm.runInContext('appData', sb); },
    upload(i, text) {
      const csv = text || CSV[i];
      els['import-text'].value = sb.normalizeStatement(sb.parseDelimited(csv), 'bank');
      sb.parseImport();
      sb.rcLoad(csv, FILES[i]);
      return sb.reconcileStatement(csv);
    },
    saveAll() { sb.saveAllStaged(); },
    card() { return els['reconcile-area'].innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '); },
    last() { const b = vm.runInContext('appData.bankRecon', sb); return b && b.last; }
  };
  return app;
}

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };

// ------------------------------------------------------------------
console.log('the forward routine, from an empty book');
const a = makeApp();

let r = a.upload(0);
t('1 Jul-15 Jul: the statement is complete — every balance accounts for its row',
  r.chain.breaks.length === 0, r.chain.count + ' rows, opening $' + r.chain.opening + ', closing $' + r.chain.closing);
t('  nothing recorded yet, so there is nothing to join', r.continuity.status === 'first');
t('  before saving, every row is reported missing from the book',
  r.match.missing.length === 45 && !r.clean, r.match.missing.length + ' missing');
t('  and the card says so', /aren't in your book/.test(a.card()));

a.saveAll();
t('saving the rows re-checks the statement and it now reconciles',
  /Reconciled/.test(a.card()) && /Recorded/.test(a.card()));
t('  and remembers where it ended', a.last() && a.last().date === '2026-07-15' && a.last().bal === 35847.58,
  JSON.stringify(a.last()));

r = a.upload(1);
t('15 Jul-31 Jul overlaps the last one and is found to join it at the same balance',
  r.continuity.status === 'joins' && r.continuity.how === 'overlap');
t('  the Merullo reversal no longer breaks the chain — it reads as money back',
  r.chain.breaks.length === 0, r.chain.breaks.length + ' breaks');
const overlapFound = r.match.found;
t('  the rows both downloads share are already in the book; only the new ones are missing',
  overlapFound > 0 && r.match.missing.length === r.chain.count - overlapFound,
  overlapFound + ' shared, ' + r.match.missing.length + ' new');
a.saveAll();
t('  saved, it reconciles through 31 Jul', a.last().date === '2026-07-31' && /Reconciled/.test(a.card()),
  JSON.stringify(a.last()));
r = a.sb.reconcileStatement(CSV[1]);
t('  and once recorded it still reports joining the 15 Jul statement, not itself',
  r.continuity.status === 'joins' && r.continuity.last.date === '2026-07-15' && /ended 15 Jul/.test(a.card()),
  r.continuity.status + ' ' + (r.continuity.last || {}).date);
t('  and the earlier one, checked again, reads as older rather than as a gap',
  a.sb.reconcileStatement(CSV[0]).continuity.status === 'older');

r = a.upload(2);
t('3 Aug-14 Aug looks like a gap by date, but opens on the exact balance 31 Jul closed on',
  r.continuity.status === 'joins' && r.continuity.how === 'adjacent',
  'opening $' + r.chain.opening + ' after a weekend');
a.saveAll();

r = a.upload(3);
t('17 Aug-31 Aug joins the same way', r.continuity.status === 'joins');
a.saveAll();
r = a.sb.reconcileStatement(CSV[3]);
t('and the whole run ends reconciled, nothing missing, nothing twice, nothing misfiled',
  r.clean && a.last().date === '2026-08-31' && a.last().bal === 32749.13,
  JSON.stringify(a.last()));
const book = a.book;
const atm = Object.keys(book.transactions).reduce((n, k) =>
  n + book.transactions[k].filter(x => x.category === 'ATM Withdrawal').length, 0);
t('  with the ATM withdrawals booked outside the expense total, not as Office',
  atm === 9 && a.sb.isNonExpenseCat('ATM Withdrawal'), atm + ' withdrawals');

// ------------------------------------------------------------------
console.log('\nand what it is there to catch');

r = a.upload(0);
t('re-checking an older statement does not move the end point back',
  r.continuity.status === 'older' && a.last().date === '2026-08-31');

{
  const g = makeApp();
  g.upload(1); g.saveAll();                       // reconciled through 31 Jul
  r = g.upload(3);                                // the 14 Aug download skipped
  t('a skipped download is a gap, and its size is named',
    r.continuity.status === 'gap' && r.continuity.moved === -3244.94 && !r.clean,
    'moved $' + r.continuity.moved + ' between 31 Jul and 17 Aug');
  t('  the card tells the owner what to download', /download from 31 Jul/.test(g.card()));
}

{
  const d = makeApp();
  CSV.forEach((_, i) => { d.upload(i); d.saveAll(); });
  const aug = d.book.transactions['2026-7'];
  const victim = aug.find(x => x.type === 'out' && x.date >= '2026-08-17');
  aug.push(Object.assign({}, victim, { id: 'dupe-1' }));
  r = d.sb.reconcileStatement(CSV[3]);
  t('a row saved twice is reported as a duplicate',
    r.match.duplicates.length === 1 && !r.clean, '$' + victim.amount + ' ' + victim.desc);

  aug.pop();
  const moved = aug.splice(aug.indexOf(victim), 1)[0];
  (d.book.transactions['2026-8'] = d.book.transactions['2026-8'] || []).push(moved);
  r = d.sb.reconcileStatement(CSV[3]);
  t('a row in the wrong month\'s list is reported as misfiled',
    r.match.misfiled.length === 1 && r.match.missing.length === 0 && !r.clean);

  d.book.transactions['2026-8'].pop();
  r = d.sb.reconcileStatement(CSV[3]);
  t('a row missing from the book is reported, with its amount',
    r.match.missing.length === 1 && r.match.missing[0].amount === victim.amount && !r.clean,
    r.match.missing.map(x => x.date + ' $' + x.amount).join(', '));
}

{
  const lines = CSV[3].split('\n');
  const cut = lines.findIndex((l, i) => i > 5 && /ORIG CO NAME:GUSTO/.test(l));
  const removed = lines[cut];
  const amount = parseFloat(removed.split('"')[2].split(',')[1]);
  lines.splice(cut, 1);
  r = makeApp().sb.reconcileStatement(lines.join('\n'));
  t('a row missing from the FILE breaks the chain by exactly that row',
    r.chain.breaks.length === 1 && Math.abs(r.chain.breaks[0].gap - amount) < 0.005 && !r.chain.breaks[0].backwards,
    'gap $' + (r.chain.breaks[0] || {}).gap + ' for a removed $' + amount + ' row');
}

{
  const s = makeApp().sb;
  const rows = [
    { date: '2026-07-15', type: 'out', amount: 376.05, bal: 35847.58 },
    { date: '2026-07-16', type: 'out', amount: 376.05, bal: 36223.63 }   // really money back
  ];
  const c = s.rcChain(rows);
  t('a row read the wrong way round is recognised as that, not as a missing row',
    c.breaks.length === 1 && c.breaks[0].backwards === true, 'gap $' + c.breaks[0].gap);
}

{
  const s = makeApp().sb;
  const amex = 'Date,Description,Amount\n08/01/2026,SOMETHING,12.00\n';
  t('an Amex export is declined rather than half-checked',
    !!s.reconcileStatement(amex).error, s.reconcileStatement(amex).error);
}

// ------------------------------------------------------------------
console.log('\nagainst the owner\'s real book');
const REAL = F.book('bloom-books-backup-2026-09-12-1750.json');
if (!REAL) {
  console.log('  (no 12 Sep backup to hand — skipping)');
} else {
  const b = makeApp();
  vm.runInContext('appData = __REAL__;', Object.assign(b.sb, { __REAL__: REAL.appData || REAL }));
  r = b.sb.reconcileStatement(CSV[3]);
  const kinds = r.match.missing.map(x => x.category);
  t('17-31 Aug: no duplicates and nothing misfiled in the book as it stands',
    r.match.duplicates.length === 0 && r.match.misfiled.length === 0);
  t('  the only rows it lacks are the ones the old ignore list discarded',
    kinds.length > 0 && kinds.every(k => ['ATM Withdrawal', 'Credit Card Payment', 'Owner Draw'].indexOf(k) >= 0),
    r.match.missing.length + ' rows: ' + Array.from(new Set(kinds)).join(', '));
  t('  and it reads the book\'s older description format without calling those missing',
    r.match.found + r.match.redated.length === r.chain.count - r.match.missing.length,
    (r.match.found + r.match.redated.length) + ' found');
}

console.log(fail.length ? '\n' + fail.length + ' FAILURES:\n' + fail.join('\n') : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
