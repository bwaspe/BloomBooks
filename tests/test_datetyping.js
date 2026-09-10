const F = require('./fixtures');
// A year could only be typed two digits at a time. Chrome fires `change` on a
// date input as soon as its value is a COMPLETE valid date, and "0002-09-05" is
// complete and valid the instant the first digit of the year is typed -- so the
// handler stored it and re-rendered, destroying the input mid-keystroke.
const fs = require('fs'), vm = require('vm');
const BK = 'bloom-books-backup-2026-09-02-1936.json';
const __raw = F.file(BK);
if (!__raw) F.skip('needs ' + BK + ' — put it in Downloads or set BLOOMBOOKS_FIXTURES');
const j = JSON.parse(__raw);
const src = fs.readFileSync(F.APP + '/cost-tracker.js', 'utf8');

const el = () => ({ innerHTML: '', value: '', style: {}, classList: { add(){}, remove(){} },
                    appendChild(){}, addEventListener(){}, querySelectorAll: () => [] });
const sb = { appData: j.appData, console, notify: () => {}, saveData: () => {}, switchPanel: () => {},
  escHtml: String, fmt: n => '$' + n,
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
  // What Chrome actually emits while someone types 09/05/2026 into a date field.
  const KEYSTROKES = ['0002-09-05', '0020-09-05', '0202-09-05', '2026-09-05'];

  const settled = KEYSTROKES.map(ctDateSettled);

  // A scanned card: only the finished date should land.
  window._ctGmailPending = [{ supplier: 'Perri Farms', invoiceNumber: 'X',
    date: '2026-06-26', deliveryDate: null, deliveryFee: 0, total: 1, items: [] }];
  KEYSTROKES.forEach(k => ctUpdateGmailDate(0, k));
  const gmailDate = window._ctGmailPending[0].date;
  KEYSTROKES.forEach(k => ctUpdateGmailDeliveryDate(0, k));
  const gmailDelivery = window._ctGmailPending[0].deliveryDate;
  ctUpdateGmailDeliveryDate(0, '');
  const cleared = window._ctGmailPending[0].deliveryDate;
  ctUpdateGmailDate(0, '');
  const dateKept = window._ctGmailPending[0].date;
  window._ctGmailPending = null;

  // An uploaded card.
  window._ctUploadPending = [{ status: 'ready', parsed: { date: '2026-06-26' },
    deliveryDate: null, deliveryFee: 0 }];
  KEYSTROKES.forEach(k => ctUpdateUploadDeliveryDate(0, k));
  const uploadDelivery = window._ctUploadPending[0].deliveryDate;
  window._ctUploadPending = null;

  // The saved-invoice editor.
  window._ctEditingInvoice = { id: 'x', supplier: 'Perri Farms', date: '2026-06-26',
    deliveryDate: null, items: [] };
  KEYSTROKES.forEach(k => ctEditUpdateField('date', k));
  const editDate = window._ctEditingInvoice.date;
  // a NON-date field on the same setter must be unaffected
  ctEditUpdateField('supplier', 'Perri Farms Inc');
  const editSupplier = window._ctEditingInvoice.supplier;
  window._ctEditingInvoice = null;

  // The reconcile-from control, which drives the whole payment check.
  const beforeFrom = ctData.reconcileFrom;
  KEYSTROKES.slice(0, 3).forEach(k => ctSetReconcileFrom(k));
  const partialFrom = ctData.reconcileFrom;
  ctSetReconcileFrom('2026-07-01');
  const finalFrom = ctData.reconcileFrom;
  ctData.reconcileFrom = beforeFrom;

  __OUT__({ settled, gmailDate, gmailDelivery, cleared, dateKept, uploadDelivery,
            editDate, editSupplier, beforeFrom, partialFrom, finalFrom });
})();`, sb, { filename: 'ct.js' });

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log(`  ${c ? 'PASS' : 'FAIL'}  ${l}${d !== undefined ? '  [' + d + ']' : ''}`); };
const o = out;

console.log('typing 09/05/2026 emits four values; only the last is a real date');
t('0002, 0020 and 0202 are not settled, 2026 is',
  JSON.stringify(o.settled) === '[false,false,false,true]', JSON.stringify(o.settled));

console.log('\nso only the finished date is stored, everywhere a date is edited');
t('scanned card, invoice date', o.gmailDate === '2026-09-05', o.gmailDate);
t('scanned card, delivery date', o.gmailDelivery === '2026-09-05', o.gmailDelivery);
t('uploaded card, delivery date', o.uploadDelivery === '2026-09-05', o.uploadDelivery);
t('saved-invoice editor, invoice date', o.editDate === '2026-09-05', o.editDate);
t('the reconcile-from control is not dragged back to the year 202',
  o.partialFrom === o.beforeFrom && o.finalFrom === '2026-07-01',
  o.partialFrom + ' -> ' + o.finalFrom);

console.log('\nand clearing a date still works — an empty value is settled');
t('a delivery date can be cleared', o.cleared === null, JSON.stringify(o.cleared));
t('but an invoice date cannot be blanked — it files nowhere',
  o.dateKept === '2026-09-05', o.dateKept);
t('a non-date field on the same setter is unaffected',
  o.editSupplier === 'Perri Farms Inc', o.editSupplier);

console.log(fail.length ? `\n${fail.length} FAILURES:\n` + fail.join('\n') : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
