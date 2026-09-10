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
// The row has to distinguish "this supplier billed nothing" from "the bank
// spells them in a way nothing matches" -- those look identical and need
// opposite responses. DVFG sat one day after a DVFlora invoice and reported as
// though nothing had been delivered.
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
  '  var RealDate = Date;',
  '  Date = class extends RealDate {',
  '    constructor(...a) { return a.length ? new RealDate(...a) : new RealDate("2026-08-27T18:13:00Z"); }',
  '    static now() { return new RealDate("2026-08-27T18:13:00Z").getTime(); } };',
  '  var R = {};',
  '  R.overlap = { dv: ctNamePrefixOverlap("DVFG", "DVFlora"),',
  '                tj: ctNamePrefixOverlap("Trader Joes", "Juliet Wholesale Flowers"),',
  '                allweld: ctNamePrefixOverlap("ALL-WELD PRODUCTS COGREENB", "DVFlora"),',
  '                main: ctNamePrefixOverlap("Main Wholesale Florist", "Main Wholesale Florist NY") };',
  '  var rows = ctUnmatchedPayments();',
  '  var pick = function (re) { return rows.filter(function (r) {',
  '      return re.test(String(r.vendor || r.desc || "")); }); };',
  '  R.dvfg    = pick(/DVFG/).map(function (r) { return { d: r.date, why: r._why, sug: r._suggest }; });',
  '  R.trader  = pick(/Trader/).map(function (r) { return { why: r._why, sug: r._suggest }; });',
  '  R.allweld = pick(/ALL-WELD/).map(function (r) { return { why: r._why, sug: r._suggest }; });',
  '  R.shortfalls = rows.filter(function (r) { return r._cands > 0; })',
  '    .slice(0, 3).map(function (r) { return r._why; });',
  '  R.count = rows.length;',
  '  Date = RealDate;',
  '  __OUT__(R);',
  '})();',
].join('\n');

vm.runInNewContext(src + TAIL, sb, { filename: 'cost-tracker.js' });

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log(`  ${c ? 'PASS' : 'FAIL'}  ${l}${d !== undefined ? '  [' + d + ']' : ''}`); };

console.log('name resemblance, used only to decide what to SUGGEST');
t('DVFG and DVFlora share 3 leading letters (d, v, f)', out.overlap.dv === 3, out.overlap.dv);
t('Trader Joes shares none with Juliet', out.overlap.tj === 0, out.overlap.tj);
t('ALL-WELD shares none with DVFlora', out.overlap.allweld === 0, out.overlap.allweld);

console.log('\nthe DVFG row that started this');
t('both DVFG rows are present', out.dvfg.length === 2, out.dvfg.length);
t('it says the name is not linked, not that no invoice exists',
  out.dvfg.every(r => /not linked to any supplier/.test(r.why)));
t('and it names DVFlora', out.dvfg.every(r => /DVFlora/.test(r.why)), out.dvfg[0] && out.dvfg[0].why);
t('with correct singular grammar', out.dvfg.every(r => /has an unmatched invoice/.test(r.why)));
t('DVFlora is offered in the dropdown',
  out.dvfg.every(r => (r.sug || []).indexOf('DVFlora') >= 0), JSON.stringify(out.dvfg[0].sug));

console.log('\ngenuine retail gets no misleading suggestion');
t('Trader Joes says only that it is unlinked',
  out.trader.every(r => /not linked to any supplier$/.test(r.why)), out.trader[0] && out.trader[0].why);
t('and suggests nobody', out.trader.every(r => !(r.sug || []).length));
t('ALL-WELD likewise', out.allweld.every(r => !(r.sug || []).length && /not linked/.test(r.why)));

console.log('\nrows that DID find candidates still report the shortfall');
t('they quote a closest figure', out.shortfalls.every(w => /closest is/.test(w)));
console.log('    ' + out.shortfalls.join('\n    '));
t('the count is unchanged at 15', out.count === 15, out.count);

console.log(fail.length ? `\n${fail.length} FAILURES:\n` + fail.join('\n') : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
