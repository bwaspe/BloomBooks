// ============================================================
// THE COST TRACKER, KEPT IN THE SHEET
// ============================================================
// Until this, ctData lived in one browser's localStorage and nowhere else.
// 229 invoices, 298KB, one copy -- and it could not be rebuilt from the
// scanner's Invoices tab, because not one stored invoice carries the
// messageId it came from, and the ones that did come from email have since
// been corrected by hand. Re-importing would hand back the original parse and
// throw those corrections away. The auto-download to Downloads only fires on
// page load, on that one machine.
//
// ONE WRITER, MANY READERS, by the owner's choice. The office machine saves;
// a phone reads what it saved and shows it properly instead of an empty
// screen. That is not a simplification of a sync problem, it is the shape of
// the work: invoices are entered and corrected at a desk. It also removes the
// failure that matters most -- a phone that loaded before its read finished
// writing an empty ctData over the only good copy.
//
// NOTHING HAPPENS UNTIL IT IS CLAIMED. With no writer set, this file does
// nothing at all and the cost tracker behaves exactly as it did. Claiming is
// a deliberate press on one computer, not something the first device to open
// the page wins by accident.
const CT_SHEET_TAB = 'CostTracker';
const CT_CHUNK = 40000;        // a Sheets cell holds 50,000 characters

// Every row carries the id of the write that put it there, and the reader
// ignores any row that does not match the one in the meta.
//
// WHY, rather than clearing the tab first: deleting an invoice makes the next
// write SHORTER, so a plain overwrite from A1 leaves the tail of the previous
// one behind and the reader resurrects what was deleted. Clearing first fixes
// that and opens a worse hole -- if the write then fails, the only copy off
// this machine is gone, which is the one thing this file exists to prevent.
// Stamping makes a stale row invisible instead, so nothing has to be deleted
// for the data to be right.
function ctWriteId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

// What must NOT go in the meta cell, rather than what may. Listing the ones
// allowed is how sync.js lost a setting every time one was added -- silently,
// and only visible after a refresh. Here the only thing that can go wrong is
// a future collection outgrowing 50,000 characters, and chunking answers that.
const CT_BULK_KEYS = { invoices: 1 };

function ctSheetValues(data, writeId, savedBy) {
  const src = data || {};
  const meta = {};
  Object.keys(src).forEach(k => {
    // Underscore keys are working state, the same ones ctSave drops.
    if (!CT_BULK_KEYS[k] && k.charAt(0) !== '_') meta[k] = src[k];
  });
  meta._savedAt = Date.now();
  meta._savedBy = savedBy || '';
  meta._invoices = (src.invoices || []).length;

  const json = JSON.stringify(meta);
  // A header row, so "when was this last saved, and how much of it" can be had
  // from ONE cell rather than pulling 300KB back. The stamps inside the meta
  // are appended last and therefore land in the LAST chunk, which is no use
  // for a cheap look. Any row whose kind is not ct or inv is ignored by the
  // reader, so this costs the round trip nothing.
  const rows = [['hdr', writeId, String(meta._savedAt), String(meta._invoices)]];
  const chunks = [];
  for (let i = 0; i < json.length; i += CT_CHUNK) {
    chunks.push(['ct', writeId, String(chunks.length), json.slice(i, i + CT_CHUNK)]);
  }
  if (!chunks.length) chunks.push(['ct', writeId, '0', '{}']);
  chunks.forEach(c => rows.push(c));

  (src.invoices || []).forEach((inv, i) => {
    // A row keeps its place even with no id on the invoice, rather than being
    // dropped for want of a label.
    rows.push(['inv', writeId, String((inv && inv.id) || 'inv-' + i), JSON.stringify(inv)]);
  });
  return rows;
}

