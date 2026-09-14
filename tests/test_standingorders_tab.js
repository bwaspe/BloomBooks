// The Perri standing order went missing from Invoice Upload.
//
// Nothing was lost -- the template was in every backup. The list is drawn into
// that tab by renderCtTemplates, and the only thing that called it was the
// upload review flow. So after a refresh the tab opened with no standing
// orders on it until a file had been uploaded, which for a delivery that
// arrives on paper is exactly the week you need the button first.
const F = require('./fixtures');
const vm = require('vm');

const el = () => ({ innerHTML: '', value: '', style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
                    setAttribute() {} });
const els = { 'ct-templates': el(), 'panel-ct-upload': el(), 'ct-parse-area': el() };
const sb = F.sandbox({ setTimeout: () => {} });
sb.document.getElementById = id => els[id] || null;
sb.document.body = el();
vm.createContext(sb);
vm.runInContext(F.src(['config.js', 'utils.js', 'ledger.js', 'cost-tracker.js']), sb, { filename: 'bb.js' });

vm.runInContext(`
  appData = { years: [2026], activeYear: 2026, transactions: {}, dailySales: {}, rules: [] };
  ctData.templates = [{ id: 'tpl-1', name: 'A. Perri Farms, Inc. standing order', supplier: 'A. Perri Farms, Inc.',
                        deliveryFee: 0, items: new Array(13).fill(0).map(function (_, i) {
                          return { name: 'Item ' + i, qty: 1, uom: 'bunch' }; }) }];
`, sb);

// A review card part-way through being checked, which opening the tab must not redraw.
els['ct-parse-area'].innerHTML = '<div id="half-checked-card"></div>';

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };

console.log('opening Invoice Upload after a refresh');
t('before, with nothing uploaded, the list is empty', els['ct-templates'].innerHTML === '');
sb.switchPanel('ct-upload');
const html = els['ct-templates'].innerHTML;
t('opening the tab draws the standing orders', /A\. Perri Farms, Inc\. standing order/.test(html));
t('  with the button that starts one', /ctStartFromTemplate\('tpl-1'\)/.test(html) && /13 items/.test(html));
t('  and leaves a review card that is part-way through alone',
  els['ct-parse-area'].innerHTML === '<div id="half-checked-card"></div>');

vm.runInContext('ctData.templates = [];', sb);
sb.switchPanel('ct-upload');
t('with none saved, it explains how to make one instead of showing nothing',
  /Save as standing order/.test(els['ct-templates'].innerHTML));

console.log(fail.length ? '\n' + fail.length + ' FAILURES:\n' + fail.join('\n') : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
