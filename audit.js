// ============================================================
// AUDIT TRAIL
// ============================================================
// What changed in the book, when, on which computer, and what it was before.
//
// Captured at saveData, like the period lock, rather than inside each feature.
// Every save is compared with the book as it stood after the previous save, so
// a change is recorded however it was made -- an edit, an import, a re-file, a
// day-book entry, a setting -- including by screens not yet written. A load
// from the browser or the sheet, or a restored backup, resets that comparison,
// because a load is not a change.
//
// The history is written to its own AuditLog tab in the Google Sheet, one row
// per save, appended and never rewritten. It does not go in the main sync
// payload: that is rewritten on every save and caps each cell at 50,000
// characters, and a history only grows. Entries wait in this browser until
// they are sent, so nothing is lost while signed out or offline, and the most
// recent few hundred stay here to read without the sheet.

const AUDIT_TAB = 'AuditLog';
const AUDIT_QUEUE_KEY = 'bb_audit_queue';
const AUDIT_RECENT_KEY = 'bb_audit_recent';
const AUDIT_RECENT_KEEP = 400;
const AUDIT_CELL_MAX = 45000;          // under the sheet's 50,000-character cell limit
const AUDIT_SKIP = { transactions: 1, dailySales: 1, _savedAt: 1, _savedBy: 1, _savedSession: 1, activeYear: 1 };
const AUDIT_SETTING_NAMES = {
  basisAdjust: 'Like-for-like figures', lockedYears: 'Closed years', rules: 'Import rules',
  bankRecon: 'Bank reconciliation record', notes: 'Month notes', reconciled: 'Reconciled ticks',
  years: 'Years', channels: 'Day book channels', channelsVersion: 'Day book channel version',
  deferrals: 'Delivery-basis deferrals', holidays: 'Holiday revenue', holidayBuy: 'Holiday buying dates',
  monthClose: 'Month-end checklist', salesSheets: 'Holiday sales workbooks', dailyRevenueFrom: 'Revenue source switch'
};
const AUDIT_DAY_FIELDS = { s: 'sales', x: 'exempt', t: 'tax', _tips: 'tips' };

let auditBase = null;          // the book as last recorded, as strings per list
let auditLabelNext = '';       // what the next recorded save was, when a feature says
let auditHold = 0;             // > 0 while a batch is in progress: record once at the end
let auditFlushTimer = null;
let auditFlushing = false;
let auditSheetEvents = null;   // full history once loaded from the sheet

// ---- snapshot and diff ------------------------------------------------------

function auditSnapshot(d) {
  const snap = { tx: {}, ds: {}, set: {} };
  if (!d) return snap;
  Object.keys(d.transactions || {}).forEach(k => {
    const rows = (d.transactions[k] || []).filter(t => t && !t._vault);   // vault totals are generated, not entered
    if (rows.length) snap.tx[k] = JSON.stringify(rows);
  });
  Object.keys(d.dailySales || {}).forEach(k => {
    const v = d.dailySales[k];
    if (v && Object.keys(v).length) snap.ds[k] = JSON.stringify(v);
  });
  Object.keys(d).forEach(k => { if (!AUDIT_SKIP[k]) snap.set[k] = JSON.stringify(d[k] === undefined ? null : d[k]); });
  return snap;
}

function auditRowBrief(t) {
  return { id: t.id || '', date: t.date || '', desc: String(t.desc || '').slice(0, 40), category: t.category || '',
           vendor: String(t.vendor || '').slice(0, 30), amount: t.amount, type: t.type || '' };
}
function auditRowFields(a, b) {
  const f = {};
  const keys = {};
  Object.keys(a || {}).concat(Object.keys(b || {})).forEach(k => { if (k !== 'id' && k !== 'bal' && k.charAt(0) !== '_') keys[k] = 1; });
  Object.keys(keys).forEach(k => {
    if (JSON.stringify(a ? a[k] : undefined) !== JSON.stringify(b ? b[k] : undefined)) f[k] = [a ? a[k] : null, b ? b[k] : null];
  });
  return f;
}

