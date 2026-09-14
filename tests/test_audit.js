// The audit trail: what changed, when, on which computer, and from what.
//
// Captured by comparing each save with the last, so it has to be right about
// three things: that a real change is recorded with its before and after,
// whatever made it; that nothing which is not a change is recorded (loading,
// vault totals, drawing a screen) or the trail fills with noise nobody reads;
// and that it reaches the sheet -- including the first time, when the tab
// does not exist yet -- without losing anything when a send fails.
const F = require('./fixtures');
const vm = require('vm');

function makeApp(opts) {
  opts = opts || {};
  const notes = [];
  const sb = F.sandbox({ setTimeout: () => 0, clearTimeout: () => {} });
  sb.document.getElementById = id => (opts.els || {})[id] || null;
  sb.document.body = { classList: { toggle() {}, contains: () => false } };
  sb.navigator = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0 Safari/537.36' };
  vm.createContext(sb);
  vm.runInContext(F.src(['config.js', 'utils.js', 'sync.js', 'periodlock.js', 'audit.js', 'ledger.js', 'reports.js',
                         'daily-sales.js', 'import-trainer.js']), sb, { filename: 'bb.js' });
  sb.__NOTE__ = m => notes.push(m);
  vm.runInContext('notify = function (m) { __NOTE__(m); }', sb);
  const S = code => vm.runInContext(code, sb);
  return {
    sb, S, notes,
    load(obj) { sb.__D__ = JSON.parse(JSON.stringify(obj)); S('appData = normalizeAppData(__D__);'); },
    recent() { return JSON.parse(sb.localStorage.store.bb_audit_recent || '[]'); },
    queue() { return JSON.parse(sb.localStorage.store.bb_audit_queue || '[]'); }
  };
}

const row = (id, date, amount, category, type) => ({ id, date, desc: 'Row ' + id, category, vendor: 'V', amount, type: type || 'out' });
const book = () => ({
  years: [2026], activeYear: 2026, rules: [], lockedYears: [], dailyRevenueFrom: '2026-01',
  transactions: { '2026-2': [row('a', '2026-03-10', 100, 'Office'), row('b', '2026-03-12', 250, 'Supplies & Materials - COGS')] },
  dailySales: { '2026-4': { '10': { counter: { s: 500 } } } },
  basisAdjust: {}
});

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };
const last = a => a.recent()[a.recent().length - 1];

// ------------------------------------------------------------------
console.log('what a change records');
{
  const a = makeApp(); a.load(book());
  a.S("updateTransaction(2026, 2, 'a', { amount: 120, category: 'Marketing' })");
  let e = last(a);
  t('an edit: which row, and each field before and after',
    e.changes.length === 1 && e.changes[0].t === 'edit' && e.changes[0].r.id === 'a' &&
    JSON.stringify(e.changes[0].f.amount) === '[100,120]' && JSON.stringify(e.changes[0].f.category) === '["Office","Marketing"]',
    JSON.stringify(e.changes[0].f));
  t('  with when and on which computer', /^\d{4}-\d{2}-\d{2}T/.test(e.at) && /^Windows Chrome · \w{4}$/.test(e.dev), e.dev);

  a.S("addTransaction(2026, 2, " + JSON.stringify(row('c', '2026-03-20', 40, 'Office')) + ")");
  t('an added row', last(a).changes[0].t === 'add' && last(a).changes[0].r.amount === 40);

  a.S("deleteTransaction(2026, 2, 'b')");
  t('a deleted row, with what it was', last(a).changes[0].t === 'del' && last(a).changes[0].r.amount === 250);

  a.S("var r = appData.transactions['2026-2'].shift(); r.date = '2026-04-02'; (appData.transactions['2026-3'] = appData.transactions['2026-3'] || []).push(r); saveData();");
  e = last(a);
  t('a row re-filed into another month is one move, not a delete and an add',
    e.changes.length === 1 && e.changes[0].t === 'move' && e.changes[0].from === '2026-2' && e.changes[0].to === '2026-3' &&
    JSON.stringify(e.changes[0].f.date) === '["2026-03-10","2026-04-02"]', JSON.stringify(e.changes));

  a.S("appData.dailySales['2026-4']['10'].counter.s = 650; appData.dailySales['2026-4']['10']._tips = 20; saveData();");
  e = last(a);
  t('a day-book entry, down to the channel and field',
    e.changes.some(c => c.t === 'day' && c.d === '10' && c.c === 'counter' && JSON.stringify(c.f.s) === '[500,650]') &&
    e.changes.some(c => c.t === 'day' && c.d === '10' && JSON.stringify(c.f._tips) === '[null,20]'), JSON.stringify(e.changes));

  a.S("basisAdjustMap()[2025] = { tax: 1000 }; saveData();");
  e = last(a);
  t('a setting, named, with what it was and is',
    e.changes.length === 1 && e.changes[0].t === 'set' && e.changes[0].k === 'basisAdjust' && /1000/.test(e.changes[0].a));

  const n = a.recent().length;
  a.S("appData.activeYear = 2025; saveData(); saveData();");
  t('switching the year on screen, or saving with nothing changed, records nothing', a.recent().length === n);
}

