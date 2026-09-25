// Settings: one store, and defaults that are exactly today's behaviour.
//
// The rule that matters most is the last one: a settings file written by an
// older version of the app is missing whatever has been added since, and those
// keys have to come back as their defaults rather than as undefined. Every
// section added later will rely on that, so it is pinned here from the start.
const F = require('./fixtures');
const vm = require('vm');

function app(cache, opts) {
  opts = opts || {};
  const els = { 'settings-content': { innerHTML: '' } };
  const sb = F.sandbox({ setTimeout: () => 0 });
  sb.document.getElementById = id => els[id] || null;
  const store = {};
  if (cache !== undefined) store.bb_settings = typeof cache === 'string' ? cache : JSON.stringify(cache);
  sb.localStorage = {
    store,
    getItem(k) { return Object.prototype.hasOwnProperty.call(this.store, k) ? this.store[k] : null; },
    setItem(k, v) { if (opts.writeThrows) throw new Error('quota'); this.store[k] = v; }
  };
  sb.fetchRetry = async () => ({ ok: false, status: 404, text: async () => '' });
  vm.createContext(sb);
  // What sync.js and audit.js declare before settings.js runs in the browser.
  // sync.js itself is not loaded here: it reaches for gapi and the Google
  // identity library at load, which a test has no business standing up.
  const preamble = `var SHEET_ID = 'BOOKID'; var SHEET_TAB = 'BloomData';
    var AUDIT_TAB = 'AuditLog'; var accessToken = null;
    var SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
    function sheetRange(tab, a1) { return tab + '!' + a1; }\n`;
  vm.runInContext(preamble + F.src(['config.js', 'utils.js', 'ledger.js', 'cost-tracker.js', 'settings.js']),
                  sb, { filename: 'bb.js' });
  vm.runInContext(`appData = { years: [2026], activeYear: 2026, transactions: {}, rules: [], dailySales: {} };
                   ctData.gmailSheetId = '${opts.scanner || 'SCANNERID'}';
                   accessToken = ${opts.token ? "'tok'" : 'null'};`, sb);
  return { sb, els, store };
}

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };

console.log('defaults are what the app already does');
{
  const a = app();
  const d = a.sb.bbSettingsDefaults();
  t('the book source is the hardcoded sheet and tab',
    d.sources.book.sheetId === vm.runInContext('SHEET_ID', a.sb) &&
    d.sources.book.tab === vm.runInContext('SHEET_TAB', a.sb));
  t('the audit and vault tabs match their constants',
    d.sources.audit.tab === vm.runInContext('AUDIT_TAB', a.sb) &&
    d.sources.vault.tab === vm.runInContext('VAULT_TAB', a.sb));
  t('the scanner points at the sheet already configured in this browser',
    d.sources.scanner.sheetId === 'SCANNERID' && d.sources.scanner.tab === 'Invoices');
  t('and settings live in that same sheet', d.sources.settings.sheetId === 'SCANNERID');
  t('stamped with the schema version', d.schemaVersion === 1);
}

console.log('\na file from an older version');
{
  // Everything after schemaVersion was added later; those keys must return.
  const a = app();
  a.sb.bbSettingsApply({ schemaVersion: 1 }, 'a file');
  const s = vm.runInContext('bbSettings', a.sb);
  t('missing sections come back as defaults', !!(s.sources && s.sources.scanner && s.sources.scanner.tab === 'Invoices'));
  t('and what the file DID carry is kept', s.schemaVersion === 1);
}

console.log('\na file with no schema version at all');
{
  const a = app();
  const out = a.sb.bbSettingsMigrate({ sources: { book: { tab: 'Old' } } });
  t('is migrated to version 1', out.schemaVersion === 1);
  t('without losing what it held', out.sources.book.tab === 'Old');
}

console.log('\nstored values win over defaults, key by key');
{
  const a = app({ schemaVersion: 1, sources: { scanner: { tab: 'Renamed' } } });
  a.sb.bbSettingsLoad();
  const s = vm.runInContext('bbSettings', a.sb);
  t('the changed key is the stored one', s.sources.scanner.tab === 'Renamed');
  t('its neighbours are still the defaults', s.sources.scanner.sheetId === 'SCANNERID');
  t('and so are the other sources', s.sources.book.tab === vm.runInContext('SHEET_TAB', a.sb));
}

console.log('\nrubbish in the cache');
{
  const a = app('{not json');
  a.sb.bbSettingsLoad();
  const s = vm.runInContext('bbSettings', a.sb);
  t('falls back to defaults rather than throwing', s.schemaVersion === 1 && !!s.sources.book);
}

console.log('\nwith no sign-in');
{
  const a = app(undefined, { token: false });
  const ok = a.sb.bbSettingsSave();
  t('a save is kept in this browser instead of being lost', !!a.store.bb_settings);
  t('and says it has not reached the sheet',
    /sign in/.test(vm.runInContext('bbSettingsState.error', a.sb) || ''),
    vm.runInContext('bbSettingsState.error', a.sb));
}

console.log('\npasting a whole Sheets URL');
{
  const a = app();
  a.sb.bbSettingsSetSource('scanner', 'sheetId',
    'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUv/edit#gid=0');
  t('takes the id out of it',
    vm.runInContext('bbSettings.sources.scanner.sheetId', a.sb) === '1AbCdEfGhIjKlMnOpQrStUv');
}

console.log('\nthe scanner id the browser already had');
{
  // settings.js parses before init.js calls ctLoad(), so the defaults built at
  // parse time saw no cost-tracker data at all. Loading is what must build them.
  const a = app();
  a.sb.bbSettingsLoad();
  t('is picked up once settings load', vm.runInContext('bbSettings.sources.scanner.sheetId', a.sb) === 'SCANNERID');
  t('and settings go in that same sheet', a.sb.bbSettingsSheetId() === 'SCANNERID');
}

console.log('\ntesting a source');
{
  const a = app();
  a.sb.bbSettingsLoad();
  vm.runInContext("accessToken = 'tok';", a.sb);
  // The Invoices tab exists but is missing a column the importer reads.
  a.sb.fetchRetry = async () => ({ ok: true, status: 200,
    json: async () => ({ values: [['MessageId', 'Vendor', 'Date', 'Total']] }) });
  a.sb.bbSettingsTestSource('scanner').then(r => {
    t('names the column that is missing rather than saying "connected"',
      r.ok === false && /ItemsJSON/.test(r.why), r.why);
  });
}

console.log('\nthe panel');
{
  const a = app();
  a.sb.renderSettingsPanel();
  const html = a.els['settings-content'].innerHTML;
  t('lists every source', ['The book', 'Audit trail', 'Historical totals', 'Invoice scanner']
    .every(n => html.indexOf(n) >= 0));
  t('offers export, import and reset', /Export settings/.test(html) && /Import settings/.test(html) && /Reset to defaults/.test(html));
  t('and shows the raw settings', /bb-settings-raw/.test(html));
}

setTimeout(() => {
  console.log(fail.length ? '\n' + fail.length + ' FAILURES:\n' + fail.join('\n') : '\nall assertions passed');
  process.exit(fail.length ? 1 : 0);
}, 50);