// Returns null when the meta cannot be read at all. The caller MUST treat that
// as "keep what is here" -- handing back an object with the invoices and none
// of the catalog, retail prices or aliases would look like a successful load
// and quietly replace months of curation with a shell.
function ctSheetFromRows(rows) {
  let writeId = null, json = '';
  const invoices = [];
  (rows || []).forEach(r => {
    if (!r || !r.length) return;
    const kind = r[0], id = r[1];
    if (kind === 'ct') {
      if (writeId === null) writeId = id;
      if (id !== writeId) return;          // a chunk left over from an older write
      json += (r[3] || '');
      return;
    }
    if (kind !== 'inv') return;
    if (writeId !== null && id !== writeId) return;
    try {
      const inv = JSON.parse(r[3] || '');
      if (inv && typeof inv === 'object') invoices.push(inv);
    } catch (e) {
      // Caught so that the count check below is what decides, rather than an
      // exception escaping. A row that will not parse makes the tally short,
      // and a short read is refused outright -- 228 invoices handed back as
      // though they were 229 is the silent loss this is all guarding.
    }
  });
  if (writeId === null) return null;       // nothing written yet
  let meta;
  try { meta = JSON.parse(json || ''); } catch (e) { return null; }
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  // A read that lost rows is a read that must not be trusted: replacing the
  // local copy with a short one is exactly the silent loss this guards.
  if (typeof meta._invoices === 'number' && invoices.length !== meta._invoices) return null;
  meta.invoices = invoices;
  return meta;
}

// ---- who saves it ------------------------------------------------------
function ctSyncSettings() {
  if (typeof bbSettings === 'undefined' || !bbSettings) return null;
  if (!bbSettings.costTracker) bbSettings.costTracker = { writer: '', writerName: '', savedAt: 0, invoices: 0 };
  return bbSettings.costTracker;
}

// The claim is keyed on the RANDOM ID alone, not on auditDevice()'s full
// string. That string carries the browser and OS read off the user agent, and
// a browser update that changes how it parses would turn the writer into a
// reader overnight -- silently, and the cost tracker would simply stop being
// saved. The readable name is kept alongside, for display only.
function ctSyncDevice() {
  // auditDevice() is what CREATES bb_device_id on a browser that has never had
  // one. Reading the key without calling it first means a fresh browser --
  // exactly the one being set up -- reports no identity and is refused the
  // claim with "this browser cannot be identified", which is both wrong and
  // unfixable from the screen it appears on.
  if (typeof auditDevice === 'function') { try { auditDevice(); } catch (e) {} }
  try { return localStorage.getItem('bb_device_id') || ''; } catch (e) { return ''; }
}

function ctSyncDeviceLabel() {
  return (typeof auditDevice === 'function' ? auditDevice() : '') || ctSyncDevice();
}

function ctSyncClaimed() {
  const s = ctSyncSettings();
  return !!(s && s.writer);
}

// Read-only is a positive answer, not the absence of one: with nobody claiming
// it, everything behaves as it always did.
function ctSyncReadOnly() {
  const s = ctSyncSettings();
  if (!s || !s.writer) return false;
  return s.writer !== ctSyncDevice();
}

function ctSyncWriterName() {
  const s = ctSyncSettings();
  return (s && (s.writerName || s.writer)) || '';
}

function ctSyncReady() {
  return typeof accessToken !== 'undefined' && !!accessToken &&
         typeof bbSettingsSheetId === 'function' && !!bbSettingsSheetId();
}

// A Google access token lasts about an hour, and a shop leaves this page open
// all day. sync.js has always handled that for the book -- handleAuthExpiry
// clears the token and puts "sign in again" in the header. This file did not,
// so the first save after the hour was up raised a raw Google 401 at somebody
// who had done nothing wrong, and every save after it failed the same way.
//
// The change itself is never at risk: the browser copy is written before the
// push is even attempted. What is at risk is the SHEET falling behind without
// anyone realising, which is why this says so in those words.
const CT_SIGNED_OUT = 'signed out — sign in again and this will save';

