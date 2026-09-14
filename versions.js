// ============================================================
// SAVED VERSIONS, AND TWO COMPUTERS SAVING OVER EACH OTHER
// ============================================================
// The sheet holds one copy of the book, and every save replaces it whole. So a
// bad save -- the wrong backup restored, an import gone wrong -- or a second
// computer saving over the first left nothing to go back to. The audit trail
// says what changed, but it cannot put a whole book back.
//
// Two defences.
//
// Saved versions. Before a save replaces the sheet's copy, that copy is kept as
// a hidden tab in the same spreadsheet: automatically once an hour at most,
// and always before a restore or when two computers' changes collide. Google
// copies the tab itself (duplicateSheet), so the automatic ones upload nothing.
// Each tab carries a small label (developer metadata) saying when, where and
// why it was kept; only tabs with that label are ever listed or deleted, so a
// tab someone makes by hand is never touched. The newest VERSION_KEEP are kept.
//
// The two-computer check, in pushToSheet: a save first confirms the sheet
// still holds the copy this page is built on. If another computer has saved
// since, nothing is written. The owner sees what differs and chooses which
// version the sheet keeps, and the other one is kept as a saved version first,
// so either choice can be undone.

const VERSION_PREFIX = 'Version ';
const VERSION_KEEP = 20;
const VERSION_EVERY_MS = 60 * 60 * 1000;
const VERSION_META_KEY = 'bloombooksVersion';

let versionNextReason = '';    // keep a version before the next write, however recent the last
let versionCheckedAt = 0;      // when this page last looked at whether a version was due
let versionList = null;        // newest first, for the panel
let versionListError = '';
let versionLoading = false;
let versionBusy = '';          // what is under way, so a button cannot be pressed twice

// ---- talking to the spreadsheet ---------------------------------------------

