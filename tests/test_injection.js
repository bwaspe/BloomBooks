// Text from outside cannot run as code.
//
// Bank and card descriptions, merchant names and invoice lines are written by
// other people -- whoever sends a Zelle, a merchant's own descriptor, a
// supplier's invoice read by the parser -- and the page they are shown on holds
// the Google sign-in. So each place that builds a screen or a button from such
// text is fed text built to break out, and the suite checks the result the way
// a browser would read it: attributes decoded, handlers actually run.
//
// A handler passes when it calls the app's own function with the text intact
// and nothing else happens. `pwned` is what a successful break-out sets.
const F = require('./fixtures');
const vm = require('vm');

const PAYLOADS = [
  'x" onmouseover="pwned=1',
  "x');pwned=1;('",
  "x\\');pwned=1;//",
  'x&quot;);pwned=1;//',
  'x&#39;);pwned=1;//',
  'x\npwned=1',
  '<img src=x onerror="pwned=1">'
];

const decode = s => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// Every on…="…" attribute in a piece of markup, as the browser would see it.
function handlers(html) {
  const out = [];
  const re = /\s(on[a-z]+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(html))) out.push({ name: m[1], js: decode(m[2]) });
  return out;
}

// Runs one handler with the app's functions stood in for, and reports what was called.
function runHandler(js, names) {
  const calls = [];
  const box = { pwned: 0, event: { stopPropagation() {} }, this: { value: 'v' } };
  names.forEach(n => { box[n] = (...args) => { calls.push({ fn: n, args }); }; });
  vm.createContext(box);
  let threw = null;
  try { vm.runInContext('(function(){' + js + '\n}).call({ value: "v" })', box); } catch (e) { threw = e.message; }
  return { calls, pwned: box.pwned, threw };
}

const sb = F.sandbox({ setTimeout: () => 0, clearTimeout: () => {} });
const els = {};
sb.document.getElementById = id => els[id] || (els[id] = { id, innerHTML: '', style: {}, parentElement: { innerHTML: '' },
                                                          getContext: () => ({}), classList: { add() {}, remove() {} } });
sb.document.body = { classList: { toggle() {}, contains: () => false } };
sb.navigator = { userAgent: 'test' };
sb.Chart = function () { return { destroy() {} }; };
sb.Chart.getChart = () => null;
let printed = '';
sb.window.open = () => ({ document: { write(h) { printed += h; }, close() {} } });
vm.createContext(sb);
vm.runInContext(F.src(['config.js', 'utils.js', 'sync.js', 'periodlock.js', 'audit.js', 'ledger.js', 'reports.js',
                       'daily-sales.js', 'import-trainer.js', 'cost-tracker.js']), sb, { filename: 'bb.js' });
const S = code => vm.runInContext(code, sb);

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };

