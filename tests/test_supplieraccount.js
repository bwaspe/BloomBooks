// The other half of the reconciliation: invoices against charges, day by day.
//
// ctReconcilePayments walks payments, so a bill you were never charged for is
// invisible to it -- and it is greedy, so Perri's 3 August payment matched one
// invoice exactly and was reported clean while four smaller orders from the
// same day sat untouched. The account view has to show that day as short, and
// has to let the running total settle when the backorder arrives the next day.
//
// Nothing here is the shop's real data except the last block, which reads the
// backup named below if it is present.
const F = require('./fixtures');
const vm = require('vm');

function makeApp(invoices, txs) {
  const sb = F.sandbox({ setTimeout: () => 0 });
  const byMonth = {};
  (txs || []).forEach(t => {
    const k = (+t.date.slice(0, 4)) + '-' + (+t.date.slice(5, 7) - 1);
    (byMonth[k] = byMonth[k] || []).push(Object.assign({ type: 'out', category: 'Supplies & Materials - COGS' }, t));
  });
  sb.getTransactions = (y, m) => byMonth[y + '-' + m] || [];
  vm.createContext(sb);
  vm.runInContext(F.src(['config.js', 'utils.js', 'ledger.js', 'cost-tracker.js']), sb, { filename: 'bb.js' });
  sb.__A__ = { years: [2026], activeYear: 2026, transactions: byMonth, rules: [], dailySales: {} };
  sb.__CT__ = { invoices: invoices || [], catalog: {}, retail: {}, family: {}, familyKeywords: {},
                reconcileFrom: '2026-08-01', templates: [], supplierAliases: {} };
  vm.runInContext('appData = __A__; ctData = __CT__;', sb);
  return sb;
}
const inv = (date, num, total, fee) => ({ id: 'i-' + num, supplier: 'Perri Farms', date, deliveryDate: date,
  invoiceNumber: num, total, deliveryFee: fee || 0, items: [] });
const pay = (date, amount) => ({ id: 'p-' + date + '-' + amount, date, amount, vendor: 'A. Perri Farms', desc: 'IN *A PERRI FARMS' });

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };
const row = (a, date) => a.rows.find(r => r.date === date);

console.log('a day that agrees');
{
  const sb = makeApp([inv('2026-08-03', '1001', 100)], [pay('2026-08-03', 100)]);
  const a = sb.ctSupplierAccount('Perri Farms');
  t('invoiced and charged match, and the day is square',
    row(a, '2026-08-03').diff === 0 && row(a, '2026-08-03').kind === 'square' && a.diff === 0);
}

console.log('\nthe backorder: ordered the 3rd, delivered the 4th');
{
  // What actually happened: $782.28 of paperwork on the 3rd, $681.96 charged;
  // the $22.00 disbud arrived the next day and was charged then, with the
  // $16.50 delivery that never reaches the paperwork.
  const sb = makeApp(
    [inv('2026-08-03', '323663', 681.96, 16.5), inv('2026-08-03', '591128-0', 32.41),
     inv('2026-08-03', '591129-0', 49.99), inv('2026-08-03', '590958-0', 10.93),
     inv('2026-08-03', '590950-0', 6.99), inv('2026-08-04', '591340-0', 103.90)],
    [pay('2026-08-03', 681.96), pay('2026-08-04', 142.40)]);
  const a = sb.ctSupplierAccount('Perri Farms');
  const d3 = row(a, '2026-08-03'), d4 = row(a, '2026-08-04');
  t('the 3rd is short, and says the paperwork was not all billed',
    d3.invoiced === 78228 && d3.charged === 68196 && d3.diff === -10032 && d3.kind === 'unbilled',
    d3.diff);
  t('the 4th is over, because the backorder was charged then',
    d4.invoiced === 10390 && d4.charged === 14240 && d4.diff === 3850, d4.diff);
  t('the running total carries the 3rd into the 4th',
    d3.running === -10032 && d4.running === -6182, d4.running);
  t('both days are reported, not just the one that looks wrong',
    a.rows.length === 2 && a.open === 2);
}

console.log('\nthe backorder, once nothing else is missing');
{
  // The same shape with no duplicated paperwork: short one day, over the next,
  // and square by the end. This is the case the running column exists for.
  const sb = makeApp([inv('2026-08-03', '1001', 100), inv('2026-08-04', '1002', 50)],
                     [pay('2026-08-03', 78), pay('2026-08-04', 72)]);
  const a = sb.ctSupplierAccount('Perri Farms');
  t('day one short, day two over', row(a, '2026-08-03').diff === -2200 && row(a, '2026-08-04').diff === 2200);
  t('and the account ends square', a.diff === 0 && row(a, '2026-08-04').running === 0);
}

