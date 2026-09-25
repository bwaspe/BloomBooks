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

console.log('\ncategories start as exactly what the app already did');
{
  const a = app();
  a.sb.bbSettingsLoad();
  const names = a.sb.ctCategories();
  t('same 15, same order', names.length === 15 && names[0] === 'Flowers' && names[14] === 'Other');
  t('same markups', a.sb.ctCategoryMarkup('Flowers') === 3 && a.sb.ctCategoryMarkup('Packaging') === 1.3);
  t('same colours', a.sb.ctCategoryColour('Flowers') === vm.runInContext("CT_COLORS['Flowers']", a.sb));
  t('an unknown category still answers a markup', a.sb.ctCategoryMarkup('Nonsense') === 2);
}

console.log('\na markup this browser had already tuned');
{
  const a = app();
  vm.runInContext("ctData.markup['Flowers'] = 4.2;", a.sb);
  a.sb.bbSettingsLoad();
  t('is what settings start from, not the constant', a.sb.ctCategoryMarkup('Flowers') === 4.2);
}

console.log('\nrenaming a category');
{
  const a = app();
  a.sb.bbSettingsLoad();
  a.sb.bbCategoryRename('Glass', 'Vases');
  t('the new name is what the pickers offer',
    a.sb.ctCategories().indexOf('Vases') >= 0 && a.sb.ctCategories().indexOf('Glass') < 0);
  t('and history filed under the old one resolves to it', a.sb.ctCategoryNow('Glass') === 'Vases');
  t('so the two years group as one', a.sb.ctCategoryNow('Glass') === a.sb.ctCategoryNow('Vases'));
  t('the markup follows the name', a.sb.ctCategoryMarkup('Glass') === a.sb.ctCategoryMarkup('Vases'));

  // Rename again: the first old name must not be left pointing at a name that
  // no longer exists.
  a.sb.bbCategoryRename('Vases', 'Containers');
  t('a second rename keeps the first one pointing somewhere real',
    a.sb.ctCategoryNow('Glass') === 'Containers' && a.sb.ctCategoryNow('Vases') === 'Containers');
  t('and it is one hop, not a chain',
    a.sb.ctCategoryNow(a.sb.ctCategoryNow('Glass')) === 'Containers');
}

console.log('\nretiring a category');
{
  const a = app();
  a.sb.bbSettingsLoad();
  a.sb.bbCategorySet('Seasonal', 'active', false);
  t('it leaves the pickers', a.sb.ctCategories().indexOf('Seasonal') < 0);
  t('but history still knows the name', a.sb.ctAllCategories().indexOf('Seasonal') >= 0);
  t('and a line already filed under it keeps it',
    /value="Seasonal" selected/.test(a.sb.ctCategoryOptions('Seasonal')));
  t('while a live line is offered the live list',
    !/Seasonal/.test(a.sb.ctCategoryOptions('Flowers')));
}

console.log('\nfamily rules');
{
  const a = app();
  vm.runInContext("ctData.familyKeywords = { gerbera: 'Gerbera', 'mini gerbera': 'Mini Gerbera' };", a.sb);
  a.sb.bbSettingsLoad();
  t('what was learned invisibly is now a list you can see', a.sb.bbFamilyRules().length === 2);
  t('the longest keyword still wins',
    a.sb.bbFamilyRules()[0].keyword === 'mini gerbera');

  // Priority is the thumb on the scale.
  a.sb.bbFamilySet('gerbera', 'priority', '5');
  t('priority overrules length', a.sb.bbFamilyRules()[0].keyword === 'gerbera');
  t('and guessing follows the rules', a.sb.ctGuessFamily('Gerbera Mini Canadian') === 'Gerbera');
}

