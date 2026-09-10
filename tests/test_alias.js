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
// Every earlier suite ran with vendorAliases EMPTY, which is why none of them
// caught that setting one shredded the name it aliased to. This one sets them.
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
  '  var R = { aliases: ctData.vendorAliases };',
  '  R.pairs = [',
  '    ["Main Wholesale Florist", "Main Wholesale Florist NY"],',
  '    ["Juliet", "Juliet Wholesale Flowers"],',
  '    ["Delaware Valley Florist", "DVFlora"],',
  '    ["A. Perri Farms", "Perri Farms"]',
  '  ].map(function (p) { return { a: p[0], b: p[1], same: ctSameVendor(p[0], p[1]),',
  '                                tok: Array.from(ctNameTokens(p[0])) }; });',
  '  R.withAliases = ctUnmatchedPayments().length;',
  '  // The same book with no aliases at all: an alias must never make it worse.',
  '  var saved = ctData.vendorAliases; ctData.vendorAliases = {};',
  '  R.withoutAliases = ctUnmatchedPayments().length;',
  '  ctData.vendorAliases = saved;',
  '  // An alias whose target has punctuation and capitals must still tokenise.',
  '  ctData.vendorAliases = { "some bank name": "A. Perri Farms, Inc." };',
  '  R.punctTokens = Array.from(ctNameTokens("some bank name"));',
  '  R.punctMatches = ctSameVendor("some bank name", "Perri Farms");',
  '  ctData.vendorAliases = saved;',
  '  Date = RealDate;',
  '  __OUT__(R);',
  '})();',
].join('\n');

vm.runInNewContext(src + TAIL, sb, { filename: 'cost-tracker.js' });

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log(`  ${c ? 'PASS' : 'FAIL'}  ${l}${d !== undefined ? '  [' + d + ']' : ''}`); };

console.log('aliases in the live book: ' + JSON.stringify(out.aliases));
console.log('\nan aliased bank name still matches its supplier');
out.pairs.forEach(p => t(`${p.a}  ->  ${p.b}`, p.same, p.tok.join(',')));

console.log('\nan alias may never make matching worse');
t('fewer unmatched with the aliases than without',
  out.withAliases <= out.withoutAliases,
  `with ${out.withAliases}, without ${out.withoutAliases}`);
t('and the live count is 15, not 42', out.withAliases === 15, out.withAliases);

console.log('\nan alias target with capitals and punctuation');
t('tokenises to the real word', out.punctTokens.indexOf('perri') >= 0, out.punctTokens.join(','));
t('and matches the supplier', out.punctMatches);

console.log(fail.length ? `\n${fail.length} FAILURES:\n` + fail.join('\n') : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
