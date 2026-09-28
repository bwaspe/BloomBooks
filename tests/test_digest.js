// The Monday digest.
//
// BloomBooks has pushed a summary to the Summary tab every day since September
// 2026 and nothing has ever read it. The comment in the app said "Apps Script
// emails it on a schedule" and no such function was written -- the whole
// second half of the feature was absent.
//
// The Apps Script half is run here the way test_vendorlist runs getVendors:
// the real Code.gs in a context with the Google services stubbed.
const F = require('./fixtures');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.join(__dirname, '..');

function script(opts) {
  opts = opts || {};
  const logged = [];
  const sent = [];
  const sb = {
    JSON, String, Array, Number, Object, Date, Math, isNaN,
    Logger: { log: m => logged.push(String(m)) },
    MailApp: { sendEmail: m => sent.push(m) },
    Session: { getEffectiveUser: () => ({ getEmail: () => opts.effective || 'runs-as@example.com' }),
               getScriptTimeZone: () => 'UTC' },
    Utilities: { formatDate: (d) => new Date(d).toISOString().slice(0, 10) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'SHEETID', setProperty: () => {} }) },
    SpreadsheetApp: {
      openById: () => ({
        getSheetByName: name => {
          if (name === 'Settings') {
            if (opts.noSettings) return null;
            return { getLastRow: () => 1,
                     getRange: () => ({ getValue: () => opts.settingsCell !== undefined ? opts.settingsCell
                                                      : JSON.stringify({ digest: opts.digest || {} }) }) };
          }
          if (name === 'Summary') {
            if (opts.noSummary) return null;
            const rows = opts.rows || [];
            return { getLastRow: () => rows.length + 1,
                     getRange: () => ({ getValues: () => [rows[rows.length - 1]] }) };
          }
          return null;
        }
      })
    },
    GmailApp: {}, UrlFetchApp: {}, DriveApp: {}, ScriptApp: { getProjectTriggers: () => [] },
    ContentService: {}, HtmlService: {}, CacheService: {}
  };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(REPO, 'apps-script', 'Code.gs'), 'utf8'), sb, { filename: 'Code.gs' });
  return { sb, logged, sent };
}

const summary = (over) => Object.assign({
  generatedAt: new Date().toISOString(),
  weekStart: '2026-09-21', weekEnd: '2026-09-28',
  weeklyTotal: 1284.5,
  byCategory: { Flowers: 900.25, Greens: 284.25, Packaging: 100 },
  staleMargins: [{ name: 'Rose Freedom', margin: 41 }, { name: 'Stock Mauve', margin: 38 }],
  missingInvoices: { count: 3, total: 412.75, oldest: '2026-09-14' },
  budget: { type: 'seasonal', baseline: 1100, actual: 1284.5, priorYearCount: 2 }
}, over || {});

const row = (s, when) => [when || new Date(), JSON.stringify(s)];

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };

console.log('off until it is asked for');
{
  // The opposite fallback to the vendor list, on purpose: a scanner reading
  // nothing fails silently for weeks, where a digest that does not arrive is
  // noticed the first Monday. So unreadable settings mean OFF.
  const a = script({ rows: [row(summary())] });
  a.sb.sendWeeklyDigest();
  t('with no digest settings at all, nothing is sent', a.sent.length === 0);
  t('and it says why', a.logged.some(m => /switched off/.test(m)), a.logged.join(' | '));

  const bad = script({ settingsCell: '{ not json', rows: [row(summary())] });
  bad.sb.sendWeeklyDigest();
  t('unreadable settings mean off, not on', bad.sent.length === 0);

  const noTab = script({ noSettings: true, rows: [row(summary())] });
  noTab.sb.sendWeeklyDigest();
  t('and so does a missing Settings tab', noTab.sent.length === 0);
}

