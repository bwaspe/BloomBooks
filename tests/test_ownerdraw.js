const F = require('./fixtures');
// The owner's own money moving was IGNORED outright, so it never reached the
// ledger and these books could not tie to the bank balance. Now categorised.
// Two traps, both real: resolveRules checks `ignore` before sign, so one ignore
// rule covered both directions and a categorising rule does not -- and an
// unmatched credit defaults to Revenue, so leaving the `in` side off would book
// the owner's own money back in as a SALE.
const fs = require('fs'), vm = require('vm');
const src = ['config.js', 'utils.js', 'ledger.js', 'import-trainer.js']
  .map(f => fs.readFileSync(F.APP + '/' + f, 'utf8')).join('\n');

const el = () => ({ innerHTML: '', value: '', style: {}, classList: { add() {}, remove() {} },
                    appendChild() {}, addEventListener() {}, querySelectorAll: () => [] });
const sb = { console, notify() {}, saveData() {}, switchPanel() {},
  escHtml: s => String(s == null ? '' : s), fmt: n => '$' + Number(n).toFixed(2),
  Chart: function () { return { destroy() {} }; },
  document: { getElementById: () => null, querySelector: () => null,
              querySelectorAll: () => [], createElement: el,
              addEventListener() {} },
  localStorage: { store: {}, getItem() { return null; }, setItem() {} } };
sb.window = sb;
let out = null;
sb.__OUT__ = o => { out = o; };

vm.runInNewContext(src + `
;(function(){
  appData = { years:[2026], activeYear:2026, rules:[], transactions:{}, dailySales:{} };

  // Chase's actual wording. This used to say 'ZELLE FROM BARAMI WASPE', which
  // the bank never writes -- it writes "Zelle payment from". The rule was
  // narrowed to the real phrasing after a bare-name keyword was found matching
  // supplier payments the owner had merely authorised; see test_ownername.
  var draw = resolveRules('ZELLE PAYMENT TO BARAMI WASPE 30515148228', 'out');
  var putIn = resolveRules('ZELLE PAYMENT FROM BARAMI WASPE 30515148999', 'in');
  var star = resolveRules('BARAMI *WASPE', 'out');
  var other = resolveRules('AMERICAN EXPRESS PAYMENT', 'out');

  // What an unmatched credit would have become, which is why the 'in' rule
  // has to exist: this is the default in the importer.
  var unmatchedIn = resolveRules('SOMETHING NOBODY HAS A RULE FOR', 'in');

  appData.transactions['2026-5'] = [
    { date:'2026-06-03', type:'out', amount:1200, category:'Owner Draw',         vendor:'Owner' },
    { date:'2026-06-10', type:'out', amount:1200, category:'Owner Draw',         vendor:'Owner' },
    { date:'2026-06-14', type:'in',  amount:5000, category:'Owner Contribution', vendor:'Owner' },
    { date:'2026-06-16', type:'out', amount:4000, category:'Capital Expenditure',vendor:'Lange' },
    { date:'2026-06-02', type:'out', amount:522.39, category:'Loan Repayment',   vendor:'VNB' },
    { date:'2026-06-20', type:'out', amount:300,  category:'Rent',               vendor:'Rent' },
    { date:'2026-06-21', type:'in',  amount:9000, category:'Revenue',            vendor:'Sales' },
    { date:'2026-06-22', type:'out', amount:180,  category:'Interest',           vendor:'VNB' }
  ];
  var c = calcMonth(2026, 5);

  __OUT__({
    draw: draw, putIn: putIn, star: star, other: other, unmatchedIn: unmatchedIn,
    m: { revenue:c.revenue, expenses:c.expenses, net:c.net, capital:c.capital,
         loan:c.loanPrincipal, drawn:c.ownerDraw, nonExpense:c.nonExpense,
         inNotRevenue:c.nonRevenueIn, bankIn:c.bankIn, bankOut:c.bankOut, bankNet:c.bankNet }
  });
})();`, sb, { filename: 'bb.js' });

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };
const o = out, m = o.m;

console.log('the rule fires, and in both directions');
t('money out to the owner is a draw, not discarded',
  o.draw && !o.draw.ignore && o.draw.category === 'Owner Draw', JSON.stringify(o.draw));
t('money IN from the owner is a contribution, not revenue',
  o.putIn && o.putIn.category === 'Owner Contribution', JSON.stringify(o.putIn));
t('and that matters: an unmatched credit would default to Revenue',
  o.unmatchedIn === null, 'unmatched -> ' + JSON.stringify(o.unmatchedIn) + ', importer then picks Revenue');
t('the other built-in ignores are untouched',
  o.other && o.other.ignore === true, JSON.stringify(o.other));

console.log('\nthe known gap, stated rather than guessed at');
t('the "BARAMI *WASPE" spelling still does NOT match', o.star === null,
  'one real row in the book carries that spelling');

console.log('\nand the month still adds up');
t('a draw is not an expense', m.expenses === 480 && m.drawn === 2400,
  '$' + m.expenses + ' expenses (rent + interest only)');
t('a contribution is not revenue', m.revenue === 9000 && m.inNotRevenue === 5000,
  '$' + m.revenue + ' revenue, $' + m.inNotRevenue + ' put in');
t('interest IS an expense', m.expenses === 480);
t('net is trading only', m.net === 8520, '$' + m.net);
t('what left the bank = expenses + everything that was not one',
  Math.abs(m.bankOut - (m.expenses + m.nonExpense)) < 0.005, '$' + m.bankOut.toFixed(2));
// bankNet is read off the rows, never inferred from net. Here -- with no day
// book loaded, so revenue still comes from deposits -- the two agree, and that
// agreement is the check. After the day-book switch-over they legitimately
// diverge, which is the bug the rename fixed.
t('and it agrees with net less what went out, plus what was put in',
  Math.abs(m.bankNet - (m.net - m.nonExpense + m.inNotRevenue)) < 0.005, '$' + m.bankNet.toFixed(2));
// The whole point of the identity, checked against the rows themselves rather
// than against a number I typed: 14,000 arrived, 7,402.39 left.
const bankIn = 5000 + 9000;
const bankOut = 1200 + 1200 + 4000 + 522.39 + 300 + 180;
t('which is what the bank actually did: $' + bankIn + ' in, $' + bankOut.toFixed(2) + ' out',
  Math.abs(m.bankNet - (bankIn - bankOut)) < 0.005,
  '$' + m.bankNet.toFixed(2) + ' vs $' + (bankIn - bankOut).toFixed(2));
t('and what left matches too', Math.abs(m.bankOut - bankOut) < 0.005,
  '$' + m.bankOut.toFixed(2) + ' vs $' + bankOut.toFixed(2));

console.log(fail.length ? '\n' + fail.length + ' FAILURES:\n' + fail.join('\n') : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