function versionHeaders(json) {
  const h = { 'Authorization': `Bearer ${accessToken}` };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

async function versionBatch(requests) {
  const res = await fetchRetry(`${SHEETS_BASE}/${SHEET_ID}:batchUpdate`, {
    method: 'POST', headers: versionHeaders(true), body: JSON.stringify({ requests }) });
  if (res.status === 401) { handleAuthExpiry(); throw new Error('signed out'); }
  if (!res.ok) throw new Error(res.status + ' ' + (await res.text()).slice(0, 200));
  return res.json();
}

function versionTime(v) {
  const t = Date.parse(((v && v.info) || {}).at || '');
  return isNaN(t) ? 0 : t;
}

// Every tab in the spreadsheet, and the saved versions among them, newest first.
async function versionTabs() {
  const fields = 'sheets(properties(sheetId,title,index,hidden),developerMetadata(metadataKey,metadataValue))';
  const res = await fetchRetry(`${SHEETS_BASE}/${SHEET_ID}?fields=${encodeURIComponent(fields)}`,
                               { headers: versionHeaders(false) });
  if (res.status === 401) { handleAuthExpiry(); throw new Error('signed out'); }
  if (!res.ok) throw new Error(res.status + ' ' + (await res.text()).slice(0, 200));
  const sheets = (await res.json()).sheets || [];
  const versions = [];
  sheets.forEach(s => {
    const p = s.properties || {};
    if (String(p.title || '').indexOf(VERSION_PREFIX) !== 0) return;
    const label = (s.developerMetadata || []).find(m => m.metadataKey === VERSION_META_KEY);
    if (!label) return;
    let info = {};
    try { info = JSON.parse(label.metadataValue || '{}') || {}; } catch (e) {}
    versions.push({ sheetId: p.sheetId, title: p.title, info });
  });
  versions.sort((a, b) => versionTime(b) - versionTime(a));
  return { sheets: sheets.map(s => s.properties || {}), versions };
}

function versionTitle(sheets) {
  const taken = {};
  sheets.forEach(s => { taken[s.title] = 1; });
  const d = new Date(Date.now());
  const p = n => String(n).padStart(2, '0');
  // Dots, not colons, in the time: a tab name that has to be quoted in every
  // range should at least not carry a character with a meaning of its own there.
  const base = `${VERSION_PREFIX}${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
               `${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`;
  let title = base, n = 2;
  while (taken[title]) title = `${base} (${n++})`;
  return title;
}

// Chosen here rather than by Google, so the tab can be hidden and labelled in
// the same request that makes it.
function versionNewId(sheets) {
  const used = {};
  sheets.forEach(s => { used[s.sheetId] = 1; });
  let id;
  do { id = 100000000 + Math.floor(Math.random() * 1900000000); } while (used[id]);
  return id;
}

function versionLabelRequest(sheetId, info) {
  return { createDeveloperMetadata: { developerMetadata: {
    metadataKey: VERSION_META_KEY, metadataValue: JSON.stringify(info),
    location: { sheetId }, visibility: 'DOCUMENT' } } };
}

// `source` is the copy being kept: the metadata of the sheet's copy, or a book.
function versionInfo(reason, source) {
  return { at: new Date(Date.now()).toISOString(), dev: auditDevice(), reason: String(reason || '').slice(0, 160),
           savedAt: (source && source._savedAt) || null, savedBy: (source && source._savedBy) || '' };
}

// Keeps the sheet's current copy. Google copies the tab; nothing is uploaded.
async function versionFromSheet(reason, meta, tabs) {
  tabs = tabs || await versionTabs();
  const src = tabs.sheets.find(s => s.title === SHEET_TAB);
  if (!src) throw new Error(`the ${SHEET_TAB} tab was not found`);
  const id = versionNewId(tabs.sheets), title = versionTitle(tabs.sheets);
  const info = versionInfo(reason, meta);
  await versionBatch([
    { duplicateSheet: { sourceSheetId: src.sheetId, insertSheetIndex: tabs.sheets.length, newSheetId: id, newSheetName: title } },
    { updateSheetProperties: { properties: { sheetId: id, hidden: true }, fields: 'hidden' } },
    versionLabelRequest(id, info)
  ]);
  const made = { sheetId: id, title, info };
  await versionPrune(tabs.versions.concat([made]));
  return made;
}

// Keeps a book this page holds -- this computer's copy, which the sheet has
// never seen. Uploaded, so used only when that is the point.
async function versionFromBook(reason, book, tabs) {
  tabs = tabs || await versionTabs();
  const values = sheetBookValues(book);
  const id = versionNewId(tabs.sheets), title = versionTitle(tabs.sheets);
  const info = versionInfo(reason, { _savedAt: book._savedAt, _savedBy: auditDevice() });
  await versionBatch([
    { addSheet: { properties: { sheetId: id, title, index: tabs.sheets.length, hidden: true,
                                gridProperties: { rowCount: values.length + 10, columnCount: 3 } } } },
    versionLabelRequest(id, info)
  ]);
  const res = await fetchRetry(
    `${SHEETS_BASE}/${SHEET_ID}/values/${encodeURIComponent(sheetRange(title, 'A1'))}?valueInputOption=RAW`,
    { method: 'PUT', headers: versionHeaders(true), body: JSON.stringify({ values }) });
  if (!res.ok) {
    // A labelled tab with no book in it would look restorable. Take it away.
    const why = res.status + ' ' + (await res.text()).slice(0, 200);
    try { await versionBatch([{ deleteSheet: { sheetId: id } }]); } catch (e) {}
    throw new Error(why);
  }
  const made = { sheetId: id, title, info };
  await versionPrune(tabs.versions.concat([made]));
  return made;
}

// Only ever deletes labelled version tabs, and only past the newest VERSION_KEEP.
async function versionPrune(versions) {
  const extra = versions.slice().sort((a, b) => versionTime(b) - versionTime(a)).slice(VERSION_KEEP);
  if (!extra.length) return;
  try { await versionBatch(extra.map(v => ({ deleteSheet: { sheetId: v.sheetId } }))); }
  catch (e) { console.warn('Older saved versions not removed yet:', e); }
}

// ---- when a version is kept -------------------------------------------------

// The next write keeps a version first whatever the hour: a backup restored,
// or changes sent that had waited in this browser.
function versionsKeepBeforeNextWrite(reason) { versionNextReason = reason || 'Kept before a save'; }

// Called by pushToSheet with the metadata of the copy it is about to replace.
// It never stops the save. A version is a second line of defence, and a save
// held up because Google would not copy a tab is a save that did not happen.
async function versionBeforeWrite(meta) {
  const reason = versionNextReason;
  const now = Date.now();
  if (!reason && versionCheckedAt && now - versionCheckedAt < VERSION_EVERY_MS) return;
  try {
    const tabs = await versionTabs();
    const newest = tabs.versions[0];
    if (!reason && newest) {
      // Due an hour after the newest version, whichever computer kept it --
      // otherwise every reload of the page would keep one, and twenty reloads
      // would push out the week's worth that matter.
      if (now - versionTime(newest) < VERSION_EVERY_MS) { versionCheckedAt = Math.min(now, versionTime(newest)); return; }
      // Or not at all, if the sheet has not changed since it was kept.
      if (newest.info.savedAt && newest.info.savedAt === meta._savedAt) { versionCheckedAt = now; return; }
    }
    await versionFromSheet(reason || 'Kept automatically before a save', meta, tabs);
    versionList = null;
  } catch (e) {
    console.warn('No version kept before this save; saving anyway:', e);
  }
  // Tried once either way. The write it was asked for is about to happen, and
  // a failing copy retried on every save would only double the requests.
  versionNextReason = '';
  versionCheckedAt = now;
}

// ---- two computers ----------------------------------------------------------

// A book as the sheet would hold it, so that the two sides of a comparison are
// alike: the sheet shortens descriptions and drops the running balance, and a
// row in this browser that has not been through it still has both.
function versionsSheetForm(book) {
  return sheetBookFromRows(sheetBookValues(book));
}

// What would change in `from` to make it `to`, in the audit trail's terms.
function versionsCompare(from, to) {
  return auditDiff(auditSnapshot(versionsSheetForm(from)), auditSnapshot(versionsSheetForm(to)));
}

// Called when a save finds the sheet saved elsewhere since this page read it.
// `theirs` is the other computer's whole book when already in hand.
function versionsOnConflict(meta, theirs) {
  const first = !syncConflict;
  syncConflict = { at: meta._savedAt || 0, by: meta._savedBy || 'Another computer',
                   diff: syncConflict ? syncConflict.diff : null, loading: false, error: '' };
  if (first) {
    auditEvent(`Held back a save: ${syncConflict.by} saved the book at ${versionsWhen(syncConflict.at)}, ` +
               `after this computer had opened it`);
    versionsCompareNow(theirs);
  }
  setSyncStatus('error', 'Not sent to the sheet — changed on another computer');
  versionsRenderConflict();
}

async function versionsCompareNow(theirs) {
  const c = syncConflict;
  if (!c) return;
  c.loading = true; c.error = '';
  versionsRenderConflict();
  try {
    if (!theirs) {
      const got = await sheetReadBook(SHEET_TAB);
      if (got.status !== 'ok') throw new Error(got.status === 'auth' ? 'signed out' : 'the sheet is empty');
      theirs = got.book;
    }
    if (syncConflict === c) c.diff = versionsCompare(theirs, appData);
  } catch (e) {
    c.error = (e && e.message) || String(e);
  }
  c.loading = false;
  versionsRenderConflict();
}

// Use the other computer's version: this computer's is kept first.
async function versionsUseTheirs() {
  const c = syncConflict;
  if (!c || versionBusy) return;
  versionBusy = 'theirs'; versionsRenderConflict();
  try {
    try {
      await versionFromBook(`This computer's version, set aside when ${c.by}'s was chosen`, appData);
    } catch (e) {
      notify(`This computer's version could not be set aside, so nothing was changed: ${(e && e.message) || e}`, true);
      return;
    }
    if (!await loadFromSheet({ preferSheet: true })) {
      notify("The other computer's version could not be loaded. This computer's is still on screen.", true);
      return;
    }
    syncConflict = null;
    auditEvent(`Chose the version ${c.by} saved at ${versionsWhen(c.at)}; this computer's was kept under Saved Versions`);
    finalizeInit();
    notify("Now showing the other computer's version. This computer's is under Saved Versions.");
  } finally {
    versionBusy = '';
    versionList = null;
    versionsRenderConflict();
  }
}

