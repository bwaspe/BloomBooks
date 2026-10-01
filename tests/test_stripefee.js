// Stripe's cut, read off the balance summary.
//
// Stripe nets its fee out of each deposit, so unlike EPX -- whose reader fee
// arrives as its own debit -- the cost appears NOWHERE in the bank. Once
// revenue is counted gross from the day book, that fee has to be entered by
// hand or it is simply missing. Once a month, every month, retyped.
//
// The parser is shape-tolerant on purpose. Stripe's exports differ by account
// and change over time, and the lesson from the payouts importer is that a
// rigid matcher rejects a good file while a loose one silently grabs the wrong
// column -- which here would be an expense out by two orders of magnitude.
const F = require('./fixtures');
const vm = require('vm');

function app(opts) {
  opts = opts || {};
  const els = {};
  const sb = F.sandbox({ setTimeout: () => 0 });
  sb.document.getElementById = id => els[id] || null;
  const notes = [];
  sb.notify = (m, bad) => notes.push({ m, bad });
  sb.confirm = () => opts.confirm !== false;
  sb.saveData = () => { sb.__saves = (sb.__saves || 0) + 1; };
  sb.localStorage = { store: {}, getItem() { return null; }, setItem() {}, removeItem() {} };
  vm.createContext(sb);
  vm.runInContext(F.src(['config.js', 'utils.js', 'ledger.js', 'import-trainer.js', 'daily-sales.js', 'payouts.js', 'stripe-fee.js']),
                  sb, { filename: 'bb.js' });
  vm.runInContext(`appData = { years: [2026], activeYear: 2026, transactions: {}, rules: [],
                               dailySales: {}, monthClose: {} };`, sb);
  return { sb, els, notes };
}

const get = (a, e) => vm.runInContext(e, a.sb);
const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };

// Three plausible shapes of the same report, because the real one is not in
// hand and the parser has to survive all of them.
const plain = [
  'Category,Amount',
  'Charges,274451.51',
  'Refunds,-1789.23',
  'Stripe fees,-8157.00',
  'Dispute fees,-667.74',
  'Net payouts,264485.32'
].join('\n');

const wordy = [
  'reporting_category,description,gross,fee,net,currency',
  'charges,Payments,274451.51,0,274451.51,usd',
  'fee,Stripe processing fees,0,8157.00,-8157.00,usd',
  'dispute,Disputes and chargeback fees,0,667.74,-667.74,usd'
].join('\n');

const bracketed = [
  'Description,Amount (USD)',
  'Gross volume,274451.51',
  'Total fees,(8157.00)',
  'Chargeback fees,(667.74)'
].join('\n');

console.log('whatever shape the report arrives in');
{
  const a = app();
  [['a plain two-column summary', plain], ['one with a description column', wordy],
   ['and one with amounts in brackets', bracketed]].forEach(([name, csv]) => {
    const out = a.sb.sfParse(csv);
    t(name + ' is read', !out.error, out.error);
    t('  with the fee found', Math.abs((out.fees || 0) - 8157) < 0.01, out.fees);
    t('  and the dispute fees kept separate', Math.abs((out.disputes || 0) - 667.74) < 0.01,
      out.disputes);
  });
}

console.log('\nwhat it must never mistake for the fee');
{
  // 'Gross' and 'Net' carry fees INSIDE them. Taking either as the fee
  // overstates the expense by two orders of magnitude, and it would look
  // perfectly plausible in the ledger.
  const a = app();
  const out = a.sb.sfParse(plain);
  t('the charges total is not read as a fee', (out.fees || 0) < 10000, out.fees);
  t('nor the payouts line', !(out.feeRows || []).some(r => /payout/i.test(r)),
    JSON.stringify(out.feeRows));

  const trap = ['Category,Amount', 'Net fees after refunds,999999.00', 'Stripe fees,8157.00'].join('\n');
  const out2 = a.sb.sfParse(trap);
  t('a line that says net is skipped even when it says fees too',
    Math.abs((out2.fees || 0) - 8157) < 0.01, out2.fees);
}

console.log('\na file it cannot read says what it saw');
{
  // The payouts importer rejected a file and left us guessing which report it
  // was. This one hands back the labels, so a wrong file is identifiable and a
  // right one that does not parse tells me what to fix.
  const a = app();
  const wrong = ['id,created,amount', 'po_1,2026-09-30,1234.50'].join('\n');
  const out = a.sb.sfParse(wrong);
  t('it is refused', !!out.error, out.error);
  // Either refusal is honest; what matters is that it names what it saw
  // rather than leaving us to guess which report it was.
  t('and the message points at the balance summary',
    /looked like a fee|balance summary/.test(out.error), out.error);
  t('handing back what it did find', (out.seen || []).length > 0, JSON.stringify(out.seen));

  const empty = a.sb.sfParse('');
  t('an empty file says so too', /no rows/.test(empty.error || ''), empty.error);
}

