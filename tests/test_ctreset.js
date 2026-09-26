// Clearing the cost tracker.
//
// The reset built a fresh object and copied three things back into it, so
// every key added since it was written was destroyed without ever being
// named: the standing order templates, the supplier and vendor aliases, where
// reconciliation starts, the pack answers, the rose colours, the colour fixes.
// The dialog promised "connection and markup settings kept".
//
// It got worse the day ctSave started pushing to the sheet, because then one
// button emptied the browser copy AND the backup it had just been given.
const F = require('./fixtures');
const vm = require('vm');

function app(opts) {
  opts = opts || {};
  const els = { 'ct-storage-warning': { innerHTML: '' } };
  const sb = F.sandbox({ setTimeout: () => 0, clearTimeout: () => {} });
  sb.document.getElementById = id => els[id] || null;
  const notes = [];
  sb.notify = (msg, bad) => notes.push({ msg, bad });
  sb.confirm = () => opts.confirm !== false;
  sb.prompt = () => (opts.typed !== undefined ? opts.typed : 'RESET');
  const store = { bb_device_id: 'office' };
  sb.localStorage = {
    store,
    getItem(k) { return Object.prototype.hasOwnProperty.call(this.store, k) ? this.store[k] : null; },
    setItem(k, v) { this.store[k] = v; }, removeItem(k) { delete this.store[k]; }
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
  vm.runInContext(`appData = { years: [2026], activeYear: 2026, transactions: {}, rules: [], dailySales: {} };`, sb);
  // Downloading a file needs a document this test has no business standing up.
  let exported = 0;
  sb.ctExportBackup = () => { exported++; };
  vm.runInContext(`ctData = {
    invoices: [{ id: 'inv-1', supplier: 'Perri Farms', date: '2026-09-01', total: 10, items: [] },
               { id: 'inv-gmail-x', supplier: 'DVFlora', date: '2026-09-02', total: 20, items: [] }],
    catalog: { rose: { category: 'Flowers' } },
    retail: { rose: 4.5 },
    family: {}, familyKeywords: { rose: 'Rose' },
    markup: { Flowers: 3 },
    gmailSheetId: 'SCANNER1', appsScriptUrl: 'https://script/exec',
    importedGmailIds: ['x'],
    dismissedStaleMargins: { a: 1 }, dismissedRepairs: {}, dismissedPayments: { b: 1 },
    templates: [{ id: 'tpl-1', name: 'Perri standing order' }],
    supplierAliases: { 'dv flora': 'DVFlora' },
    vendorAliases: { dvfg: 'DVFlora' },
    reconcileFrom: '2026-09-01',
    packAnswers: { q: 1 }, byTheBunch: { rose: true }, packCounts: { box: 10 },
    roseColors: { freedom: 'Red' }, colourFixes: { a: 'Red' },
    noInvoiceVendors: {}, gmailCoverage: { from: '2026-01-01' },
    somethingAddedNextYear: { keep: 'me' }
  };`, sb);
  return { sb, els, notes, store, exported: () => exported };
}

const get = (a, expr) => vm.runInContext(expr, a.sb);
const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };

console.log('it says what is going, in things anyone can picture');
{
  const a = app();
  const parts = a.sb.ctResetSummary(get(a, 'ctData'));
  t('the invoices are named and counted', parts.some(p => /^2 invoices$/.test(p)), parts.join(' / '));
  t('so are the remembered names', parts.some(p => /remembered item name/.test(p)));
  t('the retail prices', parts.some(p => /retail price/.test(p)));
  t('the learned rules', parts.some(p => /learned family rule/.test(p)));
  t('and the dismissed warnings are added up across all three lists',
    parts.some(p => /^2 dismissed warnings$/.test(p)), parts.join(' / '));

  // The sentence somebody reads before destroying something.
  const one = a.sb.ctResetSummary({ invoices: [{ id: 'x' }], retail: { a: 1 }, catalog: {} });
  t('one of a thing is counted as one, not one things',
    one.join(' / ') === '1 invoice / 1 retail price', one.join(' / '));
  const empty = a.sb.ctResetSummary({ invoices: [], catalog: {} });
  t('with nothing to lose it says nothing', empty.length === 0);
}

