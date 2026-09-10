const F = require('./fixtures');
// Naming a line item is how you find out it is wrong; the invoice is the only
// place it can be put right. Six screens named one and five stopped there --
// worst of all Price History, which four other screens hand you off TO.
//
// Every id rendered must also EXIST. A button that opens nothing is worse than
// no button, because it looks like the feature works.
const fs = require('fs'), vm = require('vm');
const BK = 'bloom-books-backup-2026-09-02-1936.json';
const __raw = F.file(BK);
if (!__raw) F.skip('needs ' + BK + ' — put it in Downloads or set BLOOMBOOKS_FIXTURES');
const j = JSON.parse(__raw);
const root = F.APP + '/';
const cfg = fs.readFileSync(root + 'config.js', 'utf8');
const rp  = fs.readFileSync(root + 'reports.js', 'utf8');
const ct  = fs.readFileSync(root + 'cost-tracker.js', 'utf8');

const el = () => ({ innerHTML: '', value: '', style: {}, classList: { add(){}, remove(){} },
                    appendChild(){}, addEventListener(){}, querySelectorAll: () => [] });
const sb = { console, notify: () => {}, saveData: () => {}, switchPanel: () => {},
  escHtml: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                 .replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  fmt: n => '$' + Number(n).toFixed(2),
  MONTHS_SHORT: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
  MONTHS: [], CATEGORIES2: [], holidaySetupHtml: () => '', holidayRefreshHtml: () => '',
  getTransactions: (y, m) => (j.appData.transactions[`${y}-${m}`] || []),
  Chart: function () { return { destroy() {} }; },
  easterSunday: y => new Date(Date.UTC(y, 3, 5)),
  document: { getElementById: () => null, querySelector: () => null,
              querySelectorAll: () => [], createElement: el },
  localStorage: { store: { bb_ctdata: JSON.stringify(j.ctData) },
                  getItem(k) { return this.store[k] || null; },
                  setItem(k, v) { this.store[k] = v; } } };
sb.window = sb;
sb.__BOOK__ = j.appData;
let out = null;
sb.__OUT__ = o => { out = o; };

vm.runInNewContext(cfg + '\n' + rp + '\n' + ct + `
;(function(){
  appData = __BOOK__;
  ctLoad();
  var ids = {};
  ctData.invoices.forEach(function(i){ ids[i.id] = 1; });

  // Every id a screen puts in an open button, pulled back out of its own HTML.
  var opened = function (html) {
    var out = [], re = /ctOpenInvoice\\('([^']*)'\\)/g, m;
    while ((m = re.exec(html))) out.push(m[1]);
    return out;
  };
  var allReal = function (list) {
    return list.length > 0 && list.every(function (id) { return !!ids[id]; });
  };

  // 1. Price History -- the hub four other screens jump to
  var ph = '';
  (function(){
    var byItem = {};
    ctData.invoices.forEach(function(inv){
      (inv.items||[]).forEach(function(it){
        var k = ctCatalogKey(it.name);
        byItem[k] = byItem[k] || { name: it.name, category: it.category, records: [] };
        byItem[k].records.push({ date: ctEffDate(inv), supplier: inv.supplier,
          price: ctEffectiveUnit(it), qty: it.qty, uom: it.uom,
          stemsPerBu: it.stemsPerBu || null, invoiceId: inv.id,
          itemIndex: inv.items.indexOf(it) });
      });
    });
    // Render one record row exactly as renderCtPrices does its history rows.
    var r = Object.values(byItem)[0].records[0];
    ph = ctOpenLineBtn(r.invoiceId, 'x');
  })();

  // 2. Stale margins
  var stale = ctGetStaleMargins();
  var staleHtml = stale.map(function(s){ return ctOpenLineBtn(s.invoiceId); }).join('');

  // 3. Price alerts
  var alerts = ctBuildAlerts();
  var alertHtml = alerts.map(function(a){
    return ctOpenLineBtn(a.invoiceId) + ctOpenLineBtn(a.priorInvoiceId); }).join('');

  // 4. Stems or bunches (already had it -- assert it stays)
  var counting = ctCountingHtml();

  // 7 + 8. The two screens added after this rule was established, which named
  // invoices as plain text -- exactly the mistake this file exists to catch.
  var explained = ctExplainedPaymentsHtml(ctExplainedPayments());
  var cardNote = (function () {
    var DAY = '2026-09-05';
    ctData.invoices.push({ id: 'inv-note-test', supplier: 'Perri Farms',
      invoiceNumber: '999', date: DAY, deliveryDate: DAY, deliveryFee: 16.5,
      total: 50, items: [] });
    var h = ctDeliveryFeeNoteHtml({ supplier: 'Perri Farms', effDate: DAY,
      current: 0, selfKey: 'g0', onAdd: 'x()' });
    ctData.invoices.pop();
    return h;
  })();

  // 5 + 6. The two holiday tables, rendered through the real reports.js
  var hcHtml = '', hcQty = '';
  var yr = 2026, month = 1;
  for (var y = 2024; y <= 2026; y++) {
    for (var m = 0; m < 12; m++) {
      var c = hcInvoiceCost(y, m);
      if (c && c.items && c.items.length > 3) { yr = y; month = m; }
    }
  }
  var cost = hcInvoiceCost(yr, month);
  var qty  = hcQtyByType(yr, month);
  hcQty = hcQtyHtml(yr, month);

  __OUT__({
    invoiceCount: ctData.invoices.length,
    priceHistory: { html: ph, ids: opened(ph), ok: allReal(opened(ph)) },
    stale: { n: stale.length, withId: stale.filter(function(s){ return !!s.invoiceId; }).length,
             ids: opened(staleHtml).length, ok: allReal(opened(staleHtml)) },
    alerts: { n: alerts.length, ids: opened(alertHtml).length, ok: allReal(opened(alertHtml)),
              bothEnds: alerts.length ? (!!alerts[0].invoiceId && !!alerts[0].priorInvoiceId) : false },
    counting: { ids: opened(counting).length, ok: allReal(opened(counting)) },
    explained: { rows: ctExplainedPayments().length,
                 ids: opened(explained).length, ok: allReal(opened(explained)) },
    cardNote: { html: cardNote, ids: opened(cardNote) },
    bought: { window: yr + '-' + (month + 1), lines: cost ? cost.items.length : 0,
              withId: cost ? cost.items.filter(function(i){ return !!i.invId; }).length : 0,
              allReal: cost ? cost.items.every(function(i){ return !!ids[i.invId]; }) : false },
    unresolved: { n: qty ? qty.unresolved.length : 0,
                  withId: qty ? qty.unresolved.filter(function(u){ return !!u.invId; }).length : 0,
                  allReal: qty ? qty.unresolved.every(function(u){ return !!ids[u.invId]; }) : false,
                  htmlHasOpen: hcQty.indexOf('ctOpenInvoice') >= 0 },
    // A missing id must render nothing rather than a button that opens nothing.
    blankIsSilent: ctOpenLineBtn(null) === '' && ctOpenLineBtn('') === '' &&
                   ctOpenLineBtn(undefined) === '',
    // The guard reports.js uses when the cost tracker has not loaded.
    guarded: (function(){ var f = ctOpenLineBtn; ctOpenLineBtn = undefined;
                          var r = hcOpenBtn('inv-x'); ctOpenLineBtn = f; return r === ''; })(),
    // An id with a quote in it cannot close the attribute.
    escaped: ctOpenLineBtn("inv-o'hara\\" onerror=x")
  });
})();`, sb, { filename: 'bundle.js' });

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log(`  ${c ? 'PASS' : 'FAIL'}  ${l}${d !== undefined ? '  [' + d + ']' : ''}`); };

