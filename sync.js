// ============================================================
// GOOGLE SHEETS SYNC (OAuth2)
// ============================================================
const OAUTH_CLIENT_ID = '108752503349-c9ilafi09qqoa2kqei3v6su8641v86ha.apps.googleusercontent.com';
const SHEET_ID        = '1YHVYcWXb_YD6MzX2mc5y78Zo0xAgUT11EObbgGzr9hU';
const SHEET_TAB       = 'BloomData';
const SHEETS_BASE     = 'https://sheets.googleapis.com/v4/spreadsheets';
const SCOPES          = 'https://www.googleapis.com/auth/spreadsheets';

let accessToken = null;
let tokenClient = null;
let gapiReady   = false;
let gisReady    = false;

// ---- which copy of the sheet this page is built on (see versions.js) -------
// The _savedAt the sheet's copy carried when this page last read or wrote it:
// undefined until it has been read, null if the sheet was empty. Every save
// first checks the sheet still carries it. Anything else means another
// computer has saved since, and writing now would throw that work away.
let sheetKnownSavedAt = undefined;
// Set when that check fails. Saves carry on into this browser, but nothing goes
// to the sheet until the owner has chosen which version to keep.
let syncConflict = null;
// Tells this page's own writes from another computer's -- including a write
// that reached Google but whose reply never came back.
const SYNC_SESSION = Math.random().toString(36).slice(2, 10);
// The same fact for the book kept in this browser, which outlives the page:
// the sheet copy that book was built on. When the page next loads it answers
// two questions the clock cannot -- does this browser hold changes that never
// reached the sheet, and has the sheet been saved from elsewhere since? -- and
// so tells "send them" apart from "ask first".
//
// The record names the book it belongs to (by its _savedAt), so it cannot be
// believed about a different one: a book whose write failed, or one another
// tab wrote over. Then the load compares times, as it always did.
const SHEET_BASE_KEY = 'bb_sheet_base';
let localBookWrittenAt = null;   // _savedAt of the book this page last wrote here; null if that write failed
let localSheetBase = null;       // the record, for a page running on this browser's book because the sheet could not be read

function sheetStoredBase(bookSavedAt) {
  try {
    const rec = JSON.parse(localStorage.getItem(SHEET_BASE_KEY) || 'null');
    return rec && typeof rec.base === 'number' && rec.book === bookSavedAt ? rec.base : null;
  } catch (e) { return null; }
}
function sheetRecordBase(base, bookSavedAt) {
  try {
    if (typeof base === 'number') localStorage.setItem(SHEET_BASE_KEY, JSON.stringify({ base, book: bookSavedAt }));
    else localStorage.removeItem(SHEET_BASE_KEY);
  } catch (e) {}
}
function writeLocalBook() {
  try {
    localStorage.setItem('bloombooks_v2', JSON.stringify(appData));
  } catch (e) {
    // The book already there is untouched, and so is the record naming it.
    localBookWrittenAt = null;
    return false;
  }
  localBookWrittenAt = appData._savedAt || 0;
  sheetRecordBase(typeof sheetKnownSavedAt === 'number' ? sheetKnownSavedAt
                  : sheetKnownSavedAt === null ? null : localSheetBase, localBookWrittenAt);
  return true;
}
// Has the sheet been saved by anyone else since `base`? Compared for equality,
// not "newer": two computers' clocks disagree, and a copy stamped a minute
// earlier by a slow clock is still somebody else's work.
function sheetChangedSince(meta, base) {
  if (!meta) return false;
  if ((meta._savedAt || 0) === (base || 0)) return false;
  return meta._savedSession !== SYNC_SESSION;
}

function setSyncStatus(s, msg) {
  const el = document.getElementById('sync-status');
  const btn = document.getElementById('signin-btn');
  if (!el) return;
  const icons = { idle:'☁️', saving:'⏳', loading:'⏳', error:'⚠️', saved:'✓', login:'🔑' };
  el.textContent = (icons[s] || '☁️') + ' ' + (msg || s);
  el.style.color = s === 'error' ? 'var(--red)' : s === 'saved' ? 'var(--green)' : 'var(--blue-light)';
  if (btn) btn.style.display = s === 'login' ? 'inline-block' : 'none';
}