function ctSyncHandleAuth(status, body) {
  const text = String(status) + ' ' + String(body || '');
  if (status !== 401 && !(typeof isAuthError === 'function' && isAuthError(text))) return false;
  if (typeof handleAuthExpiry === 'function') handleAuthExpiry();
  ctSyncState.error = CT_SIGNED_OUT;
  if (typeof notify === 'function') {
    notify('Signed out — your change is saved on this computer. Sign in again to put it in the sheet.', true);
  }
  if (typeof renderCtStorageWarning === 'function') renderCtStorageWarning();
  return true;
}

// ---- reading and writing the tab ---------------------------------------
let ctSyncState = { at: 0, error: '', busy: false, rows: 0 };
let _ctSyncTimer = null;
let _ctSyncChain = Promise.resolve();
// The copy last known to be right, so a change made on a reader can be put
// back rather than left on screen looking saved.
let ctReadOnlyBase = null;

async function ctSyncEnsureTab(id) {
  const url = `${SHEETS_BASE}/${id}:batchUpdate`;
  const res = await fetchRetry(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: CT_SHEET_TAB } } }] })
  });
  // Already there is the normal case, and not a failure.
  if (!res.ok) {
    const text = (await res.text()) || '';
    if (!/already exists/i.test(text)) throw new Error(res.status + ' ' + text.slice(0, 200));
  }
}

async function ctSyncPull() {
  if (!ctSyncReady() || !ctSyncClaimed()) return null;
  const id = bbSettingsSheetId();
  try {
    const url = `${SHEETS_BASE}/${id}/values/${encodeURIComponent(CT_SHEET_TAB + '!A1:D')}`;
    const res = await fetchRetry(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
    if (res.status === 400 || res.status === 404) return null;     // no tab yet
    if (ctSyncHandleAuth(res.status)) return null;
    if (!res.ok) throw new Error(res.status + ' ' + (await res.text()).slice(0, 200));
    const rows = (await res.json()).values || [];
    const data = ctSheetFromRows(rows);
    if (!data) { ctSyncState.error = 'the saved copy could not be read'; return null; }
    ctSyncState = { at: data._savedAt || 0, error: '', busy: false, rows: (data.invoices || []).length };
    return data;
  } catch (e) {
    ctSyncState.error = (e && e.message) || 'could not be read';
    return null;
  }
}

// One cell, to answer "is what I saved actually there, and when".
//
// The panel used to read the time out of the settings, which ctSyncPushNow
// wrote to the browser's cache and never to the sheet -- so the next settings
// load replaced it with nothing and the screen said "Not saved yet" on a
// computer that had been saving fine all along. A backup you are told is not
// there is barely better than no backup.
async function ctSyncPeek() {
  if (!ctSyncReady() || !ctSyncClaimed()) return null;
  const id = bbSettingsSheetId();
  try {
    const url = `${SHEETS_BASE}/${id}/values/${encodeURIComponent(CT_SHEET_TAB + '!A1:D1')}`;
    const res = await fetchRetry(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
    if (res.status === 400 || res.status === 404) return null;     // no tab yet
    if (ctSyncHandleAuth(res.status)) return null;
    if (!res.ok) throw new Error(res.status + ' ' + (await res.text()).slice(0, 200));
    const row = ((await res.json()).values || [])[0] || [];
    if (row[0] !== 'hdr') return null;
    const at = Number(row[2]) || 0, rows = Number(row[3]) || 0;
    ctSyncState = { at, error: '', busy: false, rows };
    return ctSyncState;
  } catch (e) {
    ctSyncState.error = (e && e.message) || 'could not be read';
    return null;
  }
}

// Only ever called on the machine that holds the claim.
async function ctSyncPushNow() {
  if (ctSyncReadOnly() || !ctSyncClaimed() || !ctSyncReady()) return false;
  const id = bbSettingsSheetId();
  ctSyncState.busy = true;
  try {
    await ctSyncEnsureTab(id);
    const values = ctSheetValues(ctData, ctWriteId(), ctSyncDevice());
    const url = `${SHEETS_BASE}/${id}/values/${encodeURIComponent(CT_SHEET_TAB + '!A1')}?valueInputOption=RAW`;
    const res = await fetchRetry(url, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values })
    });
    if (res.status === 401) { ctSyncHandleAuth(401); return false; }
    if (!res.ok) throw new Error(res.status + ' ' + (await res.text()).slice(0, 200));
    ctSyncState = { at: Date.now(), error: '', busy: false, rows: (ctData.invoices || []).length };
    const s = ctSyncSettings();
    if (s) { s.savedAt = ctSyncState.at; s.invoices = ctSyncState.rows; bbSettingsWriteCache(); }
    // Tidy the tail of a longer previous write. Best effort on purpose:
    // nothing depends on it, because every row carries its write id.
    ctSyncTrim(id, values.length);
    return true;
  } catch (e) {
    const msg = (e && e.message) || 'could not be saved';
    // ctSyncEnsureTab throws rather than returning a status, so the expired
    // sign-in can arrive here too.
    if (!ctSyncHandleAuth(0, msg)) {
      ctSyncState = { at: ctSyncState.at, error: msg, busy: false, rows: ctSyncState.rows };
      if (typeof notify === 'function') notify('Cost tracker not sent to the sheet — ' + msg, true);
    }
    return false;
  } finally {
    ctSyncState.busy = false;
    if (typeof renderCtStorageWarning === 'function') renderCtStorageWarning();
  }
}