function auditDiff(prev, next) {
  const changes = [];
  const removed = [], added = [];

  // Ledger rows. Matched by id within and across months, so a re-filed row
  // reads as one move rather than a delete in one month and an add in another.
  const txKeys = {};
  Object.keys(prev.tx).concat(Object.keys(next.tx)).forEach(k => { txKeys[k] = 1; });
  Object.keys(txKeys).sort().forEach(k => {
    if (prev.tx[k] === next.tx[k]) return;
    const before = prev.tx[k] ? JSON.parse(prev.tx[k]) : [];
    const after = next.tx[k] ? JSON.parse(next.tx[k]) : [];
    const keyOf = (t, i) => t.id ? 'id:' + t.id : 'raw:' + JSON.stringify(t);
    const bMap = {}, aMap = {};
    before.forEach((t, i) => { (bMap[keyOf(t, i)] = bMap[keyOf(t, i)] || []).push(t); });
    after.forEach((t, i) => { (aMap[keyOf(t, i)] = aMap[keyOf(t, i)] || []).push(t); });
    Object.keys(bMap).forEach(id => {
      const bs = bMap[id], as = aMap[id] || [];
      bs.forEach((t, i) => {
        if (i < as.length) {
          const f = auditRowFields(t, as[i]);
          if (Object.keys(f).length) changes.push({ t: 'edit', m: k, r: auditRowBrief(as[i]), f });
        } else removed.push({ m: k, row: t });
      });
    });
    Object.keys(aMap).forEach(id => {
      const bs = bMap[id] || [], as = aMap[id];
      as.slice(bs.length).forEach(t => added.push({ m: k, row: t }));
    });
  });
  removed.forEach(r => {
    const i = r.row.id ? added.findIndex(a => a.row.id === r.row.id) : -1;
    if (i >= 0) {
      const a = added.splice(i, 1)[0];
      changes.push({ t: 'move', from: r.m, to: a.m, r: auditRowBrief(a.row), f: auditRowFields(r.row, a.row) });
    } else changes.push({ t: 'del', m: r.m, r: auditRowBrief(r.row) });
  });
  added.forEach(a => changes.push({ t: 'add', m: a.m, r: auditRowBrief(a.row) }));

  // Day book, down to the field of one channel on one day.
  const dsKeys = {};
  Object.keys(prev.ds).concat(Object.keys(next.ds)).forEach(k => { dsKeys[k] = 1; });
  Object.keys(dsKeys).sort().forEach(k => {
    if (prev.ds[k] === next.ds[k]) return;
    const b = prev.ds[k] ? JSON.parse(prev.ds[k]) : {}, a = next.ds[k] ? JSON.parse(next.ds[k]) : {};
    const days = {};
    Object.keys(b).concat(Object.keys(a)).forEach(d => { days[d] = 1; });
    Object.keys(days).sort((x, y) => x - y).forEach(d => {
      const bd = b[d] || {}, ad = a[d] || {};
      const chans = {};
      Object.keys(bd).concat(Object.keys(ad)).forEach(c => { chans[c] = 1; });
      Object.keys(chans).forEach(c => {
        const bv = bd[c], av = ad[c];
        if (JSON.stringify(bv) === JSON.stringify(av)) return;
        if ((bv && typeof bv === 'object') || (av && typeof av === 'object')) {
          const f = {};
          const fk = {};
          Object.keys(bv || {}).concat(Object.keys(av || {})).forEach(x => { fk[x] = 1; });
          Object.keys(fk).forEach(x => {
            const o = (bv || {})[x], n = (av || {})[x];
            if (JSON.stringify(o) !== JSON.stringify(n)) f[x] = [o === undefined ? null : o, n === undefined ? null : n];
          });
          changes.push({ t: 'day', m: k, d, c, f });
        } else {
          changes.push({ t: 'day', m: k, d, c: '', f: { [c]: [bv === undefined ? null : bv, av === undefined ? null : av] } });
        }
      });
    });
  });

  // Settings: named, with what they were and are, shortened.
  const setKeys = {};
  Object.keys(prev.set).concat(Object.keys(next.set)).forEach(k => { setKeys[k] = 1; });
  Object.keys(setKeys).sort().forEach(k => {
    if (prev.set[k] === next.set[k]) return;
    changes.push({ t: 'set', k, b: String(prev.set[k] || 'null').slice(0, 300), a: String(next.set[k] || 'null').slice(0, 300) });
  });
  return changes;
}

// ---- recording --------------------------------------------------------------

