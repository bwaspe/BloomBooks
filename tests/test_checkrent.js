// Two built-in rules that filed real money under the wrong heading every time.
//
// MERCH SETL: Chase writes it on the daily card settlement coming IN and on the
// processor's fee going OUT ("EPX FE", $5 on the 1st and odd amounts besides).
// One rule for both filed every fee as Revenue.
//
// CHECK_PAID: every check written filed as Rent. Most checks are not the rent
// -- equipment, insurance, a supplier -- so a check is now Rent only at the
// rent amount, which is read from the ledger rather than set anywhere, and any
// other check waits for a category to be chosen. Nothing here is the shop's
// real figures: the amounts, check numbers and IDs are made up.
const F = require('./fixtures');
const vm = require('vm');

function makeApp(live) {
  const els = {
    'import-text': { value: '' }, 'import-source-sel': { value: 'bank' },
    'import-year-sel': { value: '2026' }, 'import-month-sel': { value: '8' },
    'reconcile-area': { innerHTML: '' }, 'staging-table-area': { innerHTML: '' }
  };
  const sb = F.sandbox({});
  sb.document.getElementById = id => els[id] || null;
  vm.createContext(sb);
  vm.runInContext(F.src(['config.js', 'utils.js', 'ledger.js', 'import-trainer.js', 'reconcile.js']), sb,
                  { filename: 'bb.js' });
  vm.runInContext(`appData = { years: [2026], activeYear: 2026, rules: [], transactions: {}, dailySales: {} };` +
                  (live ? '' : 'renderStagingTable = function () {};'), sb);
  return {
    sb, els,
    stage(lines) { els['import-text'].value = lines.join(String.fromCharCode(10)); sb.parseImport(); return vm.runInContext('stagingRows', sb); },
    book(yr, mo, tx) { sb.addTransaction(yr, mo, tx); },
    rows() { return Object.values(vm.runInContext('appData.transactions', sb)).reduce((n, a) => n + a.length, 0); }
  };
}

const T = String.fromCharCode(9);
const L = (date, desc, amt, type) => [date, desc, amt, type, ''].join(T);
const ach = name => 'ORIG CO NAME:' + name + '                 ORIG ID:1000000001 DESC DATE:       ' +
                    'CO ENTRY DESCR:MERCH SETLSEC:CCD    TRACE#:100000000000001 EED:260901';
const rentCheck = (date, no, amount) => ({ date, desc: 'CHECK ' + no, category: 'Rent', vendor: 'Rent Check', amount, type: 'out' });

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };

console.log('the card processor: settlement in, fee out');
{
  const app = makeApp();
  const s = app.stage([
    L('09/01/2026', ach('EPX FE'), '-5.00', 'ACH_DEBIT'),
    L('08/03/2026', ach('EPX FE'), '-8.24', 'ACH_DEBIT'),
    L('09/02/2026', ach('EPX ST'), '153.90', 'ACH_CREDIT')
  ]);
  t('the $5 fee is Payment Processing, not Revenue', s[0].type === 'out' && s[0].category === 'Payment Processing', s[0].category);
  t('and so is a fee of any other amount', s[1].category === 'Payment Processing', s[1].category);
  t('while the daily settlement coming in is still Revenue', s[2].type === 'in' && s[2].category === 'Revenue', s[2].category);
}

console.log('\nchecks, with no rent check in the ledger yet');
{
  const app = makeApp();
  const s = app.stage([L('09/04/2026', 'CHECK 2001', '-1000.00', 'CHECK_PAID')]);
  t('a check is not guessed at: no category, and it says why',
    s[0].category === '' && /no rent check/i.test(s[0].askWhy), JSON.stringify(s[0].askWhy));
}

console.log('\nchecks, once the ledger knows the rent');
{
  const app = makeApp();
  app.book(2026, 7, rentCheck('2026-08-07', 1990, 1000));
  const s = app.stage([
    L('09/04/2026', 'CHECK 2001', '-1000.00', 'CHECK_PAID'),
    L('09/02/2026', 'CHECK 2000', '-601.00', 'CHECK_PAID'),
    L('09/05/2026', 'REMOTE ONLINE DEPOSIT #          1', '140.00', 'CHECK_DEPOSIT')
  ]);
  t('a check for the rent amount is Rent', s[0].category === 'Rent' && s[0].vendor === 'Rent Check', s[0].category);
  t('any other check waits, and names the rent it was compared with',
    s[1].category === '' && s[1].askWhy.indexOf('$1,000.00') >= 0, JSON.stringify(s[1].askWhy));
  t('a check deposited is untouched: still Revenue', s[2].type === 'in' && s[2].category === 'Revenue', s[2].category);

  const before = app.rows();
  app.sb.saveAllStaged();
  t('Save All saves the rest and leaves the unchosen check in the list',
    app.rows() === before + 2 && s[1].status === 'review' && s[0].status === 'saved', app.rows() - before + ' saved');

  app.sb.saveStagedRow(s[1]._id);
  t('its own Save refuses too, until a category is chosen', s[1].status === 'review' && app.rows() === before + 2);
  app.sb.updateStageRow(s[1]._id, 'category', 'Insurance');
  app.sb.saveStagedRow(s[1]._id);
  t('and then it saves, under what was chosen', s[1].status === 'saved' && app.rows() === before + 3);
}

console.log('\nthe rent goes up');
{
  const app = makeApp();
  app.book(2026, 5, rentCheck('2026-06-05', 1985, 900));
  app.book(2026, 6, rentCheck('2026-07-10', 1988, 1000));
  let s = app.stage([L('08/07/2026', 'CHECK 1990', '-900.00', 'CHECK_PAID')]);
  t('the latest rent check is the rent, so last year\'s amount now asks', s[0].category === '', s[0].category);

  s = app.stage([L('09/04/2026', 'CHECK 2001', '-1100.00', 'CHECK_PAID')]);
  t('the first check at the new rent asks', s[0].category === '');
  app.sb.updateStageRow(s[0]._id, 'category', 'Rent');
  app.sb.saveStagedRow(s[0]._id);

  s = app.stage([L('10/02/2026', 'CHECK 2004', '-1100.00', 'CHECK_PAID'),
                 L('10/03/2026', 'CHECK 2005', '-1000.00', 'CHECK_PAID')]);
  t('filed as Rent once, the new amount is known from then on', s[0].category === 'Rent', s[0].category);
  t('and the old amount no longer counts as rent', s[1].category === '', s[1].category);
}

console.log('\nwhat the table shows');
{
  const app = makeApp(true);
  app.book(2026, 7, rentCheck('2026-08-07', 1990, 1000));
  app.stage([L('09/02/2026', 'CHECK 2000', '-601.00', 'CHECK_PAID')]);
  const html = app.els['staging-table-area'].innerHTML;
  t('the row asks, with an empty choice selected and the reason under it',
    html.indexOf('<option value="" selected>— choose —</option>') >= 0 &&
    html.indexOf('not the rent amount ($1,000.00)') >= 0);
  t('and the header counts it', html.indexOf('1 needs a category') >= 0);
}

console.log(fail.length ? '\n' + fail.length + ' FAILURES:\n' + fail.join('\n') : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