console.log('\nlearning with the toggle off');
{
  const a = app();
  a.sb.bbSettingsLoad();
  a.sb.bbFamilySetAutoLearn(false);
  a.sb.ctLearnFamily('Ranunculus Elegance White', 'Ranunculus');
  const s = vm.runInContext('bbSettings.family', a.sb);
  t('the new rule waits instead of applying', s.pending.length === 1 && s.rules.length === 0);
  a.sb.bbFamilyApprove(0);
  t('approving moves it across', s.pending.length === 0 && s.rules.length === 1);
  t('and it works', a.sb.ctGuessFamily('Ranunculus Something Else') === 'Ranunculus');
}

console.log('\nrenaming keeps a year-on-year comparison in one row');
{
  const a = app();
  a.sb.bbSettingsLoad();
  const invoices = [
    { supplier: 'X', date: '2025-06-01', deliveryDate: '2025-06-01', total: 100,
      items: [{ name: 'Vase tall', category: 'Glass', total: 100 }] },
    { supplier: 'X', date: '2026-06-01', deliveryDate: '2026-06-01', total: 60,
      items: [{ name: 'Vase tall', category: 'Glass', total: 60 }] }
  ];
  const before = a.sb.ctSpendByCategory(invoices);
  t('both years sit under the old name to begin with', before.Glass === 160);

  a.sb.bbCategoryRename('Glass', 'Vases');
  // The 2026 invoice is re-filed under the new name, as a new line would be.
  invoices[1].items[0].category = 'Vases';
  const after = a.sb.ctSpendByCategory(invoices);
  t('after renaming, the two years are ONE row', after.Vases === 160, JSON.stringify(after.Vases));
  t('and nothing is left behind under the old name', !after.Glass);
  t('which is the whole point — the comparison survives the rename',
    after.Vases === before.Glass);
}

console.log('\nthe sales tax rate');
{
  const a = app();
  a.sb.bbSettingsLoad();
  t('defaults to the rate the app already applies', a.sb.bbTaxRate() === 0.08375);

  a.sb.bbFinancialSetTaxRate('8.875');
  t('a changed county rate is what the checks now use', a.sb.bbTaxRate() === 0.08875,
    a.sb.bbTaxRate());
  t('and it is stored as a fraction, exactly',
    vm.runInContext('bbSettings.financial', a.sb).taxRate === 0.08875, vm.runInContext('bbSettings.financial', a.sb).taxRate);

  // Entered as a percent, used as a fraction: the conversion has to be clean
  // or a rate reads back as 0.08374999999999999 and every expected-tax figure
  // on the page is a hundredth of a cent out.
  a.sb.bbFinancialSetTaxRate('8.375');
  t('8.375% comes back as 0.08375 and not a float tail',
    String(vm.runInContext('bbSettings.financial', a.sb).taxRate) === '0.08375',
    String(vm.runInContext('bbSettings.financial', a.sb).taxRate));

  a.sb.bbFinancialSetTaxRate('nonsense');
  t('a rate that is not a number is refused, not stored',
    a.sb.bbTaxRate() === 0.08375);
  a.sb.bbFinancialSetTaxRate('83.75');
  t('and a percent mistyped as 83.75 is refused too — that is not a tax rate',
    a.sb.bbTaxRate() === 0.08375, a.sb.bbTaxRate());

  // A settings file can be hand-edited in the raw box, so the accessor cannot
  // trust what it reads any more than the handler can.
  vm.runInContext('bbSettings.financial', a.sb).taxRate = 'eight percent';
  // The raw settings box takes anything, and these come from a sheet another
  // device wrote -- so the ACCESSOR has to refuse a bad rate too, not just the
  // handler. A percent typed where a fraction belongs would charge 8375%.
  vm.runInContext('bbSettings.financial', a.sb).taxRate = 8.375;
  t('a percent stored where a fraction belongs is refused by the accessor',
    a.sb.bbTaxRate() === 0.08375, a.sb.bbTaxRate());
  vm.runInContext('bbSettings.financial', a.sb).taxRate = -0.05;
  t('and so is a negative rate', a.sb.bbTaxRate() === 0.08375, a.sb.bbTaxRate());

  t('a hand-edited rubbish value falls back rather than breaking the page',
    a.sb.bbTaxRate() === 0.08375);
}