// Keep this computer's version: the other computer's is kept first.
async function versionsKeepMine() {
  const c = syncConflict;
  if (!c || versionBusy) return;
  versionBusy = 'mine'; versionsRenderConflict();
  try {
    let meta;
    try {
      const remote = await sheetReadMeta(SHEET_TAB);
      if (remote.status !== 'ok') throw new Error(remote.status === 'auth' ? 'signed out' : 'the sheet is empty');
      meta = remote.meta;
      await versionFromSheet(`${meta._savedBy || 'The other computer'}'s version, set aside when this computer's was kept`, meta);
    } catch (e) {
      notify(`The other computer's version could not be set aside, so nothing was overwritten: ${(e && e.message) || e}`, true);
      return;
    }
    // The copy just set aside is the one this save may replace. If the other
    // computer saves again in the meantime, the check stops this one again.
    sheetKnownSavedAt = meta._savedAt || 0;
    syncConflict = null;
    auditEvent(`Kept this computer's version over the one ${c.by} saved at ${versionsWhen(c.at)}; ` +
               `theirs was kept under Saved Versions`);
    saveData();
    notify("Keeping this computer's version. The other one is under Saved Versions.");
  } finally {
    versionBusy = '';
    versionList = null;
    versionsRenderConflict();
  }
}

