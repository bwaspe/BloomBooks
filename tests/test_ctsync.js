// The cost tracker kept in the sheet.
//
// Everything here guards one thing: a read must never hand back LESS than was
// saved and have it look like a success. ctData is the only copy of months of
// invoice corrections, and the caller replaces what is in the browser with
// whatever comes back -- so a partial read is not a degraded load, it is data
// loss that nobody sees until they go looking for an invoice.
const F = require('./fixtures');
const vm = require('vm');

function app(deviceId) {
  const els = {};
  const sb = F.sandbox({ setTimeout: () => 0, clearTimeout: () => {} });
  sb.document.getElementById = id => els[id] || null;
  const notes = [];
  sb.notify = (msg, bad) => notes.push({ msg, bad });
  const store = {};
  if (deviceId) store.bb_device_id = deviceId;
  sb.localStorage = {
    store,
    getItem(k) { return Object.prototype.hasOwnProperty.call(this.store, k) ? this.store[k] : null; },
    setItem(k, v) { this.store[k] = v; }
  };
  sb.fetchRetry = async () => ({ ok: false, status: 404, text: async () => '' });
  vm.createContext(sb);
  const preamble = `var SHEET_ID = 'BOOKID'; var SHEET_TAB = 'BloomData';
    var accessToken = null;
    var SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
    function sheetRange(tab, a1) { return tab + '!' + a1; }
`;
  vm.runInContext(preamble + F.src(['config.js', 'utils.js', 'audit.js', 'ledger.js', 'cost-tracker.js',
                                    'settings.js', 'ct-sync.js']), sb, { filename: 'bb.js' });
  vm.runInContext(`appData = { years: [2026], activeYear: 2026, transactions: {}, rules: [], dailySales: {} };`, sb);
  return { sb, els, notes, store };
}

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };

const OFFICE = 'Windows Chrome · office';

const sample = () => ({
  invoices: [
    { id: 'inv-1', supplier: 'Perri Farms', date: '2026-09-01', total: 120.5,
      items: [{ name: 'Rose Freedom', qty: 25, uom: 'Stem', unitPrice: 1.39, total: 34.75 }] },
    { id: 'inv-2', supplier: 'DVFlora', date: '2026-09-02', total: 80, items: [] }
  ],
  catalog: { 'rose freedom': { category: 'Flowers' } },
  retail: { 'rose freedom': 4.5 },
  markup: { Flowers: 3 },
  supplierAliases: { 'a perri farms': 'Perri Farms' },
  reconcileFrom: '2026-09-01',
  _working: 'must not travel'
});

console.log('what goes to the sheet comes back');
{
  const a = app('dev1');
  const rows = a.sb.ctSheetValues(sample(), 'w1', 'dev1');
  const back = a.sb.ctSheetFromRows(rows);
  t('both invoices return', back.invoices.length === 2);
  t('and their lines with them',
    back.invoices[0].items[0].unitPrice === 1.39, JSON.stringify(back.invoices[0].items[0]));
  t('the catalog returns', back.catalog['rose freedom'].category === 'Flowers');
  t('the retail prices return', back.retail['rose freedom'] === 4.5);
  t('the supplier aliases return', back.supplierAliases['a perri farms'] === 'Perri Farms');
  t('and where reconciliation starts', back.reconcileFrom === '2026-09-01');

  // Working state is dropped here for the same reason ctSave drops it.
  t('underscore working state does not travel', back._working === undefined);

  // What must NOT go is listed, rather than what may. Listing the allowed keys
  // is how sync.js lost a setting every time one was added -- silently, and
  // only visible after a refresh.
  const withNew = sample();
  withNew.somethingAddedNextYear = { keep: 'me' };
  const back2 = a.sb.ctSheetFromRows(a.sb.ctSheetValues(withNew, 'w1', 'dev1'));
  t('a key added later rides along without being listed anywhere',
    back2.somethingAddedNextYear.keep === 'me');
}

console.log('\na catalog too big for one cell');
{
  const a = app('dev1');
  const big = sample();
  big.catalog = {};
  for (let i = 0; i < 4000; i++) big.catalog['item name number ' + i] = { category: 'Flowers', family: 'Rose' };
  const json = JSON.stringify(big.catalog);
  t('the fixture really is past the 50,000 character cell limit', json.length > 50000, json.length);

  const rows = a.sb.ctSheetValues(big, 'w1', 'dev1');
  const metaRows = rows.filter(r => r[0] === 'ct');
  t('so it is split across cells', metaRows.length > 1, metaRows.length);
  t('and no cell is over the limit', rows.every(r => String(r[3]).length <= 50000));
  const back = a.sb.ctSheetFromRows(rows);
  t('it reassembles exactly', Object.keys(back.catalog).length === 4000);
  t('with the invoices still beside it', back.invoices.length === 2);
}

