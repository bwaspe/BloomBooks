// Venmo's cut, and the money that leaves the Venmo balance without touching
// the bank.
//
// The farmers market runs on a Venmo card reader. Venmo nets its fee out of the
// payout, so once the market's sales are rung into the POS -- gross, like every
// other sale -- the fee appears nowhere: not on the Chase statement as itself,
// and not in the day book, because the Venmo statement is no longer uploaded.
//
// The transfers matter more than the fee. Money moved from the Venmo balance to
// personal checking never passes through the business account, so no importer
// can see it. A fee missed is pennies; a transfer missed is a draw that goes
// unrecorded -- and "where did all my money go" then has a wrong answer, which
// is exactly how $17,500 of draws went missing once already.
//
// So this step is ticked BY HAND, unlike the Stripe fee beside it. A month the
// market rained off has no fee row and no transfer row, legitimately, so an
// empty ledger cannot tell "nothing to do" from "not done". A step that read
// false every winter would teach the owner to ignore the whole checklist.
const F = require('./fixtures');
const vm = require('vm');

function app() {
  const els = {};
  const sb = F.sandbox({ setTimeout: () => 0 });
  sb.document.getElementById = id => els[id] || null;
  sb.notify = () => {};
  sb.saveData = () => { sb.__saves = (sb.__saves || 0) + 1; };
  sb.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  vm.createContext(sb);
  vm.runInContext(F.src(['config.js', 'utils.js', 'ledger.js', 'import-trainer.js',
                         'daily-sales.js', 'payouts.js', 'stripe-fee.js']),
                  sb, { filename: 'bb.js' });
  vm.runInContext(`appData = { years: [2026], activeYear: 2026, transactions: {}, rules: [],
                               dailySales: {}, monthClose: {} };`, sb);
  return { sb, els };
}

const get = (a, e) => vm.runInContext(e, a.sb);
const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };

const AUG = '2026-7';
const row = (o) => Object.assign({ id: 'x' + Math.random(), date: '2026-08-31', type: 'out' }, o);
const put = (a, rows) => vm.runInContext(
  `appData.transactions['${AUG}'] = ${JSON.stringify(rows)};`, a.sb);

console.log('the step exists and says where to go');
{
  const a = app();
  const steps = get(a, 'DS_CLOSE_STEPS');
  const vm_ = steps.find(s => s.id === 'venmo');
  t('there is a Venmo step', !!vm_, steps.map(s => s.id).join(','));
  t('it names venmo.com', /venmo\.com/i.test(vm_.how), vm_.how);
  // Both halves have to be named or only the fee gets done -- the fee is the
  // part that was asked for, the transfer is the part worth money.
  t('it names the fee', /fee/i.test(vm_.how));
  t('and the transfer to personal checking', /personal/i.test(vm_.how));
  // Which category each belongs in, or the row lands in Office and the whole
  // point is lost.
  t('it says Payment Processing', /Payment Processing/i.test(vm_.how));
  t('and Owner Draw', /Owner Draw/i.test(vm_.how));
  // The out-of-season case has to be an instruction, not a puzzle.
  t('and says what to do in a month with no market', /tick it/i.test(vm_.how), vm_.how);

  // Adding a step must not have cost an existing one. This caught a real
  // mistake: the first version of the edit deleted the Stripe payouts step.
  ['bank', 'fn', 'epx', 'fee', 'payouts'].forEach(id =>
    t('the ' + id + ' step is still there', steps.some(s => s.id === id)));
  t('every step still says where', steps.every(s => s.how && s.how.length > 10),
    steps.filter(s => !s.how).map(s => s.id).join(','));
  t('ids are unique', new Set(steps.map(s => s.id)).size === steps.length);
}

console.log('\nit is ticked by hand, not read off the ledger');
{
  const a = app();
  // A step the ledger answers for gets no toggle (dsMonthStatusHtml only
  // offers one where dsAutoStep returns null). This one must offer it.
  t('dsAutoStep has no opinion on it', get(a, 'dsAutoStep("venmo",2026,7)') === null);
  // ...even when a fee row IS present. Otherwise a month with the fee entered
  // but a transfer still to do would tick itself and hide the transfer.
  put(a, [row({ desc: 'Venmo fee', category: 'Payment Processing', vendor: 'Venmo', amount: 2.14 })]);
  t('and still none once a fee row exists', get(a, 'dsAutoStep("venmo",2026,7)') === null);
  const html = a.sb.dsMonthStatusHtml(2026, 7);
  t('so the checklist offers a by-hand tick', /dsToggleDone\(2026,7,'venmo'\)/.test(html));
  t('and shows where to go while outstanding', /venmo\.com/i.test(html));
}