// Checks every handler in `html` against every payload: the payload must reach
// the named function whole, and nothing else may run.
function handlersHold(html, payload, fnNames) {
  const hs = handlers(html);
  if (!hs.length) return { ok: false, why: 'no handlers found' };
  // A raw quote after the attribute name is a real attribute; escaped text reads &quot;.
  if (/\son(mouseover|error)="|<img\b/i.test(html)) return { ok: false, why: 'markup broke out' };
  for (const h of hs) {
    const r = runHandler(h.js, fnNames);
    if (r.pwned) return { ok: false, why: 'ran injected code via ' + h.name };
    if (r.threw) return { ok: false, why: h.name + ' threw: ' + r.threw };
    if (!r.calls.length) return { ok: false, why: h.name + ' called nothing' };
    const carried = r.calls.some(c => c.args.some(a => a === payload));
    if (!carried && r.calls.every(c => c.fn !== 'ctOpenInvoice')) return { ok: false, why: h.name + ' lost the text: ' + JSON.stringify(r.calls[0].args) };
  }
  return { ok: true };
}

console.log('bank and card text');
{
  let bad = [];
  PAYLOADS.forEach(p => {
    S(`appData = normalizeAppData({ years: [2026], activeYear: 2026, rules: [], dailySales: {},
        transactions: { '2026-8': [{ id: ${JSON.stringify(p)}, date: '2026-09-01', desc: ${JSON.stringify(p)},
          category: 'Supplies & Materials - COGS', vendor: ${JSON.stringify(p)}, amount: 10, type: 'out' }] } });`);
    printed = '';
    S('printMonthSummary(8);');
    if (/<img\b|\son(mouseover|error)="/i.test(printed)) bad.push('print: ' + p);
    const row = S(`renderTxRow(appData.transactions['2026-8'][0], 8, 2026)`);
    const r = handlersHold(row, p, ['openEditModal', 'deleteTx']);
    if (!r.ok) bad.push('ledger row: ' + p + ' — ' + r.why);
    S(`renderSupplierPie('pie', 'legend', [[${JSON.stringify(p)}, 10]]);`);
    if (/<img\b|\son(mouseover|error)="/i.test(els.legend.innerHTML)) bad.push('legend: ' + p);
  });
  t('the Print / PDF summary, a ledger row and the supplier legend hold against every payload', bad.length === 0, bad.join(' | ') || PAYLOADS.length + ' payloads');
  t('  and still show the text itself, escaped', printed.includes('&lt;img src=x') && els.legend.innerHTML.includes('&lt;img src=x'));
}

console.log('\ninvoice lines');
{
  let bad = [];
  PAYLOADS.forEach(p => {
    const html = S(`ctRowActions('pack', 'inv-1', ${JSON.stringify(p)})`);
    const r = handlersHold(html, p, ['ctApplyOneRepair', 'ctOpenInvoice', 'ctDismissRepair']);
    if (!r.ok) bad.push('repair buttons: ' + p + ' — ' + r.why);
    const issues = S(`ctIssuesHtml({ name: 'BALLOON MYLAR PK5 ' + ${JSON.stringify(p)}, uom: 'Each', category: 'Hard Goods',
                                      qty: 1, unitPrice: 5.49, total: 5.49 }, null)`);
    if (!issues) bad.push('pack question not asked for: ' + p);
    else {
      const r2 = handlersHold(issues, 'BALLOON MYLAR PK5 ' + p, ['ctSetPackAnswer']);
      if (!r2.ok) bad.push('pack question: ' + p + ' — ' + r2.why);
    }
  });
  t('the fix / open / leave buttons and the pack question hold against every payload', bad.length === 0, bad.join(' | ') || PAYLOADS.length + ' payloads');
  const inch = S(`ctRowActions('pack', 'inv-1', '5" X 10" Clear Cylinder')`);
  t('  including a name with inch marks, which used to break the buttons outright',
    handlersHold(inch, '5" X 10" Clear Cylinder', ['ctApplyOneRepair', 'ctOpenInvoice', 'ctDismissRepair']).ok);

  const items = JSON.parse(S(`JSON.stringify(ctCleanItems([
    { name: 'Rose "Freedom"', qty: '25', unit_price: '0.95', total: null, uom: 'Stem<script>', stems_per_bunch: '25' },
    { name: 'Vase', qty: '<img src=x>', unit_price: 3, uom: 'Each' },
    null, 'junk'
  ]))`));
  t('what the invoice reader returns is put into shape: numbers as numbers, units as plain text',
    items.length === 2 && items[0].qty === 25 && items[0].unit_price === 0.95 && items[0].stems_per_bunch === 25 &&
    items[0].uom === 'Stemscript' && items[0].name === 'Rose "Freedom"' && items[1].qty === null && items[1].uom === 'Each',
    JSON.stringify(items));
  t('  and dates keep only the characters a date has',
    S(`ctCleanDate('2026-09-12')`) === '2026-09-12' && S(`ctCleanDate('<svg onload=x>')`) === null &&
    /^[0-9\/.-]+$/.test(S(`ctParseSheetsApiDate('<b>9/12</b>')`)));
  t('uploads and the weekly summary only ever go to a script.google.com /exec address',
    S(`ctAppsScriptUrlOk('https://script.google.com/macros/s/AKfycbx_12-ab/exec')`) === true &&
    S(`ctAppsScriptUrlOk('https://script.google.com/a/macros/tuckahoeflorist.com/s/AKfy12/exec')`) === true &&
    S(`ctAppsScriptUrlOk('https://evil.example/macros/s/AKfy12/exec')`) === false &&
    S(`ctAppsScriptUrlOk('https://script.google.com.evil.example/macros/s/AKfy12/exec')`) === false &&
    S(`ctAppsScriptUrlOk('')`) === false);
}

console.log('\na book from the sheet or a backup');
{
  const d = JSON.parse(S(`JSON.stringify(normalizeAppData({ years: ['2025', 2026, '1);pwned=1//', 2026, 99999], activeYear: '1);pwned=1//' }))`));
  t('years become whole numbers, and a "year" that is really code is dropped',
    JSON.stringify(d.years) === '[2025,2026]' && d.activeYear === 2026, JSON.stringify(d.years) + ' active ' + d.activeYear);
  const ok = JSON.parse(S(`JSON.stringify(normalizeAppData({ years: [2023, 2024], activeYear: '2024' }))`));
  t('  and good ones are left as they are', JSON.stringify(ok.years) === '[2023,2024]' && ok.activeYear === 2024);
}

console.log('\nthe helper itself');
{
  let bad = [];
  PAYLOADS.concat(['plain', "Mother's Day", 'a\\b', 'tab\there', '']).forEach(p => {
    const js = decode(S(`jsArg(${JSON.stringify(p)})`));
    const r = runHandler(`f('${js}')`, ['f']);
    if (r.pwned || r.threw || !r.calls.length || r.calls[0].args[0] !== p) bad.push(JSON.stringify(p));
  });
  t('jsArg carries any string through an inline handler intact', bad.length === 0, bad.join(', ') || 'all intact');
}

console.log(fail.length ? '\n' + fail.length + ' FAILURES:\n' + fail.join('\n') : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