function gapiLoaded() {
  gapiReady = true;
  maybeInit();
}

function gisLoaded() {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: OAUTH_CLIENT_ID,
    scope: SCOPES,
    callback: async (resp) => {
      if (resp.error) { signInFailed(resp.error_description || resp.error); return; }
      accessToken = resp.access_token;
      await loadFromSheet();
      finalizeInit();
    },
    // Without this, the failures that aren't OAuth errors -- the pop-up being
    // blocked, or the user dismissing it -- fire into nothing: the callback
    // above never runs and the status line sits there mid-sign-in forever.
    // Pop-ups are blocked far more readily on a phone than on a desktop,
    // which is a large part of why this only ever bit on mobile.
    error_callback: (err) => {
      const type = err && err.type;
      if (type === 'popup_closed') return signInFailed('Sign-in window closed');
      if (type === 'popup_failed_to_open') return signInFailed('Pop-up blocked — allow pop-ups for this site');
      return signInFailed((err && err.message) || 'Sign-in failed');
    }
  });
  gisReady = true;
  maybeInit();
}

// Reports a failure as 'login' rather than 'error' so the button survives.
// setSyncStatus() hides it for every status except 'login', so the old
// setSyncStatus('error', ...) removed the only way to try again short of
// reloading the page -- one failed tap and the button was simply gone.
function signInFailed(msg) {
  accessToken = null;
  setSyncStatus('login', msg + ' — tap to retry');
}

function maybeInit() {
  if (!gapiReady || !gisReady) return;
  // Check if we already have a token cached
  const cached = sessionStorage.getItem('bb_token');
  if (cached) {
    accessToken = cached;
    loadFromSheet().then(finalizeInit);
  } else {
    setSyncStatus('login', 'Sign in to sync →');
  }
}

function signIn() {
  if (!tokenClient) return;
  // Interactive on purpose. The old prompt:'' asked Google to authorise with
  // no UI at all, which only succeeds where there is already a signed-in
  // Google session that has previously granted this app access -- true of the
  // desktop this was built on, false of a phone opening it for the first
  // time. The comment here used to claim it fell back to a consent prompt; it
  // never did, so on mobile there was no path to signing in at all. A press
  // of a button labelled "Sign in" is exactly when the account chooser
  // belongs on screen.
  setSyncStatus('loading', 'Signing in…');
  tokenClient.requestAccessToken({ prompt: 'select_account' });
}

function parseAppData(raw) {
  const parsed = JSON.parse(raw);
  if (parsed.transactions) {
    Object.keys(parsed.transactions).forEach(k => {
      parsed.transactions[k] = parsed.transactions[k].filter(t => !t._vault);
    });
  }
  return normalizeAppData(parsed);
}

// The containers every book is assumed to have. A copy arriving without one
// -- an older sheet, an older export, a save made before the setting existed
// -- otherwise throws the first time something writes into it: a month note,
// a reconciled tick, an import rule. Every path that replaces appData runs
// through here, so the shape is guaranteed in one place rather than guarded
// at each of the thirty-odd places that read it.
const APPDATA_CONTAINERS = {
  transactions: 'object', dailySales: 'object', notes: 'object',
  reconciled: 'object', holidays: 'object', salesSheets: 'object',
  deferrals: 'object', holidayBuy: 'object', monthClose: 'object',
  basisAdjust: 'object', bankRecon: 'object', rules: 'array', channels: 'array'
};
function normalizeAppData(d) {
  if (!d || typeof d !== 'object') return d;
  Object.keys(APPDATA_CONTAINERS).forEach(k => {
    const wantArray = APPDATA_CONTAINERS[k] === 'array';
    const v = d[k];
    const ok = wantArray ? Array.isArray(v) : (v && typeof v === 'object' && !Array.isArray(v));
    if (!ok) d[k] = wantArray ? [] : {};
  });
  // Years are written straight into buttons and menus as numbers, so they are
  // made numbers here. A book arrives from the sheet or a backup file, and a
  // "year" that was really text would otherwise run as part of those buttons.
  const isYear = y => Number.isInteger(y) && y >= 1900 && y <= 2200;
  if (Array.isArray(d.years)) {
    d.years = d.years.map(y => Number(y)).filter((y, i, a) => isYear(y) && a.indexOf(y) === i);
  }
  if (d.activeYear !== undefined && !isYear(Number(d.activeYear))) {
    d.activeYear = Array.isArray(d.years) && d.years.length ? Math.max.apply(null, d.years) : new Date().getFullYear();
  } else if (d.activeYear !== undefined) {
    d.activeYear = Number(d.activeYear);
  }
  // Whatever arrives by replacing the whole book is the accepted state of its
  // closed years: a load, or a backup deliberately restored.
  if (typeof lockOnLoad === 'function') lockOnLoad(d);
  // And the point the audit trail compares the next save against.
  if (typeof auditOnLoad === 'function') auditOnLoad(d);
  return d;
}