function versionsWhen(ts) {
  const d = new Date(typeof ts === 'string' ? Date.parse(ts) : ts);
  return isNaN(d) || !+d ? 'an unknown time' : d.toLocaleString();
}

function versionsConflictLine(c) {
  switch (c.t) {
    case 'add':  return `<strong>Only on this computer</strong> · ${auditRowText(c.r)}`;
    case 'del':  return `<strong>Only in the other version</strong> · ${auditRowText(c.r)}`;
    case 'edit': return `<strong>Different</strong> · ${auditRowText(c.r)} — ${auditFieldList(c.f)}`;
    case 'move': return `<strong>Filed in different months</strong> · ${escHtml(auditMonthLabel(c.from))} there, ` +
                        `${escHtml(auditMonthLabel(c.to))} here · ${auditRowText(c.r)}`;
    case 'day': {
      const [y, m] = String(c.m).split('-');
      const date = `${y}-${String(+m + 1).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`;
      return `<strong>Day book</strong> ${escHtml(date)}${c.c ? ' · ' + escHtml(auditChannelName(c.c)) : ''} — ${auditFieldList(c.f)}`;
    }
    case 'set':  return `<strong>${escHtml(AUDIT_SETTING_NAMES[c.k] || c.k)}</strong> differ${/s$/.test(AUDIT_SETTING_NAMES[c.k] || '') ? '' : 's'}`;
    default:     return escHtml(JSON.stringify(c));
  }
}

function versionsDiffSummary(diff) {
  const n = { here: 0, there: 0, differ: 0 };
  diff.forEach(c => { if (c.t === 'add') n.here++; else if (c.t === 'del') n.there++; else n.differ++; });
  const parts = [];
  if (n.here) parts.push(`${n.here} only on this computer`);
  if (n.there) parts.push(`${n.there} only in the other version`);
  if (n.differ) parts.push(`${n.differ} different in each`);
  return parts.join(', ');
}

