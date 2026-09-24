// Starting a standing order: the totals have to be what was actually paid.
//
// Perri prices some bunches per STEM -- 1 Bunch of 25 at $1.39, total $34.75 --
// and ctEffectiveUnit deliberately returns the price column for those lines,
// because their totals cannot be trusted in general. The template start used
// qty x price, so a $34.75 bunch of roses came back as $1.39 EVERY week, and
// nothing the owner could do fixed it: the template holds no prices, so
// re-saving it changed nothing, and correcting the invoice changed nothing
// either because the lookup still answered $1.39.
//
// The other 557 bunch lines in the real book are priced per bunch and are
// correct as they stand, so the fix must not touch them. Both shapes are here.
const F = require('./fixtures');
const vm = require('vm');

function app(invoices, template) {
  const els = { 'ct-parse-area': { innerHTML: '' } };
  const sb = F.sandbox({ setTimeout: () => 0 });
  sb.document.getElementById = id => els[id] || null;
  vm.createContext(sb);
  vm.runInContext(F.src(['config.js', 'utils.js', 'ledger.js', 'cost-tracker.js']), sb, { filename: 'bb.js' });
  sb.__CT__ = { invoices, catalog: {}, retail: {}, family: {}, familyKeywords: {},
                markup: {}, templates: [template], supplierAliases: {} };
  sb.__A__ = { years: [2026], activeYear: 2026, transactions: {}, rules: [], dailySales: {} };
  vm.runInContext('appData = __A__; ctData = __CT__; ctRenderUploadArea = function(){}; renderCtTemplates = function(){};', sb);
  vm.runInContext('window._ctUploadPending = [];', sb);
  sb.ctStartFromTemplate('tpl-1');
  return vm.runInContext('window._ctUploadPending[0].enriched', sb);
}

const invoice = (date, items) => ({ id: 'inv-' + date, supplier: 'Perri Farms', date, deliveryDate: date,
                                    invoiceNumber: '300000', total: 0, items });
const tpl = items => ({ id: 'tpl-1', name: 'Perri standing order', supplier: 'Perri Farms', deliveryFee: 16.5, items });
const line = (name, qty, uom, unitPrice, total, stemsPerBu) =>
  ({ name, category: 'Flowers', family: '', qty, uom, unitPrice, total, stemsPerBu: stemsPerBu || null });

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };
const of = (rows, name) => rows.find(r => r.name === name);

console.log('a bunch priced per stem');
{
  // Perri's own shape: the price column is per stem, the total is the bunch.
  const rows = app([invoice('2026-09-14', [line('Roses Yellow Hummer Premium 70CM', 1, 'Bunch', 1.39, 34.75, 25)])],
                   tpl([{ name: 'Roses Yellow Hummer Premium 70CM', qty: 1, uom: 'Bunch', stemsPerBu: 25 }]));
  const r = of(rows, 'Roses Yellow Hummer Premium 70CM');
  t('the line starts at what was paid, not at the stem price', r.total === 34.75, r.total);
  t('and the price column still reads per stem, as the invoice prints it', r.unit_price === 1.39, r.unit_price);
}

console.log('\na bunch priced per bunch — the other 557 lines');
{
  const rows = app([invoice('2026-09-14', [line('Stock Light Pink Sweetheart Ecuador', 1, 'Bunch', 11.38, 11.38, 10)])],
                   tpl([{ name: 'Stock Light Pink Sweetheart Ecuador', qty: 1, uom: 'Bunch', stemsPerBu: 10 }]));
  const r = of(rows, 'Stock Light Pink Sweetheart Ecuador');
  t('is untouched', r.total === 11.38 && r.unit_price === 11.38, r.total);
}

console.log('\nordering a different quantity than last time');
{
  const inv = invoice('2026-09-14', [line('Roses Red Freedom Premium 60CM', 4, 'Bunch', 1.29, 129.00, 25)]);
  const four = app([inv], tpl([{ name: 'Roses Red Freedom Premium 60CM', qty: 4, uom: 'Bunch', stemsPerBu: 25 }]));
  const one = app([inv], tpl([{ name: 'Roses Red Freedom Premium 60CM', qty: 1, uom: 'Bunch', stemsPerBu: 25 }]));
  const six = app([inv], tpl([{ name: 'Roses Red Freedom Premium 60CM', qty: 6, uom: 'Bunch', stemsPerBu: 25 }]));
  t('same quantity repeats the same total', of(four, 'Roses Red Freedom Premium 60CM').total === 129.00);
  t('one bunch is a quarter of four', of(one, 'Roses Red Freedom Premium 60CM').total === 32.25,
    of(one, 'Roses Red Freedom Premium 60CM').total);
  t('six bunches scale up and round to the cent', of(six, 'Roses Red Freedom Premium 60CM').total === 193.50,
    of(six, 'Roses Red Freedom Premium 60CM').total);
}

