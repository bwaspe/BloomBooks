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
// Backfilling old invoices must not widen a reconciliation already worked
// through. Also checks a NEW supplier arrives on its own, since a May backfill
// brings several.
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(F.APP + '/cost-tracker.js', 'utf8');
const bk = F.book('bloom-books-backup-2026-08-27-1813 (1).json');
if (!bk) F.skip('needs bloom-books-backup-2026-08-27-1813 (1).json — put it in Downloads or set BLOOMBOOKS_FIXTURES');

const el = () => ({ innerHTML: '', value: '', options: { length: 2 }, style: {},
                    classList: { add(){}, remove(){} }, appendChild(){}, addEventListener(){} });
const sb = { appData: bk.appData, notify: () => {}, escHtml: String,
  fmt: n => '$' + Number(n).toFixed(2), confirm: () => true, prompt: () => 'x', console,
  switchPanel: () => {}, Chart: function () { return { destroy() {} }; },
  document: { getElementById: id => (id === 'ct-parse-area' ? el() : null),
              querySelector: () => el(), querySelectorAll: () => [], createElement: el },
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
  '  R.startBefore = ctReconcileFrom();',
  '  R.unmatchedBefore = ctUnmatchedPayments().length;',
  '',
  '  // Save a MAY invoice from a supplier never seen before.',
  '  var mk = function (n, q, u, p, tot) {',
  '    return { name:n, qty:q, uom:u, unit_price:p, total:tot, category:"Flowers",',
  '             family:"", priorPrice:null, stemsPerBu:null, removed:false }; };',
  '  window._ctUploadPending = [{ status:"ready", filename:"may.pdf",',
  '    deliveryDate:"2026-05-06", deliveryFee:0,',
  '    parsed:{ supplier:"Clifton Wholesale Florist", date:"2026-05-06",',
  '             invoice_number:"MD1", total:null },',
  '    enriched:[ mk("Roses Red Freedom", 20, "Bunch", 12.50, 250.00) ] }];',
  '  ctSaveUploadInvoice(0);',
  '',
  '  R.startAfter = ctReconcileFrom();',
  '  R.pinned = ctData.reconcileFrom;',
  '  R.derivedNow = ctReconcileDefault();',
  '  R.unmatchedAfter = ctUnmatchedPayments().length;',
  '  R.suppliers = Array.from(new Set(ctData.invoices.map(function (i) { return i.supplier; })));',
  '  R.newSupplierKept = R.suppliers.indexOf("Clifton Wholesale Florist") >= 0;',
  '',
  '  // A second invoice from the same new supplier, spelled differently, must',
  '  // resolve onto the first rather than making a third name.',
  '  R.canon = ctCanonicalSupplier("CLIFTON WHOLESALE FLORIST INC");',
  '',
  '  // And once pinned, saving something older again changes nothing.',
  '  window._ctUploadPending = [{ status:"ready", filename:"feb.pdf",',
  '    deliveryDate:"2026-02-10", deliveryFee:0,',
  '    parsed:{ supplier:"Perri Farms", date:"2026-02-10", invoice_number:"V1", total:null },',
  '    enriched:[ mk("Roses Red", 10, "Bunch", 20.00, 200.00) ] }];',
  '  ctSaveUploadInvoice(0);',
  '  R.startAfterSecond = ctReconcileFrom();',
  '  R.unmatchedFinal = ctUnmatchedPayments().length;',
  '  Date = RealDate;',
  '  __OUT__(R);',
  '})();',
].join('\n');

vm.runInNewContext(src + TAIL, sb, { filename: 'cost-tracker.js' });

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log(`  ${c ? 'PASS' : 'FAIL'}  ${l}${d !== undefined ? '  [' + d + ']' : ''}`); };

console.log('backfilling May does not widen the scan');
t('starts at 2026-07-01', out.startBefore === '2026-07-01', out.startBefore);
t('15 unmatched to begin with', out.unmatchedBefore === 15, out.unmatchedBefore);
t('the start is unchanged after saving a May invoice',
  out.startAfter === '2026-07-01', out.startAfter);
t('because it pinned itself', out.pinned === '2026-07-01', out.pinned);
t('the DERIVED value did move back, which is what was avoided',
  out.derivedNow === '2026-06-01', out.derivedNow);
t('so the list is still 15, not a hundred and sixty',
  out.unmatchedAfter === 15, out.unmatchedAfter);

console.log('\nand a February one after that changes nothing further');
t('start still July', out.startAfterSecond === '2026-07-01', out.startAfterSecond);
t('list still 15', out.unmatchedFinal === 15, out.unmatchedFinal);

console.log('\na new supplier arrives without setup');
t('kept under its own name', out.newSupplierKept, out.suppliers.join(' | '));
t('and a different spelling resolves onto it, not a duplicate',
  out.canon === 'Clifton Wholesale Florist', out.canon);

console.log(fail.length ? `\n${fail.length} FAILURES:\n` + fail.join('\n') : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
