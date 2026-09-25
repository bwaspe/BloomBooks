// ============================================================
// SETTINGS
// ============================================================
// One store, two doors. Every setting is STORED in one place -- a Settings tab
// in the scanner's Google Sheet, read once into bbSettings at startup -- while
// the controls that belong beside a piece of work keep their place there. Both
// read and write this one object, so they cannot drift; before this, each
// screen owned its own copy in localStorage and a second device simply had
// different settings.
//
// WHY THE SCANNER'S SHEET AND NOT THE BOOK'S. The Apps Script already opens
// that one every run, so it can read these settings with nothing new
// configured. The book's sheet carries the version and conflict machinery
// (versions.js), and settings have no business inside a document that gets
// rewritten wholesale and rolled back.
//
// THE ONE VALUE THAT CANNOT LIVE IN THE SHEET is the address of the sheet
// itself, so it stays where it already was: ctData.gmailSheetId, in
// localStorage. Everything else here is a cache of what the sheet holds.
//
// OAUTH, NOT THE WEB APP. The owner's spec asked for writes to go through the
// Apps Script doPost endpoint "so there's no OAuth plumbing in the front end".
// There already is: sync.js signs in and writes the book with the Sheets API
// under the owner's own account. Routing settings through /exec instead would
// add a SECOND, UNAUTHENTICATED path -- that URL has no login, which is why a
// backup file carrying it is not shareable -- and anyone holding it could
// rewrite the shop's settings. So these writes use the session that is already
// there. Said aloud rather than quietly decided, and easy to reverse.
const BB_SETTINGS_TAB    = 'Settings';
const BB_SETTINGS_CACHE  = 'bb_settings';
const BB_SETTINGS_SCHEMA = 1;

// Defaults ARE today's behaviour. Nothing in this file may change a figure the
// app already uses; a setting that has never been touched must answer exactly
// what the constant it replaces answered.
function bbSettingsDefaults() {
  const scanner = (typeof ctData !== 'undefined' && ctData.gmailSheetId) || '';
  return {
    schemaVersion: BB_SETTINGS_SCHEMA,
    sources: {
      book: {
        label: 'The book', sheetId: (typeof SHEET_ID !== 'undefined' ? SHEET_ID : ''),
        tab: (typeof SHEET_TAB !== 'undefined' ? SHEET_TAB : 'BloomData'),
        expect: 'json', note: 'Every year of transactions and the day book.'
      },
      audit: {
        label: 'Audit trail', sheetId: (typeof SHEET_ID !== 'undefined' ? SHEET_ID : ''),
        tab: (typeof AUDIT_TAB !== 'undefined' ? AUDIT_TAB : 'AuditLog'),
        expect: 'any', note: 'What changed, when, and on which computer.'
      },
      vault: {
        label: 'Historical totals', sheetId: (typeof SHEET_ID !== 'undefined' ? SHEET_ID : ''),
        tab: (typeof VAULT_TAB !== 'undefined' ? VAULT_TAB : 'VaultTotals'),
        expect: 'any', note: 'Pre-BloomBooks figures, read only.'
      },
      scanner: {
        label: 'Invoice scanner', sheetId: scanner, tab: 'Invoices',
        expect: ['MessageId', 'Vendor', 'Date', 'Total', 'ItemsJSON'],
        note: 'Where the Apps Script writes the invoices it reads from email.'
      },
      settings: {
        label: 'Settings (this)', sheetId: scanner, tab: BB_SETTINGS_TAB,
        expect: 'json', note: 'This panel. Its address lives in this browser.'
      }
    }
  };
}

let bbSettings = bbSettingsDefaults();
let bbSettingsState = { loaded: false, from: 'defaults', at: null, error: null };

// Every future shape change adds a STEP here and never edits an older one: a
// migration that is rewritten stops being able to read what it already wrote.
function bbSettingsMigrate(raw) {
  const out = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? { ...raw } : {};
  const from = Number(out.schemaVersion) || 0;
  if (from < 1) {
    // v0 is anything stored before this file existed — nothing did, so there is
    // nothing to move. The step is here so v0 is a real, handled case rather
    // than an unrecognised shape.
    out.schemaVersion = 1;
  }
  return out;
}

