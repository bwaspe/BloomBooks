// A Perri Farms invoice scanned in September 2026 came through dated July 2025,
// with the delivery date correct.
//
// The cause was in the Apps Script -- PARSE_PROMPT told Claude to "use today's
// date" when the date was missing, and the model is never told what today is,
// so it substituted its own sense of now. Every 'body'-mode vendor was affected
// and no 'pdf'-mode one was. That half is fixed upstream; this is the guard on
// THIS side, so a bad date is caught whatever produced it.
//
// It matters because ctEffDate falls back to the invoice date, so a wrong one
// files the cost in the wrong month and compares its prices against the wrong
// season.
//
// The hard part is not flagging: it is NOT flagging. An old invoice scanned on
// purpose during a backfill is legitimate, and 24 were flagged on age alone
// when 23 of them were fine because their delivery dates were right.
const F = require('./fixtures');
const vm = require('vm');

const BK = 'bloom-books-backup-2026-09-08-1904.json';
const raw = F.file(BK);
if (!raw) F.skip('needs ' + BK + ' — put it in Downloads or set BLOOMBOOKS_FIXTURES');
const j = JSON.parse(raw);

const sb = F.sandbox({ appData: j.appData });
sb.localStorage.store.bb_ctdata = JSON.stringify(j.ctData);
let out = null;
sb.__OUT__ = o => { out = o; };

vm.runInNewContext(F.src(['config.js', 'utils.js', 'cost-tracker.js']) + `
;(function(){
  ctLoad();
  var W = function (inv) { return ctInvoiceDateWarning(inv); };

  var cases = {
    // The reported one: invoice a year behind its own delivery.
    reported:   W({ date: '2025-07-15', deliveryDate: '2026-09-03' }),
    // The other direction -- an invoice dated long AFTER its delivery.
    backwards:  W({ date: '2026-09-03', deliveryDate: '2025-07-15' }),
    // Fall River came through as 1986, with no delivery date to disagree with,
    // and sat forty years out of every report saying nothing.
    ancient:    W({ date: '1986-04-08' }),
    ancientToo: W({ date: '1986-04-08', deliveryDate: '2026-09-03' }),
    // A date after today is not a delivery that has not happened yet.
    future:     W({ date: '2099-01-01' }),

    // ...and everything that must stay QUIET.
    sameDay:    W({ date: '2026-09-03', deliveryDate: '2026-09-03' }),
    nextDay:    W({ date: '2026-09-02', deliveryDate: '2026-09-03' }),
    // A month apart is ordinary: terms, a late scan, a statement date.
    thirtyDays: W({ date: '2026-08-04', deliveryDate: '2026-09-03' }),
    // A backfill: old, deliberately, and with no delivery date to contradict.
    backfill:   W({ date: '2024-03-11' }),
    // Nothing to judge.
    noDate:     W({ date: null }),
    noInvoice:  W(null),
    junkDate:   W({ date: 'not a date', deliveryDate: '2026-09-03' }),
    junkDeliv:  W({ date: '2026-09-03', deliveryDate: 'not a date' })
  };

  // Where the boundary actually sits.
  var boundary = {
    at30:  W({ date: '2026-08-04', deliveryDate: '2026-09-03' }),
    at31:  W({ date: '2026-08-03', deliveryDate: '2026-09-03' })
  };

  // And the real book: which invoices this flags, and whether ctEffDate is
  // being rescued by a delivery date in each case.
  var flagged = [];
  ctData.invoices.forEach(function (inv) {
    var w = W(inv);
    if (!w) return;
    flagged.push({ supplier: inv.supplier, date: inv.date, deliv: inv.deliveryDate || null,
                   eff: ctEffDate(inv), warning: w,
                   rescued: !!(inv.deliveryDate && ctEffDate(inv) === inv.deliveryDate) });
  });

  __OUT__({
    cases: cases, boundary: boundary, drift: CT_DATE_DRIFT_DAYS,
    invoices: ctData.invoices.length,
    flagged: flagged.length,
    rescued: flagged.filter(function (f) { return f.rescued; }).length,
    unrescued: flagged.filter(function (f) { return !f.rescued; })
                      .map(function (f) { return f.supplier + ' ' + f.date; }),
    sample: flagged.slice(0, 3).map(function (f) {
      return f.supplier + ' ' + f.date + ' -> eff ' + f.eff; })
  });
})();`, sb, { filename: 'ct.js' });

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };
const o = out, c = o.cases;

console.log('the dates that are wrong');
t('the reported one: dated a year before its own delivery',
  /415 days before/.test(c.reported || ''), c.reported);
t('and the other direction is caught too',
  /days after the delivery date/.test(c.backwards || ''), c.backwards);
t('1986, with nothing to compare against, is caught on its own',
  /cannot be right/.test(c.ancient || ''), c.ancient);
t('and is still caught when there IS a delivery date',
  /cannot be right/.test(c.ancientToo || ''), c.ancientToo);
t('a date in the future is caught', /in the future/.test(c.future || ''), c.future);

console.log('\nand — the harder half — the ones that must stay quiet');
t('same day says nothing', c.sameDay === null);
t('next day says nothing', c.nextDay === null);
t('a month apart says nothing — terms, or a late scan', c.thirtyDays === null);
t('a deliberate backfill with no delivery date says nothing', c.backfill === null);
t('no date at all, and no invoice at all, say nothing',
  c.noDate === null && c.noInvoice === null);
t('an unparseable date is not guessed at',
  c.junkDate === null && c.junkDeliv === null);

console.log('\nthe boundary sits where it says it does (' + o.drift + ' days)');
t('exactly ' + o.drift + ' days is quiet', o.boundary.at30 === null);
t('one more speaks up', /31 days before/.test(o.boundary.at31 || ''), o.boundary.at31);

console.log('\nthe real book (' + o.invoices + ' invoices)');
t(o.flagged + ' flagged, and all ' + o.rescued + ' carry a delivery date holding the real one',
  o.flagged === o.rescued, o.flagged + ' flagged / ' + o.rescued + ' rescued');
t('so nothing flagged is silently filing costs in the wrong month',
  o.unrescued.length === 0, o.unrescued.slice(0, 3).join('; ') || 'none unrescued');
if (o.sample.length) console.log('      (' + o.sample.join(' | ') + ')');

console.log(fail.length ? '\n' + fail.length + ' FAILURES:\n' + fail.join('\n') : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
