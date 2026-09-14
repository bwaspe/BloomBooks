// ============================================================
// PERIOD LOCK
// ============================================================
// 2023, 2024 and 2025 are filed. Until now nothing enforced that: a stray edit,
// a re-file, an import that reached back a few days, and a filed year moved
// without anyone meaning it to.
//
// The lock is one guard at the point everything passes through -- saveData --
// rather than a check on each button. There are more than a dozen paths that
// write a year's rows or its day book, and a guard bolted onto each would miss
// the next one written. So each closed year keeps a fingerprint of how it was
// last accepted, and a save that finds the fingerprint changed puts that year
// back and says so. Whatever did the writing, the filed figures stand.
//
// What it covers: the ledger rows and the day book of a closed year. What it
// deliberately does not: the like-for-like basis figures, notes, reconciliation
// ticks and the like -- none of them alters a filed figure.
//
// Unlocking lasts for the session and is never saved. Reloading closes the
// year again, so a year cannot be left open by forgetting to shut it, and
// unlocking on one computer opens nothing on another.

const LOCK_DEFAULT_YEARS = [2023, 2024, 2025];   // the owner's filed years, 2026-09-12

let lockBaselines = {};        // { year: { fp, tx, ds } } -- the year as last accepted
let lockSessionOpen = {};      // { year: true } -- unlocked for this session only

function lockedYears() {
  return (typeof appData !== 'undefined' && appData && Array.isArray(appData.lockedYears)) ? appData.lockedYears : [];
}
function isYearClosed(yr) { return lockedYears().indexOf(+yr) >= 0; }
function isYearLocked(yr) { return isYearClosed(yr) && !lockSessionOpen[+yr]; }

// Key order and row order carry no meaning, so neither may count as a change:
// a row rewritten with its fields in a different order, or a month's list
// re-sorted, must not read as someone editing a filed year.
function lockCanon(v) {
  if (Array.isArray(v)) return '[' + v.map(lockCanon).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + lockCanon(v[k])).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}

// One year's data, as the lock sees it. Vault rows are left out: they are
// generated from the historical totals on every load, not entered by anyone.
function lockYearData(d, yr) {
  const tx = {}, ds = {};
  for (let m = 0; m < 12; m++) {
    const k = yr + '-' + m;
    const rows = (((d && d.transactions) || {})[k] || []).filter(t => t && !t._vault);
    if (rows.length) tx[k] = rows;
    const day = ((d && d.dailySales) || {})[k];
    if (day && Object.keys(day).length) ds[k] = day;
  }
  return { tx, ds };
}
function lockFingerprint(d, yr) {
  const y = lockYearData(d, yr);
  const tx = Object.keys(y.tx).sort().map(k => k + '=' + y.tx[k].map(lockCanon).sort().join('|'));
  const ds = Object.keys(y.ds).sort().map(k => k + '=' + lockCanon(y.ds[k]));
  return tx.join(';') + '#' + ds.join(';');
}

function lockTakeBaseline(d, yr) {
  const y = lockYearData(d, yr);
  const raw = JSON.stringify(y);
  lockBaselines[yr] = { raw, fp: lockFingerprint(d, yr), tx: JSON.parse(JSON.stringify(y.tx)), ds: JSON.parse(JSON.stringify(y.ds)) };
}

// Runs on every save, including each day-book entry, so the common case --
// nothing in a closed year touched -- is a single plain comparison. Only when
// that differs is the order-blind fingerprint worked out, to tell a real edit
// from a re-sort; and a re-sort then becomes the new plain copy so the next
// save is fast again.
function lockYearChanged(yr) {
  const base = lockBaselines[yr];
  const raw = JSON.stringify(lockYearData(appData, yr));
  if (raw === base.raw) return false;
  if (lockFingerprint(appData, yr) === base.fp) { base.raw = raw; return false; }
  return true;
}

// Called by normalizeAppData whenever the book is replaced -- a load from the
// browser, a load from the sheet, an imported backup. Whatever arrives that way
// is the accepted state; restoring a backup is a deliberate act, not an edit.
function lockOnLoad(d) {
  if (!d || typeof d !== 'object') return;
  // Seed the filed years once. An empty list is a choice and is kept.
  if (!Array.isArray(d.lockedYears)) d.lockedYears = LOCK_DEFAULT_YEARS.slice();
  lockBaselines = {};
  d.lockedYears.forEach(yr => lockTakeBaseline(d, yr));
}

// Put a closed year back as it was last accepted. Rows that moved OUT of it
// into an open year are taken back out of there too, or restoring would leave
// them in both.
function lockRestore(yr) {
  const base = lockBaselines[yr];
  if (!base) return;
  const ids = {};
  Object.values(base.tx).forEach(rows => rows.forEach(t => { if (t.id) ids[t.id] = true; }));
  Object.keys(appData.transactions || {}).forEach(k => {
    if (+k.split('-')[0] === +yr) return;
    const rows = appData.transactions[k] || [];
    if (rows.some(t => t.id && ids[t.id])) appData.transactions[k] = rows.filter(t => !(t.id && ids[t.id]));
  });
  for (let m = 0; m < 12; m++) {
    const k = yr + '-' + m;
    const vault = ((appData.transactions || {})[k] || []).filter(t => t && t._vault);
    const real = JSON.parse(JSON.stringify(base.tx[k] || []));
    if (vault.length || real.length || appData.transactions[k]) appData.transactions[k] = vault.concat(real);
    if (!appData.dailySales) appData.dailySales = {};
    if (base.ds[k]) appData.dailySales[k] = JSON.parse(JSON.stringify(base.ds[k]));
    else delete appData.dailySales[k];
  }
}

