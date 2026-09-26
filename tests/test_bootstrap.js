// Finding the settings sheet from a device that has never had anything.
//
// This is the failure the owner hit on 2026-09-26: the phone reported the cost
// tracker as never having been set up, when it had been. The address of the
// scanner's sheet was kept in ctData.gmailSheetId -- and ctData is EXACTLY what
// a second device does not have. So the phone could not find the settings, could
// not learn which computer saves the cost tracker, and said so.
//
// The book's own address is a constant in sync.js, so it is reachable from
// nothing. The address of everything else has to ride in with it.
const F = require('./fixtures');
const vm = require('vm');

function app(opts) {
  opts = opts || {};
  const els = { 'settings-content': { innerHTML: '' } };
  const sb = F.sandbox({ setTimeout: () => 0, clearTimeout: () => {} });
  sb.document.getElementById = id => els[id] || null;
  const saves = [];
  const store = {};
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
  vm.runInContext(preamble + F.src(['config.js', 'utils.js', 'audit.js', 'ledger.js',
                                    'cost-tracker.js', 'settings.js', 'ct-sync.js']),
                  sb, { filename: 'bb.js' });
  // saveData is sync.js's; the book is not loaded here, so it is recorded.
  sb.saveData = () => saves.push(vm.runInContext('appData.gmailSheetId', sb));
  vm.runInContext(`appData = { years: [2026], activeYear: 2026, transactions: {}, rules: [], dailySales: {} };
                   ${opts.bookSheetId ? `appData.gmailSheetId = '${opts.bookSheetId}';` : ''}
                   ${opts.ctSheetId ? `ctData.gmailSheetId = '${opts.ctSheetId}';` : ''}
                   accessToken = ${opts.token === false ? 'null' : "'tok'"};`, sb);
  return { sb, els, saves, store };
}

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };

console.log('the phone, which has no cost tracker data at all');
{
  // What the owner actually had: the office machine knows the sheet, the phone
  // has only the book -- which is what every signed-in device gets.
  const phone = app({ bookSheetId: 'SCANNER1' });
  t('it has no ctData sheet id, by definition',
    vm.runInContext('ctData.gmailSheetId', phone.sb) === '');
  t('but it finds the scanner sheet through the book', phone.sb.bbScannerSheetId() === 'SCANNER1');
  t('so it knows where the settings are', phone.sb.bbSettingsSheetId() === 'SCANNER1');
  t('and it is ready to read them', phone.sb.bbSettingsReady() === true);

  // Before the fix this was the whole bug: not ready, so bbSettingsLoad returned
  // early, costTracker.writer stayed empty, and the cost tracker reported
  // itself as never set up on a device where it had been.
  const blind = app({});
  t('with the address in neither place it is NOT ready, and says nothing false',
    blind.sb.bbSettingsReady() === false);
}

console.log('\nthe computer that has it puts the address in the book');
{
  const office = app({ ctSheetId: 'SCANNER1' });
  t('the book does not carry it yet',
    vm.runInContext('appData.gmailSheetId', office.sb) === undefined);
  t('sharing it reports that it did something', office.sb.bbShareScannerSheetId() === true);
  t('the book now carries it', vm.runInContext('appData.gmailSheetId', office.sb) === 'SCANNER1');
  t('and the book was saved, so other devices get it', office.saves.length === 1);

  t('doing it again changes nothing', office.sb.bbShareScannerSheetId() === false);
  t('and does not save the book again', office.saves.length === 1);
}

console.log('\na device with nothing must not take the address away');
{
  // The mirror only runs one way. A phone writing its empty copy over the
  // book's would strip the address from every device -- the same failure
  // again, in the other direction and harder to spot.
  const phone = app({ bookSheetId: 'SCANNER1' });
  t('a device with no copy of its own shares nothing', phone.sb.bbShareScannerSheetId() === false);
  t('the book keeps the address', vm.runInContext('appData.gmailSheetId', phone.sb) === 'SCANNER1');
  t('and the book was not written at all', phone.saves.length === 0);
}

console.log('\nand the settings panel shows the sheet it really found');
{
  const phone = app({ bookSheetId: 'SCANNER1' });
  phone.sb.bbSettingsLoad();
  t('the scanner source is filled in from the book',
    vm.runInContext('bbSettings.sources.scanner.sheetId', phone.sb) === 'SCANNER1');
  t('and so is the settings source',
    vm.runInContext('bbSettings.sources.settings.sheetId', phone.sb) === 'SCANNER1');
}

console.log(fail.length ? '\n' + fail.length + ' FAILED' : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
