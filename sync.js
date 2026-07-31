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

async function loadFromSheet() {
  setSyncStatus('loading', 'Loading from cloud...');
  await loadVaultTotals();
  try {
    // Fetch multiple rows — A1=metadata, A2+=year transactions
    const url = `${SHEETS_BASE}/${SHEET_ID}/values/${encodeURIComponent(SHEET_TAB + '!A1:A20')}`;
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
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
        // Need to fetch col B too for new format
        const urlB = `${SHEETS_BASE}/${SHEET_ID}/values/${encodeURIComponent(SHEET_TAB + '!A1:B200')}`;
        const resB = await fetch(urlB, { headers: { 'Authorization': `Bearer ${accessToken}` } });
        // Unchecked before: a failed second fetch left dataB.values undefined,
        // so rowsB became [] and the app loaded with every transaction missing
        // and no indication anything had gone wrong.
        if (!resB.ok) throw new Error(resB.status + ' ' + (await resB.text()).slice(0, 300));
        const dataB = await resB.json();
        const rowsB = dataB.values || [];
        rowsB.slice(1).forEach(row => {
          const key = row[0];
          const txJson = row[1];
          if (key && txJson) {
            try { meta.transactions[key] = JSON.parse(txJson); } catch(e) {}
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
    setSyncStatus('error', 'Load failed: ' + describeSheetError(e) + ' — showing local data');
    loadFromLocal();
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
      rules: appData.rules || [],
      _savedAt: appData._savedAt || Date.now()
    };
    const monthRows = [];
    (appData.years || []).forEach(yr => {
      for (let mi = 0; mi < 12; mi++) {
        const key = `${yr}-${mi}`;
        const txs = (appData.transactions[key] || []).filter(t => !t._vault).map(compactTx);
        // Store key in col A, transactions JSON in col B
        monthRows.push([key, JSON.stringify(txs)]);
      }
    });
    const values = [[JSON.stringify(meta), ''], ...monthRows];
    const url = `${SHEETS_BASE}/${SHEET_ID}/values/${encodeURIComponent(SHEET_TAB + '!A1')}?valueInputOption=RAW`;
    const res = await fetch(url, {
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