console.log('\nswitched on');
{
  const a = script({ digest: { enabled: true, to: 'owner@example.com' }, rows: [row(summary())] });
  a.sb.sendWeeklyDigest();
  t('it sends', a.sent.length === 1);
  t('to the address given', a.sent[0].to === 'owner@example.com');

  // The subject has to carry the week, or an uninteresting one cannot be
  // skipped without opening it.
  t('the subject leads with what was spent', /\$1,284\.50 bought/.test(a.sent[0].subject),
    a.sent[0].subject);
  t('and names what needs doing', /3 invoices missing/.test(a.sent[0].subject) &&
    /2 to reprice/.test(a.sent[0].subject), a.sent[0].subject);

  const html = a.sent[0].htmlBody;
  t('the body breaks it down by category', /Flowers/.test(html) && /\$900\.25/.test(html));
  t('sets it against the same month last year', /same month of previous years/.test(html));
  t('and says how far over', /\$184\.50 over/.test(html), (html.match(/\$[\d,.]+ (over|under)/) || [])[0]);
  t('names the payments with no invoice', /3 payments with no invoice/.test(html) &&
    /\$412\.75/.test(html));
  t('and what is worth repricing', /Rose Freedom/.test(html));
  t('with a way to stop it', /Settings › Weekly digest/.test(html));

  const blank = script({ digest: { enabled: true, to: '' }, rows: [row(summary())] });
  blank.sb.sendWeeklyDigest();
  t('no address falls back to whoever the scanner runs as',
    blank.sent[0].to === 'runs-as@example.com');
}

console.log('\nfigures nobody refreshed');
{
  // The summary is only pushed when somebody OPENS BloomBooks. A week nobody
  // opened it would otherwise report stale numbers as this morning's, which is
  // the one way a digest actively misleads rather than merely being dull.
  const old = new Date(Date.now() - 6 * 864e5);
  const a = script({ digest: { enabled: true, to: 'x@y.com' }, rows: [row(summary(), old)] });
  a.sb.sendWeeklyDigest();
  const html = a.sent[0].htmlBody;
  t('it says the figures are old', /figures are 6 days old/.test(html),
    (html.match(/figures are \d+ days old/) || [])[0]);
  t('and why they are', /collected when/.test(html) && /opened/.test(html));

  const fresh = script({ digest: { enabled: true, to: 'x@y.com' }, rows: [row(summary())] });
  fresh.sb.sendWeeklyDigest();
  t('and says nothing of the sort when they are current',
    !/days old/.test(fresh.sent[0].htmlBody));
}

console.log('\na quiet week still arrives');
{
  // A digest that goes silent when there is nothing to report is
  // indistinguishable from one that has stopped working.
  const quiet = summary({ weeklyTotal: 0, byCategory: {}, staleMargins: [],
                          missingInvoices: { count: 0, total: 0, oldest: null } });
  const a = script({ digest: { enabled: true, to: 'x@y.com' }, rows: [row(quiet)] });
  a.sb.sendWeeklyDigest();
  t('it is still sent', a.sent.length === 1);
  t('saying so plainly', !!a.sent[0] && /Nothing bought this week/.test(a.sent[0].htmlBody));
  t('and the subject shows it at a glance',
    !!a.sent[0] && /\$0\.00 bought/.test(a.sent[0].subject),
    a.sent[0] && a.sent[0].subject);
  t('with nothing invented to fill it', !!a.sent[0] && !/missing/.test(a.sent[0].subject));
}

console.log('\nnothing to build one from');
{
  const a = script({ digest: { enabled: true, to: 'x@y.com' }, noSummary: true });
  a.sb.sendWeeklyDigest();
  t('no Summary tab sends nothing', a.sent.length === 0);
  t('and says so rather than failing quietly',
    a.logged.some(m => /Nothing in the Summary tab/.test(m)), a.logged.join(' | '));

  const junk = script({ digest: { enabled: true, to: 'x@y.com' }, rows: [[new Date(), '{ broken']] });
  junk.sb.sendWeeklyDigest();
  t('and a row that will not parse does not throw', junk.sent.length === 0);
}

console.log('\nthe app knows about it too');
{
  const s = fs.readFileSync(path.join(REPO, 'settings.js'), 'utf8');
  t('the setting ships off', /digest: \{ enabled: false, to: ''/.test(s));
  t('there is a panel for it', /Weekly digest/.test(s));
  t('and a malformed address is refused rather than stored',
    /does not look like an email address/.test(s));
}

console.log(fail.length ? '\n' + fail.length + ' FAILED' : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