// Turns a sync failure into something readable on a phone, where there is
// no console to go and look in. "Load failed" on its own gave nothing to
// act on -- a blocked request, the wrong Google account and a rate limit
// all looked identical.
function describeSheetError(e) {
  const msg = (e && e.message) || String(e);
  // Safari words an unreachable/blocked request "Load failed"; Chrome says
  // "Failed to fetch". Neither one ever reached Google.
  if (/load failed|failed to fetch|networkerror/i.test(msg)) return 'network blocked';
  const code = (msg.match(/^(\d{3})\b/) || [])[1];
  if (code === '403') return "403 — this Google account can't open the sheet";
  if (code === '404') return '404 — sheet not found';
  if (code === '429') return '429 — rate limited, try shortly';
  if (code) return code + ' from Google';
  return msg.slice(0, 60);
}

// A network-level failure is the one case the message alone can't explain:
// it looks identical whether the whole API domain is unreachable (a content
// blocker, a filtered network) or only our authenticated request was
// refused. A no-cors probe separates them -- it skips CORS entirely, so it
// resolves if the request reached Google at all and only rejects when the
// connection genuinely didn't happen.
async function diagnoseNetworkBlock() {
  const sw = (navigator.serviceWorker && navigator.serviceWorker.controller) ? 'offline cache on' : 'offline cache off';
  try {
    // Retried like everything else. Without this the probe runs inside the
    // same transient window that broke the original request and reports the
    // domain as blocked when it is perfectly reachable -- which is exactly
    // what it did, and it cost a wrong diagnosis.
    await fetchRetry(`${SHEETS_BASE}/${SHEET_ID}`, { mode: 'no-cors', cache: 'no-store' });
    return `Google is reachable but the signed-in request was refused (${sw})`;
  } catch (e) {
    return `sheets.googleapis.com is blocked on this network or browser (${sw})`;
  }
}

// A book from the rows of one sheet tab: A1 the metadata, then one row per
// month with the transactions in B and the day book in C. The same layout
// serves the live tab and every saved version.
function sheetBookFromRows(rows) {
  const meta = JSON.parse(rows[0][0]);
  meta.transactions = {};
  meta.dailySales = {};
  rows.slice(1).forEach(row => {
    const key = row[0];
    if (!key) return;
    const txJson = row[1];
    const dailyJson = row[2];
    if (txJson) {
      try { meta.transactions[key] = JSON.parse(txJson); } catch(e) {}
    }
    if (dailyJson) {
      try { meta.dailySales[key] = JSON.parse(dailyJson); } catch(e) {}
    }
  });
  return meta;
}