console.log('\nan invoice that was deleted stays deleted');
{
  // A shorter write leaves the tail of the longer one behind. Clearing the tab
  // first would fix that and open a worse hole -- if the write then failed,
  // the only copy off the machine would be gone. So every row carries the id
  // of the write that put it there, and a leftover row is simply not read.
  const a = app('dev1');
  const first = a.sb.ctSheetValues(sample(), 'write-1', 'dev1');

  const fewer = sample();
  fewer.invoices = fewer.invoices.slice(0, 1);
  const second = a.sb.ctSheetValues(fewer, 'write-2', 'dev1');

  // The sheet as it stands after the second, shorter write: new rows on top,
  // the tail of the first still sitting underneath.
  const sheet = second.concat(first.slice(second.length));
  t('the tail really is still there', sheet.length > second.length);

  const back = a.sb.ctSheetFromRows(sheet);
  // Without the write id, the leftover rows make the tally disagree with the
  // count in the meta, the read is refused, and the phone quietly stops
  // updating from the first time an invoice is deleted.
  t('the shorter write is still readable, not refused', back !== null);
  t('only the newer write is read', back && back.invoices.length === 1,
    back && back.invoices.length);
  t('and it is the right one', back && back.invoices[0].id === 'inv-1');
}

console.log('\na read that lost something is refused outright');
{
  const a = app('dev1');
  const rows = a.sb.ctSheetValues(sample(), 'w1', 'dev1');

  // One invoice row lost or damaged. Handing back the other one as though the
  // load succeeded would replace the browser copy with a shorter one.
  const short = rows.filter(r => r[2] !== 'inv-2');
  t('a missing invoice row returns nothing at all', a.sb.ctSheetFromRows(short) === null);

  const damaged = rows.map(r => (r[2] === 'inv-2' ? [r[0], r[1], r[2], '{ not json'] : r));
  t('and so does one that will not parse', a.sb.ctSheetFromRows(damaged) === null);

  const badMeta = rows.map(r => (r[0] === 'ct' ? [r[0], r[1], r[2], '{ broken'] : r));
  t('meta that will not parse returns nothing, not the invoices alone',
    a.sb.ctSheetFromRows(badMeta) === null);

  t('an empty tab returns nothing', a.sb.ctSheetFromRows([]) === null);
  t('and so does a tab with only invoice rows and no meta',
    a.sb.ctSheetFromRows(rows.filter(r => r[0] !== 'ct')) === null);
}

console.log('\nwho may write');
{
  const a = app('office');
  a.sb.bbSettingsLoad();
  t('with nobody claiming it, nothing is read-only', a.sb.ctSyncReadOnly() === false);
  t('and nothing is claimed', a.sb.ctSyncClaimed() === false);

  const ct = vm.runInContext('bbSettings.costTracker', a.sb);
  ct.writer = 'office'; ct.writerName = OFFICE;
  t('the computer that claimed it may write', a.sb.ctSyncReadOnly() === false);

  const phone = app('phone');
  phone.sb.bbSettingsLoad();
  const pct = vm.runInContext('bbSettings.costTracker', phone.sb);
  pct.writer = 'office'; pct.writerName = OFFICE;
  t('every other device reads only', phone.sb.ctSyncReadOnly() === true);
  t('and says whose copy it is', phone.sb.ctSyncWriterName() === OFFICE);

  // The claim is keyed on the random device id alone. auditDevice()'s full
  // string carries the browser and OS read off the user agent, and a browser
  // update that changed how that parses would turn the writer into a reader
  // overnight, silently.
  t('the claim is the id, not the readable name',
    a.sb.ctSyncDevice() === 'office' && a.sb.ctSyncDeviceLabel() !== 'office',
    a.sb.ctSyncDeviceLabel());

  // A browser that has never had an id is precisely the one being set up. It
  // has to be able to claim, rather than be told it cannot be identified by
  // the screen where the claim button is.
  const fresh = app(null);
  fresh.sb.bbSettingsLoad();
  const id = fresh.sb.ctSyncDevice();
  t('a brand new browser is given an id rather than refused', !!id, id);
  t('and keeps the same one next time', fresh.sb.ctSyncDevice() === id);
}

console.log('\na change on a reader does not stick, and says so');
{
  const a = app('phone');
  a.sb.bbSettingsLoad();
  const ct = vm.runInContext('bbSettings.costTracker', a.sb);
  ct.writer = 'office'; ct.writerName = OFFICE;

  vm.runInContext(`ctData = { invoices: [{ id: 'inv-1', supplier: 'Perri Farms', total: 120.5, items: [] }],
                              catalog: {}, retail: {}, markup: {} };
                   ctReadOnlyBase = JSON.stringify(ctData);`, a.sb);

  // As any of the dozen screens that change something would: mutate, then save.
  vm.runInContext(`ctData.invoices[0].total = 999;`, a.sb);
  const ok = a.sb.ctSave();
  t('the save is refused', ok === false);
  t('the change is put back, not left on screen looking saved',
    vm.runInContext('ctData.invoices[0].total', a.sb) === 120.5,
    vm.runInContext('ctData.invoices[0].total', a.sb));
  t('and it says which computer keeps it',
    a.notes.some(n => n.bad && n.msg.indexOf(OFFICE) >= 0),
    JSON.stringify(a.notes.map(n => n.msg)));
  t('nothing was written to this browser either', !a.store.bb_ctdata);
}

console.log('\nthe writer saves as it always did');
{
  const a = app('office');
  a.sb.bbSettingsLoad();
  const ct = vm.runInContext('bbSettings.costTracker', a.sb);
  ct.writer = 'office';
  vm.runInContext(`ctData = { invoices: [], catalog: {}, retail: {}, markup: {} };`, a.sb);
  t('the save goes through', a.sb.ctSave() === true);
  t('and the browser copy is written first, so a failed push costs nothing',
    !!a.store.bb_ctdata);
}

console.log(fail.length ? '\n' + fail.length + ' FAILED' : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