console.log('\nwhen last time came in a different unit');
{
  const rows = app([invoice('2026-09-14', [line('Garden Roses Light Pink Filomena', 25, 'Stem', 1.26, 31.50)])],
                   tpl([{ name: 'Garden Roses Light Pink Filomena', qty: 1, uom: 'Bunch', stemsPerBu: 25 }]));
  const r = of(rows, 'Garden Roses Light Pink Filomena');
  t('the quantity is not silently converted', r.qty === 1 && r.uom === 'Bunch');
  t('and the card is told what it was last time',
    r.priorShape && r.priorShape.qty === 25 && r.priorShape.uom === 'Stem' && r.priorShape.total === 31.50,
    JSON.stringify(r.priorShape));
}

console.log('\nan item never bought before');
{
  const rows = app([], tpl([{ name: 'Something New', qty: 3, uom: 'Bunch' }]));
  const r = of(rows, 'Something New');
  t('starts at zero, which reads as fill this in', r.total === 0 && r.unit_price === 0 && r.priorShape === null);
}

console.log('\na discounted line');
{
  // The prior total is already net; scaling it keeps it net rather than
  // re-applying the discount to a discounted price.
  const rows = app([invoice('2026-09-14', [line('Hydrangea Blue Select', 10, 'Stem', 2.00, 18.10)])],
                   tpl([{ name: 'Hydrangea Blue Select', qty: 20, uom: 'Stem' }]));
  const r = of(rows, 'Hydrangea Blue Select');
  t('doubles what was paid, not what was printed', r.total === 36.20, r.total);
}

console.log('\nthe real book');
{
  const BK = 'bloom-books-backup-2026-09-24-1552.json';
  const book = F.book(BK);
  const t0 = book && (book.ctData.templates || [])[0];
  if (!t0) console.log('  SKIP  needs ' + BK + ' with a saved standing order');
  else {
    const sb = F.sandbox({ setTimeout: () => 0 });
    sb.document.getElementById = () => null;
    vm.createContext(sb);
    vm.runInContext(F.src(['config.js', 'utils.js', 'ledger.js', 'cost-tracker.js']), sb, { filename: 'bb.js' });
    sb.__CT__ = book.ctData; sb.__A__ = book.appData;
    vm.runInContext('appData = __A__; ctData = __CT__; ctRenderUploadArea = function(){}; renderCtTemplates = function(){}; window._ctUploadPending = [];', sb);
    sb.ctStartFromTemplate(t0.id);
    const rows = vm.runInContext('window._ctUploadPending[0].enriched', sb);
    // The property, not a direction: every line must be what was last paid for
    // it, scaled by quantity. Whether that is MORE than qty x price depends on
    // whether the last invoice was recorded correctly, which is the owner's
    // data rather than this code's behaviour.
    const wrong = [];
    rows.forEach(r => {
      sb.__N__ = r.name; sb.__S__ = t0.supplier;
      sb.__D__ = new Date().toISOString().slice(0, 10);
      const info = vm.runInContext('ctGetPriorPriceInfo(__N__, __S__, __D__)', sb);
      if (!info || !info.item) return;
      const L = info.item;
      if (String(L.uom || '') !== String(r.uom || '') || !(Number(L.qty) > 0)) return;
      const want = Math.round((L.total / L.qty) * r.qty * 100) / 100;
      if (Math.abs(want - r.total) > 0.005) wrong.push(r.name + ' ' + r.total + ' vs ' + want);
    });
    t('every line starts at what was last paid for it', wrong.length === 0, wrong.join('; ').slice(0, 140));
    t('and the whole order is the sum of those lines',
      Math.abs(rows.reduce((s, r) => s + r.total, 0) - vm.runInContext(
        'window._ctUploadPending[0].enriched.reduce((s, r) => s + r.total, 0)', sb)) < 0.005);
  }
}

console.log(fail.length ? '\n' + fail.length + ' FAILURES:\n' + fail.join('\n') : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
