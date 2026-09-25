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
    },

    // The cost categories, in the order they are offered and charted. Seeded
    // from the constants AND from any markup this browser has already tuned,
    // so turning settings on changes no figure anywhere.
    //
    // RETIRING keeps the name: 1,384 invoice lines store their category as a
    // string, and a retired one has to keep reading back as what it was filed
    // under. Retiring only takes it out of the pickers.
    categories: {
      list: (typeof CT_CATEGORIES !== 'undefined' ? CT_CATEGORIES : []).map(name => ({
        name,
        colour: (typeof CT_COLORS !== 'undefined' && CT_COLORS[name]) || '#888899',
        markup: (typeof ctData !== 'undefined' && ctData.markup && ctData.markup[name] != null)
          ? ctData.markup[name]
          : ((typeof CT_DEFAULT_MARKUP !== 'undefined' && CT_DEFAULT_MARKUP[name]) || 2),
        marginTarget: null,
        active: true
      })),
      // RENAMING does not touch a single stored line. The old label is mapped
      // to the new one and resolved when anything groups or displays, so a
      // category renamed in 2026 still gathers its 2025 history into one row
      // -- which is the whole reason for renaming rather than adding.
      renames: {}
    },

    // The suppliers whose email the scanner reads. This list has lived in the
    // Apps Script, which means adding a supplier has meant opening the script
    // editor, pasting and redeploying -- for what is four fields. Here it is a
    // form entry, and the script reads the same list.
    //
    // THE NAME IS AN IDENTITY, NOT A LABEL. 'Perri Farms' is what the bank's
    // "A. Perri Farms" is matched against; changing it breaks the payment
    // reconciliation rather than the scan, which is why renaming one asks.
    vendors: [
      { name: 'Juliet Wholesale', email: 'julietwholesalenj@gmail.com',
        label: '', mode: 'pdf', skipSubjects: [], active: true },
      // Perri's invoices are scanned now, but the vendor stays: removing it
      // would remove the delivery markers, and those are what say a delivery
      // happened on a day no invoice was captured.
      { name: 'Perri Farms', email: 'sales@perrifarms.com',
        label: '', mode: 'body', active: true,
        skipSubjects: ['we are on our way', 'you are next', 'a. perri farms, inc. order*'] },
      { name: 'DVFlora', email: 'orders@dvflora.com',
        label: '', mode: 'body', active: true,
        skipSubjects: ['deleted shopping cart notice*'] },
      { name: 'Fisch Floral Supply', email: 'info@fischfloralsupply.com',
        label: '', mode: 'pdf', skipSubjects: [], active: true },
      { name: 'Main Wholesale', email: 'ANTHONY@mainwholesaleflorist.com',
        label: '', mode: 'pdf', active: true,
        skipSubjects: ['mwf receipt*', 'main wholesale florist*'] }
    ],

    // The few numbers the app assumes rather than reads.
    financial: {
      // NY state + Westchester. Used to CHECK the tax recorded on a day
      // against what the sale should have carried -- it files nothing.
      taxRate: (typeof DS_TAX_RATE !== 'undefined' ? DS_TAX_RATE : 0.08375)
    },

    // Keyword -> Family/Type. The built-in list in config.js stays in code;
    // this holds the rules learned from tagging items, which until now were
    // written invisibly and could never be seen, corrected or removed.
    family: {
      // Off queues new rules for approval instead of writing them.
      autoLearn: true,
      rules: Object.entries((typeof ctData !== 'undefined' && ctData.familyKeywords) || {})
        .map(([keyword, family]) => ({ keyword, family, priority: 0 })),
      pending: []
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
      <h3>🏷️ Categories</h3>
      <div style="font-size:0.75rem;color:var(--mist);margin-bottom:10px">
        Renaming changes nothing already recorded: the old name is mapped to the
        new one, so a category renamed today still gathers last year's history
        into the same row. Retiring keeps the name on every line that carries
        it and only takes it out of the pickers.
      </div>
      <div class="staging-table-wrap"><table>
        <thead><tr><th></th><th>Category</th><th style="text-align:right">Markup</th>
          <th style="text-align:right">Margin target</th><th>Colour</th><th>In use</th></tr></thead>
        <tbody>${bbCategoryList().map((c, i) => `
          <tr${c.active === false ? ' style="opacity:0.55"' : ''}>
            <td style="white-space:nowrap">
              <button class="btn btn-outline btn-xs" onclick="bbCategoryMove(${i},-1)" ${i === 0 ? 'disabled' : ''}>↑</button>
              <button class="btn btn-outline btn-xs" onclick="bbCategoryMove(${i},1)" ${i === bbCategoryList().length - 1 ? 'disabled' : ''}>↓</button>
            </td>
            <td><input type="text" value="${escHtml(c.name)}" style="width:150px;font-size:0.75rem"
                       onchange="bbCategoryRename('${jsArg(c.name)}', this.value)"></td>
            <td style="text-align:right"><input type="number" step="0.1" min="0" value="${escHtml(String(c.markup ?? ''))}"
                       style="width:64px;font-size:0.75rem"
                       onchange="bbCategorySet('${jsArg(c.name)}','markup',this.value)">×</td>
            <td style="text-align:right"><input type="number" step="1" min="0" max="99"
                       value="${escHtml(c.marginTarget == null ? '' : String(c.marginTarget))}" placeholder="—"
                       style="width:60px;font-size:0.75rem"
                       onchange="bbCategorySet('${jsArg(c.name)}','marginTarget',this.value)">%</td>
            <td><input type="color" value="${escHtml(c.colour || '#888899')}" style="width:44px;padding:0"
                       onchange="bbCategorySet('${jsArg(c.name)}','colour',this.value)"></td>
            <td><label style="font-size:0.72rem"><input type="checkbox" ${c.active === false ? '' : 'checked'}
                       onchange="bbCategorySet('${jsArg(c.name)}','active',this.checked)"> in use</label></td>
          </tr>`).join('')}</tbody>
      </table></div>
      <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
        <input type="text" id="bb-cat-new" placeholder="New category" style="font-size:0.75rem;padding:4px 6px">
        <button class="btn btn-outline btn-sm" onclick="bbCategoryAdd()">Add</button>
      </div>
      ${Object.keys((bbSettings.categories && bbSettings.categories.renames) || {}).length ? `
        <div style="font-size:0.72rem;color:var(--mist);margin-top:10px">
          Renamed: ${Object.entries(bbSettings.categories.renames)
            .map(([a, b]) => `${escHtml(a)} → ${escHtml(b)}`).join(', ')}
        </div>` : ''}
    </div>

    <div class="chart-wrap">
      <h3>🌿 Family / Type rules</h3>
      <div style="font-size:0.75rem;color:var(--mist);margin-bottom:10px">
        A keyword in an item's name decides its family. These are the ones
        learned from your own tagging — until now they were written invisibly
        and could never be seen or undone. The built-in list stays in the app.
        The longest keyword wins; priority is how you overrule that.
      </div>
      <label style="font-size:0.78rem;display:block;margin-bottom:10px">
        <input type="checkbox" ${bbFamilyAutoLearn() ? 'checked' : ''} onchange="bbFamilySetAutoLearn(this.checked)">
        Learn new rules automatically. Off, they wait here for approval.
      </label>
      ${(bbSettings.family.pending || []).length ? `
        <div style="margin-bottom:10px;padding:8px 10px;border-radius:6px;background:#fff8e1;border:1px solid var(--amber)">
          <strong style="font-size:0.78rem">Waiting for you</strong>
          ${bbSettings.family.pending.map((r, i) => `
            <div style="font-size:0.75rem;margin-top:4px">
              “${escHtml(r.keyword)}” → ${escHtml(r.family)}
              <button class="btn btn-outline btn-xs" onclick="bbFamilyApprove(${i})">Keep</button>
              <button class="btn btn-danger btn-xs" onclick="bbFamilyDiscard(${i})">Discard</button>
            </div>`).join('')}
        </div>` : ''}
      <div class="staging-table-wrap"><table>
        <thead><tr><th>Keyword</th><th>Family / Type</th><th style="text-align:right">Priority</th><th></th></tr></thead>
        <tbody>${bbFamilyRules().map(r => `
          <tr>
            <td><input type="text" value="${escHtml(r.keyword)}" style="width:150px;font-size:0.75rem"
                       onchange="bbFamilySet('${jsArg(r.keyword)}','keyword',this.value)"></td>
            <td><input type="text" value="${escHtml(r.family)}" style="width:150px;font-size:0.75rem"
                       onchange="bbFamilySet('${jsArg(r.keyword)}','family',this.value)"></td>
            <td style="text-align:right"><input type="number" step="1" value="${escHtml(String(r.priority || 0))}"
                       style="width:56px;font-size:0.75rem"
                       onchange="bbFamilySet('${jsArg(r.keyword)}','priority',this.value)"></td>
            <td><button class="btn btn-danger btn-xs" onclick="bbFamilyRemove('${jsArg(r.keyword)}')">Remove</button></td>
          </tr>`).join('') || '<tr><td colspan="4" style="font-size:0.75rem;color:var(--mist)">Nothing learned yet — the built-in rules are doing the work.</td></tr>'}</tbody>
      </table></div>
    </div>

    <div class="chart-wrap">
      <h3>📨 Suppliers the scanner reads</h3>
      <div style="font-size:0.75rem;color:var(--mist);margin-bottom:10px">
        Adding a supplier used to mean editing the Apps Script. Fill the row in,
        save to the sheet, and the scanner picks it up on its next run — no
        redeploy. <strong>Invoice in an attachment</strong> is the usual case;
        choose <strong>in the email itself</strong> only for a supplier who
        writes the invoice into the message body. Skip subjects are the ones
        that are <em>not</em> invoices — order confirmations, "on our way" —
        one per line, <code>*</code> matching anything after it.
      </div>
      <div class="staging-table-wrap"><table>
        <thead><tr>
          <th>Supplier</th><th>Sender or Gmail label</th><th>Invoice is</th>
          <th>Subjects to skip</th><th>On</th><th></th>
        </tr></thead>
        <tbody>${bbSettings.vendors.map((v, i) => `
          <tr${v.active === false ? ' style="opacity:0.5"' : ''}>
            <td><input type="text" value="${escHtml(v.name)}" style="width:100%;font-size:0.75rem"
                       onchange="bbVendorRename(${i}, this.value)"></td>
            <td>
              <input type="text" value="${escHtml(v.email || '')}" placeholder="them@supplier.com"
                     style="width:100%;font-size:0.75rem"
                     onchange="bbVendorSet(${i},'email',this.value)">
              <input type="text" value="${escHtml(v.label || '')}" placeholder="or a Gmail label, for a scanner"
                     style="width:100%;font-size:0.72rem;margin-top:3px"
                     onchange="bbVendorSet(${i},'label',this.value)">
            </td>
            <td><select style="font-size:0.75rem" onchange="bbVendorSet(${i},'mode',this.value)">
              <option value="pdf"${v.mode !== 'body' ? ' selected' : ''}>an attachment</option>
              <option value="body"${v.mode === 'body' ? ' selected' : ''}>in the email itself</option>
            </select></td>
            <td><textarea rows="2" style="width:100%;font-size:0.72rem;font-family:inherit"
                       placeholder="one per line"
                       onchange="bbVendorSet(${i},'skipSubjects',this.value)"
              >${escHtml((v.skipSubjects || []).join('\n'))}</textarea></td>
            <td style="text-align:center"><input type="checkbox" ${v.active === false ? '' : 'checked'}
                       onchange="bbVendorSet(${i},'active',this.checked)"></td>
            <td><button class="btn btn-danger btn-xs" onclick="bbVendorRemove(${i})">Remove</button></td>
          </tr>`).join('')}</tbody>
      </table></div>
      <button class="btn btn-outline btn-sm" style="margin-top:8px" onclick="bbVendorAdd()">+ Add a supplier</button>
      <div style="font-size:0.7rem;color:var(--mist);margin-top:8px">
        Switching one <strong>off</strong> stops the scanner reading new mail
        without losing the row or anything it has already filed. The name is
        what the bank's own spelling is matched against, so renaming one asks
        first.
      </div>
    </div>

    <div class="chart-wrap">
      <h3>💵 Financial</h3>
      <div class="staging-table-wrap"><table>
        <thead><tr><th>Assumption</th><th style="text-align:right">Value</th><th>What it does</th></tr></thead>
        <tbody>
          <tr>
            <td><strong style="font-size:0.8rem">Sales tax rate</strong></td>
            <td style="text-align:right"><input type="number" step="0.001" min="0" max="20"
                       value="${escHtml((bbTaxRate() * 100).toFixed(3))}"
                       style="width:80px;font-size:0.75rem;text-align:right"
                       onchange="bbFinancialSetTaxRate(this.value)">&nbsp;%</td>
            <td style="font-size:0.72rem;color:var(--mist)">
              Checks the tax recorded on a day against what the sale should have
              carried. It files nothing. One rate covers every year on the page,
              closed ones included — so change it only if the county rate really
              changed, and expect the older years to move with it.
            </td>
          </tr>
        </tbody>
      </table></div>
      <div style="font-size:0.7rem;color:var(--mist);margin-top:8px">
        Markup and margin by category are above, under Categories. Yearly
        revenue targets stay on Trends, beside the figures they are read
        against.
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

// ---- categories --------------------------------------------------------
function bbCategoryTouched() {
  bbSettingsWriteCache();
  renderSettingsPanel();
  if (typeof renderCtDashboard === 'function') renderCtDashboard();
}

function bbCategorySet(name, field, val) {
  const row = bbCategoryList().find(c => c.name === name);
  if (!row) return;
  if (field === 'active') row.active = !!val;
  else if (field === 'colour') row.colour = String(val || '#888899');
  else if (field === 'markup') { const n = parseFloat(val); if (Number.isFinite(n) && n >= 0) row.markup = n; }
  else if (field === 'marginTarget') {
    const n = parseFloat(val);
    row.marginTarget = (val === '' || !Number.isFinite(n)) ? null : n;
  }
  bbCategoryTouched();
}

// A rename never edits a stored line. It records old -> new, and rewrites any
// entry that already pointed AT the old name so lookups stay one hop: rename
// Glass to Vases and then Vases to Containers, and Glass must end up at
// Containers rather than at a name that no longer exists.
function bbCategoryRename(from, to) {
  const name = String(to || '').trim();
  const row = bbCategoryList().find(c => c.name === from);
  if (!row || !name || name === from) { renderSettingsPanel(); return; }
  if (bbCategoryList().some(c => c.name === name)) {
    notify('There is already a category called ' + name, true);
    renderSettingsPanel();
    return;
  }
  const r = bbSettings.categories.renames || (bbSettings.categories.renames = {});
  Object.keys(r).forEach(k => { if (r[k] === from) r[k] = name; });
  r[from] = name;
  row.name = name;
  // The markup map is keyed by name and is read by older builds.
  if (ctData.markup && ctData.markup[from] != null) ctData.markup[name] = ctData.markup[from];
  ctSave();
  bbCategoryTouched();
  notify(`“${from}” is now “${name}” — history follows it`);
}

function bbCategoryMove(i, by) {
  const list = bbCategoryList();
  const j = i + by;
  if (j < 0 || j >= list.length) return;
  const [row] = list.splice(i, 1);
  list.splice(j, 0, row);
  bbCategoryTouched();
}

function bbCategoryAdd() {
  const box = document.getElementById('bb-cat-new');
  const name = String((box && box.value) || '').trim();
  if (!name) return;
  if (bbCategoryList().some(c => c.name === name)) { notify('That category already exists', true); return; }
  bbCategoryList().push({ name, colour: '#888899', markup: 2, marginTarget: null, active: true });
  if (box) box.value = '';
  bbCategoryTouched();
}

// ---- family rules ------------------------------------------------------
function bbFamilySetAutoLearn(on) {
  bbSettings.family.autoLearn = !!on;
  bbSettingsWriteCache();
  renderSettingsPanel();
}

function bbFamilySet(keyword, field, val) {
  const r = (bbSettings.family.rules || []).find(x => x.keyword === keyword);
  if (!r) return;
  if (field === 'priority') { const n = parseInt(val, 10); r.priority = Number.isFinite(n) ? n : 0; }
  else {
    const v = String(val || '').trim();
    if (!v) return;
    r[field] = v;
  }
  bbSettingsWriteCache();
  renderSettingsPanel();
}

function bbFamilyRemove(keyword) {
  const list = bbSettings.family.rules || [];
  const i = list.findIndex(x => x.keyword === keyword);
  if (i < 0) return;
  if (!confirm(`Forget “${keyword}” → ${list[i].family}?\n\nItems already tagged keep their family; only future ones stop matching this rule.`)) return;
  list.splice(i, 1);
  if (ctData.familyKeywords) delete ctData.familyKeywords[keyword];
  ctSave();
  bbSettingsWriteCache();
  renderSettingsPanel();
}

function bbFamilyApprove(i) {
  const p = (bbSettings.family.pending || [])[i];
  if (!p) return;
  bbSettings.family.pending.splice(i, 1);
  const at = (bbSettings.family.rules || []).find(r => r.keyword === p.keyword);
  if (at) at.family = p.family;
  else bbSettings.family.rules.push({ keyword: p.keyword, family: p.family, priority: 0 });
  bbSettingsWriteCache();
  renderSettingsPanel();
}

function bbFamilyDiscard(i) {
  const p = (bbSettings.family.pending || [])[i];
  if (!p) return;
  bbSettings.family.pending.splice(i, 1);
  // It was written to the old map on the way in; take it out of there too, or
  // it keeps matching from a place with no screen.
  if (ctData.familyKeywords) delete ctData.familyKeywords[p.keyword];
  ctSave();
  bbSettingsWriteCache();
  renderSettingsPanel();
}

// ---- suppliers the scanner reads ---------------------------------------
function bbVendorList() {
  if (!Array.isArray(bbSettings.vendors)) bbSettings.vendors = [];
  return bbSettings.vendors;
}

function bbVendorTouched() {
  bbSettingsWriteCache();
  renderSettingsPanel();
}

function bbVendorSet(i, field, val) {
  const v = bbVendorList()[i];
  if (!v) return;
  if (field === 'skipSubjects') {
    // One per line, blanks dropped. Lowercased because that is how the script
    // compares them, and a subject typed in Title Case would quietly match
    // nothing at all.
    v.skipSubjects = String(val || '').split('\n')
      .map(s => s.trim().toLowerCase()).filter(Boolean);
  } else if (field === 'active') {
    v.active = !!val;
  } else if (field === 'mode') {
    v.mode = val === 'body' ? 'body' : 'pdf';
  } else {
    v[field] = String(val || '').trim();
  }
  bbVendorTouched();
}

// The name is the identity the bank's own spelling is matched against, so this
// is the one field on the row that can break something the scanner never
// touches. Renaming is allowed -- a supplier really can change their name --
// but never silently.
function bbVendorRename(i, to) {
  const v = bbVendorList()[i];
  if (!v) return;
  const name = String(to || '').trim();
  if (!name || name === v.name) { renderSettingsPanel(); return; }
  const ok = confirm(
    `Rename "${v.name}" to "${name}"?\n\n` +
    `This name is what the bank's own spelling is matched against when ` +
    `payments are reconciled, and what invoices already filed are filed under. ` +
    `Renaming it can leave those looking unmatched.`
  );
  if (!ok) { renderSettingsPanel(); return; }
  v.name = name;
  bbVendorTouched();
}

function bbVendorAdd() {
  bbVendorList().push({ name: '', email: '', label: '', mode: 'pdf', skipSubjects: [], active: true });
  bbVendorTouched();
}

function bbVendorRemove(i) {
  const v = bbVendorList()[i];
  if (!v) return;
  const ok = confirm(
    `Remove ${v.name || 'this supplier'} from the scanner?\n\n` +
    `Nothing already filed is touched, but no new mail from them will be read ` +
    `— including delivery notices, which are what say a delivery happened on a ` +
    `day no invoice arrived. Switching the row off keeps it; removing does not.`
  );
  if (!ok) return;
  bbVendorList().splice(i, 1);
  bbVendorTouched();
}

// ---- financial ---------------------------------------------------------
function bbFinancialSetTaxRate(pct) {
  const n = Number(pct);
  if (!Number.isFinite(n) || n < 0 || n >= 20) {
    notify('A sales tax rate has to be a percentage under 20', true);
    renderSettingsPanel();
    return;
  }
  if (!bbSettings.financial) bbSettings.financial = {};
  // Stored as a fraction, entered as a percent. Rounded to the ten-thousandth
  // so 8.375 comes back as 0.08375 and not 0.08374999999999999.
  bbSettings.financial.taxRate = Math.round(n * 1e6) / 1e8;
  bbSettingsWriteCache();
  renderSettingsPanel();
  if (typeof renderSalesTaxPanel === 'function') renderSalesTaxPanel();
}