// The guard. saveData calls this before anything is written anywhere.
// Returns the years it had to put back.
function lockGuard() {
  if (typeof appData === 'undefined' || !appData) return [];
  const refused = [];
  lockedYears().forEach(yr => {
    if (lockSessionOpen[yr] || !lockBaselines[yr]) return;
    if (lockYearChanged(yr)) { lockRestore(yr); refused.push(yr); }
  });
  if (refused.length) {
    const which = refused.join(' and ');
    notify(`${which} ${refused.length === 1 ? 'is' : 'are'} closed, so that change was not saved. ` +
           `Unlock the year from its month page or the Yearly Summary to edit it.`, true);
    // After the caller has finished, so the screen shows the year as it stands.
    if (typeof renderCurrentPanel === 'function') setTimeout(() => { try { renderCurrentPanel(); } catch (e) {} }, 0);
  }
  return refused;
}

function lockRefreshViews() {
  if (typeof renderCurrentPanel === 'function') { try { renderCurrentPanel(); } catch (e) {} }
}

function lockUnlockForSession(yr) {
  yr = +yr;
  if (!isYearLocked(yr)) return;
  if (!confirm(`Unlock ${yr} for this session?\n\n${yr} is filed, so change it only if you mean to. ` +
               `It locks again when you reload the page, or when you press Lock again.`)) return;
  lockSessionOpen[yr] = true;
  lockRefreshViews();
  notify(`${yr} is unlocked until you reload or lock it again`);
}

// Locking again accepts whatever was done while it was open.
function lockRelock(yr) {
  yr = +yr;
  if (!lockSessionOpen[yr]) return;
  delete lockSessionOpen[yr];
  lockTakeBaseline(appData, yr);
  lockRefreshViews();
  notify(`${yr} is locked again`);
}

function lockCloseYear(yr) {
  yr = +yr;
  if (isYearClosed(yr)) return;
  if (!confirm(`Close ${yr}?\n\nIts ledger and day book will refuse changes from now on. ` +
               `You can still unlock it for a session when you need to.`)) return;
  appData.lockedYears = lockedYears().concat([yr]).sort((a, b) => a - b);
  delete lockSessionOpen[yr];
  lockTakeBaseline(appData, yr);
  saveData();
  lockRefreshViews();
  notify(`${yr} is closed`);
}

// Only offered while a closed year is unlocked, so reopening one for good
// takes two deliberate steps.
function lockReopenYear(yr) {
  yr = +yr;
  if (!isYearClosed(yr)) return;
  if (!confirm(`Reopen ${yr} for good?\n\nIt will stay editable on every computer until you close it again.`)) return;
  appData.lockedYears = lockedYears().filter(y => y !== yr);
  delete lockSessionOpen[yr];
  delete lockBaselines[yr];
  saveData();
  lockRefreshViews();
  notify(`${yr} is open`);
}

function lockBannerHtml(yr) {
  yr = +yr;
  if (!isYearClosed(yr)) return '';
  if (isYearLocked(yr)) {
    return `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 14px;padding:9px 14px;
                 border-radius:8px;background:var(--paper);border:1px solid var(--border);font-size:0.8rem">
      <span>🔒 <strong>${yr} is closed.</strong> It was filed, so changes to it are not saved.</span>
      <button class="btn btn-outline btn-sm" onclick="lockUnlockForSession(${yr})">Unlock for this session</button>
    </div>`;
  }
  return `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 14px;padding:9px 14px;
               border-radius:8px;background:var(--paper);border:1px solid var(--gold, #c9a84c);font-size:0.8rem">
    <span>🔓 <strong>${yr} is unlocked for this session.</strong> Changes to it will save.</span>
    <button class="btn btn-primary btn-sm" onclick="lockRelock(${yr})">Lock again</button>
    <button class="btn btn-outline btn-sm" onclick="lockReopenYear(${yr})">Reopen for good</button>
  </div>`;
}

// The line on each Yearly Summary card. The card itself opens the year, so
// every button here stops that click.
function lockCardHtml(yr) {
  yr = +yr;
  const stop = 'event.stopPropagation();';
  if (!isYearClosed(yr)) {
    return `<div class="stat-row"><span style="color:var(--mist)">Open</span>
      <button class="btn btn-outline btn-xs" onclick="${stop}lockCloseYear(${yr})">Close year</button></div>`;
  }
  if (isYearLocked(yr)) {
    return `<div class="stat-row"><span>🔒 Closed</span>
      <button class="btn btn-outline btn-xs" onclick="${stop}lockUnlockForSession(${yr})">Unlock</button></div>`;
  }
  return `<div class="stat-row"><span>🔓 Unlocked this session</span>
    <button class="btn btn-primary btn-xs" onclick="${stop}lockRelock(${yr})">Lock again</button></div>`;
}