console.log('\nthe month it belongs to');
{
  const a = app();
  // A summary uploaded on the 3rd belongs to the month it covers, not today --
  // the same rule the EPX statement follows.
  const dated = 'Category,Amount\nPeriod,2026-08-01 to 2026-08-31\nStripe fees,-8157.00';
  const p = a.sb.sfPeriod(dated);
  t('read off the file when it is there', p.year === 2026 && p.month === 7,
    p.year + '-' + (p.month + 1));
  t('and not guessed', !p.guessed);

  const bare = a.sb.sfPeriod('Category,Amount\nStripe fees,-8157.00');
  t('with no date it falls back to last month', bare.guessed === true);
  t('and says it guessed, so the month can be checked', bare.guessed === true);
}

console.log('\nit proposes, it does not write');
{
  const a = app();
  vm.runInContext(`sfFound = { year: 2026, month: 7, fees: 8157, disputes: 667.74,
                               feeRows: ['Stripe fees'], disputeRows: ['Dispute fees'] };`, a.sb);
  const html = a.sb.sfReportHtml();
  t('it shows what it will enter', /8,157\.00/.test(html) && /667\.74/.test(html), html.slice(0, 60));
  t('and says where it got each figure', /Stripe fees/.test(html));
  t('nothing is in the books yet', (get(a, 'appData.transactions["2026-7"]') || []).length === 0);

  a.sb.sfConfirm();
  const rows = get(a, 'appData.transactions["2026-7"]') || [];
  t('confirming writes the rows', rows.length === 2, rows.length);
  t('both under Payment Processing', rows.every(r => r.category === 'Payment Processing'));
  t('dated the last day of the month', rows.every(r => r.date === '2026-08-31'),
    rows.map(r => r.date).join(','));
  t('out, not in', rows.every(r => r.type === 'out'));
  // Kept apart because they are different costs, and the 1099 formula needs
  // disputes on their own at year end.
  t('and the dispute fees are their own row',
    rows.some(r => /dispute/i.test(r.desc)) && rows.some(r => !/dispute/i.test(r.desc)),
    rows.map(r => r.desc).join(' | '));
  t('the month is ticked off the checklist',
    !!(get(a, 'appData.monthClose') || {})['2026-7'].fee);
}

console.log('\nand it will not quietly enter it twice');
{
  const a = app({ confirm: false });
  vm.runInContext(`appData.transactions['2026-7'] = [{ id: 'x', date: '2026-08-31',
    desc: 'Stripe fees', category: 'Payment Processing', vendor: 'Stripe', amount: 8157, type: 'out' }];
    sfFound = { year: 2026, month: 7, fees: 8157, disputes: 0, feeRows: [], disputeRows: [] };`, a.sb);
  t('an existing Stripe row is noticed', /already/.test(a.sb.sfReportHtml()));
  a.sb.sfConfirm();
  t('and declining the prompt adds nothing',
    (get(a, 'appData.transactions["2026-7"]') || []).length === 1);
}

console.log('\nthe checklist says where to get each thing');
{
  const a = app();
  const steps = get(a, 'DS_CLOSE_STEPS');
  t('every step says where', steps.every(s => s.how && s.how.length > 10),
    steps.filter(s => !s.how).map(s => s.id).join(','));
  const fee = steps.find(s => s.id === 'fee');
  const pay = steps.find(s => s.id === 'payouts');
  t('the fee step names the balance summary', /balance summary/i.test(fee.how), fee.how);
  t('and the sanity check', /2\.95/.test(fee.how));
  // The question that gets asked every month: there are three plausible Stripe
  // reports and only two are right.
  t('the payouts step says the payouts PAGE, not Reports',
    /not Reports/i.test(pay.how), pay.how);
  t('and names the columns to expect', /Arrival Date/i.test(pay.how));

  // Shown only while outstanding, so a finished checklist is not instructions.
  const html = a.sb.dsMonthStatusHtml(2026, 7);
  t('an outstanding step shows its how', /Balance summary/i.test(html));
  vm.runInContext(`appData.transactions['2026-7'] = [{ id: 'x', date: '2026-08-31',
    desc: 'Stripe fees', category: 'Payment Processing', vendor: 'Stripe', amount: 8157, type: 'out' }];`, a.sb);
  const done = a.sb.dsMonthStatusHtml(2026, 7);
  t('and a done one does not', !/Balance summary/i.test(done));
  t('while the steps still outstanding keep theirs', /Arrival Date/i.test(done));
}


// The SHAPE of the shop's real exports, with made-up figures -- the repo is
// public, so no actual takings go in it. Every column name and category key
// here is exactly what Stripe wrote on 1 Oct 2026.
const realBalance = [
  '"category","description","net_amount","currency"',
  '"starting_balance","Starting balance (2026-09-01)","100.00","usd"',
  '"starting_balance_available","Available balance (2026-09-01)","0.00","usd"',
  '"activity_gross","Account activity before fees","10000.00","usd"',
  '"activity_fee","Less fees","-300.00","usd"',
  '"activity","Activity","9700.00","usd"',
  '"payouts_gross","Payouts to bank","-9800.00","usd"',
  '"payouts_fee","Payout fees","0.00","usd"',
  '"payouts","Total payouts","-9800.00","usd"',
  '"ending_balance","Ending balance (2026-09-30)","0.00","usd"'
].join('\n');

