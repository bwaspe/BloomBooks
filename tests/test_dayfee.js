const F = require('./fixtures');
// The delivery charge, asked about while the card is still open rather than
// found weeks later against a bank statement.
//
// One charge per DELIVERY DAY, not per document. Several orders placed for one
// day's delivery share a charge and produce an acknowledgment each, so a
// per-document prompt would fire on three of a Tuesday's four cards and be
// wrong every time.
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
  const DAY = '2026-09-05';                 // a day with nothing saved against it
  const card = (fee, date) => ({ supplier: 'Perri Farms', invoiceNumber: 'X1',
    date: date || DAY, deliveryDate: date === null ? null : (date || DAY),
    deliveryFee: fee || 0, total: 100, items: [] });

  const note = (opts) => ctDeliveryFeeNoteHtml(Object.assign(
    { supplier: 'Perri Farms', effDate: DAY, current: 0, selfKey: 'g0',
      onAdd: 'x()' }, opts));

  window._ctGmailPending = null; window._ctUploadPending = null;
  const asks = note({});

  // A card that already has the charge says nothing at all.
  const quietWhenSet = note({ current: 16.5 });

  // A supplier with no habit is never asked about.
  const noHabit = note({ supplier: 'Trader Joes' });

  // No delivery date: it cannot know which day, and says so instead of guessing.
  const noDate = note({ effDate: '' });

  // A SIBLING CARD in the same batch already carrying it quiets this one.
  window._ctGmailPending = [card(0), card(16.5)];
  const coveredByBatch = note({ selfKey: 'g0' });
  // ...and the sibling itself is not told it is covered by itself.
  const notSelfCovered = note({ selfKey: 'g1', current: 0 });
  window._ctGmailPending = null;

  // A SAVED invoice for the same day quiets it too.
  ctData.invoices.push({ id: 'inv-test-saved', supplier: 'Perri Farms',
    invoiceNumber: '999', date: DAY, deliveryDate: DAY, deliveryFee: 16.5,
    total: 50, items: [] });
  const coveredBySaved = note({});
  // A DIFFERENT day is still asked about.
  const otherDay = note({ effDate: '2026-09-06' });
  // A different SUPPLIER on the same day is still asked about.
  const otherSupplier = note({ supplier: 'Main Wholesale Florist NY' });
  ctData.invoices.pop();

  // Adding it from the card, and the sibling flipping to covered.
  window._ctGmailPending = [card(0), card(0)];
  ctAddGmailDeliveryFee(0);
  const added = window._ctGmailPending[0].deliveryFee;
  const siblingNow = note({ selfKey: 'g1' });
  window._ctGmailPending = null;

  __OUT__({
    asks: asks, quietWhenSet: quietWhenSet, noHabit: noHabit, noDate: noDate,
    coveredByBatch: coveredByBatch, notSelfCovered: notSelfCovered,
    coveredBySaved: coveredBySaved, otherDay: otherDay, otherSupplier: otherSupplier,
    added: added, siblingNow: siblingNow
  });
})();`, sb, { filename: 'ct.js' });

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log(`  ${c ? 'PASS' : 'FAIL'}  ${l}${d !== undefined ? '  [' + d + ']' : ''}`); };
const o = out;
const asksFor = h => /usually charges/.test(h) && /add \$16\.50/.test(h);
const saysCovered = h => /already on/.test(h);

console.log('it asks, once, on the day that needs it');
t('a Perri card with no charge is asked about $16.50', asksFor(o.asks));
t('a card that already has the charge says nothing', o.quietWhenSet === '',
  JSON.stringify(o.quietWhenSet));
t('a supplier with no habit is never asked', o.noHabit === '', JSON.stringify(o.noHabit));
t('with no delivery date it says so rather than guessing a day',
  /set a delivery\s+date/.test(o.noDate) && !/add \$/.test(o.noDate), o.noDate.trim().slice(0, 70));

console.log('\nand it counts the DAY, not the document');
t('a sibling card in the same batch quiets it', saysCovered(o.coveredByBatch),
  o.coveredByBatch.replace(/\s+/g, ' ').trim().slice(0, 74));
t('the card holding the charge is not told it is covered by itself',
  asksFor(o.notSelfCovered) === false || !saysCovered(o.notSelfCovered));
t('a saved invoice for the same day quiets it', saysCovered(o.coveredBySaved));
t('a different day is still asked about', asksFor(o.otherDay));
t('a different supplier on the same day is still asked about',
  /usually charges/.test(o.otherSupplier) && /18\.75/.test(o.otherSupplier),
  o.otherSupplier.replace(/\s+/g, ' ').trim().slice(0, 74));

console.log('\nand adding it settles the whole day at once');
t('the button puts $16.50 on the card', o.added === 16.5, o.added);
t('the sibling immediately reads as covered', saysCovered(o.siblingNow),
  o.siblingNow.replace(/\s+/g, ' ').trim().slice(0, 74));

console.log(fail.length ? `\n${fail.length} FAILURES:\n` + fail.join('\n') : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