console.log('\nwhat is not a change');
{
  const a = makeApp(); a.load(book());
  a.S(`appData.transactions['2026-2'].unshift({ id: 'vault-rev-2026-2', date: '2026-03-01', desc: 'Total Revenue (Vault)',
         category: 'Revenue', amount: 5000, type: 'in', _vault: true }); saveData();`);
  t('vault totals added on load record nothing', a.recent().length === 0);
  a.load(Object.assign(book(), { transactions: { '2026-2': [row('z', '2026-03-01', 1, 'Office')] } }));
  a.S('saveData()');
  t('loading a different book is not a change to it', a.recent().length === 0);
}

console.log('\none act, one entry');
{
  const a = makeApp(); a.load(book());
  a.S(`renderStagingTable = function () {};
       stagingRows = [1, 2, 3].map(function (i) { return { _id: 's' + i, date: '2026-03-2' + i, txYear: 2026, txMonth: 2,
         desc: 'IMPORTED ' + i, amount: 10 * i, type: 'out', category: 'Office', vendor: '', status: 'review' }; });
       saveAllStaged();`);
  const e = last(a);
  t('an import of three rows is one entry, labelled, with three additions',
    a.recent().length === 1 && e.label === 'Bulk import' && e.changes.filter(c => c.t === 'add').length === 3,
    a.recent().length + ' entries');
}

console.log('\nthe lock\'s moments');
{
  const a = makeApp(); a.load(Object.assign(book(), { lockedYears: [2026] }));
  a.S("updateTransaction(2026, 2, 'a', { amount: 999 })");
  t('a refused change is recorded as refused, and not as made',
    a.recent().length === 1 && /Refused a change to closed 2026/.test(last(a).label) && last(a).changes.length === 0,
    a.recent().map(e => e.label).join(' / '));
  a.S('lockUnlockForSession(2026)');
  a.S("updateTransaction(2026, 2, 'a', { amount: 110 })");
  a.S('lockRelock(2026)');
  const labels = a.recent().map(e => e.label || e.changes.map(c => c.t).join(','));
  t('unlocking, the edit made while open, and locking again, in order',
    labels.slice(1).join(' / ') === 'Unlocked 2026 for the session / edit / Locked 2026 again', labels.join(' / '));
}