console.log('\nwhat a reset keeps');
{
  const a = app();
  a.sb.ctResetCostData();

  t('the invoices are gone', get(a, 'ctData.invoices.length') === 0);
  t('the remembered names are gone', Object.keys(get(a, 'ctData.catalog')).length === 0);
  t('and the imported message ids, so they can come again',
    get(a, 'ctData.importedGmailIds.length') === 0);

  // Every one of these was silently destroyed before, and none was mentioned.
  t('the standing order templates survive', get(a, '(ctData.templates||[]).length') === 1);
  t('the supplier aliases survive', get(a, "(ctData.supplierAliases||{})['dv flora']") === 'DVFlora');
  t('the vendor aliases survive', get(a, '(ctData.vendorAliases||{}).dvfg') === 'DVFlora');
  t('where reconciliation starts survives', get(a, 'ctData.reconcileFrom') === '2026-09-01');
  t('the pack answers survive', Object.keys(get(a, 'ctData.packAnswers||{}')).length === 1);
  t('the pack sizes survive', get(a, '(ctData.packCounts||{}).box') === 10);
  t('the rose colours survive', get(a, '(ctData.roseColors||{}).freedom') === 'Red');
  t('the colour fixes survive', get(a, '(ctData.colourFixes||{}).a') === 'Red');
  t('the markup survives', get(a, '(ctData.markup||{}).Flowers') === 3);
  t('the sheet connection survives', get(a, 'ctData.gmailSheetId') === 'SCANNER1');

  // Clearing BY NAME rather than rebuilding is what makes this true, and it is
  // the whole reason the old one kept losing things nobody listed.
  t('a key added next year survives a reset written this year',
    get(a, '(ctData.somethingAddedNextYear||{}).keep') === 'me');
}

console.log('\nthe way back');
{
  const a = app();
  const before = get(a, 'JSON.stringify(ctData)');
  t('a backup file is written BEFORE anything is touched', a.exported() === 0);
  a.sb.ctResetCostData();
  t('the file was written', a.exported() === 1);
  t('and the previous copy is kept in the browser', !!a.store.bb_ctdata_before_reset);
  t('exactly as it was', a.store.bb_ctdata_before_reset === before);
  t('so the undo is offered where the damage shows', /Undo the reset/.test(a.sb.ctUndoResetHtml()));

  a.sb.ctUndoReset();
  t('undoing puts the invoices back', get(a, 'ctData.invoices.length') === 2);
  t('and the remembered names', Object.keys(get(a, 'ctData.catalog')).length === 1);
  t('and stops offering itself once used', a.sb.ctUndoResetHtml() === '');
  t('with nothing kept that should not be', !a.store.bb_ctdata_before_reset);
}

console.log('\nit takes typing, not a click');
{
  // The reset button sits beside Download Backup; the two are one slip apart.
  // The old dialog said "Type-confirm:" and then asked for a click.
  const a = app({ typed: 'yes' });
  a.sb.ctResetCostData();
  t('anything but RESET clears nothing', get(a, 'ctData.invoices.length') === 2);
  t('and says so rather than going quiet', a.notes.some(n => /Nothing was cleared/.test(n.msg)));

  const b = app({ confirm: false });
  b.sb.ctResetCostData();
  t('and so does saying no to the dialog', get(b, 'ctData.invoices.length') === 2);
}

console.log('\nthe sheet copy is named, on the computer that keeps it');
{
  // A reset on the writer empties the browser copy and then, two seconds
  // later, overwrites the sheet with the empty one. Someone agreeing to this
  // has to be told the phone will not still have it.
  const a = app();
  a.sb.bbSettingsLoad();
  const ct = get(a, 'bbSettings.costTracker');
  ct.writer = 'office';
  let asked = '';
  a.sb.confirm = msg => { asked = msg; return true; };
  a.sb.ctResetCostData();
  t('the dialog says the sheet goes too', /copy in the sheet is replaced/.test(asked), asked.slice(0, 40));

  const phone = app();
  phone.sb.bbSettingsLoad();
  get(phone, 'bbSettings.costTracker').writer = 'someone-else';
  let askedPhone = '';
  phone.sb.confirm = msg => { askedPhone = msg; return true; };
  phone.sb.ctResetCostData();
  t('on a reader it does not claim to touch the sheet, because it cannot',
    !/copy in the sheet is replaced/.test(askedPhone));
}

console.log(fail.length ? '\n' + fail.length + ' FAILED' : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