function versionsRenderConflict() {
  const el = document.getElementById('sync-conflict');
  if (!el) return;
  const c = syncConflict;
  if (!c) { el.style.display = 'none'; el.innerHTML = ''; return; }
  el.style.display = 'block';
  const busy = !!versionBusy;
  let compare;
  if (c.loading) compare = `<div style="color:var(--mist)">Comparing the two versions…</div>`;
  else if (c.error) compare = `<div style="color:var(--mist)">Could not compare them (${escHtml(c.error)}).
      <button class="btn btn-outline btn-xs" onclick="versionsCompareNow()">Try again</button></div>`;
  else if (c.diff && !c.diff.length) compare = `<div>The two versions hold the same figures, so either choice loses nothing.</div>`;
  else if (c.diff) compare = `
    <details style="margin-top:2px">
      <summary style="cursor:pointer"><strong>What's different:</strong> ${escHtml(versionsDiffSummary(c.diff))}</summary>
      <div style="font-size:0.74rem;color:var(--mist);margin:6px 0 4px">Where a figure differs, it reads: the other version → this computer's.</div>
      <div style="font-size:0.76rem;line-height:1.6;max-height:320px;overflow:auto">
        ${c.diff.slice(0, 200).map(x => `<div>${versionsConflictLine(x)}</div>`).join('')}
        ${c.diff.length > 200 ? `<div style="color:var(--mist)">…and ${c.diff.length - 200} more</div>` : ''}
      </div>
      <button class="btn btn-outline btn-xs" style="margin-top:6px" onclick="versionsCompareNow()">Compare again</button>
    </details>`;
  else compare = '';

  el.innerHTML = `
    <div style="margin:0 0 16px;padding:12px 16px;border-radius:8px;background:var(--red-light);
                border:1px solid var(--red);font-size:0.82rem;line-height:1.5">
      <div style="font-weight:600;margin-bottom:4px">⚠️ The book was changed on another computer</div>
      <div>${escHtml(c.by)} saved it at ${escHtml(versionsWhen(c.at))}, after this computer opened it. So that neither
        computer's work is lost, this one has stopped sending its changes to the sheet. Anything you change here is
        still kept on this computer.</div>
      <div style="margin:8px 0">${compare}</div>
      <div style="margin-bottom:8px">Which version should the sheet keep? The other one is kept under
        <a href="#" onclick="switchPanel('versions');return false">Saved Versions</a> first, so either choice can be undone.</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-outline btn-sm" ${busy ? 'disabled' : ''} onclick="versionsUseTheirs()">
          ${versionBusy === 'theirs' ? 'Switching…' : "Use the other computer's version"}</button>
        <button class="btn btn-primary btn-sm" ${busy ? 'disabled' : ''} onclick="versionsKeepMine()">
          ${versionBusy === 'mine' ? 'Saving…' : "Keep this computer's version"}</button>
      </div>
    </div>`;
}

// ---- the Saved Versions screen ------------------------------------------------

function versionsOpen() {
  renderVersionsPanel();
  if (!versionList && !versionLoading) versionsLoad();
}

async function versionsLoad() {
  if (!accessToken) { renderVersionsPanel(); return; }
  versionLoading = true; renderVersionsPanel();
  try {
    versionList = (await versionTabs()).versions;
    versionListError = '';
  } catch (e) {
    versionListError = (e && e.message) || String(e);
  }
  versionLoading = false;
  renderVersionsPanel();
}

async function versionSaveNow() {
  if (!accessToken) { notify('Sign in to keep a version in the sheet', true); return; }
  if (versionBusy) return;
  versionBusy = 'save'; renderVersionsPanel();
  try {
    await versionFromBook('Kept by hand', appData);
    notify('Version kept');
  } catch (e) {
    notify('Could not keep a version: ' + ((e && e.message) || e), true);
  } finally {
    versionBusy = '';
    await versionsLoad();
  }
}