// A tab name as the Sheets API wants it inside a range. BloomData passes as it
// is; a version's name has spaces, so it is quoted.
function sheetRange(tab, a1) {
  return (/^[A-Za-z0-9_]+$/.test(tab) ? tab : "'" + String(tab).replace(/'/g, "''") + "'") + '!' + a1;
}

// Reads the whole book from one tab.
// Returns { status: 'ok', book } | { status: 'empty' } | { status: 'auth' }.
async function sheetReadBook(tab) {
  // Fetch multiple rows — A1=metadata, A2+=year transactions
  const url = `${SHEETS_BASE}/${SHEET_ID}/values/${encodeURIComponent(sheetRange(tab, 'A1:A20'))}`;
  const res = await fetchRetry(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
  if (res.status === 401) return { status: 'auth' };
  // Keep the status code on the error. The body alone doesn't say whether
  // this was a 403 on the sheet or a 429 from the API, and on a phone
  // there's no console to go and check.
  if (!res.ok) throw new Error(res.status + ' ' + (await res.text()).slice(0, 300));
  const data = await res.json();
  const rows = (data.values || []).map(r => r[0] || '');
  if (rows.length === 0 || !rows[0]) return { status: 'empty' };

  // Parse sheet data
  // New format: A1=metadata, then rows with col A=key, col B=transactions JSON
  // Old format: A1=entire JSON blob
  //
  // A failure anywhere here is thrown to the caller, which says so and shows
  // the browser's copy. This used to catch it and "fall back" to parsing A1 as
  // the old format -- which succeeds on the metadata cell alone, so a failed
  // second fetch loaded a book with no transactions in it, silently, and the
  // next save sent that empty book to the sheet.
  let book;
  const meta = JSON.parse(rows[0]);
  if (meta.transactions !== undefined) {
    // Old format — entire appData in A1
    book = meta;
  } else {
    // New format. Need cols B and C too: B holds the month's transactions,
    // C its daily sales. Older sheets have no column C, which reads back as
    // undefined and simply leaves dailySales empty.
    const urlB = `${SHEETS_BASE}/${SHEET_ID}/values/${encodeURIComponent(sheetRange(tab, 'A1:C200'))}`;
    const resB = await fetchRetry(urlB, { headers: { 'Authorization': `Bearer ${accessToken}` } });
    if (!resB.ok) throw new Error(resB.status + ' ' + (await resB.text()).slice(0, 300));
    const dataB = await resB.json();
    book = sheetBookFromRows(dataB.values || [[rows[0]]]);
  }
  if (book.transactions) {
    Object.keys(book.transactions).forEach(k => {
      book.transactions[k] = book.transactions[k].filter(t => !t._vault);
    });
  }
  return { status: 'ok', book };
}

// Just the metadata cell: enough to see when, and from where, a tab was saved.
async function sheetReadMeta(tab) {
  const url = `${SHEETS_BASE}/${SHEET_ID}/values/${encodeURIComponent(sheetRange(tab, 'A1'))}`;
  const res = await fetchRetry(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
  if (res.status === 401) return { status: 'auth' };
  if (!res.ok) throw new Error(res.status + ' ' + (await res.text()).slice(0, 300));
  const cell = ((((await res.json()).values || [])[0]) || [])[0];
  if (!cell) return { status: 'empty' };
  try { return { status: 'ok', meta: JSON.parse(cell) }; } catch (e) { return { status: 'empty' }; }
}

// opts.preferSheet: take the sheet's copy even when this browser's is newer --
// the owner has chosen another computer's version over this one's.
// Returns true once the sheet has been read.
async function loadFromSheet(opts) {
  opts = opts || {};
  let loaded = false;
  setSyncStatus('loading', 'Loading from cloud...');
  await loadVaultTotals();
  try {
    const got = await sheetReadBook(SHEET_TAB);
    if (got.status === 'auth') { handleAuthExpiry(); ensureVaultData(); return false; }
    if (got.status === 'empty') {
      sheetKnownSavedAt = null;
      setSyncStatus('saved', 'New sheet — ready');
      ensureVaultData();
      return true;
    }
    const sheetData = got.book;
    // What the sheet holds now, whichever copy is used below.
    sheetKnownSavedAt = sheetData._savedAt || 0;

    // This browser's book, or the sheet's?
    const localRaw = localStorage.getItem('bloombooks_v2');
    let useSheet = true;
    if (localRaw && !opts.preferSheet) {
      try {
        const localData = JSON.parse(localRaw);
        const sheetTs = sheetData._savedAt || 0;
        const localTs = localData._savedAt || 0;
        const base = sheetStoredBase(localTs);
        // Knowing the copy this book was built on, the clocks are not needed:
        // it holds unsent changes if it has been saved since, and the sheet has
        // moved on if it no longer carries that copy. With no record -- a book
        // saved before there was one, or whose last write failed -- the newer
        // time wins, as it always did.
        const unsent = base === null ? localTs > sheetTs : localTs !== base;
        const moved = base !== null && sheetTs !== base;
        if (unsent) {
          appData = normalizeAppData(localData);
          if (appData.transactions) {
            Object.keys(appData.transactions).forEach(k => {
              appData.transactions[k] = appData.transactions[k].filter(t => !t._vault);
            });
          }
          localBookWrittenAt = localTs;
          ensureVaultData();
          useSheet = false;
          if (moved && typeof versionsOnConflict === 'function') {
            // Changes here that never reached the sheet, AND the sheet saved
            // from somewhere else since. Sending them now is exactly how one
            // computer's work used to vanish under another's. Ask instead.
            // The book on screen is built on the older copy, and saves here
            // must go on saying so, or a reload would take the sheet's copy
            // for this book's own and send the changes over it after all.
            sheetKnownSavedAt = base;
            versionsOnConflict(sheetData, sheetData);
          } else {
            // Only unsent changes, on top of what the sheet still holds. With no
            // record, that is a guess, so the sheet's copy is kept first.
            console.log('Local data is newer, syncing to sheet');
            if (base === null && typeof versionsKeepBeforeNextWrite === 'function') {
              versionsKeepBeforeNextWrite('Kept before this computer sent changes it had not yet saved to the sheet');
            }
            setSyncStatus('saving', 'Syncing local to cloud...');
            await pushToSheet();
          }
        }
      } catch(e) {}
    }

    if (useSheet) {
      // Preserve locally-stored rules if the sheet copy is missing/empty
      // (older sheets saved before rules were synced won't contain them)
      if (!Array.isArray(sheetData.rules) || sheetData.rules.length === 0) {
        try {
          const localData = JSON.parse(localStorage.getItem('bloombooks_v2') || '{}');
          if (Array.isArray(localData.rules) && localData.rules.length > 0) {
            sheetData.rules = localData.rules;
          }
        } catch(e) {}
      }
      appData = normalizeAppData(sheetData);
      // This browser's book now is the sheet's copy, and records that it is.
      // (When another computer's version has just been chosen, this is also
      // what stops the old book here being sent back over the choice.)
      writeLocalBook();
      setSyncStatus('saved', 'Synced ✓');
      setTimeout(() => setSyncStatus('idle', 'Synced'), 2000);
    }
    if (accessToken) sessionStorage.setItem('bb_token', accessToken);
    loaded = true;
  } catch(e) {
    console.warn('Sheet load error:', e);
    const reason = describeSheetError(e);
    setSyncStatus('error', 'Load failed: ' + reason + ' — showing local data');
    loadFromLocal();
    // Refine the message once the probe answers. Deliberately after
    // loadFromLocal() so the figures are on screen either way.
    if (reason === 'network blocked') {
      diagnoseNetworkBlock().then(detail => setSyncStatus('error', detail));
    }
  }
  ensureVaultData();
  return loaded;
}

function loadFromLocal() {
  try {
    const raw = localStorage.getItem('bloombooks_v2');
    if (raw) {
      appData = parseAppData(raw);
      localBookWrittenAt = appData._savedAt || 0;
      localSheetBase = sheetStoredBase(localBookWrittenAt);
    }
  } catch(e) {}
  loadVaultFromCache();
  ensureVaultData();
}

function isAuthError(text) {
  return text.includes('401') || text.includes('UNAUTHENTICATED') || text.includes('invalid authentication');
}

function handleAuthExpiry() {
  accessToken = null;
  sessionStorage.removeItem('bb_token');
  setSyncStatus('login', 'Session expired — sign in again');
}

function compactTx(t) {
  // Strip heavy fields before cloud storage to minimize cell size
  return {
    id: t.id,
    date: t.date,
    desc: (t.desc || '').slice(0, 40),
    category: t.category,
    vendor: (t.vendor || '').slice(0, 30),
    amount: t.amount,
    type: t.type
  };
}

// The whole book as the rows of one sheet tab: the live one, or a version.
// Row 1: metadata
// Row 2+: one row per month (year-month key) to stay under 50k char cell limit
function sheetBookValues(book) {
  // Everything on the book EXCEPT the two bulk collections, which go in
  // columns B and C of the per-month rows below -- four years of daily
  // figures is roughly 90KB against a 50k character cell limit.
  //
  // This was an allowlist until 2026-09-12, and it lost a setting each time
  // one was added: salesSheets, deferrals, holidayBuy, monthClose and
  // finally basisAdjust, the year-comparison figures, which were typed in,
  // written to localStorage, and then wiped by the next load from the sheet.
  // That failure is silent and only shows up on a refresh, which is why it
  // kept recurring despite a warning comment on every entry.
  //
  // Listing what must NOT go fails the other way round: a new setting rides
  // along on its own, and the only thing that can go wrong is a future bulk
  // collection blowing the cell limit -- which Google answers with an error
  // instead of quiet data loss.
  const BULK_KEYS = { transactions: 1, dailySales: 1 };
  const meta = {};
  Object.keys(book).forEach(k => { if (!BULK_KEYS[k]) meta[k] = book[k]; });
  // The load side tells the two sheet formats apart by whether A1 carries
  // transactions, so this cell must never have the key at all.
  delete meta.transactions;
  delete meta.dailySales;
  meta._savedAt = book._savedAt || Date.now();
  // Where it was saved from: named in a conflict, and how this page knows its
  // own write when the reply to it was lost.
  meta._savedBy = typeof auditDevice === 'function' ? auditDevice() : '';
  meta._savedSession = SYNC_SESSION;
  const monthRows = [];
  (book.years || []).forEach(yr => {
    for (let mi = 0; mi < 12; mi++) {
      const key = `${yr}-${mi}`;
      const txs = ((book.transactions || {})[key] || []).filter(t => !t._vault).map(compactTx);
      const daily = (book.dailySales || {})[key] || {};
      // Col A = key, col B = transactions JSON, col C = daily sales JSON.
      // Daily sales ride alongside the transactions rather than in the
      // metadata cell for the same reason transactions do: the cell caps at
      // 50k characters and four years of daily figures is well past it.
      monthRows.push([key, JSON.stringify(txs), Object.keys(daily).length ? JSON.stringify(daily) : '']);
    }
  });
  return [[JSON.stringify(meta), ''], ...monthRows];
}

// One push at a time. Two overlapping -- a slow save with the next one close
// behind -- would each check the sheet before the other had written.
let _pushChain = Promise.resolve();
function pushToSheet() {
  const run = _pushChain.then(pushToSheetNow);
  _pushChain = run.catch(() => {});
  return run;
}

// Returns true once the sheet holds this page's book.
async function pushToSheetNow() {
  try {
    if (syncConflict) {
      setSyncStatus('error', 'Not sent to the sheet — changed on another computer');
      return false;
    }
    // Is the sheet still the copy this page is built on? When the load failed
    // and the page is running on the browser's copy, that copy's own record
    // stands in for it.
    const base = sheetKnownSavedAt !== undefined ? sheetKnownSavedAt : localSheetBase;
    const remote = await sheetReadMeta(SHEET_TAB);
    if (remote.status === 'auth') { handleAuthExpiry(); return false; }
    if (sheetChangedSince(remote.meta, base)) {
      if (typeof versionsOnConflict === 'function') versionsOnConflict(remote.meta);
      else { syncConflict = { at: remote.meta._savedAt || 0, by: remote.meta._savedBy || '' };
             setSyncStatus('error', 'Not sent to the sheet — changed on another computer'); }
      return false;
    }
    // Keep what the sheet holds as a version before replacing it, when one is
    // due. It never stops the save: see versions.js.
    if (remote.meta && typeof versionBeforeWrite === 'function') await versionBeforeWrite(remote.meta);

    const values = sheetBookValues(appData);
    const url = `${SHEETS_BASE}/${SHEET_ID}/values/${encodeURIComponent(SHEET_TAB + '!A1')}?valueInputOption=RAW`;
    const res = await fetchRetry(url, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values })
    });
    if (res.status === 401) { handleAuthExpiry(); return false; }
    if (!res.ok) throw new Error(res.status + ' ' + (await res.text()).slice(0, 300));
    sheetKnownSavedAt = JSON.parse(values[0][0])._savedAt;
    // The book in this browser is now built on what was just sent -- provided
    // this page wrote it. If that write failed, the record still names the
    // older book that is there, and stays right about it.
    if (localBookWrittenAt !== null && localBookWrittenAt >= sheetKnownSavedAt) sheetRecordBase(sheetKnownSavedAt, localBookWrittenAt);
    setSyncStatus('saved', 'Saved to cloud ✓');
    setTimeout(() => setSyncStatus('idle', 'Synced'), 2000);
    return true;
  } catch(e) {
    const msg = e.message || '';
    if (isAuthError(msg)) { handleAuthExpiry(); return false; }
    setSyncStatus('error', 'Save failed: ' + describeSheetError(e) + ' — local only');
    console.error('Sheet save error:', e);
    return false;
  }
}

let _saveTimer = null;
function saveData() {
  // A closed year is put back before anything is written anywhere -- the
  // browser copy or the sheet. See periodlock.js.
  if (typeof lockGuard === 'function') lockGuard();
  // Then record what actually changed -- after the lock, so a refused change
  // is not logged as made. See audit.js.
  if (typeof auditCapture === 'function') auditCapture();
  // Always later than the copy it was built on, even on a computer whose clock
  // is behind the one that saved that copy. Otherwise the next load would
  // judge these changes older than the sheet and quietly drop them.
  appData._savedAt = Math.max(Date.now(), (appData._savedAt || 0) + 1);
  writeLocalBook();
  if (!accessToken) { setSyncStatus('login', 'Sign in to sync →'); return; }
  // Debounce cloud saves — wait 2s after last change before pushing to sheet
  setSyncStatus('saving', 'Saving...');
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(async () => {
    await pushToSheet();
  }, 2000);
}

async function loadData() {
  // Will be handled by gapiLoaded/gisLoaded flow
  // Immediately load from local as fallback while OAuth initializes
  loadFromLocal();
}

function finalizeInit() {
  // Again here, not only at startup: loading from the sheet replaces appData
  // wholesale, so a year added locally a moment ago would be overwritten by
  // whatever the sheet's list happens to hold.
  if (typeof ensureCurrentYear === 'function') ensureCurrentYear();

  // There is a sign-in now, so the Settings tab can be read. Until this point
  // the app has been running on this browser's cached copy.
  if (typeof bbSettingsLoad === 'function') {
    // Chained, not fired alongside: the settings are what name the computer
    // that saves the cost tracker, so starting its sync before they arrive
    // would have every device believe it was the writer.
    Promise.resolve(bbSettingsLoad())
      .then(() => { if (typeof ctSyncStart === 'function') return ctSyncStart(); })
      .catch(() => {});
  }

  const editCatSel = document.getElementById('edit-category');
  if (editCatSel) editCatSel.innerHTML = CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('');
  updateYearSelects();
  renderMonthTabs();
  switchPanel('month-0');
}

// ============================================================
// EXPORT / IMPORT
// ============================================================
function exportData() {
  const blob = new Blob([JSON.stringify({ version: 2, appData, ctData }, null, 2)], {type: 'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bloom-books-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  notify('Data exported successfully (includes cost tracker)');
}

function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const parsed = JSON.parse(ev.target.result);
      if (parsed.version === 2 && parsed.appData) {
        // New combined format
        appData = normalizeAppData(parsed.appData);
        ctData = { invoices:[], catalog:{}, retail:{}, family:{}, familyKeywords:{}, markup:{...CT_DEFAULT_MARKUP}, gmailSheetId:'', appsScriptUrl:'', importedGmailIds:[], ...(parsed.ctData||{}) };
        ctSave();
      } else {
        // Old format — bare appData only, no cost tracker data (pre-dates this feature)
        appData = normalizeAppData(parsed);
      }
      if (typeof auditEvent === 'function') auditEvent('Restored the whole book from a backup file');
      // Whatever the sheet held is kept first, however recently a version was.
      if (typeof versionsKeepBeforeNextWrite === 'function') versionsKeepBeforeNextWrite('Kept before a backup file was restored');
      ensureVaultData();
      saveData();
      initApp();
      notify('Data imported successfully');
    } catch(err) { notify('Import failed: invalid JSON', true); }
  };
  reader.readAsText(file);
  e.target.value = '';
}

// ============================================================
// NOTIFICATION
// ============================================================
function notify(msg, isError = false) {
  const el = document.getElementById('notification');
  el.textContent = msg;
  el.className = 'show' + (isError ? ' error' : '');
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = ''; }, 3000);
}