console.log('\nthe delivery charge the scan never sees');
{
  // Learned from the supplier's own invoices, so it needs three sightings.
  const sb = makeApp(
    [inv('2026-08-03', '1001', 100, 16.5), inv('2026-08-10', '1002', 100, 16.5),
     inv('2026-08-17', '1003', 100, 16.5), inv('2026-08-24', '1004', 100)],
    [pay('2026-08-24', 116.50)]);
  const a = sb.ctSupplierAccount('Perri Farms');
  t('a day out by exactly the delivery charge says so', row(a, '2026-08-24').kind === 'fee', a.fee);
}

console.log('\nwhat is too recent to judge');
{
  const today = new Date().toISOString().slice(0, 10);
  const sb = makeApp([inv(today, '1001', 100)], []);
  const a = sb.ctSupplierAccount('Perri Farms', '2026-01-01');
  t('today\'s invoice is not called a problem', row(a, today).kind === 'recent' && a.open === 0);
}

console.log('\npaperwork and charges with nothing on the other side');
{
  const sb = makeApp([inv('2026-08-03', '1001', 100)], [pay('2026-08-10', 60)]);
  const a = sb.ctSupplierAccount('Perri Farms');
  t('an invoice with no charge against it is named', row(a, '2026-08-03').kind === 'nocharge');
  t('a charge with no paperwork is named', row(a, '2026-08-10').kind === 'nopaper');
  t('and the account is left short by the difference', a.diff === -4000, a.diff);
}

console.log('\nwhen the bank spells the supplier differently');
{
  // The real pair: invoices say DVFlora, the statement says DVFG, and only the
  // alias map connects them. Joining vendor and desc loses the alias, and the
  // supplier then reads as never charged.
  const sb = makeApp([{ id: 'd1', supplier: 'DVFlora', date: '2026-08-03', deliveryDate: '2026-08-03',
                        invoiceNumber: 'NJ.1', total: 200, items: [] }],
                     [{ id: 'p1', date: '2026-08-03', amount: 200, vendor: 'DVFG',
                        desc: 'ORIG CO NAME:DELAWARE VALLEY' }]);
  vm.runInContext("ctData.vendorAliases = { dvfg: 'DVFlora' };", sb);
  const a = sb.ctSupplierAccount('DVFlora');
  t('the payment is counted through the alias', a.charged === 20000 && a.diff === 0, a.charged);
}

console.log('\nthe supplier list');
{
  const sb = makeApp([inv('2026-08-03', '1001', 100)], [pay('2026-08-03', 100)]);
  const names = sb.ctAccountSuppliers();
  t('offers the suppliers that billed since the start date', names.length === 1 && names[0] === 'Perri Farms');
}

console.log('\nthe real book, 3 and 4 August');
{
  const BK = 'bloom-books-backup-2026-09-22-1408.json';
  const book = F.book(BK);
  if (!book) console.log('  SKIP  needs ' + BK);
  else {
    const sb = F.sandbox({ setTimeout: () => 0 });
    sb.getTransactions = (y, m) => (book.appData.transactions[y + '-' + m] || []);
    vm.createContext(sb);
    vm.runInContext(F.src(['config.js', 'utils.js', 'ledger.js', 'cost-tracker.js']), sb, { filename: 'bb.js' });
    sb.__A__ = book.appData; sb.__CT__ = book.ctData;
    vm.runInContext('appData = __A__; ctData = __CT__;', sb);
    const a = sb.ctSupplierAccount('Perri Farms', '2026-08-01');
    const d3 = row(a, '2026-08-03'), d4 = row(a, '2026-08-04');
    t('3 August reads its real figures', d3 && d3.invoiced === 78228 && d3.charged === 68196,
      d3 && (d3.invoiced / 100) + ' vs ' + (d3.charged / 100));
    t('4 August reads its real figures', d4 && d4.invoiced === 10390 && d4.charged === 14240,
      d4 && (d4.invoiced / 100) + ' vs ' + (d4.charged / 100));
    t('and 3 August is flagged, which the payment walk called clean', d3 && d3.kind === 'unbilled');
  }
}

console.log(fail.length ? '\n' + fail.length + ' FAILURES:\n' + fail.join('\n') : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