console.log('\nadding a supplier is a form entry, not a redeploy');
{
  const a = app();
  a.sb.bbSettingsLoad();
  t('the five suppliers the script reads today are there',
    vm.runInContext('bbSettings.vendors', a.sb).length === 5 &&
    vm.runInContext('bbSettings.vendors', a.sb).some(v => v.name === 'Perri Farms'));

  a.sb.bbVendorAdd();
  const i = vm.runInContext('bbSettings.vendors', a.sb).length - 1;
  a.sb.bbVendorSet(i, 'email', '  Sales@FallRiver.com  ');
  a.sb.bbVendorSet(i, 'mode', 'body');
  a.sb.bbVendorRename(i, 'Fall River Florist');
  const v = vm.runInContext('bbSettings.vendors', a.sb)[i];
  t('the new row carries the name, sender and mode', v.name === 'Fall River Florist' &&
    v.email === 'Sales@FallRiver.com' && v.mode === 'body');

  // Typed in the box as a Title Case line, compared by the script in lower
  // case: a subject that keeps its capitals matches nothing at all.
  a.sb.bbVendorSet(i, 'skipSubjects', 'Order Confirmation*' + String.fromCharCode(10) + '  ' + String.fromCharCode(10) + 'We Are On Our Way');
  t('skip subjects are split per line, trimmed, blanks dropped',
    v.skipSubjects.length === 2, JSON.stringify(v.skipSubjects));
  t('and lowercased, because that is how they are compared',
    v.skipSubjects[0] === 'order confirmation*' && v.skipSubjects[1] === 'we are on our way');

  a.sb.bbVendorSet(i, 'mode', 'something else');
  t('a mode that is neither reads as an attachment, the usual case', v.mode === 'pdf');

  a.sb.bbVendorSet(i, 'active', false);
  t('switching one off keeps the row', v.active === false &&
    vm.runInContext('bbSettings.vendors', a.sb).length === i + 1);

  a.sb.bbVendorRemove(i);
  t('removing takes it out', vm.runInContext('bbSettings.vendors', a.sb).length === i);

  // Renaming is the one field that can break reconciliation, so it asks. A
  // declined rename must leave the name alone.
  a.sb.confirm = () => false;
  a.sb.bbVendorRename(0, 'Juliet');
  t('a rename that was declined changes nothing',
    vm.runInContext('bbSettings.vendors', a.sb)[0].name === 'Juliet Wholesale');
  a.sb.confirm = () => true;
  a.sb.bbVendorRename(0, 'Juliet Wholesale Inc');
  t('and an accepted one goes through',
    vm.runInContext('bbSettings.vendors', a.sb)[0].name === 'Juliet Wholesale Inc');
}

console.log('\na list that was cut down stays cut down');
{
  // Defaults sit UNDERNEATH stored values key by key, which is what brings a
  // newly added setting back. A list is different: a stored one is the whole
  // statement of it, so merging element by element would quietly restore the
  // supplier or category that was just removed from the end.
  const a = app({ schemaVersion: 1, vendors: [
    { name: 'Perri Farms', email: 'sales@perrifarms.com', mode: 'body', active: true }
  ] });
  a.sb.bbSettingsLoad();
  const v = vm.runInContext('bbSettings.vendors', a.sb);
  t('four suppliers removed stay removed', v.length === 1, v.length);
  t('and the one kept is the one stored', v[0].name === 'Perri Farms');

  const c = app({ schemaVersion: 1, categories: { list: [{ name: 'Flowers', active: true }] } });
  c.sb.bbSettingsLoad();
  t('the same for categories',
    vm.runInContext('bbSettings.categories.list', c.sb).length === 1);
  t('while a section added since is still filled in from the defaults',
    vm.runInContext('bbSettings.financial.taxRate', c.sb) === 0.08375);
}

setTimeout(() => {
  console.log(fail.length ? '\n' + fail.length + ' FAILURES:\n' + fail.join('\n') : '\nall assertions passed');
  process.exit(fail.length ? 1 : 0);
}, 50);