// Defaults underneath, stored values on top, key by key. A settings file
// written by an older version is missing whatever was added since, and those
// keys have to come back as their defaults rather than as undefined.
function bbSettingsMerge(base, over) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  Object.keys(over || {}).forEach(k => {
    const a = out[k], b = over[k];
    out[k] = (b && typeof b === 'object' && !Array.isArray(b) && a && typeof a === 'object' && !Array.isArray(a))
      ? bbSettingsMerge(a, b)
      : b;
  });
  return out;
}

function bbSettingsApply(raw, from) {
  bbSettings = bbSettingsMerge(bbSettingsDefaults(), bbSettingsMigrate(raw));
  bbSettingsState = { loaded: true, from, at: Date.now(), error: null };
  return bbSettings;
}

// ---- the offline cache -------------------------------------------------
function bbSettingsReadCache() {
  try {
    const raw = localStorage.getItem(BB_SETTINGS_CACHE);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function bbSettingsWriteCache() {
  try { localStorage.setItem(BB_SETTINGS_CACHE, JSON.stringify(bbSettings)); return true; }
  catch (e) { return false; }
}

// ---- the sheet ---------------------------------------------------------
// The whole object in one cell, like the book's metadata. A settings file is
// small and is always read and written whole, so a row-per-setting layout
// would buy nothing and invite half-written state.
function bbSettingsSheetId() {
  return (bbSettings.sources && bbSettings.sources.settings && bbSettings.sources.settings.sheetId)
    || (typeof ctData !== 'undefined' ? ctData.gmailSheetId : '') || '';
}

function bbSettingsReady() {
  return !!(typeof accessToken !== 'undefined' && accessToken && bbSettingsSheetId());
}

async function bbSettingsLoad() {
  // Applied even with nothing cached, because this is where the DEFAULTS are
  // built too. settings.js is loaded before init.js calls ctLoad(), so the
  // defaults computed as this file parsed saw an empty ctData and an empty
  // scanner sheet id; a browser with a configured scanner and no cache showed
  // that field blank. Built here, they see the data.
  const cached = bbSettingsReadCache();
  bbSettingsApply(cached || {}, cached ? 'this browser' : 'defaults');

  if (!bbSettingsReady()) return bbSettings;
  const id = bbSettingsSheetId();
  try {
    const url = `${SHEETS_BASE}/${id}/values/${encodeURIComponent(BB_SETTINGS_TAB + '!A1')}`;
    const res = await fetchRetry(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
    if (res.status === 400 || res.status === 404) return bbSettings;   // no tab yet
    if (res.status === 401) { bbSettingsState.error = 'sign-in expired'; return bbSettings; }
    if (!res.ok) throw new Error(res.status + ' ' + (await res.text()).slice(0, 200));
    const cell = ((((await res.json()).values || [])[0]) || [])[0];
    if (!cell) return bbSettings;
    bbSettingsApply(JSON.parse(cell), 'the Settings sheet');
    bbSettingsWriteCache();
  } catch (e) {
    // The cache is still in force; say so rather than reverting to defaults,
    // which would silently undo settings that are perfectly well stored.
    bbSettingsState.error = (e && e.message) || 'could not be read';
  }
  if (typeof renderSettingsPanel === 'function') renderSettingsPanel();
  return bbSettings;
}

async function bbSettingsEnsureTab(id) {
  const meta = await fetchRetry(`${SHEETS_BASE}/${id}?fields=sheets.properties.title`,
    { headers: { 'Authorization': `Bearer ${accessToken}` } });
  if (!meta.ok) throw new Error('could not read the sheet: ' + meta.status);
  const titles = (((await meta.json()).sheets) || []).map(s => s.properties && s.properties.title);
  if (titles.indexOf(BB_SETTINGS_TAB) >= 0) return;
  const res = await fetchRetry(`${SHEETS_BASE}/${id}:batchUpdate`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: BB_SETTINGS_TAB } } }] })
  });
  if (!res.ok) throw new Error('could not add the Settings tab: ' + res.status);
}

