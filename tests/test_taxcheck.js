const F = require('./fixtures');
// The cross-check asked whether a CHANNEL had any tax recorded, so one day
// carrying a figure marked every day on that channel as checked -- and a
// half-filled quarter reported a shortfall that was only the unfilled half.
// It now asks the day.
//
// EPX no longer reaches this path at all (it derives -- see test_derivedtax),
// so the rule is exercised here on a 'detail' channel, which is where a missing
// tax figure is still a real hole rather than arithmetic nobody wrote down.
const fs = require('fs'), vm = require('vm');
const BK = 'bloom-books-backup-2026-09-08-1904.json';
const __raw = F.file(BK);
if (!__raw) F.skip('needs ' + BK + ' — put it in Downloads or set BLOOMBOOKS_FIXTURES');
const j = JSON.parse(__raw);
const src = ['config.js', 'utils.js', 'daily-sales.js']
  .map(f => fs.readFileSync(F.APP + '/' + f, 'utf8')).join('\n');

const el = () => ({ innerHTML: '', value: '', style: {}, classList: { add() {}, remove() {} },
                    appendChild() {}, addEventListener() {}, querySelectorAll: () => [] });
const sb = { console, notify() {}, saveData() {}, switchPanel() {},
  escHtml: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
  fmt: n => '$' + Number(n).toFixed(2),
  Chart: function () { return { destroy() {} }; },
  document: { getElementById: () => null, querySelector: () => null,
              querySelectorAll: () => [], createElement: el },
  localStorage: { store: {}, getItem(k) { return this.store[k] || null; },
                  setItem(k, v) { this.store[k] = v; } } };
sb.window = sb;
let out = null;
sb.__OUT__ = o => { out = o; };

const TAIL = `
;(function(){
  appData = __BOOK__;
  var R = DS_TAX_RATE, r2 = function (n) { return Math.round(n*100)/100; };
  var pick = function (r) { return {
    checked: r2(r.tot.checkedTaxable), unchecked: r2(r.tot.uncheckedTaxable),
    channels: r.tot.uncheckedChannels.slice(),
    gap: r2((r.tot.tax - r.tot.derivedTax) - r2(r.tot.checkedTaxable * R)) }; };

  // Mar-May 2026, where the FloraNext channels carry a real per-order tax.
  var Y = 2026, Q = 1, KEYS = ['2026-2','2026-3','2026-4'], CH = 'counter';
  var whole = pick(dsTaxReport(Y, Q));

  // Strip the tax off ONE month, the way a half-done import would leave it.
  var stripped = [], cleared = 0;
  Object.keys(appData.dailySales['2026-4'] || {}).forEach(function (d) {
    var rec = (appData.dailySales['2026-4'][d] || {})[CH];
    if (!rec || !rec.t) return;
    stripped.push([d, rec.t]); delete rec.t; cleared++;
  });
  var half = pick(dsTaxReport(Y, Q));
  var strippedTaxable = 0;
  Object.keys(appData.dailySales['2026-4'] || {}).forEach(function (d) {
    var rec = (appData.dailySales['2026-4'][d] || {})[CH];
    if (rec && rec.x != null && !rec.t) strippedTaxable += Number(rec.x) || 0;
  });

  stripped.forEach(function (p) { appData.dailySales['2026-4'][p[0]][CH].t = p[1]; });
  var restored = pick(dsTaxReport(Y, Q));

  __OUT__({ whole: whole, half: half, restored: restored,
            cleared: cleared, strippedTaxable: r2(strippedTaxable) });
})();`;

vm.runInNewContext(src + TAIL, Object.assign(sb, { __BOOK__: j.appData }), { filename: 'ds.js' });

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };
const o = out;

console.log('Mar-May 2026, every counter day carrying its own tax figure');
t('nothing is reported as unchecked', o.whole.unchecked === 0, '$' + o.whole.unchecked);
t('and the check balances', Math.abs(o.whole.gap) < 25, '$' + o.whole.gap);

console.log('\nstrip the tax off ONE of the three months — the case that used to lie');
t('it cleared ' + o.cleared + ' days', o.cleared > 0);
t('only those days fall out of the check, not the whole channel',
  Math.abs(o.half.unchecked - o.strippedTaxable) < 0.02,
  '$' + o.half.unchecked + ' unchecked of $' + o.strippedTaxable + ' stripped');
t('the other two months stay checkable',
  o.half.checked > 0 && Math.abs(o.half.checked - (o.whole.checked - o.strippedTaxable)) < 0.02,
  '$' + o.half.checked + ' still checkable');
t('and no phantom shortfall is reported', Math.abs(o.half.gap) < 25, '$' + o.half.gap);
console.log('      (keyed on the channel this read $' + o.whole.checked.toFixed(2) +
            ' checkable and a gap of about -$' + (o.strippedTaxable * 0.08375).toFixed(2) + ')');

console.log('\nput it back');
t('everything checkable again', Math.abs(o.restored.checked - o.whole.checked) < 0.02);
t('and nothing left unchecked', o.restored.unchecked === 0);

console.log(fail.length ? '\n' + fail.length + ' FAILURES:\n' + fail.join('\n') : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