function ctSyncTrim(id, keptRows) {
  const from = keptRows + 1;
  const url = `${SHEETS_BASE}/${id}/values/${encodeURIComponent(CT_SHEET_TAB + '!A' + from + ':D')}:clear`;
  fetchRetry(url, { method: 'POST', headers: { 'Authorization': `Bearer ${accessToken}` } })
    .catch(() => {});
}

// Debounced the same 2 seconds the book uses, and queued so two pushes cannot
// overlap and land out of order.
function ctSyncPush() {
  if (ctSyncReadOnly() || !ctSyncClaimed()) return;
  clearTimeout(_ctSyncTimer);
  _ctSyncTimer = setTimeout(() => {
    _ctSyncChain = _ctSyncChain.then(ctSyncPushNow).catch(() => {});
  }, 2000);
}

// ---- joining up --------------------------------------------------------
// Called after sign-in, once settings are loaded and so the writer is known.
async function ctSyncStart() {
  if (!ctSyncClaimed()) return;
  if (!ctSyncReadOnly()) {
    // The writer's own copy is the authority. Send it, rather than reading
    // over in-memory edits with an older sheet -- but look at the header row
    // first, so the screen can say what is actually in the sheet rather than
    // only what this session has managed to put there.
    await ctSyncPeek();
    if (typeof renderSettingsPanel === 'function') renderSettingsPanel();
    ctSyncPush();
    return;
  }
  const data = await ctSyncPull();
  if (!data) {
    // A failed or empty read leaves whatever is here alone. Blanking the
    // screen because the network hiccuped is the behaviour being fixed.
    if (typeof renderCtStorageWarning === 'function') renderCtStorageWarning();
    return;
  }
  delete data._savedAt; delete data._savedBy; delete data._invoices;
  ctData = { ...ctData, ...data };
  ctReadOnlyBase = JSON.stringify(ctData);
  if (typeof ctHistoryReset === 'function') ctHistoryReset(ctData);
  try { localStorage.setItem('bb_ctdata', ctReadOnlyBase); } catch (e) { /* a phone in private mode still reads fine */ }
  ctStorageState = null;
  if (typeof renderCtDashboard === 'function') renderCtDashboard();
  if (typeof renderCtStorageWarning === 'function') renderCtStorageWarning();
}