async function bbSettingsSave() {
  bbSettings.schemaVersion = BB_SETTINGS_SCHEMA;
  const cached = bbSettingsWriteCache();
  if (!bbSettingsReady()) {
    // Kept here and pushed on the next load. Refusing the edit outright would
    // make the panel unusable on a phone with no signal, which is where it is
    // most likely to be read.
    bbSettingsState.error = cached
      ? 'kept in this browser — sign in to put it in the sheet'
      : 'could not be stored anywhere';
    if (typeof renderSettingsPanel === 'function') renderSettingsPanel();
    return false;
  }
  const id = bbSettingsSheetId();
  try {
    await bbSettingsEnsureTab(id);
    const url = `${SHEETS_BASE}/${id}/values/${encodeURIComponent(BB_SETTINGS_TAB + '!A1')}?valueInputOption=RAW`;
    const res = await fetchRetry(url, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [[JSON.stringify(bbSettings)]] })
    });
    if (!res.ok) throw new Error(res.status + ' ' + (await res.text()).slice(0, 200));
    bbSettingsState = { loaded: true, from: 'the Settings sheet', at: Date.now(), error: null };
  } catch (e) {
    bbSettingsState.error = (e && e.message) || 'could not be saved';
    if (typeof notify === 'function') notify('Settings kept in this browser only — ' + bbSettingsState.error, true);
    if (typeof renderSettingsPanel === 'function') renderSettingsPanel();
    return false;
  }
  if (typeof renderSettingsPanel === 'function') renderSettingsPanel();
  return true;
}

