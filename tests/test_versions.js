// Saved versions, and two computers saving over each other.
//
// Everything here is about not losing a book, so it runs the REAL sync.js,
// audit.js, periodlock.js and versions.js -- in two separate "computers" that
// share one fake Google spreadsheet -- and checks what ends up in the sheet,
// not what the app believes it did. Only fetch, the clock and the screen are
// stood in for.
//
// The fake spreadsheet answers the calls the app makes (values get/put/append,
// batchUpdate, the tab list) the way Google does in the ways that matter here:
// a batch is all-or-nothing, a tab name must be unique, a write to a missing
// tab is refused, and a range beyond what was asked for is not returned.
const F = require('./fixtures');
const vm = require('vm');

const clone = x => JSON.parse(JSON.stringify(x));

// ---- the spreadsheet ----------------------------------------------------------

function makeGoogle() {
  const G = { tabs: [{ sheetId: 0, title: 'BloomData', hidden: false, rows: [], md: [] }],
              log: [], failCopy: false, loseReply: 0, failRead: null };
  const resp = (status, body) => ({ ok: status >= 200 && status < 300, status,
    json: async () => clone(body), text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
  const colNo = c => c.charCodeAt(0) - 64;
  function parseRange(enc) {
    const r = decodeURIComponent(enc);
    const m = r.match(/^(?:'((?:[^']|'')+)'|([A-Za-z0-9_]+))!([A-Z])(\d*)(?::([A-Z])(\d*))?$/);
    if (!m) return null;
    return { title: m[1] != null ? m[1].replace(/''/g, "'") : m[2], text: r,
             c1: colNo(m[3]), r1: m[4] ? +m[4] : 1,
             c2: m[5] ? colNo(m[5]) : colNo(m[3]), r2: m[5] ? (m[6] ? +m[6] : Infinity) : (m[4] ? +m[4] : Infinity) };
  }
  function apply(tabs, q) {
    const byId = id => tabs.find(t => t.sheetId === id);
    const named = s => tabs.some(t => t.title === s);
    if (q.duplicateSheet) {
      const d = q.duplicateSheet, src = byId(d.sourceSheetId);
      if (!src) return 'No sheet with id ' + d.sourceSheetId;
      if (d.newSheetId == null || d.newSheetId < 0 || byId(d.newSheetId)) return 'Bad or duplicate sheet id';
      if (named(d.newSheetName)) return 'A sheet with the name "' + d.newSheetName + '" already exists.';
      if (!(d.insertSheetIndex >= 0 && d.insertSheetIndex <= tabs.length)) return 'Bad index';
      tabs.splice(d.insertSheetIndex, 0, { sheetId: d.newSheetId, title: d.newSheetName, hidden: src.hidden, rows: clone(src.rows), md: [] });
    } else if (q.addSheet) {
      const p = q.addSheet.properties;
      if (byId(p.sheetId) || named(p.title)) return 'Already exists';
      tabs.splice(p.index == null ? tabs.length : p.index, 0, { sheetId: p.sheetId, title: p.title, hidden: !!p.hidden, rows: [], md: [] });
    } else if (q.updateSheetProperties) {
      const u = q.updateSheetProperties, tab = byId(u.properties.sheetId);
      if (!tab) return 'No sheet';
      if (u.fields !== 'hidden') return 'Unexpected fields ' + u.fields;
      tab.hidden = !!u.properties.hidden;
    } else if (q.createDeveloperMetadata) {
      const dm = q.createDeveloperMetadata.developerMetadata;
      const tab = byId(dm.location && dm.location.sheetId);
      if (!tab) return 'No sheet for the metadata';
      if (!dm.metadataKey || dm.visibility !== 'DOCUMENT' || typeof dm.metadataValue !== 'string') return 'Bad metadata';
      tab.md.push({ metadataKey: dm.metadataKey, metadataValue: dm.metadataValue });
    } else if (q.deleteSheet) {
      const i = tabs.findIndex(t => t.sheetId === q.deleteSheet.sheetId);
      if (i < 0) return 'No sheet';
      if (tabs.length === 1) return 'Cannot delete the only sheet';
      tabs.splice(i, 1);
    } else return 'Unknown request ' + Object.keys(q)[0];
    return '';
  }
  G.tab = title => G.tabs.find(t => t.title === title);
  G.fetch = async (url, opts) => {
    opts = opts || {};
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : null;
    let m;
    if (/:batchUpdate$/.test(url)) {
      G.log.push('batch:' + body.requests.map(r => Object.keys(r)[0]).join(','));
      if (G.failCopy && body.requests.some(r => r.duplicateSheet || r.addSheet)) return resp(500, 'Internal error');
      const tabs = clone(G.tabs);
      for (const q of body.requests) { const err = apply(tabs, q); if (err) return resp(400, { error: { message: err } }); }
      G.tabs = tabs;
      return resp(200, { replies: [] });
    }
    if (/\/spreadsheets\/[^/]+\?fields=/.test(url)) {
      G.log.push('list');
      return resp(200, { sheets: G.tabs.map((t, i) => Object.assign(
        { properties: Object.assign({ sheetId: t.sheetId, title: t.title, index: i }, t.hidden ? { hidden: true } : {}) },
        t.md.length ? { developerMetadata: t.md } : {})) });
    }
    if ((m = url.match(/\/values\/([^?]+?)(:append)?(\?.*)?$/))) {
      const rg = parseRange(m[1]);
      const tab = rg && G.tab(rg.title);
      if (!tab) return resp(400, { error: { message: 'Unable to parse range: ' + decodeURIComponent(m[1]) } });
      if (m[2]) { tab.rows.push(...clone(body.values)); return resp(200, {}); }
      if (method === 'PUT') {
        G.log.push('put:' + tab.title);
        body.values.forEach((row, i) => { tab.rows[rg.r1 - 1 + i] = clone(row); });
        if (G.loseReply && tab.title === 'BloomData') { G.loseReply--; throw new Error('The connection was reset'); }
        return resp(200, {});
      }
      G.log.push('get:' + rg.text);
      if (G.failRead && G.failRead.test(rg.text)) return resp(503, 'Backend unavailable');
      const out = tab.rows.slice(rg.r1 - 1, rg.r2 === Infinity ? undefined : rg.r2).map(r => (r || []).slice(rg.c1 - 1, rg.c2));
      return resp(200, out.length ? { values: out } : {});
    }
    return resp(404, 'Not found: ' + url);
  };
  return G;
}

// What a tab holds, read the way a person looking at the sheet would.
function tabBook(G, title) {
  const tab = G.tab(title);
  if (!tab || !tab.rows.length) return null;
  const meta = JSON.parse(tab.rows[0][0]);
  const ids = [];
  const amounts = {};
  tab.rows.slice(1).forEach(r => { if (r && r[1]) JSON.parse(r[1]).forEach(t => { ids.push(t.id); amounts[t.id] = t.amount; }); });
  return { meta, ids, amounts };
}
const versionTabs = G => G.tabs.filter(t => t.md.some(m => m.metadataKey === 'bloombooksVersion'))
  .map(t => Object.assign({ tab: t, info: JSON.parse(t.md.find(m => m.metadataKey === 'bloombooksVersion').metadataValue) }))
  .sort((a, b) => Date.parse(b.info.at) - Date.parse(a.info.at));

// ---- a computer ---------------------------------------------------------------

const UA_OFFICE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0 Safari/537.36';
const UA_PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1';

// A page load. Pass the same `store` to load the page again on the same computer.
function openPage(G, clock, ua, store) {
  const notes = [], warns = [];
  const els = {};
  const sb = F.sandbox({ setTimeout: () => 0, clearTimeout: () => {} });
  sb.console = { log() {}, warn: (...a) => warns.push(a.join(' ')), error: (...a) => warns.push(a.join(' ')) };
  sb.localStorage = { store, getItem(k) { return Object.prototype.hasOwnProperty.call(this.store, k) ? this.store[k] : null; },
                      setItem(k, v) { this.store[k] = String(v); }, removeItem(k) { delete this.store[k]; } };
  sb.sessionStorage = { s: {}, getItem(k) { return this.s[k] || null; }, setItem(k, v) { this.s[k] = v; }, removeItem(k) { delete this.s[k]; } };
  sb.document.getElementById = id => els[id] || (els[id] = { id, innerHTML: '', textContent: '', value: '', style: {},
                                                            classList: { add() {}, remove() {} } });
  sb.document.body = { classList: { toggle() {}, contains: () => false } };
  sb.navigator = { userAgent: ua };
  sb.fetch = G.fetch;
  sb.__clock = clock;
  vm.createContext(sb);
  vm.runInContext(F.src(['config.js', 'utils.js', 'sync.js', 'periodlock.js', 'audit.js', 'versions.js']), sb, { filename: 'bb.js' });
  sb.__NOTE__ = m => notes.push(String(m));
  vm.runInContext(`
    notify = function (m) { __NOTE__(m); };
    updateYearSelects = function () {}; renderMonthTabs = function () {};
    Date.now = function () { return __clock.now; };
    accessToken = 'token';
  `, sb);
  const S = code => vm.runInContext(code, sb);
  const run = code => vm.runInContext('(async function(){\n' + code + '\n})()', sb);
  return {
    sb, S, run, notes, warns, els, store,
    ids: () => JSON.parse(S(`JSON.stringify(Object.keys(appData.transactions).sort().reduce(function (a, k) {
      return a.concat(appData.transactions[k].filter(function (t) { return !t._vault; }).map(function (t) { return t.id; })); }, []))`)),
    add: (key, row) => S(`appData.transactions[${JSON.stringify(key)}] = appData.transactions[${JSON.stringify(key)}] || [];
                          appData.transactions[${JSON.stringify(key)}].push(${JSON.stringify(row)}); saveData();`),
    audit: () => JSON.parse(store.bb_audit_recent || '[]')
  };
}

const row = (id, date, amount) => ({ id, date, desc: 'Row ' + id, category: 'Office', vendor: 'V', amount, type: 'out' });
const startBook = () => ({
  years: [2025, 2026], activeYear: 2026, rules: [], lockedYears: [2025], dailyRevenueFrom: '2026-01',
  transactions: { '2025-3': [row('old', '2025-04-02', 100)], '2026-8': [row('a', '2026-09-01', 50)] },
  dailySales: { '2026-8': { '1': { counter: { s: 400 } } } }, basisAdjust: {}
});
const tick = () => new Promise(r => setImmediate(r));
const MIN = 60 * 1000;

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };

