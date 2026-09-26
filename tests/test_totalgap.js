// An invoice that does not add up to its own total.
//
// ctRepairs has always computed this exact number and only ever looked at the
// POSITIVE side of it -- a stated total ABOVE the lines, which is an unfiled
// delivery charge. The other direction had no home, and that is the direction
// a corrected line goes.
//
// Juliet rang a Cremon order as 2 stems instead of 20 and phoned to say so.
// The line was put right by hand; the invoice total stayed at what the wrong
// quantity had produced, because a total read off a supplier's document is
// deliberately NOT moved by a line edit. Nothing said the two now disagreed,
// and it surfaced five weeks later as a bank reconciliation $18.00 out.
const F = require('./fixtures');
const vm = require('vm');

function app(invoices) {
  const els = {};
  const sb = F.sandbox({ setTimeout: () => 0 });
  sb.document.getElementById = id => els[id] || null;
  const notes = [];
  sb.notify = (m, bad) => notes.push({ m, bad });
  sb.confirm = () => sb.__ok !== false;
  const store = {};
  sb.localStorage = {
    store,
    getItem(k) { return Object.prototype.hasOwnProperty.call(this.store, k) ? this.store[k] : null; },
    setItem(k, v) { this.store[k] = v; }
  };
  vm.createContext(sb);
  vm.runInContext(F.src(['config.js', 'utils.js', 'ledger.js', 'cost-tracker.js']), sb, { filename: 'bb.js' });
  sb.__CT__ = { invoices: invoices || [], catalog: {}, retail: {}, family: {}, familyKeywords: {},
                markup: {}, templates: [], supplierAliases: {}, dismissedRepairs: {} };
  vm.runInContext('appData = { years: [2026], activeYear: 2026, transactions: {}, rules: [], dailySales: {} }; ctData = __CT__;', sb);
  return { sb, notes, store };
}

// Invoice #129070 as it stood: the Cremon line corrected to $20.00, the total
// still the $115.25 that 2 stems had produced.
const juliet = () => ({
  id: 'i-129070', supplier: 'Juliet Wholesale Flowers',
  date: '2026-09-21', deliveryDate: '2026-09-21',
  invoiceNumber: '129070', total: 115.25, deliveryFee: 15.00,
  items: [
    { name: 'Calla Bouquet White', qty: 2, uom: 'Bunch', unitPrice: 16.00, total: 32.00 },
    { name: 'Carnation Orange Select', qty: 25, uom: 'Stem', unitPrice: 0.60, total: 15.00 },
    { name: 'Carnation White Select', qty: 25, uom: 'Stem', unitPrice: 0.55, total: 13.75 },
    { name: 'Cremon Bronze', qty: 20, uom: 'Stem', unitPrice: 1.00, total: 20.00 },
    { name: 'Sunflowers Black Center', qty: 25, uom: 'Stem', unitPrice: 1.10, total: 27.50 },
    { name: 'Tee Pee Palm', qty: 2, uom: 'Bunch', unitPrice: 5.00, total: 10.00 }
  ]
});
const tidy = () => ({
  id: 'i-ok', supplier: 'Perri Farms', date: '2026-09-20', deliveryDate: '2026-09-20',
  invoiceNumber: '900', total: 41.50, deliveryFee: 16.50,
  items: [{ name: 'Rose Freedom', qty: 25, uom: 'Stem', unitPrice: 1.00, total: 25.00 }]
});

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };

console.log('the corrected line that the total never followed');
{
  const a = app([juliet(), tidy()]);
  const rows = a.sb.ctTotalOvershoots();
  t('exactly the one invoice is flagged', rows.length === 1, rows.length);
  t('and it is the right one', rows[0].inv.invoiceNumber === '129070');
  t('by the amount that was actually missing', Math.abs(rows[0].over - 18.00) < 0.005,
    rows[0].over);
  t('naming what it says and what it should say',
    Math.abs(rows[0].stated - 115.25) < 0.005 && Math.abs(rows[0].should - 133.25) < 0.005,
    rows[0].stated + ' -> ' + rows[0].should);

  // An invoice that agrees with itself, delivery fee and all, must stay quiet.
  // 229 of the shop's 230 do, which is the only reason this flag is worth
  // having: one true positive and no noise.
  t('an invoice that adds up says nothing', !rows.some(r => r.inv.id === 'i-ok'));
}