// ---- does a source actually answer? ------------------------------------
// Checks the tab EXISTS and carries what the app expects to find, because
// "connected" on its own is the claim that has been wrong every time: a sheet
// id can be perfectly valid and point at a workbook with no Invoices tab.
async function bbSettingsTestSource(key) {
  const src = bbSettings.sources[key];
  if (!src) return { ok: false, why: 'no such source' };
  if (!src.sheetId) return { ok: false, why: 'no sheet id set' };
  if (typeof accessToken === 'undefined' || !accessToken) return { ok: false, why: 'sign in first' };
  try {
    const url = `${SHEETS_BASE}/${src.sheetId}/values/${encodeURIComponent(sheetRange(src.tab, 'A1:Z1'))}`;
    const res = await fetchRetry(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
    if (res.status === 400 || res.status === 404) return { ok: false, why: 'no tab called "' + src.tab + '"' };
    if (res.status === 401) return { ok: false, why: 'sign-in expired' };
    if (res.status === 403) return { ok: false, why: 'this Google account cannot open that sheet' };
    if (!res.ok) return { ok: false, why: 'the sheet answered ' + res.status };
    const row = ((((await res.json()).values || [])[0]) || []).map(c => String(c || '').trim());
    if (Array.isArray(src.expect)) {
      const missing = src.expect.filter(h => row.indexOf(h) < 0);
      return missing.length
        ? { ok: false, why: 'the tab is there but these columns are not: ' + missing.join(', ') }
        : { ok: true, why: row.length + ' columns, all the expected ones present' };
    }
    if (src.expect === 'json') {
      if (!row[0]) return { ok: true, why: 'the tab is there and empty — it will be written on the next save' };
      try { JSON.parse(row[0]); return { ok: true, why: 'readable' }; }
      catch (e) { return { ok: false, why: 'the first cell is not readable as settings' }; }
    }
    return { ok: true, why: row.length ? row.length + ' columns' : 'the tab is there' };
  } catch (e) {
    return { ok: false, why: (e && e.message) || 'could not be reached' };
  }
}

// ============================================================
// THE PANEL
// ============================================================
let bbSettingsTests = {};     // key -> { ok, why } from the last Test connection

function bbSettingsSourceRow(key) {
  const s = bbSettings.sources[key];
  const r = bbSettingsTests[key];
  const result = r
    ? `<div style="font-size:0.72rem;margin-top:4px;color:${r.ok ? 'var(--green)' : 'var(--red)'}">
         ${r.ok ? '✓' : '✕'} ${escHtml(r.why)}</div>`
    : '';
  return `
    <div style="padding:10px 0;border-bottom:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <strong style="font-size:0.85rem">${escHtml(s.label)}</strong>
        <button class="btn btn-outline btn-sm" onclick="bbSettingsTest('${jsArg(key)}')">Test connection</button>
      </div>
      <div style="font-size:0.72rem;color:var(--mist);margin:2px 0 6px">${escHtml(s.note || '')}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <input type="text" value="${escHtml(s.sheetId)}" placeholder="Sheet ID"
               onchange="bbSettingsSetSource('${jsArg(key)}','sheetId',this.value)"
               style="flex:2;min-width:180px;font-size:0.75rem;padding:4px 6px">
        <input type="text" value="${escHtml(s.tab)}" placeholder="Tab"
               onchange="bbSettingsSetSource('${jsArg(key)}','tab',this.value)"
               style="flex:1;min-width:90px;font-size:0.75rem;padding:4px 6px">
      </div>${result}
    </div>`;
}

function renderSettingsPanel() {
  const el = document.getElementById('settings-content');
  if (!el) return;
  const st = bbSettingsState;
  const where = st.error
    ? `<span style="color:var(--red)">${escHtml(st.error)}</span>`
    : `from ${escHtml(st.from)}${st.at ? ' at ' + new Date(st.at).toLocaleTimeString() : ''}`;

  el.innerHTML = `
    <div class="chart-wrap">
      <h3>🔌 Data Sources</h3>
      <div style="font-size:0.75rem;color:var(--mist);margin-bottom:10px">
        Every sheet BloomBooks reads or writes. Test connection checks the tab is
        really there and carries the columns the app expects — an id can be
        perfectly valid and point at the wrong workbook.
      </div>
      ${Object.keys(bbSettings.sources).map(bbSettingsSourceRow).join('')}
      <div style="font-size:0.7rem;color:var(--mist);margin-top:10px">
        The Settings sheet's own address is the one thing kept in this browser —
        it cannot be stored inside the sheet it points at.
      </div>
    </div>

    <div class="chart-wrap">
      <h3>🧰 System</h3>
      <div style="font-size:0.75rem;color:var(--mist);margin-bottom:10px">
        Settings are ${escHtml(where)}. Schema version ${bbSettings.schemaVersion}.
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
        <button class="btn btn-outline btn-sm" onclick="bbSettingsExport()">⬇ Export settings</button>
        <button class="btn btn-outline btn-sm" onclick="document.getElementById('bb-settings-file').click()">⬆ Import settings</button>
        <input type="file" id="bb-settings-file" accept=".json" style="display:none" onchange="bbSettingsImport(event)">
        <button class="btn btn-danger btn-sm" onclick="bbSettingsReset()">Reset to defaults</button>
        <button class="btn btn-primary btn-sm" onclick="bbSettingsSave()">Save to the sheet</button>
      </div>
      <details>
        <summary style="cursor:pointer;font-size:0.78rem">The raw settings</summary>
        <textarea id="bb-settings-raw" spellcheck="false"
                  style="width:100%;height:220px;font-family:monospace;font-size:0.7rem;margin-top:8px"
        >${escHtml(JSON.stringify(bbSettings, null, 2))}</textarea>
        <button class="btn btn-outline btn-sm" style="margin-top:6px" onclick="bbSettingsSaveRaw()">Use what I typed</button>
      </details>
    </div>`;
}

function bbSettingsSetSource(key, field, val) {
  const s = bbSettings.sources[key];
  if (!s) return;
  s[field] = String(val || '').trim();
  // A pasted Sheets URL is what a person actually has to hand; the id is the
  // part between /d/ and the next slash. setSalesSheetId does the same.
  const m = s[field].match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  if (field === 'sheetId' && m) s[field] = m[1];
  delete bbSettingsTests[key];
  bbSettingsWriteCache();
  renderSettingsPanel();
}

async function bbSettingsTest(key) {
  bbSettingsTests[key] = { ok: false, why: 'checking…' };
  renderSettingsPanel();
  bbSettingsTests[key] = await bbSettingsTestSource(key);
  renderSettingsPanel();
}

function bbSettingsExport() {
  const blob = new Blob([JSON.stringify(bbSettings, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bloom-books-settings-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  notify('Settings exported');
}

function bbSettingsImport(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      bbSettingsApply(JSON.parse(ev.target.result), 'a file');
      bbSettingsWriteCache();
      renderSettingsPanel();
      notify('Settings imported — press Save to put them in the sheet');
    } catch (err) {
      notify('That file could not be read as settings', true);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

function bbSettingsReset() {
  if (!confirm('Put every setting back to what the app does out of the box?\n\n' +
               'The sheet keeps what it has until you press Save.')) return;
  bbSettings = bbSettingsDefaults();
  bbSettingsWriteCache();
  renderSettingsPanel();
  notify('Back to defaults — not saved to the sheet yet');
}

function bbSettingsSaveRaw() {
  const box = document.getElementById('bb-settings-raw');
  if (!box) return;
  let parsed;
  try { parsed = JSON.parse(box.value); }
  catch (e) { notify('That is not readable JSON — nothing changed', true); return; }
  bbSettingsApply(parsed, 'typed here');
  bbSettingsWriteCache();
  renderSettingsPanel();
  notify('Settings replaced — press Save to put them in the sheet');
}
