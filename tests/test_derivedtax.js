const F = require('./fixtures');
// An "all taxable" channel has no second source for its tax: every dollar is
// taxable by definition, so tax IS sales x rate. Recording that and then
// comparing it against sales x rate proves nothing -- and asking for it made
// the page report $0.00 collected on a quarter that plainly collected some.
const fs = require('fs'), vm = require('vm');
const BK = 'bloom-books-backup-2026-09-08-1904.json';
const __raw = F.file(BK);
if (!__raw) F.skip('needs ' + BK + ' — put it in Downloads or set BLOOMBOOKS_FIXTURES');
const j = JSON.parse(__raw);
const src = ['config.js','utils.js','daily-sales.js']
  .map(f => fs.readFileSync(F.APP + '/' + f, 'utf8')).join('\n');
const el = () => ({ innerHTML:'', value:'', style:{}, classList:{add(){},remove(){}},
                    appendChild(){}, addEventListener(){}, querySelectorAll:()=>[] });
const sb = { console, notify(){}, saveData(){}, switchPanel(){},
  escHtml: s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;'),
  fmt: n => '$' + Number(n).toFixed(2),
  Chart: function(){ return { destroy(){} }; },
  document: { getElementById:()=>null, querySelector:()=>null, querySelectorAll:()=>[], createElement: el },
  localStorage: { store:{}, getItem(k){return this.store[k]||null;}, setItem(k,v){this.store[k]=v;} } };
sb.window = sb;
let out = null; sb.__OUT__ = o => { out = o; };

vm.runInNewContext(src + `
;(function(){
  appData = __BOOK__;
  var R = DS_TAX_RATE, r2 = function (n) { return Math.round(n*100)/100; };
  var pick = function (r) { return {
    taxable: r2(r.tot.taxable), tax: r2(r.tot.tax),
    derived: r2(r.tot.derivedTax), derivedOn: r2(r.tot.derivedTaxable),
    derivedCh: r.tot.derivedChannels.slice(),
    checked: r2(r.tot.checkedTaxable), unchecked: r2(r.tot.uncheckedTaxable),
    uncheckedCh: r.tot.uncheckedChannels.slice(),
    gap: r2((r.tot.tax - r.tot.derivedTax) - r2(r.tot.checkedTaxable * R)),
    epxTax: r2((r.byChannel.epx||{}).tax || 0) }; };

  var q3 = pick(dsTaxReport(2025, 2));                 // all EPX, nothing recorded
  var q2_26 = pick(dsTaxReport(2026, 1));              // FloraNext months, tax recorded

  // A figure typed on a day must beat the derived one.
  var mo = appData.dailySales['2025-7'], day = Object.keys(mo).find(function (d) {
    return mo[d].epx && mo[d].epx.s; });
  var sale = mo[day].epx.s;
  mo[day].epx.t = 999;
  var overridden = pick(dsTaxReport(2025, 2));
  delete mo[day].epx.t;

  // The unit itself.
  var unit = {
    recordedWins:   dsDayTax({ s: 100, t: 7 }, 100, 'all'),
    derivedAll:     dsDayTax({ s: 100 },       100, 'all'),
    exemptIsZero:   dsDayTax({ s: 100 },         0, 'exempt'),
    detailStaysGap: dsDayTax({ s: 100, x: 100 }, 100, 'detail'),
    detailNoBase:   dsDayTax({ s: 100 },      null, 'detail'),
    negative:       dsDayTax({ s: -50 },       -50, 'all')
  };

  __OUT__({ q3: q3, q2_26: q2_26, overridden: overridden, unit: unit,
            sale: sale, rate: R });
})();`, Object.assign(sb, { __BOOK__: j.appData }), { filename: 'ds.js' });

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log(`  ${c?'PASS':'FAIL'}  ${l}${d!==undefined?'  ['+d+']':''}`); };
const o = out;

console.log('Jun-Aug 2025 — $3,052 of counter card takings, no tax ever typed');
// $255.60 rather than $255.61: the tax is worked out on each DAY and rounded
// to the cent there, which is how it was charged, rather than on the quarter in
// one go. The penny is the difference between the two and is not worth chasing.
t('the tax is no longer reported as zero', o.q3.tax === 255.60, '$' + o.q3.tax);
t('and it is labelled as worked out, not collected-and-recorded',
  o.q3.derived === 255.60 && o.q3.derivedCh.join() === 'epx', '$' + o.q3.derived + ' on ' + o.q3.derivedCh.join());
t('which is within a penny of the whole quarter at the rate',
  Math.abs(o.q3.derived - o.q3.taxable * o.rate) < 0.02,
  '$' + (o.q3.taxable * o.rate).toFixed(4) + ' in one go');
t('nothing is left demanding to be entered',
  o.q3.unchecked === 0 && o.q3.uncheckedCh.length === 0);
t('and no gap is claimed against a figure derived from the same sales',
  Math.abs(o.q3.gap) < 1, '$' + o.q3.gap);
t('taxable sales — the figure the filing asks for — is unchanged',
  o.q3.taxable === 3052, '$' + o.q3.taxable);

console.log('\na figure typed on a day still beats the arithmetic');
t('one day set to $999 moves the total by 999 minus what it derived',
  Math.abs(o.overridden.tax - (o.q3.tax - Math.round(o.sale * o.rate * 100) / 100 + 999)) < 0.02,
  '$' + o.overridden.tax);
t('and that day is no longer counted as derived',
  o.overridden.derived < o.q3.derived, '$' + o.overridden.derived);
t('it becomes a checked day instead',
  o.overridden.checked === o.sale, '$' + o.overridden.checked + ' of sale $' + o.sale);

console.log('\na quarter whose FloraNext tax really was recorded still checks it');
t('only the counter card machine is derived there — not the POS channels',
  o.q2_26.derivedCh.join() === 'epx', o.q2_26.derivedCh.join() || '(none)');
t('its cross-check still runs on the rest', o.q2_26.checked > 0, '$' + o.q2_26.checked + ' checkable');
t('and that check still balances', Math.abs(o.q2_26.gap) < 25, '$' + o.q2_26.gap);

console.log('\nthe rule itself');
t('a recorded figure wins', o.unit.recordedWins.tax === 7 && !o.unit.recordedWins.derived);
t('"all taxable" with none recorded derives', o.unit.derivedAll.tax === 8.38 && o.unit.derivedAll.derived,
  '$' + o.unit.derivedAll.tax);
t('"all exempt" derives zero', o.unit.exemptIsZero.tax === 0 && o.unit.exemptIsZero.derived);
t('"per order" never derives — a missing figure there is a real hole',
  o.unit.detailStaysGap.tax === 0 && !o.unit.detailStaysGap.derived);
t('and neither does one with no taxable base at all',
  o.unit.detailNoBase.tax === 0 && !o.unit.detailNoBase.derived);
t('a refund day derives a negative tax', o.unit.negative.tax === -4.19, '$' + o.unit.negative.tax);

console.log(fail.length ? `\n${fail.length} FAILURES:\n` + fail.join('\n') : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