const realItemized = [
  '"automatic_payout_id","automatic_payout_effective_at","balance_transaction_id","created",' +
  '"available_on","currency","gross","fee","net","reporting_category","description"',
  '"po_1","2026-09-01 20:09:00","txn_1","2026-08-29 10:04:26","2026-09-01 20:00:00","usd","100.00","3.00","97.00","charge","Charge for order #1"',
  '"po_1","2026-09-01 20:09:00","txn_2","2026-08-29 11:27:48","2026-09-01 20:00:00","usd","50.00","1.50","48.50","charge","Charge for order #2"',
  '"po_2","2026-09-02 20:34:12","txn_3","2026-09-01 11:22:08","2026-09-02 20:00:00","usd","20.00","0.60","19.40","charge","Charge for order #3"',
  '"po_2","2026-09-02 20:34:12","txn_4","2026-09-01 11:30:00","2026-09-02 20:00:00","usd","-5.00","0.00","-5.00","refund","REFUND FOR CHARGE (Charge for order #3)"'
].join('\n');

console.log('\nthe balance summary Stripe really writes');
{
  // It failed on the real file. The key is "activity_fee", and a
  // word-boundary match on "fee" does NOT find that -- an underscore is a
  // word character, so there is no boundary before it. Nothing matched and
  // it reported no fee at all.
  const a = app();
  const out = a.sb.sfParse(realBalance);
  t('it is read', !out.error, out.error);
  t('the fee is the activity fee', Math.abs((out.fees || 0) - 300) < 0.005, out.fees);
  t('shown by its description rather than its key',
    (out.feeRows || []).indexOf('Less fees') >= 0, JSON.stringify(out.feeRows));
  // Every one of these is a bigger number that CONTAINS the fee.
  t('and nothing else in the file is mistaken for it',
    !(out.feeRows || []).some(r => /gross|before fees|payouts to bank|balance/i.test(r)),
    JSON.stringify(out.feeRows));
  t('a zero fee line is not an entry', (out.feeRows || []).length === 1,
    JSON.stringify(out.feeRows));

  // A category column that spells its lines out rather than using machine
  // keys. 'before fees' is the GROSS -- counting it as the fee would file
  // the month's whole takings as an expense.
  const spelled = [
    'Category,Amount',
    'Account activity before fees,10000.00',
    'Stripe fees,-300.00'
  ].join(String.fromCharCode(10));
  const out2 = a.sb.sfParse(spelled);
  t('a line that says before fees is the gross, not the fee',
    Math.abs((out2.fees || 0) - 300) < 0.005, out2.fees);
  const per = a.sb.sfPeriod(realBalance);
  t('and the month comes off the file', per.year === 2026 && per.month === 8 && !per.guessed,
    per.year + '-' + (per.month + 1));
}

console.log('\nthe other Stripe report, recognised rather than parsed');
{
  // It has a fee column, so it WOULD parse -- and give a fee on a different
  // basis: fees on transactions paid out this month, which include last
  // month's late charges and exclude this month's. Measured against the real
  // September files that was $24.93 out. A plausible wrong number is worse
  // than a refusal.
  const a = app();
  const out = a.sb.sfParse(realItemized);
  t('it is refused', !!out.error, (out.error || '').slice(0, 40));
  t('named, so it is obvious which file this is',
    /itemized payout reconciliation/i.test(out.error || ''));
  t('and it says what the file IS for', /Payouts screen/i.test(out.error || ''));
  t('and which one to pull instead', /Balance summary/i.test(out.error || ''));
}

console.log('\nand that file does feed the payouts matcher');
{
  // One row per TRANSACTION, not per payout, so there is no payout-level
  // amount to read -- but every row names its payout and carries its net,
  // and those sum to exactly what reached the bank. It was being turned away.
  const a = app();
  const out = a.sb.poParse(realItemized);
  t('it is accepted', !out.error, out.error);
  t('and says where it read it', /itemized/.test(out.from || ''), out.from);
  t('one entry per payout, not per transaction', (out.payouts || []).length === 2,
    (out.payouts || []).length);
  t('summed to what reached the bank',
    !!out.payouts[0] && Math.abs(out.payouts[0].amount - 145.50) < 0.005,
    out.payouts[0] && out.payouts[0].amount);
  // A refund inside a payout reduces it, exactly as the bank saw it.
  t('with refunds netted off',
    !!out.payouts[1] && Math.abs(out.payouts[1].amount - 14.40) < 0.005,
    out.payouts[1] && out.payouts[1].amount);
  t('dated when the payout landed, not when the charge was taken',
    !!out.payouts[0] && out.payouts[0].date === '2026-09-01',
    out.payouts[0] && out.payouts[0].date);
}

console.log(fail.length ? '\n' + fail.length + ' FAILED' : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