function auditDevice() {
  let id = '';
  try {
    id = localStorage.getItem('bb_device_id') || '';
    if (!id) { id = Math.random().toString(36).slice(2, 6); localStorage.setItem('bb_device_id', id); }
  } catch (e) { id = '----'; }
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  const os = /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows'
           : /Mac/.test(ua) ? 'Mac' : 'Computer';
  const br = /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox'
           : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return os + ' ' + br + ' · ' + id;
}

function auditRead(key) {
  try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}
function auditWrite(key, list) {
  try { localStorage.setItem(key, JSON.stringify(list)); } catch (e) {}
}

function auditRecord(label, changes) {
  const ev = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: new Date().toISOString(),
               dev: auditDevice(), label: label || '', changes: changes || [] };
  // The copy kept for reading here is capped by size as well as count: browser
  // storage is shared with the book itself, and one large import is a large
  // entry. The queue below is not capped -- nothing unsent may be dropped.
  let recent = auditRead(AUDIT_RECENT_KEY);
  recent.push(ev);
  recent = recent.slice(-AUDIT_RECENT_KEEP);
  while (recent.length > 20 && JSON.stringify(recent).length > 800000) recent.shift();
  auditWrite(AUDIT_RECENT_KEY, recent);
  const q = auditRead(AUDIT_QUEUE_KEY);
  q.push(ev);
  auditWrite(AUDIT_QUEUE_KEY, q);
  auditScheduleFlush();
  return ev;
}

// A labelled moment with no data change of its own: unlocking a year, a
// change the lock refused, a backup restored.
function auditEvent(label) { return auditRecord(label, []); }

// Name the next recorded save, e.g. "Bulk import".
function auditLabel(label) { auditLabelNext = label || ''; }

// Many saves that are one act -- an import saving row after row -- recorded as
// one entry. auditEnd records everything since auditBegin.
function auditBegin(label) { auditHold++; if (label) auditLabelNext = label; }
function auditEnd() { auditHold = Math.max(0, auditHold - 1); if (!auditHold) auditCapture(); }

// Called by saveData after the period lock has had its say.
function auditCapture() {
  if (auditHold || !auditBase || typeof appData === 'undefined' || !appData) return null;
  const next = auditSnapshot(appData);
  const changes = auditDiff(auditBase, next);
  auditBase = next;
  const label = auditLabelNext;
  auditLabelNext = '';
  if (!changes.length) return null;
  return auditRecord(label, changes);
}

// Called by normalizeAppData whenever the whole book is replaced.
function auditOnLoad(d) {
  auditBase = auditSnapshot(d);
  auditLabelNext = '';
  auditHold = 0;
  if (typeof accessToken !== 'undefined' && accessToken) auditScheduleFlush();
}

// ---- sending to the sheet ---------------------------------------------------

function auditSummary(ev) {
  const n = { add: 0, edit: 0, del: 0, move: 0, day: 0, set: 0, more: 0 };
  (ev.changes || []).forEach(c => { n[c.t] = (n[c.t] || 0) + (c.t === 'more' ? c.n : 1); });
  const parts = [];
  if (n.add) parts.push(n.add + ' added');
  if (n.edit) parts.push(n.edit + ' edited');
  if (n.del) parts.push(n.del + ' deleted');
  if (n.move) parts.push(n.move + ' moved');
  if (n.day) parts.push(n.day + ' day-book ' + (n.day === 1 ? 'entry' : 'entries'));
  if (n.set) parts.push(n.set + ' setting' + (n.set === 1 ? '' : 's'));
  if (n.more) parts.push(n.more + ' more');
  return parts.join(', ');
}

function auditSheetRow(ev) {
  let changes = ev.changes || [];
  let json = JSON.stringify(changes);
  if (json.length > AUDIT_CELL_MAX) {
    // Keep what fits and say how much did not; the local copy has it all.
    let keep = changes.length;
    while (keep > 0 && JSON.stringify(changes.slice(0, keep)).length > AUDIT_CELL_MAX - 60) keep = Math.floor(keep * 0.8);
    changes = changes.slice(0, keep).concat([{ t: 'more', n: ev.changes.length - keep }]);
    json = JSON.stringify(changes);
  }
  return [ev.at, ev.dev, ev.label || '', auditSummary(ev), json, ev.id];
}

function auditScheduleFlush() {
  if (typeof setTimeout !== 'function') return;
  clearTimeout(auditFlushTimer);
  auditFlushTimer = setTimeout(() => { auditFlush(); }, 3000);
}