console.log('\nwhat is behind the tick is shown beside it');
{
  // The tick alone says only that somebody looked. Naming the rows that exist
  // is what makes "ticked, nothing entered" visible.
  const a = app();
  put(a, [
    row({ desc: 'Venmo fee', category: 'Payment Processing', vendor: 'Venmo', amount: 2.14 }),
    row({ desc: 'Venmo to personal checking', category: 'Owner Draw', vendor: 'Venmo', amount: 200 })
  ]);
  a.sb.dsToggleDone(2026, 7, 'venmo');
  const html = a.sb.dsMonthStatusHtml(2026, 7);
  t('the fee is reported', /fee \$2\.14/.test(html), (html.match(/fee \$[\d.]+/) || [])[0]);
  t('and the transfer, under its own words', /to personal \$200\.00/.test(html),
    (html.match(/to personal \$[\d.,]+/) || [])[0]);
}

console.log('\na tick with nothing under it says so');
{
  const a = app();
  a.sb.dsToggleDone(2026, 7, 'venmo');
  const html = a.sb.dsMonthStatusHtml(2026, 7);
  // This is the legitimate rained-off month AND the careless tick. The step
  // cannot tell them apart, so it states the fact and leaves the judgement.
  t('it reads "nothing entered"', /nothing entered/.test(html));
  // Tested by CONTRAST, not by looking for the step's own name -- the name is
  // in the html whether it is ticked or not, so matching it proves nothing.
  // A ticked row renders its name at font-weight 500, an outstanding one 400.
  const untickedHtml = app().sb.dsMonthStatusHtml(2026, 7);
  t('a ticked step renders as done', /font-weight:500">Venmo fee and transfers/.test(html));
  t('and an untouched one does not',
    /font-weight:400">Venmo fee and transfers/.test(untickedHtml));
}

console.log('\nit only counts Venmo rows, and only the right categories');
{
  const a = app();
  put(a, [
    // A Venmo purchase is not a fee. Matching any out-row mentioning Venmo --
    // which is what the Stripe step does, safely, because a Stripe row is
    // always a fee -- would report this as the month's fee.
    row({ desc: 'Venmo', category: 'Office', vendor: 'Venmo', amount: 99 }),
    // Stripe's fee sits in the same category and must not be swept in.
    row({ desc: 'Stripe fees', category: 'Payment Processing', vendor: 'Stripe', amount: 8157 }),
    // Nor a draw that had nothing to do with Venmo.
    row({ desc: 'Zelle payment to Barami Waspe', category: 'Owner Draw', vendor: 'Owner', amount: 500 }),
    row({ desc: 'Venmo fee', category: 'Payment Processing', vendor: 'Venmo', amount: 3.05 })
  ]);
  a.sb.dsToggleDone(2026, 7, 'venmo');
  const html = a.sb.dsMonthStatusHtml(2026, 7);
  t('the Venmo fee alone is reported', /fee \$3\.05/.test(html), (html.match(/fee \$[\d,.]+/) || [])[0]);
  t("Stripe's fee is not swept in", !/fee \$8,?157/.test(html));
  t('the Office purchase is not a fee', !/fee \$99/.test(html));
  t('and a non-Venmo draw is not reported', !/to personal/.test(html));
}

console.log('\nthe month still reports its own state correctly');
{
  const a = app();
  const n = get(a, 'DS_CLOSE_STEPS.length');
  const html = a.sb.dsMonthStatusHtml(2026, 7);
  // "all five done" was hardcoded; with a sixth step it would have been a lie
  // the moment the checklist was finished.
  t('the outstanding count uses the real length', new RegExp(n + ' still to do').test(html),
    (html.match(/\d+ of \d+ still to do/) || [])[0]);
  t('no hardcoded "all five"', !/all five/.test(html));

  // Finish every step and the summary must agree.
  get(a, 'DS_CLOSE_STEPS').forEach(s => a.sb.dsToggleDone(2026, 7, s.id));
  vm.runInContext(`appData.transactions['${AUG}'] = [
    { id: 'b', date: '2026-08-31', desc: 'Stripe fees', category: 'Payment Processing',
      vendor: 'Stripe', amount: 8157, type: 'out' }];`, a.sb);
  const done = a.sb.dsMonthStatusHtml(2026, 7);
  t('a finished checklist says so with the real count',
    new RegExp('all ' + n + ' done').test(done), (done.match(/all \d+ done/) || [])[0]);
}

console.log('\nthe Venmo day-book channel is untouched by any of this');
{
  // Retiring the channel is a separate act, and venmo.js writes to it without
  // consulting `active` -- so nothing here may quietly depend on it being off.
  const a = app();
  const ch = get(a, 'dsChannels()').find(c => c.id === 'venmo');
  t('the channel still exists', !!ch);
  t('and its figures still count wherever they are',
    get(a, `(function(){ appData.dailySales['${AUG}'] = { 5: { venmo: { s: 185, t: 0, x: 185 } } };
             return dsMonthTotals(2026,7).sales; })()`) === 185);
}

console.log(fail.length ? '\n' + fail.length + ' FAILED' : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