(async () => {
  const G = makeGoogle();
  const clock = { now: Date.UTC(2026, 8, 14, 13, 0, 0) };
  const officeStore = {}, phoneStore = {};

  // ------------------------------------------------------------------
  console.log('keeping versions');
  let office = openPage(G, clock, UA_OFFICE, officeStore);
  await office.run(`await loadFromSheet(); appData = normalizeAppData(${JSON.stringify(startBook())}); saveData(); await pushToSheet();`);
  const first = tabBook(G, 'BloomData');
  t('the first save to an empty sheet keeps nothing -- there is nothing to keep',
    first && first.ids.join() === 'old,a' && versionTabs(G).length === 0 && !G.log.some(l => /^batch/.test(l)),
    first && first.ids.join());

  clock.now += 10 * MIN;
  office = openPage(G, clock, UA_OFFICE, officeStore);
  await office.run('await loadFromSheet();');
  G.log.length = 0;
  office.add('2026-8', row('b', '2026-09-02', 60));
  await office.run('await pushToSheet();');
  let v = versionTabs(G);
  t('before the first save of a new session replaces the sheet, its copy is kept',
    v.length === 1 && tabBook(G, v[0].tab.title).ids.join() === 'old,a' && tabBook(G, 'BloomData').ids.join() === 'old,a,b',
    v.length && ('version holds ' + tabBook(G, v[0].tab.title).ids.join() + '; sheet now ' + tabBook(G, 'BloomData').ids.join()));
  t('  as a hidden tab, copied by Google in one request with its label',
    v.length === 1 && v[0].tab.hidden === true && G.log.includes('batch:duplicateSheet,updateSheetProperties,createDeveloperMetadata') &&
    !G.log.some(l => /^put:Version/.test(l)), v.length && v[0].tab.title);
  t('  labelled with when, where from, and the copy it holds',
    v.length === 1 && v[0].info.at === new Date(clock.now).toISOString() && /^Windows Chrome · \w{4}$/.test(v[0].info.dev) &&
    v[0].info.savedAt === first.meta._savedAt && /automatically/.test(v[0].info.reason), v.length && JSON.stringify(v[0].info));
  t('the sheet records which computer and which page saved it',
    /^Windows Chrome/.test(tabBook(G, 'BloomData').meta._savedBy) && tabBook(G, 'BloomData').meta._savedSession === office.S('SYNC_SESSION'));

  clock.now += 5 * MIN;
  G.log.length = 0;
  office.add('2026-8', row('c', '2026-09-03', 70));
  await office.run('await pushToSheet();');
  t('another save within the hour keeps no second version, and does not even look',
    versionTabs(G).length === 1 && !G.log.includes('list') && tabBook(G, 'BloomData').ids.includes('c'), G.log.join(' '));

  clock.now += 20 * MIN;
  office = openPage(G, clock, UA_OFFICE, officeStore);
  await office.run('await loadFromSheet();');
  office.add('2026-8', row('d', '2026-09-04', 80));
  await office.run('await pushToSheet();');
  t('reloading the page does not keep one either: the hour runs from the newest version',
    versionTabs(G).length === 1 && tabBook(G, 'BloomData').ids.includes('d'));

  clock.now += 61 * MIN;
  office.add('2026-8', row('e', '2026-09-05', 90));
  await office.run('await pushToSheet();');
  v = versionTabs(G);
  t('an hour on, the next save keeps the next one',
    v.length === 2 && tabBook(G, v[0].tab.title).ids.join() === 'old,a,b,c,d', v.length && tabBook(G, v[0].tab.title).ids.join());

  // ------------------------------------------------------------------
  console.log('\nhow many are kept');
  G.tabs.push({ sheetId: 55, title: 'Version notes', hidden: false, rows: [['my own notes']], md: [] });
  G.tabs.push({ sheetId: 56, title: 'AuditLog', hidden: false, rows: [['When (UTC)']], md: [] });
  const automatic = versionTabs(G).map(x => x.tab.title);
  for (let i = 0; i < 22; i++) { clock.now += 1000; await office.run('await versionSaveNow();'); }
  v = versionTabs(G);
  t('the newest 20, and no more', v.length === 20, v.length + ' versions');
  t('  the oldest are the ones removed', automatic.every(title => !G.tab(title)) && v[0].info.at === new Date(clock.now).toISOString());
  t('  and nothing that is not a labelled version is ever touched',
    !!G.tab('Version notes') && !!G.tab('AuditLog') && tabBook(G, 'BloomData').ids.includes('e'));
  t('a version kept by hand holds the book on screen, uploaded',
    /by hand/.test(v[0].info.reason) && tabBook(G, v[0].tab.title).ids.join() === 'old,a,b,c,d,e' &&
    G.log.some(l => /^put:Version/.test(l)));
  t('the Saved Versions screen lists them, each with a Restore button',
    (office.els['versions-content'].innerHTML.match(/versionRestore\(/g) || []).length === 20);

  // ------------------------------------------------------------------
  console.log('\ntwo computers');
  let phone = openPage(G, clock, UA_PHONE, phoneStore);
  await phone.run('await loadFromSheet();');
  clock.now += MIN;
  office.add('2026-8', row('x', '2026-09-06', 11));
  const officeSaved = await office.run('return await pushToSheet();');
  phone.add('2026-8', row('y', '2026-09-06', 22));
  const phoneSaved = await phone.run('return await pushToSheet();');
  await tick(); await tick();
  let sheet = tabBook(G, 'BloomData');
  t('the office saves; the phone, which loaded before that, does not overwrite it',
    officeSaved === true && phoneSaved === false && sheet.ids.includes('x') && !sheet.ids.includes('y'), sheet.ids.join());
  t('  it knows whose work it would have overwritten',
    /^Windows Chrome/.test(phone.S('syncConflict.by')) && phone.S('syncConflict.at') === sheet.meta._savedAt, phone.S('syncConflict.by'));
  const diff = JSON.parse(phone.S('JSON.stringify(syncConflict.diff)') || 'null');
  t('  and shows what differs: its own row, and the row only the office has',
    diff && diff.length === 2 && diff.some(c => c.t === 'add' && c.r.id === 'y') && diff.some(c => c.t === 'del' && c.r.id === 'x') &&
    phone.S('versionsDiffSummary(syncConflict.diff)') === '1 only on this computer, 1 only in the other version',
    diff && phone.S('versionsDiffSummary(syncConflict.diff)'));
  t('  on a banner asking which version to keep',
    phone.els['sync-conflict'].style.display === 'block' && /changed on another computer/.test(phone.els['sync-conflict'].innerHTML) &&
    /Keep this computer&#39;s version|Keep this computer's version/.test(phone.els['sync-conflict'].innerHTML));
  t('  and says so in the audit trail', phone.audit().some(e => /^Held back a save: Windows Chrome/.test(e.label)));
  phone.add('2026-8', row('y2', '2026-09-07', 23));
  const again = await phone.run('return await pushToSheet();');
  t('further saves on the phone stay on the phone until the choice is made',
    again === false && !tabBook(G, 'BloomData').ids.includes('y2') && JSON.parse(phoneStore.bloombooks_v2).transactions['2026-8'].some(r => r.id === 'y2'));

  console.log('\n  the phone keeps its own version');
  clock.now += MIN;
  await phone.run('await versionsKeepMine(); await pushToSheet();');
  v = versionTabs(G);
  sheet = tabBook(G, 'BloomData');
  t('  the office\'s copy is set aside first',
    /set aside when this computer's was kept/.test(v[0].info.reason) && tabBook(G, v[0].tab.title).ids.includes('x') &&
    !tabBook(G, v[0].tab.title).ids.includes('y'), v[0].info.reason);
  t('  then the phone\'s book goes to the sheet', sheet.ids.includes('y') && sheet.ids.includes('y2') && !sheet.ids.includes('x'), sheet.ids.join());
  t('  and the banner goes', phone.S('syncConflict') === null && phone.els['sync-conflict'].style.display === 'none');

  console.log('\n  the office, which saved before the phone chose, takes the phone\'s');
  office.add('2026-8', row('z', '2026-09-08', 33));
  const officeAgain = await office.run('return await pushToSheet();');
  await tick(); await tick();
  t('  its next save is held back in turn', officeAgain === false && !tabBook(G, 'BloomData').ids.includes('z'));
  clock.now += MIN;
  await office.run('await versionsUseTheirs();');
  v = versionTabs(G);
  t('  its own book is set aside first, uploaded, since the sheet never had it',
    /This computer's version, set aside/.test(v[0].info.reason) && ['x', 'z'].every(id => tabBook(G, v[0].tab.title).ids.includes(id)),
    v[0].info.reason);
  t('  and the office now shows the phone\'s book', office.ids().includes('y') && !office.ids().includes('z') && office.S('syncConflict') === null,
    office.ids().join());
  office = openPage(G, clock, UA_OFFICE, officeStore);
  await office.run('await loadFromSheet();');
  t('  a reload does not send the office\'s old book back over the choice',
    office.ids().includes('y') && !office.ids().includes('z') && !tabBook(G, 'BloomData').ids.includes('z') && office.S('syncConflict') === null);
  office.add('2026-8', row('w', '2026-09-09', 44));
  t('  and its saves go through again', await office.run('return await pushToSheet();') === true && tabBook(G, 'BloomData').ids.includes('w'));

  // ------------------------------------------------------------------
  console.log('\nrestoring a version');
  // A version in which a CLOSED year differs, and some rows came and went.
  const old = JSON.parse(office.S('JSON.stringify(appData)'));
  old.transactions['2025-3'][0].amount = 90;
  old.transactions['2026-8'] = old.transactions['2026-8'].filter(r => r.id !== 'w').concat([row('r', '2026-09-10', 55)]);
  clock.now += MIN;
  await office.run(`await versionFromBook('A version to go back to', ${JSON.stringify(old)});`);
  clock.now += MIN;
  await office.run('await versionsLoad();');
  const target = office.S(`versionList.find(function (v) { return v.info.reason === 'A version to go back to'; }).sheetId`);
  let asked = '';
  office.sb.confirm = m => { asked = m; return true; };
  office.notes.length = 0;
  await office.run(`await versionRestore(${target}); await pushToSheet();`);
  v = versionTabs(G);
  sheet = tabBook(G, 'BloomData');
  t('it asks first, saying what restoring would change', /Restoring it: 1 added, 1 edited, 1 deleted/.test(asked), asked.split('\n')[2]);
  t('the book as it stood is kept before it is replaced',
    /^Kept before restoring/.test(v[0].info.reason) && tabBook(G, v[0].tab.title).ids.includes('w') && !tabBook(G, v[0].tab.title).ids.includes('r'));
  t('the version comes back, in the app and then in the sheet',
    office.ids().includes('r') && !office.ids().includes('w') && sheet.ids.includes('r') && !sheet.ids.includes('w'), sheet.ids.join());
  t('  closed year included, without the period lock refusing it',
    sheet.amounts.old === 90 && !office.notes.some(n => /closed/.test(n)), 'closed-year row $' + sheet.amounts.old);
  const restored = office.audit().find(e => /^Restored the version kept/.test(e.label));
  t('the audit trail records the restore, with exactly what it changed',
    restored && restored.changes.length === 3 && restored.changes.some(c => c.t === 'edit' && c.r.id === 'old' && JSON.stringify(c.f.amount) === '[100,90]'),
    restored && restored.changes.map(c => c.t + ':' + c.r.id).join(' '));
  office.S('appData.notes["2026-8"] = "after the restore"; saveData();');
  t('  and records nothing twice when the next save comes', !office.audit().slice(-1)[0].label ||
    office.audit().slice(-1)[0].changes.every(c => c.t === 'set'));

  // ------------------------------------------------------------------
  console.log('\nchanges that waited in the browser');
  await office.run('await pushToSheet();');
  office.S('accessToken = null;');
  office.add('2026-8', row('off1', '2026-09-11', 1));
  office = openPage(G, clock, UA_OFFICE, officeStore);
  await office.run('await loadFromSheet();');
  t('saved while signed out, on top of what the sheet still holds: sent on the next load, quietly',
    tabBook(G, 'BloomData').ids.includes('off1') && office.S('syncConflict') === null);

  office.S('accessToken = null;');
  office.add('2026-8', row('off2', '2026-09-12', 2));
  phone = openPage(G, clock, UA_PHONE, phoneStore);
  await phone.run('await loadFromSheet();');
  clock.now += MIN;
  phone.add('2026-8', row('p2', '2026-09-12', 3));
  await phone.run('await pushToSheet();');
  // The office's clock is now BEHIND the phone's save, which used to mean its
  // waiting change simply lost to the sheet on the next load.
  clock.now -= 5 * MIN;
  office = openPage(G, clock, UA_OFFICE, officeStore);
  await office.run('await loadFromSheet();');
  await tick(); await tick();
  sheet = tabBook(G, 'BloomData');
  t('saved while signed out, and the sheet saved elsewhere meanwhile: neither is lost, it asks',
    office.S('syncConflict') !== null && office.ids().includes('off2') && sheet.ids.includes('p2') && !sheet.ids.includes('off2'),
    'office shows off2: ' + office.ids().includes('off2') + ', sheet ' + sheet.ids.slice(-3).join());
  office.add('2026-8', row('off3', '2026-09-13', 4));
  office = openPage(G, clock, UA_OFFICE, officeStore);
  await office.run('await loadFromSheet();');
  t('  reloading without choosing asks again, rather than sending it',
    office.S('syncConflict') !== null && !tabBook(G, 'BloomData').ids.includes('off3') && office.ids().includes('off3'));
  clock.now += 10 * MIN;
  await office.run('await versionsKeepMine(); await pushToSheet();');
  t('  and keeping it sends it, with the phone\'s copy set aside',
    tabBook(G, 'BloomData').ids.includes('off3') && versionTabs(G)[0].info.reason.indexOf('iPhone/iPad Safari') === 0 &&
    tabBook(G, versionTabs(G)[0].tab.title).ids.includes('p2'));

  // A book saved before this record existed: no record, so the clock decides,
  // and the sheet's copy is kept before it is replaced.
  office.S('accessToken = null;');
  office.add('2026-8', row('legacy', '2026-09-13', 5));
  delete officeStore.bb_sheet_base;
  const before = versionTabs(G)[0].info.at;
  clock.now += MIN;
  office = openPage(G, clock, UA_OFFICE, officeStore);
  await office.run('await loadFromSheet();');
  t('a waiting book from before the record existed is sent as it always was, the sheet\'s copy kept first',
    tabBook(G, 'BloomData').ids.includes('legacy') && versionTabs(G)[0].info.at !== before &&
    /not yet saved to the sheet/.test(versionTabs(G)[0].info.reason));

  // ------------------------------------------------------------------
  console.log('\nwhen things go wrong');
  G.loseReply = 1;
  office.add('2026-8', row('lost', '2026-09-14', 6));
  const lost = await office.run('return await pushToSheet();');
  office.add('2026-8', row('after', '2026-09-14', 7));
  const afterLost = await office.run('return await pushToSheet();');
  t('a save that reached Google but whose reply was lost is not mistaken for another computer\'s',
    lost === false && afterLost === true && office.S('syncConflict') === null && tabBook(G, 'BloomData').ids.includes('after'));

  G.failCopy = true;
  clock.now += 2 * 60 * MIN;
  const countBefore = versionTabs(G).length, newestBefore = versionTabs(G)[0].tab.title;
  office.add('2026-8', row('nocopy', '2026-09-14', 8));
  const saved = await office.run('return await pushToSheet();');
  t('Google refusing to copy the tab does not stop the save',
    saved === true && tabBook(G, 'BloomData').ids.includes('nocopy') && versionTabs(G)[0].tab.title === newestBefore &&
    versionTabs(G).length === countBefore && office.warns.some(w => /No version kept/.test(w)));
  G.failCopy = false;
  office.S(`confirm = function () { return true; };`);
  const target2 = versionTabs(G)[3].tab.sheetId;
  await office.run('await versionsLoad();');
  G.failCopy = true;
  office.notes.length = 0;
  await office.run(`await versionRestore(${target2});`);
  t('but a restore that cannot keep the book first restores nothing',
    office.ids().includes('nocopy') && office.notes.some(n => /could not be kept first, so nothing was restored/.test(n)));
  G.failCopy = false;

  G.failRead = /A1:C200/;
  const idsBefore = office.ids().join();
  office = openPage(G, clock, UA_OFFICE, officeStore);
  office.S('loadFromLocal();');
  const loadedOk = await office.run('return await loadFromSheet();');
  t('a failed read of the month rows is reported, not loaded as an empty book',
    loadedOk === false && office.ids().join() === idsBefore && tabBook(G, 'BloomData').ids.includes('nocopy'), office.ids().length + ' rows on screen');
  G.failRead = null;
  office.add('2026-8', row('offline-load', '2026-09-14', 9));
  t('  and a page running on the browser\'s book still saves, checking against that book\'s record',
    await office.run('return await pushToSheet();') === true && tabBook(G, 'BloomData').ids.includes('offline-load') && office.S('syncConflict') === null);

  // ------------------------------------------------------------------
  console.log('\nsmall things');
  const slow = { now: clock.now - 30 * MIN };
  phone = openPage(G, slow, UA_PHONE, phoneStore);
  await phone.run('await loadFromSheet();');
  phone.add('2026-8', row('slow', '2026-09-14', 10));
  t('a save on a computer whose clock is behind is still later than the copy it was built on',
    phone.S('appData._savedAt') > tabBook(G, 'BloomData').meta._savedAt);
  t('a tab name with spaces or quotes is quoted in a range', office.S(`sheetRange("Bob's tab", 'A1')`) === "'Bob''s tab'!A1" &&
    office.S(`sheetRange('BloomData', 'A1')`) === 'BloomData!A1');

  console.log(fail.length ? '\n' + fail.length + ' FAILURES:\n' + fail.join('\n') : '\nall assertions passed');
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.log('  FAIL  suite threw: ' + (e && e.stack || e)); process.exit(1); });