async function auditAppend(rows) {
  const url = `${SHEETS_BASE}/${SHEET_ID}/values/${encodeURIComponent(AUDIT_TAB + '!A:F')}:append` +
              `?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  return fetchRetry(url, { method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: rows }) });
}

async function auditCreateTab() {
  const res = await fetchRetry(`${SHEETS_BASE}/${SHEET_ID}:batchUpdate`, { method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: AUDIT_TAB } } }] }) });
  // Already there (another computer made it a moment ago) is fine.
  if (!res.ok && res.status !== 400) throw new Error(res.status + ' creating the AuditLog tab');
  await auditAppend([['When (UTC)', 'Computer', 'What', 'Summary', 'Changes (JSON)', 'Entry id']]);
}

// Sends everything waiting. Only what was sent leaves the queue, so an entry
// recorded while a send is in flight waits for the next one.
async function auditFlush() {
  if (auditFlushing || typeof accessToken === 'undefined' || !accessToken) return false;
  const q = auditRead(AUDIT_QUEUE_KEY);
  if (!q.length) return true;
  auditFlushing = true;
  try {
    const rows = q.map(auditSheetRow);
    let res = await auditAppend(rows);
    if (res.status === 400) {
      const body = await res.text();
      if (/parse range/i.test(body)) { await auditCreateTab(); res = await auditAppend(rows); }
    }
    if (res.status === 401) { if (typeof handleAuthExpiry === 'function') handleAuthExpiry(); return false; }
    if (!res.ok) throw new Error(res.status + ' sending the audit trail');
    const sent = {};
    q.forEach(e => { sent[e.id] = 1; });
    auditWrite(AUDIT_QUEUE_KEY, auditRead(AUDIT_QUEUE_KEY).filter(e => !sent[e.id]));
    if (auditSheetEvents) auditSheetEvents = auditSheetEvents.concat(q);
    return true;
  } catch (e) {
    console.warn('Audit trail not sent yet; it will be retried:', e);
    return false;
  } finally {
    auditFlushing = false;
  }
}

async function auditLoadFromSheet() {
  if (typeof accessToken === 'undefined' || !accessToken) { notify('Sign in to load the full history', true); return; }
  try {
    const url = `${SHEETS_BASE}/${SHEET_ID}/values/${encodeURIComponent(AUDIT_TAB + '!A2:F')}`;
    const res = await fetchRetry(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
    if (res.status === 400) { auditSheetEvents = []; renderAuditPanel(); return; }   // no tab yet: nothing sent so far
    if (!res.ok) throw new Error(res.status);
    const values = (await res.json()).values || [];
    auditSheetEvents = values.map(r => {
      let changes = [];
      try { changes = JSON.parse(r[4] || '[]'); } catch (e) {}
      return { at: r[0], dev: r[1], label: r[2] || '', changes, id: r[5] || (r[0] + r[1]) };
    });
    renderAuditPanel();
  } catch (e) {
    notify('Could not load the audit trail from the sheet: ' + (e.message || e), true);
  }
}

// ---- reading it -------------------------------------------------------------

function auditMonthLabel(key) {
  const [y, m] = String(key).split('-');
  return (MONTHS_SHORT[+m] || '?') + ' ' + y;
}
function auditMoney(v) { return (typeof v === 'number') ? fmt(v) : escHtml(String(v == null ? '—' : v)); }
function auditValue(field, v) {
  if (field === 'amount' || field === 's' || field === 'x' || field === 't' || field === '_tips') return auditMoney(v);
  return escHtml(v == null || v === '' ? '—' : String(v));
}
function auditFieldList(f) {
  return Object.keys(f || {}).map(k =>
    `${escHtml(AUDIT_DAY_FIELDS[k] || k)} ${auditValue(k, f[k][0])} → ${auditValue(k, f[k][1])}`).join('; ');
}
function auditRowText(r) {
  return `${escHtml(r.date)} · ${escHtml(r.category)} · ${r.type === 'in' ? 'in' : 'out'} ${auditMoney(r.amount)} · ${escHtml(r.desc)}`;
}
function auditChannelName(c) {
  if (!c) return '';
  try {
    const ch = (typeof dsChannels === 'function' ? dsChannels() : []).find(x => x.id === c);
    return ch ? ch.label : c;
  } catch (e) { return c; }
}

function auditChangeHtml(c) {
  switch (c.t) {
    case 'add':  return `<strong>Added</strong> · ${auditRowText(c.r)}`;
    case 'del':  return `<strong>Deleted</strong> · ${auditRowText(c.r)}`;
    case 'edit': return `<strong>Edited</strong> · ${auditRowText(c.r)} — ${auditFieldList(c.f)}`;
    case 'move': return `<strong>Moved</strong> ${escHtml(auditMonthLabel(c.from))} → ${escHtml(auditMonthLabel(c.to))} · ${auditRowText(c.r)}` +
                        (Object.keys(c.f || {}).length ? ` — ${auditFieldList(c.f)}` : '');
    case 'day': {
      const [y, m] = String(c.m).split('-');
      const date = `${y}-${String(+m + 1).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`;
      return `<strong>Day book</strong> ${escHtml(date)}${c.c ? ' · ' + escHtml(auditChannelName(c.c)) : ''} — ${auditFieldList(c.f)}`;
    }
    case 'set':  return `<strong>${escHtml(AUDIT_SETTING_NAMES[c.k] || c.k)}</strong> changed` +
                        `<div style="font-size:0.68rem;color:var(--mist);word-break:break-all">was ${escHtml(c.b)}<br>now ${escHtml(c.a)}</div>`;
    case 'more': return `…and ${Number(c.n) || 0} more change${c.n === 1 ? '' : 's'} (kept in full on the computer that made them)`;
    default:     return escHtml(JSON.stringify(c));
  }
}

let auditFilter = '';
function auditSetFilter(v) { auditFilter = String(v || ''); renderAuditPanel(); }

function renderAuditPanel() {
  const el = document.getElementById('audit-content');
  if (!el) return;
  const byId = {};
  (auditSheetEvents || []).concat(auditRead(AUDIT_RECENT_KEY)).forEach(e => { if (e && e.id) byId[e.id] = e; });
  let events = Object.values(byId).sort((a, b) => (a.at < b.at ? 1 : -1));
  const waiting = auditRead(AUDIT_QUEUE_KEY).length;
  const q = auditFilter.trim().toLowerCase();
  const shown = q ? events.filter(e => (e.label + ' ' + e.dev + ' ' + JSON.stringify(e.changes)).toLowerCase().includes(q)) : events;
  const when = iso => { const d = new Date(iso); return isNaN(d) ? escHtml(iso) : d.toLocaleString(); };

  el.innerHTML = `
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
      <input type="text" placeholder="Search: a date, a supplier, an amount, a category…" value="${escHtml(auditFilter)}"
        oninput="auditSetFilter(this.value)" style="flex:1;min-width:220px;font-size:0.8rem;padding:6px 10px;
        border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--ink)">
      <button class="btn btn-outline btn-sm" onclick="auditLoadFromSheet()">
        ${auditSheetEvents ? 'Reload full history' : 'Load full history from the sheet'}</button>
    </div>
    <div style="font-size:0.72rem;color:var(--mist);margin-bottom:10px">
      ${auditSheetEvents ? `${events.length} entries, from the sheet and this computer.`
                         : `The last ${events.length} entr${events.length === 1 ? 'y' : 'ies'} made on this computer.`}
      ${waiting ? ` <span style="color:var(--gold, #c9a84c)">${waiting} waiting to be sent to the sheet.</span>` : ''}
    </div>
    ${shown.length ? shown.slice(0, 300).map(e => `
      <details class="ledger-wrap" style="margin-bottom:8px;padding:8px 14px">
        <summary style="cursor:pointer;font-size:0.8rem">
          <strong>${when(e.at)}</strong>
          <span style="color:var(--mist)"> · ${escHtml(e.dev)}</span>
          · ${escHtml(e.label || auditSummary(e) || 'Change')}
          ${e.label && e.changes.length ? `<span style="color:var(--mist)"> — ${escHtml(auditSummary(e))}</span>` : ''}
        </summary>
        ${e.changes.length ? `<div style="font-size:0.76rem;margin:8px 0 2px;line-height:1.6">${
          e.changes.slice(0, 200).map(c => `<div>${auditChangeHtml(c)}</div>`).join('')}${
          e.changes.length > 200 ? `<div style="color:var(--mist)">…and ${e.changes.length - 200} more</div>` : ''}</div>` : ''}
      </details>`).join('')
      : `<div class="empty-state"><div class="empty-icon">📜</div>${q ? 'Nothing matches that search.' : 'No changes recorded yet. Every save from now on is.'}</div>`}`;
}
