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
  return parsed;
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

async function loadFromSheet() {
  setSyncStatus('loading', 'Loading from cloud...');
  await loadVaultTotals();
  try {
    // Fetch multiple rows — A1=metadata, A2+=year transactions
    const url = `${SHEETS_BASE}/${SHEET_ID}/values/${encodeURIComponent(SHEET_TAB + '!A1:A20')}`;
    const res = await fetchRetry(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
    if (res.status === 401) { handleAuthExpiry(); ensureVaultData(); return; }
    // Keep the status code on the error. The body alone doesn't say whether
    // this was a 403 on the sheet or a 429 from the API, and on a phone
    // there's no console to go and check.
    if (!res.ok) throw new Error(res.status + ' ' + (await res.text()).slice(0, 300));
    const data = await res.json();
    const rows = (data.values || []).map(r => r[0] || '');

    if (rows.length === 0 || !rows[0]) {
      setSyncStatus('saved', 'New sheet — ready');
      ensureVaultData();
      return;
    }

    // Parse sheet data
    // New format: A1=metadata, then rows with col A=key, col B=transactions JSON
    // Old format: A1=entire JSON blob
    let sheetData;
    try {
      const meta = JSON.parse(rows[0]);
      if (meta.transactions !== undefined) {
        // Old format — entire appData in A1
        sheetData = meta;
      } else {
        // New format — meta in A1, month rows after
        meta.transactions = {};
        meta.dailySales = {};
        // Need cols B and C too: B holds the month's transactions, C its daily
        // sales. Older sheets have no column C, which reads back as undefined
        // and simply leaves dailySales empty.
        const urlB = `${SHEETS_BASE}/${SHEET_ID}/values/${encodeURIComponent(SHEET_TAB + '!A1:C200')}`;
        const resB = await fetchRetry(urlB, { headers: { 'Authorization': `Bearer ${accessToken}` } });
        // Unchecked before: a failed second fetch left dataB.values undefined,
        // so rowsB became [] and the app loaded with every transaction missing
        // and no indication anything had gone wrong.
        if (!resB.ok) throw new Error(resB.status + ' ' + (await resB.text()).slice(0, 300));
        const dataB = await resB.json();
        const rowsB = dataB.values || [];
        rowsB.slice(1).forEach(row => {
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
        sheetData = meta;
      }
    } catch(e) {
      // Fallback: try parsing entire A1 as old format
      try { sheetData = parseAppData(rows[0]); } catch(e2) { throw e; }
    }
    if (sheetData.transactions) {
      Object.keys(sheetData.transactions).forEach(k => {
        sheetData.transactions[k] = sheetData.transactions[k].filter(t => !t._vault);
      });
    }

    // Timestamp conflict resolution
    const localRaw = localStorage.getItem('bloombooks_v2');
    let useSheet = true;
    if (localRaw) {
      try {
        const localData = JSON.parse(localRaw);
        const sheetTs = sheetData._savedAt || 0;
        const localTs = localData._savedAt || 0;
        if (localTs > sheetTs) {
          console.log('Local data is newer, syncing to sheet');
          appData = localData;
          if (appData.transactions) {
            Object.keys(appData.transactions).forEach(k => {
              appData.transactions[k] = appData.transactions[k].filter(t => !t._vault);
            });
          }
          ensureVaultData();
          useSheet = false;
          setSyncStatus('saving', 'Syncing local to cloud...');
          await pushToSheet();
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
      appData = sheetData;
      setSyncStatus('saved', 'Synced ✓');
      setTimeout(() => setSyncStatus('idle', 'Synced'), 2000);
    }
    if (accessToken) sessionStorage.setItem('bb_token', accessToken);
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
}

function loadFromLocal() {
  try {
    const raw = localStorage.getItem('bloombooks_v2');
    if (raw) { appData = parseAppData(raw); }
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

async function pushToSheet() {
  try {
    // Row 1: metadata
    // Row 2+: one row per month (year-month key) to stay under 50k char cell limit
    const meta = {
      years: appData.years,
      activeYear: appData.activeYear,
      notes: appData.notes || {},
      reconciled: appData.reconciled || {},
      holidays: appData.holidays || {},
      // Year -> Sales workbook id, for the Holiday Revenue refresh. This list
      // is an allowlist, not a spread: anything missing from it is silently
      // dropped on every sync, so a new top-level key must be added here too.
      salesSheets: appData.salesSheets || {},
      // The channel list only. Daily figures are far too big for this cell
      // (four years is roughly 90KB against a 50k character limit) and go in
      // column C of the per-month rows below, alongside the transactions.
      channels: appData.channels || [],
      // The version stamp must ride along with the channels it describes.
      // Without it the sheet always reads back as v1, so the migration re-runs
      // on every single load -- harmless today, since it only reactivates
      // FloraNext and retires Web, but it would silently undo those choices
      // for anyone who later decided otherwise.
      channelsVersion: appData.channelsVersion || null,
      // How much of each month's revenue was delivered in an earlier one --
      // measured at import, used to draw the year on a delivery basis without
      // moving anything. Same allowlist rule as above.
      deferrals: appData.deferrals || {},
      // When holiday buying started, per holiday per year. Same allowlist rule:
      // a top-level key missing from this list is dropped on every sync.
      holidayBuy: appData.holidayBuy || {},
      // Which month-end uploads have been done, and when. Same allowlist rule:
      // omit it here and the record is dropped on every sync, which is exactly
      // the forgetting it exists to prevent.
      monthClose: appData.monthClose || {},
      dailyRevenueFrom: appData.dailyRevenueFrom || null,
      rules: appData.rules || [],
      _savedAt: appData._savedAt || Date.now()
    };
    const monthRows = [];
    (appData.years || []).forEach(yr => {
      for (let mi = 0; mi < 12; mi++) {
        const key = `${yr}-${mi}`;
        const txs = (appData.transactions[key] || []).filter(t => !t._vault).map(compactTx);
        const daily = (appData.dailySales || {})[key] || {};
        // Col A = key, col B = transactions JSON, col C = daily sales JSON.
        // Daily sales ride alongside the transactions rather than in the
        // metadata cell for the same reason transactions do: the cell caps at
        // 50k characters and four years of daily figures is well past it.
        monthRows.push([key, JSON.stringify(txs), Object.keys(daily).length ? JSON.stringify(daily) : '']);
      }
    });
    const values = [[JSON.stringify(meta), ''], ...monthRows];
    const url = `${SHEETS_BASE}/${SHEET_ID}/values/${encodeURIComponent(SHEET_TAB + '!A1')}?valueInputOption=RAW`;
    const res = await fetchRetry(url, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values })
    });
    if (res.status === 401) { handleAuthExpiry(); return; }
    if (!res.ok) throw new Error(res.status + ' ' + (await res.text()).slice(0, 300));
    setSyncStatus('saved', 'Saved to cloud ✓');
    setTimeout(() => setSyncStatus('idle', 'Synced'), 2000);
  } catch(e) {
    const msg = e.message || '';
    if (isAuthError(msg)) { handleAuthExpiry(); return; }
    setSyncStatus('error', 'Save failed: ' + describeSheetError(e) + ' — local only');
    console.error('Sheet save error:', e);
  }
}

let _saveTimer = null;
function saveData() {
  appData._savedAt = Date.now();
  try { localStorage.setItem('bloombooks_v2', JSON.stringify(appData)); } catch(e) {}
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
        appData = parsed.appData;
        ctData = { invoices:[], catalog:{}, retail:{}, family:{}, familyKeywords:{}, markup:{...CT_DEFAULT_MARKUP}, gmailSheetId:'', appsScriptUrl:'', importedGmailIds:[], ...(parsed.ctData||{}) };
        ctSave();
      } else {
        // Old format — bare appData only, no cost tracker data (pre-dates this feature)
        appData = parsed;
      }
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

