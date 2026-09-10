const F = require('./fixtures');
// The scaling tolerance was tuned to absorb "the worst real miss of 0.72" on a
// $236.83 payment. Searching every subset size shows that payment has an EXACT
// five-invoice answer -- the 72 cents was never rounding, it was the four-deep
// search failing to reach it. And the owner's suppliers do not differ by cents:
// an invoice is paid to the cent or it is not that invoice. So the tolerance is
// a flat 5c now, covering a stored total rounded on the way in and nothing more.
// Tolerance, the per-row diagnosis, and silencing a vendor outright.
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(F.APP + '/cost-tracker.js', 'utf8');
const bk = F.book('bloom-books-backup-2026-08-27-1553.json');
if (!bk) F.skip('needs bloom-books-backup-2026-08-27-1553.json — put it in Downloads or set BLOOMBOOKS_FIXTURES');

const el = () => ({ innerHTML: '', value: '', options: { length: 2 }, style: {},
                    classList: { add(){}, remove(){} }, appendChild(){}, addEventListener(){} });
const sb = { appData: bk.appData, notify: () => {}, escHtml: String,
  fmt: n => '$' + Number(n).toFixed(2), confirm: () => true, prompt: () => 'x',
  console, Chart: function () { return { destroy() {} }; },
  document: { getElementById: el, querySelector: el, querySelectorAll: () => [], createElement: el },
  localStorage: { store: {}, getItem(k) { return this.store[k] || null; }, setItem(k, v) { this.store[k] = v; } } };
sb.window = sb;
let out = null;
sb.__OUT__ = o => { out = o; };
sb.__CT__ = bk.ctData;

const TAIL = [
  ';(function(){',
  '  ctData = Object.assign(ctData, __CT__);',
  '  ctData.noInvoiceVendors = {}; ctData.dismissedPayments = {};',
  '  var R = {};',
  '  var RealDate = Date;',
  '  Date = class extends RealDate {',
  '    constructor(...a) { return a.length ? new RealDate(...a) : new RealDate("2026-08-27T12:00:00Z"); }',
  '    static now() { return new RealDate("2026-08-27T12:00:00Z").getTime(); } };',
  '',
  '  R.tol = { small: ctMatchTolerance(1851), mid: ctMatchTolerance(23683),',
  '            big: ctMatchTolerance(500000), tiny: ctMatchTolerance(100) };',
  '',
  '  var inv = function (c) { return { d: "2026-08-01", c: c, sup: "Perri Farms", used: false }; };',
  '  R.exact    = !!ctFindSubset([inv(66341)], 66341).hit;',
  '  R.within   = !!ctFindSubset([inv(66345)], 66341).hit;',
  '  R.worstReal= !!ctFindSubset([inv(23611)], 23683).hit;',
  '  R.tooFar   = !!ctFindSubset([inv(23000)], 23683).hit;',
  '  R.smallOK  = !!ctFindSubset([inv(1800)], 1851).hit;',
  '  R.multi    = !!ctFindSubset([inv(10000), inv(8000), inv(5683)], 23683).hit;',
  '  var miss   = ctFindSubset([inv(10000), inv(8000)], 23683);',
  '  R.bestBack = miss.best ? miss.best.sum : null;',
  '',
  '  R.before = ctUnmatchedPayments().length;',
  '  var rows = ctUnmatchedPayments();',
  '  R.everyRowHasWhy = rows.every(function (r) { return !!r._why; });',
  '  R.whySamples = rows.slice(0, 4).map(function (r) { return (r.vendor || "").slice(0, 18) + " :: " + r._why; });',
  '  R.noCandidateRows = rows.filter(function (r) { return r._cands === 0; }).length;',
  '',
  '  var tj = rows.find(function (r) { return /trader/i.test(r.vendor || ""); });',
  '  R.hadTraderJoes = !!tj;',
  '  ctIgnoreVendor(tj.id);',
  '  var after = ctUnmatchedPayments();',
  '  R.afterSilence = after.length;',
  '  R.traderGone = !after.some(function (r) { return /trader/i.test(r.vendor || ""); });',
  '  R.persisted = !!JSON.parse(localStorage.getItem("bb_ctdata") || "{}").noInvoiceVendors;',
  '  ctExpectInvoicesAgain();',
  '  R.afterRestore = ctUnmatchedPayments().length;',
  '  Date = RealDate;',
  '  __OUT__(R);',
  '})();',
].join('\n');

vm.runInNewContext(src + TAIL, sb, { filename: 'cost-tracker.js' });

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log(`  ${c ? 'PASS' : 'FAIL'}  ${l}${d !== undefined ? '  [' + d + ']' : ''}`); };

console.log('tolerance is a flat five cents, whatever the amount');
t('$18.51 gets 5c', out.tol.small === 5, out.tol.small);
t('$236.83 gets 5c too — no room to absorb 72 cents', out.tol.mid === 5, out.tol.mid);
t('$5000 gets 5c, not $2', out.tol.big === 5, out.tol.big);
t('$1.00 gets 5c', out.tol.tiny === 5, out.tol.tiny);

console.log('\nmatching');
t('an exact match still matches', out.exact);
t('4c out on $663.41 now matches', out.within);
t('72c out on $236.83 does NOT match — that payment has an exact five-invoice answer',
  !out.worstReal);
t('$6.83 out does NOT match', !out.tooFar);
t('51c out on $18.51 does NOT match (5c floor holds)', !out.smallOK);
t('three invoices summing to the payment match', out.multi);
t('a miss reports how close it got', out.bestBack === 18000, out.bestBack);

console.log('\nevery row explains itself');
t('all rows carry a reason', out.everyRowHasWhy);
t('some say there is no invoice near that date', out.noCandidateRows > 0, out.noCandidateRows);
console.log('    ' + out.whySamples.join('\n    '));

console.log('\nsilencing a vendor');
t('Trader Joes was listed', out.hadTraderJoes);
t('silencing it removes it', out.traderGone);
t('and only it', out.afterSilence === out.before - 1, `${out.before} -> ${out.afterSilence}`);
t('the choice persists', out.persisted);
t('restoring brings it back', out.afterRestore === out.before, out.afterRestore);

console.log(fail.length ? `\n${fail.length} FAILURES:\n` + fail.join('\n') : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