console.log('\nsending it to the sheet');
{
  const a = makeApp(); a.load(book());
  a.S("updateTransaction(2026, 2, 'a', { amount: 120 })");
  a.S("addTransaction(2026, 2, " + JSON.stringify(row('c', '2026-03-20', 40, 'Office')) + ")");
  t('while signed out, entries wait in this browser', a.queue().length === 2);

  const calls = [];
  let tabExists = false, failNext = false;
  a.sb.fetch = async (url, opt) => {
    calls.push({ url, method: opt && opt.method, body: opt && opt.body });
    const reply = (status, body) => ({ ok: status < 300, status, text: async () => body || '', json: async () => JSON.parse(body || '{}') });
    if (/:batchUpdate/.test(url)) { tabExists = true; return reply(200, '{}'); }
    if (/:append/.test(url)) {
      if (failNext) { failNext = false; return reply(503, 'unavailable'); }
      if (!tabExists) return reply(400, '{"error":{"message":"Unable to parse range: AuditLog!A:F"}}');
      return reply(200, '{}');
    }
    return reply(404, '');
  };
  a.S("accessToken = 'test-token';");
  (async () => {
    await a.S('auditFlush()');
    const appends = calls.filter(c => /:append/.test(c.url));
    t('the first send finds no AuditLog tab, makes it, adds a header, then the entries',
      calls.some(c => /:batchUpdate/.test(c.url) && /addSheet/.test(c.body) && /AuditLog/.test(c.body)) &&
      appends.length === 3 && /When \(UTC\)/.test(appends[1].body) && JSON.parse(appends[2].body).values.length === 2,
      calls.map(c => c.url.replace(/^.*\/spreadsheets\/[^/]+/, '')).join(' , '));
    t('  appended as raw rows, never overwriting', appends.every(c => c.method === 'POST' && /valueInputOption=RAW&insertDataOption=INSERT_ROWS/.test(c.url)));
    const sent = JSON.parse(appends[2].body).values[0];
    t('  each row readable in the sheet: when, computer, what, summary, changes',
      /^\d{4}-/.test(sent[0]) && /Windows Chrome/.test(sent[1]) && sent[3] === '1 edited' && JSON.parse(sent[4])[0].t === 'edit', sent.slice(0, 4).join(' | '));
    t('  and the queue is empty once sent', a.queue().length === 0);

    a.S("updateTransaction(2026, 2, 'a', { amount: 130 })");
    failNext = true;
    await a.S('auditFlush()');
    t('a failed send keeps the entry for next time', a.queue().length === 1);
    await a.S('auditFlush()');
    t('  and the next send delivers it', a.queue().length === 0);

    // An enormous change -- a whole year re-filed -- must still fit in one cell.
    const big = { id: 'big', at: '2026-09-14T00:00:00Z', dev: 'x', label: 'huge', changes: [] };
    for (let i = 0; i < 3000; i++) big.changes.push({ t: 'add', m: '2026-1', r: row('r' + i, '2026-02-01', i, 'Supplies & Materials - COGS') });
    a.sb.__BIG__ = big;
    const cell = a.S('auditSheetRow(__BIG__)')[4];
    t('a very large entry is cut to fit a sheet cell and says how much was left out',
      cell.length <= 45000 && JSON.parse(cell).slice(-1)[0].t === 'more', cell.length + ' chars');

    // ---- reading it back ----
    const els = { 'audit-content': { innerHTML: '' } };
    const r = makeApp({ els }); r.load(book());
    r.S("updateTransaction(2026, 2, 'a', { amount: 120, category: 'Marketing' })");
    r.S("appData.dailySales['2026-4']['10'].counter.s = 650; saveData();");
    r.S('renderAuditPanel()');
    const text = els['audit-content'].innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    console.log('\nreading it');
    t('the Audit Trail screen reads as plain English',
      /Edited · 2026-03-10 · Marketing · out \$120\.00 · Row a — /.test(text) &&
      /amount \$100\.00 → \$120\.00/.test(text) && /category Office → Marketing/.test(text) &&
      /Day book 2026-05-10 · \S+ — sales \$500\.00 → \$650\.00/.test(text), text.slice(0, 260));
    t('  and says how many are waiting to be sent', /2 waiting to be sent to the sheet/.test(text));

    // ---- the owner's real book ----
    console.log('\na normal session on the owner\'s real book records nothing');
    const REAL = F.book('bloom-books-backup-2026-09-14-1809.json');
    if (!REAL) { console.log('  (no 14 Sep backup to hand — skipping)'); }
    else {
      const b = makeApp(); b.load(REAL.appData || REAL);
      const tries = ['ensureVaultData()', 'renderYearlyPanel()', 'renderTaxPanel()', 'renderTrendsPanel()', 'renderHolidayPanel()',
                     'renderDailySalesPanel()', 'renderSalesTaxPanel()', 'dsChannels()'];
      [2023, 2024, 2025, 2026].forEach(y => { for (let m = 0; m < 12; m++) tries.push('appData.activeYear = ' + y + '; renderMonthPanel(' + m + ')'); });
      tries.forEach(code => { try { b.S(code); } catch (e) {} });
      b.S('saveData()');
      const ev = b.recent();
      t('loading, vault totals and drawing every screen add nothing to the trail', ev.length === 0,
        ev.map(e => auditBrief(e)).join(' / '));
      const t0 = Date.now(); for (let i = 0; i < 10; i++) b.S('saveData()');
      t('  and checking a save costs a few milliseconds', (Date.now() - t0) / 10 < 30, ((Date.now() - t0) / 10).toFixed(1) + ' ms per save, lock included');
    }

    console.log(fail.length ? '\n' + fail.length + ' FAILURES:\n' + fail.join('\n') : '\nall assertions passed');
    process.exit(fail.length ? 1 : 0);
  })().catch(e => { console.log('  FAIL  suite threw: ' + (e.stack || e)); process.exit(1); });
}

function auditBrief(e) { return (e.label || '') + ' ' + JSON.stringify(e.changes).slice(0, 200); }