console.log(`${out.invoiceCount} invoices\n`);
console.log('every screen that names a line item reaches its invoice');
t('Price History — the hub four screens jump to', out.priceHistory.ok, out.priceHistory.ids.join());
t('Stale Margins — every row carries an id', out.stale.n > 0 && out.stale.withId === out.stale.n,
  out.stale.withId + '/' + out.stale.n);
t('  and every one of them is a real invoice', out.stale.ok);
t('Price Alerts — both the new price and the old one',
  out.alerts.n > 0 && out.alerts.bothEnds && out.alerts.ok, out.alerts.ids + ' buttons');
t('Stems or bunches — kept', out.counting.ids > 0 && out.counting.ok, out.counting.ids + ' buttons');
t('Payments whose invoices do not add up — every invoice named opens',
  out.explained.rows > 0 && out.explained.ids > 0 && out.explained.ok,
  out.explained.rows + ' rows, ' + out.explained.ids + ' buttons');
t('the delivery-charge note on a review card opens the invoice carrying it',
  out.cardNote.ids.length === 1 && out.cardNote.ids[0] === 'inv-note-test',
  out.cardNote.ids.join());
t('Holiday "What was bought" — every line carries an id',
  out.bought.lines > 0 && out.bought.withId === out.bought.lines,
  out.bought.window + ': ' + out.bought.withId + '/' + out.bought.lines);
t('  and every one resolves to a real invoice', out.bought.allReal);
t('Holiday "no stem count" — the prose said fix it on the invoice',
  out.unresolved.n > 0 && out.unresolved.withId === out.unresolved.n,
  out.unresolved.withId + '/' + out.unresolved.n);
t('  and now there is a way to', out.unresolved.htmlHasOpen);
t('  reaching real invoices', out.unresolved.allReal);

console.log('\nand it fails safely');
t('no id renders nothing, not a button that opens nothing', out.blankIsSilent);
t('reports.js renders nothing when the cost tracker has not loaded', out.guarded);
// Escaped, not stripped: the apostrophe becomes \' for the JS string and the
// double quote an entity, so the id reaches ctOpenInvoice as it was written.
t('a quote in an id cannot close the attribute',
  out.escaped.indexOf('onerror=x"') === -1 &&
  out.escaped.indexOf(String.fromCharCode(92, 39)) >= 0 &&
  out.escaped.indexOf('&quot;') >= 0,
  out.escaped.slice(out.escaped.indexOf('ctOpenInvoice'), out.escaped.indexOf('ctOpenInvoice') + 50));

console.log(fail.length ? `\n${fail.length} FAILURES:\n` + fail.join('\n') : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
