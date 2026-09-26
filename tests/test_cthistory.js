// What happened to this invoice.
//
// On 26 September the owner corrected a line on Juliet's #129070, the invoice
// total did not follow, and the only way to find out why was to read source
// code for ten minutes. The answer -- a total read off the supplier's own
// document is deliberately not moved by a line edit -- belonged on the
// invoice, next to the question.
const F = require('./fixtures');
const vm = require('vm');

function app(invoices) {
  const els = {};
  const sb = F.sandbox({ setTimeout: () => 0, clearTimeout: () => {} });
  sb.document.getElementById = id => els[id] || null;
  const notes = [];
  sb.notify = (m, bad) => notes.push({ m, bad });
  sb.confirm = () => sb.__ok !== false;
  const store = { bb_device_id: 'office' };
  sb.localStorage = {
    store,
    getItem(k) { return Object.prototype.hasOwnProperty.call(this.store, k) ? this.store[k] : null; },
    setItem(k, v) { this.store[k] = v; }, removeItem(k) { delete this.store[k]; }
  };
  sb.fetchRetry = async () => ({ ok: false, status: 404, text: async () => '' });
  vm.createContext(sb);
  const preamble = `var SHEET_ID = 'X'; var SHEET_TAB = 'B'; var accessToken = null;
    var SHEETS_BASE = ''; function sheetRange(t, a) { return t + '!' + a; }
`;
  vm.runInContext(preamble + F.src(['config.js', 'utils.js', 'audit.js', 'ledger.js',
                                    'cost-tracker.js', 'settings.js', 'ct-sync.js', 'ct-history.js']),
                  sb, { filename: 'bb.js' });
  sb.__CT__ = { invoices: invoices || [], catalog: {}, retail: {}, family: {}, familyKeywords: {},
                markup: {}, templates: [], supplierAliases: {}, dismissedRepairs: {}, history: [] };
  vm.runInContext(`appData = { years: [2026], activeYear: 2026, transactions: {}, rules: [], dailySales: {} };
                   ctData = __CT__; ctHistoryReset(ctData);`, sb);
  return { sb, els, notes, store };
}

const get = (a, e) => vm.runInContext(e, a.sb);
const juliet = () => ({
  id: 'i-129070', supplier: 'Juliet Wholesale Flowers', date: '2026-09-21',
  deliveryDate: '2026-09-21', invoiceNumber: '129070', total: 115.25, deliveryFee: 15,
  items: [
    { name: 'Calla Bouquet White', qty: 2, uom: 'Bunch', unitPrice: 16, total: 32 },
    { name: 'Cremon Bronze', qty: 2, uom: 'Stem', unitPrice: 1, total: 2 }
  ]
});

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };

console.log('the change that started this');
{
  const a = app([juliet()]);
  // Exactly what happened: the quantity was keyed as 2 and should have been 20.
  vm.runInContext(`ctData.invoices[0].items[1].qty = 20;
                   ctData.invoices[0].items[1].total = 20;`, a.sb);
  a.sb.ctSave();

  const rows = a.sb.ctHistoryFor('i-129070');
  t('it is recorded', rows.length === 1, rows.length);
  const text = a.sb.ctHistoryEntryText(rows[0]);
  t('naming the line', /Cremon Bronze/.test(text), text);
  t('a quantity reads as a count, not as money', /quantity 2 → 20/.test(text), text);
  t('and a line total reads as money, because it is',
    /line total .2.00 → .20.00/.test(text), text);

  // The whole point: the invoice total did NOT move, and the history says so
  // by not claiming it did.
  t('and does not claim the invoice total changed', !/Invoice total/.test(text), text);
  t('which is the answer to the question that was asked',
    get(a, 'ctData.invoices[0].total') === 115.25);
}

console.log('\nthen putting it right');
{
  const a = app([juliet()]);
  a.sb.ctAdoptLineTotal('i-129070');
  const rows = a.sb.ctHistoryFor('i-129070');
  t('using the line totals is recorded', rows.length === 1);
  t('as an action, not a list of fields', rows[0].label === 'Used the line totals', rows[0].label);
  t('with the figures', /Invoice total/.test(a.sb.ctHistoryEntryText(rows[0])),
    a.sb.ctHistoryEntryText(rows[0]));
  t('and who did it', /office/.test(rows[0].dev), rows[0].dev);
}

console.log('\na line removed does not look like every line below it changing');
{
  // Matched by NAME rather than position. By position, removing the first of
  // six lines reads as five separate edits and buries the one that happened.
  const inv = juliet();
  inv.items = [
    { name: 'A', qty: 1, uom: 'Stem', unitPrice: 1, total: 1 },
    { name: 'B', qty: 1, uom: 'Stem', unitPrice: 2, total: 2 },
    { name: 'C', qty: 1, uom: 'Stem', unitPrice: 3, total: 3 }
  ];
  const a = app([inv]);
  vm.runInContext(`ctData.invoices[0].items.splice(0, 1);`, a.sb);
  a.sb.ctSave();
  const text = a.sb.ctHistoryEntryText(a.sb.ctHistoryFor('i-129070')[0]);
  t('one removal, and nothing else', /removed A/.test(text) && !/B/.test(text) && !/C/.test(text), text);
}

