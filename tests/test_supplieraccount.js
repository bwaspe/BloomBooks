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

console.log('\npaid the next day — noise, not a discrepancy');
{
  // The owner's words. An invoice on the Monday charged on the Tuesday is how
  // half their suppliers work, and flagging both days says there are two
  // problems where there is none.
  const sb = makeApp([inv('2026-08-03', '1001', 100)], [pay('2026-08-04', 100)]);
  const a = sb.ctSupplierAccount('Perri Farms');
  t('both days are quiet', row(a, '2026-08-03').kind === 'settled' && row(a, '2026-08-04').kind === 'settled');
  t('and the day it settled is named', row(a, '2026-08-03').settledOn === '2026-08-04');
  t('so nothing is reported as open', a.open === 0 && a.diff === 0);
}

console.log('\na Friday delivery charged with Monday\'s');
{
  // 10 July invoiced $134.39 with no charge; 13 July invoiced $736.83 and
  // charged $871.22, which is both.
  const sb = makeApp([inv('2026-07-10', '322173', 134.39), inv('2026-07-13', '322300', 736.83)],
                     [pay('2026-07-13', 871.22)]);
  const a = sb.ctSupplierAccount('Perri Farms', '2026-07-01');
  t('neither day is flagged', a.open === 0, a.rows.map(r => r.date + ':' + r.kind).join(' '));
}

console.log('\nan invoice that is never charged');
{
  // The same shape as far as one day can tell, and it must NOT be quieted:
  // nothing later cancels it, so the running total never comes back.
  const sb = makeApp([inv('2026-08-03', '1001', 100), inv('2026-08-10', '1002', 50)],
                     [pay('2026-08-10', 50)]);
  const a = sb.ctSupplierAccount('Perri Farms');
  t('it stays flagged', row(a, '2026-08-03').kind === 'nocharge' && a.open === 1);
  t('and the account stays short', a.diff === -10000, a.diff);
}

console.log('\nsettled, but too late to be a lag');
{
  // Covered 40 days later, well outside any supplier habit: that is two
  // separate facts, not a settlement.
  const sb = makeApp([inv('2026-08-03', '1001', 100)], [pay('2026-09-12', 100)]);
  const a = sb.ctSupplierAccount('Perri Farms');
  t('the invoice day is still reported', row(a, '2026-08-03').kind === 'nocharge');
  t('and so is the payment day', row(a, '2026-09-12').kind === 'nopaper');
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


console.log('\na settlement you have actually seen is never forgotten');
{
  // Juliet, 2026. Three lag samples, one of them eight days -- and because
  // three is fewer than CT_LAG_MIN_SAMPLES the window fell back to the
  // five-day default and the observations were thrown away. So a 3 September
  // delivery paid on the 11th alongside the 10th's, landing on $242.25 to the
  // cent, was reported as two days short and one day unexplained.
  const invoices = [
    inv('2026-08-05', '2001', 50),      // two short lags, to make three samples
    inv('2026-08-12', '2002', 60),
    inv('2026-08-20', '2003', 70),      // and the eight-day one
    inv('2026-09-03', '2004', 75.50),
    inv('2026-09-10', '2005', 166.75)
  ];
  const txs = [
    pay('2026-08-06', 50), pay('2026-08-13', 60), pay('2026-08-28', 70),
    pay('2026-09-11', 242.25)   // covers BOTH September deliveries
  ];
  const sb = makeApp(invoices, txs);
  const seen = sb.ctVendorLags()['Perri Farms'] || [];
  t('the eight-day settlement really is among the samples', seen.indexOf(8) >= 0,
    JSON.stringify(seen));
  t('so the window reaches that far even on three samples',
    sb.ctSettleDays('Perri Farms') >= 9, sb.ctSettleDays('Perri Farms'));

  const a = sb.ctSupplierAccount('Perri Farms', '2026-09-01');
  const kinds = ['2026-09-03', '2026-09-10', '2026-09-11'].map(d => row(a, d).kind);
  t('and the two deliveries settle against the single charge',
    kinds.every(k => k === 'settled'), kinds.join(','));
  t('leaving nothing flagged',
    (a.rows || []).filter(r => r.diff && r.kind !== 'settled' && !r.recent).length === 0);
}

console.log('\nbut a supplier with no history still gets the plain default');
{
  // Widening only ever follows evidence. With nothing observed the answer is
  // unchanged, or every new supplier would start with the widest reach.
  const sb = makeApp([inv('2026-09-03', '3001', 40)], []);
  t('no samples, so the default window stands', sb.ctSettleDays('Perri Farms') === 5,
    sb.ctSettleDays('Perri Farms'));
}

console.log(fail.length ? '\n' + fail.length + ' FAILURES:\n' + fail.join('\n') : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