// A change made on a reader is PUT BACK, not quietly dropped. Left on screen
// it would look saved, and the next load would take it away with no
// explanation -- which is worse than being told at the time.
function ctSyncRefuseWrite() {
  if (ctReadOnlyBase) {
    try { ctData = JSON.parse(ctReadOnlyBase); } catch (e) { /* keep what is here */ }
  }
  if (typeof notify === 'function') {
    notify('The cost tracker is saved from ' + (ctSyncWriterName() || 'another computer') +
           ' — that change was not kept', true);
  }
  if (typeof renderCtStorageWarning === 'function') renderCtStorageWarning();
  if (typeof renderCurrentPanel === 'function') setTimeout(() => { try { renderCurrentPanel(); } catch (e) {} }, 0);
}

// ---- the claim ---------------------------------------------------------
function ctSyncClaim() {
  const s = ctSyncSettings();
  if (!s) return;
  const me = ctSyncDevice();
  if (!me) { notify('This browser cannot be identified — it may be in private mode', true); return; }
  if (s.writer && s.writer !== me) {
    const ok = confirm(
      `The cost tracker is saved from ${ctSyncWriterName()}.\n\n` +
      `Take that over, so it is saved from this computer instead?\n\n` +
      `${ctSyncWriterName()} becomes read-only, and what is on THIS computer ` +
      `becomes the copy everything else reads.`
    );
    if (!ok) return;
  } else if (!s.writer) {
    const ok = confirm(
      'Save the cost tracker from this computer?\n\n' +
      'Its invoices and prices go into the CostTracker tab of the scanner\'s ' +
      'sheet, so they exist somewhere other than this browser and your phone ' +
      'can read them. Other devices will read, not write.'
    );
    if (!ok) return;
  }
  s.writer = me;
  s.writerName = ctSyncDeviceLabel();
  bbSettingsWriteCache();
  if (typeof bbSettingsSave === 'function') bbSettingsSave();
  ctReadOnlyBase = null;
  if (typeof renderSettingsPanel === 'function') renderSettingsPanel();
  // Awaited, so the panel that follows reports what happened rather than what
  // had not happened yet -- which is how a successful first save showed as
  // 'Not saved yet'.
  ctSyncPushNow().then(() => {
    if (typeof renderSettingsPanel === 'function') renderSettingsPanel();
  });
}

function ctSyncRelease() {
  const s = ctSyncSettings();
  if (!s || !s.writer) return;
  const ok = confirm(
    'Stop keeping the cost tracker in the sheet?\n\n' +
    'Nothing already saved there is deleted, but it stops being updated, and ' +
    'other devices go back to showing an empty cost tracker.'
  );
  if (!ok) return;
  s.writer = ''; s.writerName = '';
  bbSettingsWriteCache();
  if (typeof bbSettingsSave === 'function') bbSettingsSave();
  if (typeof renderSettingsPanel === 'function') renderSettingsPanel();
}

// "Save it now" — the button, so the result reaches the screen. Calling
// ctSyncPushNow directly from an onclick left the panel showing whatever it
// showed before, which is how a working save looked like a failed one.
function ctSyncSaveNow() {
  ctSyncPushNow().then(ok => {
    if (typeof notify === 'function') {
      notify(ok ? 'Cost tracker saved to the sheet' : 'Cost tracker was NOT saved', !ok);
    }
    if (typeof renderSettingsPanel === 'function') renderSettingsPanel();
  });
}

// Is the backup really there? Asks the sheet rather than the settings, and
// says what it found in the words someone would use to check.
function ctSyncCheck() {
  ctSyncPeek().then(st => {
    if (typeof renderSettingsPanel === 'function') renderSettingsPanel();
    if (typeof notify !== 'function') return;
    if (!st) {
      notify(ctSyncState.error
        ? 'Could not read the sheet — ' + ctSyncState.error
        : 'Nothing saved in the sheet yet', true);
      return;
    }
    notify(`${st.rows} invoices in the sheet, saved ${new Date(st.at).toLocaleString()}`);
  });
}