console.log('\nadding and deleting whole invoices');
{
  const a = app([]);
  vm.runInContext(`ctData.invoices.push(${JSON.stringify(juliet())});`, a.sb);
  a.sb.ctSave();
  t('a new invoice says so', a.sb.ctHistoryEntryText(a.sb.ctHistoryFor('i-129070')[0]) ===
    'Saved to the cost tracker');

  vm.runInContext(`ctData.invoices = [];`, a.sb);
  a.sb.ctSave();
  const rows = a.sb.ctHistoryFor('i-129070');
  t('and a deleted one is still findable afterwards', rows.length === 2);
  t('saying it was deleted', a.sb.ctHistoryEntryText(rows[0]) === 'Deleted');
  // Without this the record of what was deleted goes with the thing deleted.
  t('and what it was', rows[0].was && rows[0].was.number === '129070',
    JSON.stringify(rows[0].was));
}

console.log('\na load is not a change');
{
  const a = app([juliet()]);
  // What ctSyncStart does on a reader, and ctLoad on any device.
  vm.runInContext(`ctData.invoices[0].total = 999; ctHistoryReset(ctData);`, a.sb);
  a.sb.ctSave();
  t('replacing the data wholesale records nothing', a.sb.ctHistoryFor('i-129070').length === 0);
}

console.log('\nand a reload is not a change either');
{
  // Through ctLoad itself, not a direct call to the reset. A reload that
  // diffed the loaded data against a stale base would record every difference
  // between two sessions as edits nobody made.
  const a = app([juliet()]);
  const other = JSON.parse(JSON.stringify(juliet()));
  other.total = 999;
  other.items[0].qty = 77;
  a.store.bb_ctdata = JSON.stringify({ invoices: [other], catalog: {}, retail: {},
                                       markup: {}, history: [] });
  vm.runInContext('ctLoad();', a.sb);
  t('the stored copy really is different', get(a, 'ctData.invoices[0].total') === 999,
    get(a, 'ctData.invoices[0].total'));

  a.sb.ctSave();
  t('but loading it records nothing', a.sb.ctHistoryFor('i-129070').length === 0,
    JSON.stringify(a.sb.ctHistoryFor('i-129070')));

  // And a real edit after the reload is still caught, or the reset would have
  // simply switched recording off.
  vm.runInContext('ctData.invoices[0].total = 1000;', a.sb);
  a.sb.ctSave();
  t('while an edit after it still is', a.sb.ctHistoryFor('i-129070').length === 1);
}

console.log('\nclearing everything is one line, not two hundred and thirty');
{
  // A clear, a restore or the first import moves every invoice at once. One
  // entry each would push every real edit out of a capped list.
  const many = [];
  for (let i = 0; i < 60; i++) {
    many.push({ id: 'i-' + i, supplier: 'S', date: '2026-09-01', deliveryDate: '2026-09-01',
                invoiceNumber: String(i), total: 10, deliveryFee: 0,
                items: [{ name: 'x', qty: 1, uom: 'Stem', unitPrice: 10, total: 10 }] });
  }
  const a = app(many);
  vm.runInContext(`ctData.history.push({ invId: 'i-1', kind: 'changed', at: 1, changes: [], lines: [] });`, a.sb);
  vm.runInContext(`ctData.invoices = [];`, a.sb);
  a.sb.ctHistorySay('Cleared the cost tracker');
  a.sb.ctSave();

  const all = get(a, 'ctData.history');
  t('sixty removals become one entry', all.length === 2, all.length);
  t('which says how many', all[1].kind === 'bulk' && all[1].count === 60, JSON.stringify(all[1]));
  t('reading as what it was', a.sb.ctHistoryEntryText(all[1]) === '60 invoices changed at once');
  // The real edit that was there before must survive it.
  t('and the edit behind it is still there', all[0].invId === 'i-1');
}

console.log('\nit never costs the change it describes');
{
  const a = app([juliet()]);
  // A history that throws must not take the save with it.
  vm.runInContext(`ctHistoryDiff = function () { throw new Error('boom'); };`, a.sb);
  vm.runInContext(`ctData.invoices[0].total = 500;`, a.sb);
  const ok = a.sb.ctSave();
  t('the save still goes through', ok === true);
  t('and the change is stored', !!a.store.bb_ctdata && /500/.test(a.store.bb_ctdata));
}

console.log('\nit reaches the sheet with everything else');
{
  // Listed as what must NOT sync rather than what may, so the history rides
  // along without a second sync path.
  const a = app([juliet()]);
  vm.runInContext(`ctData.invoices[0].total = 133.25;`, a.sb);
  a.sb.ctSave();
  const rows = a.sb.ctSheetValues(get(a, 'ctData'), 'w1', 'office');
  const back = a.sb.ctSheetFromRows(rows);
  t('the history is in what goes to the sheet', (back.history || []).length === 1,
    (back.history || []).length);
  t('and comes back readable', back.history[0].invId === 'i-129070');
}

console.log('\nan invoice nothing has happened to');
{
  const a = app([juliet()]);
  t('says so plainly rather than looking broken',
    /Nothing has changed/.test(a.sb.ctHistoryHtml('i-129070')));
}

console.log(fail.length ? '\n' + fail.length + ' FAILED' : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