console.log('\nonly this direction — the other one is already handled');
{
  // A stated total ABOVE the lines is an unfiled delivery charge, which
  // ctRepairs.feeGaps has always caught. Flagging it here too would report one
  // problem twice and invite two different fixes for it.
  const over = tidy(); over.total = 60.00;    // $2 more than its lines and fee
  const a = app([over]);
  t('a total above its lines is left to the delivery-charge repair',
    a.sb.ctTotalOvershoots().length === 0);
  t('which does still see it', a.sb.ctRepairs().feeGaps.length === 1);
}

console.log('\ntaking the lines');
{
  const a = app([juliet()]);
  a.sb.ctAdoptLineTotal('i-129070');
  const inv = vm.runInContext('ctData.invoices[0]', a.sb);
  t('the total becomes what the lines come to', Math.abs(inv.total - 133.25) < 0.005, inv.total);
  t('and it stops being flagged', a.sb.ctTotalOvershoots().length === 0);
  t('the change is saved, not just shown', !!a.store.bb_ctdata);

  t('and it is money, to the cent', String(inv.total) === '133.25', String(inv.total));
}

console.log('\nfloat dust never reaches the total');
{
  // Line totals are added in floating point, and this figure gets compared to
  // a bank charge to the cent. Lines of 1.10 and 2.20 add to
  // 3.3000000000000003 unrounded, and an invoice carrying that figure is one
  // that can never quite settle against a $3.30 charge.
  const dusty = {
    id: 'i-dust', supplier: 'Perri Farms', date: '2026-09-20', deliveryDate: '2026-09-20',
    invoiceNumber: '901', total: 1.00, deliveryFee: 0,
    items: [
      { name: 'A', qty: 1, uom: 'Stem', unitPrice: 1.1, total: 1.1 },
      { name: 'B', qty: 1, uom: 'Stem', unitPrice: 2.2, total: 2.2 }
    ]
  };
  t('the raw sum really does carry dust',
    String(1.1 + 2.2) !== '3.3', String(1.1 + 2.2));

  const a = app([dusty]);
  a.sb.ctAdoptLineTotal('i-dust');
  const inv = vm.runInContext('ctData.invoices[0]', a.sb);
  t('but the total stored is a round 3.30', String(inv.total) === '3.3', String(inv.total));
}

console.log('\nit asks first, and takes no for an answer');
{
  // Two possible causes with opposite fixes: a line corrected upward (take the
  // lines) or a line counted twice (fix the line). Only whoever has seen the
  // paper knows which, so this is never part of "Repair all of them".
  const a = app([juliet()]);
  a.sb.__ok = false;
  a.sb.ctAdoptLineTotal('i-129070');
  t('declining changes nothing',
    Math.abs(vm.runInContext('ctData.invoices[0].total', a.sb) - 115.25) < 0.005);
  t('and it is still flagged', a.sb.ctTotalOvershoots().length === 1);
}

console.log('\nleaving it alone');
{
  const a = app([juliet()]);
  a.sb.ctDismissRepair('i-129070', '__total__');
  t('a dismissed invoice stops being flagged', a.sb.ctTotalOvershoots().length === 0);
}

console.log('\nand it reaches the screen even when nothing else needs repair');
{
  // The repairs panel returns early when it has nothing of its own to say,
  // and that early exit is EXACTLY the shop's situation -- so a flag added
  // only to the other branch would never once have been seen.
  const a = app([juliet()]);
  t('no pack line or fee gap here', a.sb.ctRepairs().packLines.length === 0 &&
    a.sb.ctRepairs().feeGaps.length === 0);
  const html = a.sb.ctTotalOvershootHtml();
  t('yet the notice is rendered', /does not add up/.test(html), html.slice(0, 60));
  t('carrying both figures', /115\.25/.test(html) && /133\.25/.test(html));
  t('and a way to act on it', /ctAdoptLineTotal/.test(html));
}

console.log(fail.length ? '\n' + fail.length + ' FAILED' : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
