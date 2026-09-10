const F = require('./fixtures');
// "Every COGS payment has an invoice behind it" was a weaker claim than it read
// as. The matcher took the FIRST subset within a $2 tolerance, not the best one
// -- so a $695.22 payment was declared reconciled against three invoices summing
// to $696.56, while the single invoice that was exactly the payment minus
// Perri's $16.50 delivery charge sat unexamined in the same candidate list.
const fs = require('fs'), vm = require('vm');
const BK = 'bloom-books-backup-2026-09-02-1936.json';
const __raw = F.file(BK);
if (!__raw) F.skip('needs ' + BK + ' — put it in Downloads or set BLOOMBOOKS_FIXTURES');
const j = JSON.parse(__raw);
const src = fs.readFileSync(F.APP + '/cost-tracker.js', 'utf8');

const el = () => ({ innerHTML: '', value: '', style: {}, classList: { add(){}, remove(){} },
                    appendChild(){}, addEventListener(){}, querySelectorAll: () => [] });
const sb = { appData: j.appData, console, notify: () => {}, saveData: () => {}, switchPanel: () => {},
  escHtml: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                 .replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  fmt: n => '$' + Number(n).toFixed(2),
  Chart: function () { return { destroy() {} }; }, easterSunday: y => new Date(Date.UTC(y, 3, 5)),
  document: { getElementById: () => null, querySelector: () => null,
              querySelectorAll: () => [], createElement: el },
  localStorage: { store: { bb_ctdata: JSON.stringify(j.ctData) },
                  getItem(k) { return this.store[k] || null; },
                  setItem(k, v) { this.store[k] = v; } } };
sb.window = sb;
let out = null; sb.__OUT__ = o => { out = o; };

vm.runInNewContext(src + `
;(function(){
  ctLoad();
  const c = n => Math.round(n * 100);
  const mk = (n, cents, sup) => ({ d: '2026-07-01', c: cents, sup: sup || 'Perri Farms',
                                   num: n, id: 'inv-' + n, used: false });

  // The reported case, reduced to its bones. The exact answer is 678.72 + 16.50;
  // the trap is the three-invoice sum 1.34 away.
  const cands = [mk('321851', c(678.72)), mk('586879-1', c(38.50)),
                 mk('586546-0', c(70.92)), mk('320919', c(587.14))];

  const feeCase = ctClassifyPayment(cands, c(695.22), 'A. Perri Farms');

  // A payment that genuinely IS its invoices.
  const exactCase = ctClassifyPayment(
    [mk('a', c(100)), mk('b', c(50)), mk('c', c(999))], c(150), 'Perri Farms');

  // Paperwork totalling MORE than was paid -- an order with a backordered line.
  const shortCase = ctClassifyPayment([mk('a', c(220))], c(180), 'Perri Farms');

  // Nothing near it at all.
  const noneCase = ctClassifyPayment([mk('a', c(20))], c(900), 'Perri Farms');

  // The best subset must be the CLOSEST, and prefer fewer invoices on a tie.
  const tie = ctBestSubset([mk('one', c(100)), mk('x', c(60)), mk('y', c(40))], c(100));

  // Five invoices, exactly, and no smaller combination reaches it -- the decoy
  // is deliberately too large to be part of any answer. The old four-deep loops
  // could not see a five-invoice payment at all and reported it as cents out
  // for ever, which is what happened to a real Main Wholesale payment.
  const five = ctBestSubset([mk('a', c(11.11)), mk('b', c(22.23)), mk('c', c(33.37)),
                             mk('d', c(44.41)), mk('e', c(55.57)), mk('f', c(900.00))],
                            c(166.69));

  // A wide window must not take for ever.
  const wide = [];
  for (let i = 1; i <= 22; i++) wide.push(mk('w' + i, c(i * 7.13)));
  const t0 = Date.now();
  const wideBest = ctBestSubset(wide, c(1000));
  const wideMs = Date.now() - t0;

  // Which WAY the difference goes. At a flat 5c tolerance, 44 cents is no
  // longer absorbed as a loose match -- it is a document that is missing, and
  // the row says which side it is missing from.
  const over  = ctClassifyPayment([mk('a', c(100))], c(100.44), 'Perri Farms');
  const under = ctClassifyPayment([mk('a', c(100.44))], c(100), 'Perri Farms');
  const overBest  = ctBestSubset([mk('a', c(100))], c(100.44));
  const underBest = ctBestSubset([mk('a', c(100.44))], c(100));
  // ...and 4 cents still IS rounding.
  const rounding = ctClassifyPayment([mk('a', c(100))], c(100.04), 'Perri Farms');

  // The habit, looked up the way a bank statement spells the vendor.
  const fees = {};
  ['A. Perri Farms', 'Perri Farms', 'MAIN WHOLESALE FLORIHAWTHO', 'DVFG', 'Trader Joes']
    .forEach(n => { fees[n] = ctUsualDeliveryFee(n); });

  // Against the real book.
  const rows = ctExplainedPayments();
  const kinds = {};
  rows.forEach(r => { const k = r.kind || 'none'; kinds[k] = (kinds[k] || 0) + 1; });
  const feeRow = rows.filter(r => r.kind === 'fee')[0];

  // Applying it moves the fee AND the total, and only from a click.
  let applied = null;
  if (feeRow && feeRow.picked.length === 1) {
    const id = feeRow.picked[0].id;
    const inv = ctData.invoices.find(i => i.id === id);
    const before = { fee: inv.deliveryFee || 0, total: inv.total };
    ctApplyDeliveryFee(id, feeRow.fee);
    applied = { before: before,
                after: { fee: inv.deliveryFee, total: inv.total },
                addedFee: Math.round((inv.deliveryFee - before.fee) * 100),
                addedTotal: Math.round((inv.total - before.total) * 100) };
    inv.deliveryFee = before.fee; inv.total = before.total;   // put it back
  }
  const missingInvoiceId = (function () {
    const n = ctData.invoices.length;
    ctApplyDeliveryFee('inv-does-not-exist', 1650);
    return ctData.invoices.length === n;
  })();

  __OUT__({
    fee: { kind: feeCase.kind, fee: feeCase.fee,
           pick: (feeCase.pick || []).map(p => p.num + ':' + p.c) },
    exact: { kind: exactCase.kind, pick: (exactCase.pick || []).map(p => p.num) },
    short: { kind: shortCase.kind, diff: shortCase.diff },
    none:  { kind: noneCase.kind },
    tie:   { pick: tie.pick.map(p => p.num), diff: tie.diff },
    five:  { pick: five.pick.map(p => p.num).sort().join('+'), diff: five.diff },
    wide:  { ms: wideMs, diff: wideBest.diff },
    over:  { kind: over.kind, signed: c(100.44) - overBest.sum },
    under: { kind: under.kind, signed: c(100) - underBest.sum },
    rounding: rounding.kind,
    fees: fees,
    rows: rows.length, kinds: kinds,
    feeRowDate: feeRow ? feeRow.date : null,
    feeRowAmount: feeRow ? feeRow.amount : null,
    feeRowInv: feeRow ? feeRow.picked.map(p => p.num).join('+') : null,
    applied: applied, missingInvoiceId: missingInvoiceId
  });
})();`, sb, { filename: 'ct.js' });

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log(`  ${c ? 'PASS' : 'FAIL'}  ${l}${d !== undefined ? '  [' + d + ']' : ''}`); };
const o = out;