async function versionRestore(sheetId) {
  if (!accessToken) { notify('Sign in to restore a version', true); return; }
  if (syncConflict) { notify("Choose which computer's version to keep first", true); return; }
  if (versionBusy) return;
  const v = (versionList || []).find(x => x.sheetId === sheetId);
  if (!v) return;
  versionBusy = 'restore:' + sheetId; renderVersionsPanel();
  try {
    const got = await sheetReadBook(v.title);
    if (got.status !== 'ok') throw new Error(got.status === 'auth' ? 'signed out' : 'that version is empty');
    const book = got.book;
    const changes = versionsCompare(appData, book);
    const rows = Object.keys(book.transactions || {}).reduce((s, k) => s + (book.transactions[k] || []).length, 0);
    const when = versionsWhen(v.info.at);
    if (!changes.length) { notify('That version is the same as the book as it stands. Nothing to restore.'); return; }
    if (!confirm(`Restore the book as it was kept ${when}?\n\n` +
                 `It holds ${rows} ledger rows. Restoring it: ${auditSummary({ changes })}.\n\n` +
                 `The book as it stands now is kept as a saved version first, so this can be undone.`)) return;
    try {
      await versionFromBook(`Kept before restoring the version from ${when}`, appData);
    } catch (e) {
      notify('The book as it stands could not be kept first, so nothing was restored: ' + ((e && e.message) || e), true);
      return;
    }
    // A deliberate replacement of the whole book, like a backup file: the
    // closed years take the version's figures, and the audit trail records
    // exactly what the restore changed.
    appData = normalizeAppData(book);
    ensureVaultData();
    auditRecord(`Restored the version kept ${when} on ${v.info.dev || 'another computer'}`, changes);
    saveData();
    finalizeInit();
    switchPanel('versions');
    notify('Restored. The book as it was a moment ago is kept at the top of the list.');
  } catch (e) {
    notify('Nothing was restored: ' + ((e && e.message) || e), true);
  } finally {
    versionBusy = '';
    versionList = null;
    versionsLoad();
  }
}

function renderVersionsPanel() {
  const el = document.getElementById('versions-content');
  if (!el) return;
  if (!accessToken) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">🕘</div>Sign in to see the versions kept in the sheet.</div>`;
    return;
  }
  const busy = !!versionBusy;
  const list = versionList || [];
  const rows = list.map(v => {
    const i = v.info || {};
    const restoring = versionBusy === 'restore:' + v.sheetId;
    return `
      <div class="ledger-wrap" style="margin-bottom:8px;padding:10px 14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <div style="flex:1;min-width:220px;font-size:0.8rem;line-height:1.5">
          <strong>${escHtml(versionsWhen(i.at))}</strong>
          <span style="color:var(--mist)"> · ${escHtml(i.dev || '')}</span>
          <div>${escHtml(i.reason || '')}</div>
          ${i.savedAt ? `<div style="font-size:0.72rem;color:var(--mist)">The book in it was last saved
            ${escHtml(versionsWhen(i.savedAt))}${i.savedBy ? ' on ' + escHtml(i.savedBy) : ''}</div>` : ''}
        </div>
        <button class="btn btn-outline btn-sm" ${busy ? 'disabled' : ''} onclick="versionRestore(${+v.sheetId})">
          ${restoring ? 'Restoring…' : 'Restore'}</button>
      </div>`;
  }).join('');

  el.innerHTML = `
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
      <button class="btn btn-primary btn-sm" ${busy ? 'disabled' : ''} onclick="versionSaveNow()">
        ${versionBusy === 'save' ? 'Keeping a version…' : 'Keep a version now'}</button>
      <button class="btn btn-outline btn-sm" ${versionLoading ? 'disabled' : ''} onclick="versionsLoad()">Refresh</button>
    </div>
    <div style="font-size:0.72rem;color:var(--mist);margin-bottom:12px;line-height:1.5">
      A version is kept automatically before a save once an hour at most, and always before a restore or when two
      computers' changes collide. The newest ${VERSION_KEEP} are kept. Restoring puts back the ledger, the day book
      and the settings; the cost tracker's invoices are not part of it.
    </div>
    ${versionListError ? `<div style="color:var(--red);font-size:0.8rem;margin-bottom:10px">Could not list the versions: ${escHtml(versionListError)}</div>` : ''}
    ${versionLoading && !versionList ? `<div style="color:var(--mist);font-size:0.8rem">Loading…</div>`
      : list.length ? rows
      : `<div class="empty-state"><div class="empty-icon">🕘</div>No versions kept yet. The first is kept before the next save.</div>`}`;
}
