const F = require('./fixtures');
// 17 -> 15: the candidate window is now learned per vendor from payments a
// SINGLE invoice settles exactly -- Perri same day or next, Main Wholesale one
// to three days -- instead of a blanket 16 days back and 3 forward. A narrower
// window removes wrong candidates, so more payments find their true set.
// 16 -> 17: the match tolerance is a flat 5c instead of scaling to $2, so a
// payment that only came within a dollar of its invoices is no longer called
// matched. The supplier does not round; a difference that size means a
// document is missing.
// 15 -> 16: searching past four invoices found a CLOSER combination for the
// 3 August Perri payment -- eight invoices $15.20 short, rather than the two
// it used to guess at $60.42 over. Closer, but no longer the overshoot that
// reads as a backorder, so it moved from explained back to unmatched with an
// honest "closest is" line. A better search, not a worse result.
// Was 20. Five of those now carry an explanation -- four Perri payments that
// are exact once the $16.50 delivery charge is added, and a Juliet one whose
// paperwork totals more than was paid -- so they moved from ctUnmatchedPayments
// to ctExplainedPayments. 15 is the improvement, not a regression.
// The reconcile start date, and the Gmail coverage line. The first exists to
// make a backfill safe: without it, one February invoice floods the list.
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(F.APP + '/cost-tracker.js', 'utf8');
const bk = F.book('bloom-books-backup-2026-08-27-1813 (1).json');
if (!bk) F.skip('needs bloom-books-backup-2026-08-27-1813 (1).json — put it in Downloads or set BLOOMBOOKS_FIXTURES');

const el = () => ({ innerHTML: '', value: '', options: { length: 2 }, style: {},
                    classList: { add(){}, remove(){} }, appendChild(){}, addEventListener(){} });
const sb = { appData: bk.appData, notify: () => {}, escHtml: String,
  fmt: n => '$' + Number(n).toFixed(2), confirm: () => true, prompt: () => 'x', console,
  Chart: function () { return { destroy() {} }; },
  document: { getElementById: el, querySelector: el, querySelectorAll: () => [], createElement: el },
  localStorage: { store: {}, getItem(k) { return this.store[k] || null; }, setItem(k, v) { this.store[k] = v; } } };
sb.window = sb;
let out = null;
sb.__OUT__ = o => { out = o; };
sb.__CT__ = bk.ctData;

const TAIL = [
  ';(function(){',
  '  ctData = Object.assign(ctData, __CT__);',
  '  ctData.reconcileFrom = "";',
  '  var RealDate = Date;',
  '  Date = class extends RealDate {',
  '    constructor(...a) { return a.length ? new RealDate(...a) : new RealDate("2026-08-27T20:00:00Z"); }',
  '    static now() { return new RealDate("2026-08-27T20:00:00Z").getTime(); } };',
  '  var R = {};',
  '  R.derived = ctReconcileDefault();',
  '  R.effective = ctReconcileFrom();',
  '  R.baseline = ctUnmatchedPayments().length;',
  '',
  '  // The disaster case: one February invoice, no pin.',
  '  ctData.invoices.push({ id: "feb", date: "2026-02-10", deliveryDate: "2026-02-10",',
  '    supplier: "Perri Farms", invoiceNumber: "V1", deliveryFee: 0, total: 500,',
  '    items: [{ name: "Roses", qty: 100, uom: "Stem", unitPrice: 5, total: 500 }] });',
  '  R.derivedAfterBackfill = ctReconcileDefault();',
  '  R.floodedCount = ctUnmatchedPayments().length;',
  '',
  '  // Pinned, the backfill is harmless.',
  '  ctSetReconcileFrom("2026-07-01");',
  '  R.pinned = ctData.reconcileFrom;',
  '  R.pinnedCount = ctUnmatchedPayments().length;',
  '  R.pinnedStart = ctReconcileFrom();',
  '',
  '  ctSetReconcileFrom("");',
  '  R.clearedBackToDerived = ctReconcileFrom();',
  '  ctSetReconcileFrom("not a date");',
  '  R.rubbishRejected = ctData.reconcileFrom === "";',
  '  Date = RealDate;',
  '  __OUT__(R);',
  '})();',
].join('\n');

vm.runInNewContext(src + TAIL, sb, { filename: 'cost-tracker.js' });

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log(`  ${c ? 'PASS' : 'FAIL'}  ${l}${d !== undefined ? '  [' + d + ']' : ''}`); };

console.log('the derived start');
t('is the month after the first invoice — July, not June',
  out.derived === '2026-07-01', out.derived);
t('and is what gets used when nothing is pinned', out.effective === out.derived);
t('15 unmatched payments as things stand', out.baseline === 15, out.baseline);

console.log('\nwhat a February backfill does UNPINNED');
t('the derived start jumps back to March', out.derivedAfterBackfill === '2026-03-01',
  out.derivedAfterBackfill);
t('and the list floods', out.floodedCount > 100, `${out.baseline} -> ${out.floodedCount}`);

console.log('\npinned, the same backfill is harmless');
t('the pin sticks', out.pinned === '2026-07-01', out.pinned);
t('the start is the pinned date, not the derived one', out.pinnedStart === '2026-07-01');
t('and the list is back to normal', out.pinnedCount <= out.baseline + 1,
  `${out.floodedCount} -> ${out.pinnedCount}`);

console.log('\nclearing and bad input');
t('clearing returns to the derived date', out.clearedBackToDerived === '2026-03-01',
  out.clearedBackToDerived);
t('a non-date is refused rather than stored', out.rubbishRejected);

console.log(fail.length ? `\n${fail.length} FAILURES:\n` + fail.join('\n') : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