console.log('the reported case: $695.22 against four candidate invoices');
t('it is explained as a missing delivery charge, not a loose match',
  o.fee.kind === 'fee', o.fee.kind);
t('the charge named is Perri\'s $16.50', o.fee.fee === 1650, o.fee.fee);
t('and it picks the ONE invoice that is exactly the payment minus it',
  o.fee.pick.length === 1 && o.fee.pick[0] === '321851:67872', o.fee.pick.join(', '));

console.log('\nthe other outcomes are told apart');
t('a payment that IS its invoices is exact and reported nowhere',
  o.exact.kind === 'exact' && o.exact.pick.join('+') === 'a+b', o.exact.kind);
t('paperwork totalling more than was paid reads as a possible backorder',
  o.short.kind === 'short' && o.short.diff === 4000,
  o.short.kind + ' $' + (o.short.diff / 100).toFixed(2));
t('nothing near it stays unmatched', o.none.kind === 'none', o.none.kind);

console.log('\nthe subset search picks the best, not the first');
t('an exact single invoice beats a pair that also sums to it',
  o.tie.pick.length === 1 && o.tie.pick[0] === 'one' && o.tie.diff === 0,
  o.tie.pick.join('+') + ' diff ' + o.tie.diff);
t('a payment that is exactly FIVE invoices is found — the old cap stopped at four',
  o.five.diff === 0 && o.five.pick === 'a+b+c+d+e', o.five.pick + ' diff ' + o.five.diff);
t('22 candidates still resolve in well under a second', o.wide.ms < 500, o.wide.ms + 'ms');

console.log('\nand it says WHICH WAY the difference goes');
t('paid MORE than the paperwork reads as a positive difference',
  o.over.signed === 44, o.over.signed);
t('paid LESS reads as a negative one', o.under.signed === -44, o.under.signed);
t('44 cents MORE than the paperwork is a missing document, not rounding',
  o.over.kind === 'none', o.over.kind);
t('44 cents LESS reads as a short charge — a backorder or a credit',
  o.under.kind === 'short', o.under.kind);
t('but 4 cents still is rounding', o.rounding === 'exact', o.rounding);

console.log('\nthe habit is found however the bank spells the vendor');
t('"A. Perri Farms" resolves to $16.50', o.fees['A. Perri Farms'] === 1650,
  o.fees['A. Perri Farms']);
t('so does "Perri Farms"', o.fees['Perri Farms'] === 1650);
t('"MAIN WHOLESALE FLORIHAWTHO" resolves to $18.75',
  o.fees['MAIN WHOLESALE FLORIHAWTHO'] === 1875, o.fees['MAIN WHOLESALE FLORIHAWTHO']);
t('a vendor that never charges one has no habit', o.fees['Trader Joes'] === 0);

console.log('\nagainst the real book');
t('differences that used to read as clean matches are now reported', o.rows > 0,
  o.rows + ' explained: ' + JSON.stringify(o.kinds));
t('the 6 July Perri payment is the delivery-charge one',
  o.feeRowDate === '2026-07-06' && Math.abs(o.feeRowAmount - 695.22) < 0.005,
  o.feeRowDate + ' $' + o.feeRowAmount + ' -> ' + o.feeRowInv);

console.log('\nand agreeing to it writes both numbers');
t('the delivery fee gains exactly $16.50', o.applied && o.applied.addedFee === 1650,
  o.applied && o.applied.addedFee);
t('and so does the invoice total — the money was paid',
  o.applied && o.applied.addedTotal === 1650, o.applied && o.applied.addedTotal);
t('an id that is not there changes nothing', o.missingInvoiceId);

console.log(fail.length ? `\n${fail.length} FAILURES:\n` + fail.join('\n') : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
