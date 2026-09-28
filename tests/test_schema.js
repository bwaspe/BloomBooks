// Which version wrote this.
//
// The settings have carried a schemaVersion and a migration chain since they
// were built. The book and the cost tracker carried nothing, so there was no
// record of which version of the app wrote what is stored -- and no protection
// in the direction nobody plans for.
//
// FORWARD is the ordinary case: old data brought up to date by a step written
// once and never edited. BACKWARD is the dangerous one. The office machine
// updates and writes a new shape to the sheet; a phone still running the old
// app through its service worker reads it, silently drops the field it does
// not know, and writes the rest back. The newer data is gone and nothing said
// a word.
const F = require('./fixtures');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.join(__dirname, '..');

function app(opts) {
  opts = opts || {};
  const els = { 'bb-schema-warning': { innerHTML: '' }, 'ct-storage-warning': { innerHTML: '' } };
  const sb = F.sandbox({ setTimeout: () => 0, clearTimeout: () => {} });
  sb.document.getElementById = id => els[id] || null;
  const notes = [];
  sb.notify = (m, bad) => notes.push({ m, bad });
  const store = Object.assign({ bb_device_id: 'office' }, opts.store);
  sb.localStorage = {
    store,
    getItem(k) { return Object.prototype.hasOwnProperty.call(this.store, k) ? this.store[k] : null; },
    setItem(k, v) { this.store[k] = v; }, removeItem(k) { delete this.store[k]; }
  };
  sb.fetchRetry = async () => ({ ok: false, status: 404, text: async () => '' });
  vm.createContext(sb);
  const preamble = `var SHEET_ID = 'X'; var SHEET_TAB = 'B'; var accessToken = null;
    var SHEETS_BASE = ''; function sheetRange(t, a) { return t + '!' + a; }
    var APPDATA_CONTAINERS = { transactions: 'object', rules: 'array', years: 'array' };
`;
  vm.runInContext(preamble + F.src(['config.js', 'utils.js', 'schema.js', 'audit.js', 'ledger.js',
                                    'cost-tracker.js', 'settings.js', 'ct-sync.js', 'ct-history.js']),
                  sb, { filename: 'bb.js' });
  vm.runInContext(`appData = { years: [2026], activeYear: 2026, transactions: {}, rules: [], dailySales: {} };`, sb);
  return { sb, els, notes, store };
}

const get = (a, e) => vm.runInContext(e, a.sb);
const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };

console.log('data written before any of this existed');
{
  const a = app();
  const book = a.sb.schemaMigrate({ years: [2026], transactions: {} }, 'book');
  t('is stamped with the current version', book.schemaVersion === 1, book.schemaVersion);
  t('and nothing else about it changes', JSON.stringify(book.years) === '[2026]');
  t('nothing is blocked', a.sb.schemaBlocked() === false);

  // Everything stored today is v1 by definition: it is the shape the app reads.
  const ct = a.sb.schemaMigrate({ invoices: [{ id: 'i1' }] }, 'ct');
  t('the cost tracker the same', ct.schemaVersion === 1 && ct.invoices.length === 1);
}

console.log('\ndata from a NEWER app is shown but never written over');
{
  // The office machine updates and saves; this device has not caught up.
  const a = app();
  const newer = a.sb.schemaMigrate({ years: [2026], schemaVersion: 99, somethingNew: 'keep me' }, 'book');
  t('it is blocked', a.sb.schemaBlocked() === true);
  t('the version it was written as is left alone, not downgraded',
    newer.schemaVersion === 99, newer.schemaVersion);
  t('and what this app does not understand is still there',
    newer.somethingNew === 'keep me');

  // Shown, because hiding it would look like the data had gone.
  const html = a.sb.schemaWarningHtml();
  t('it says which store', /this book/i.test(html), html.slice(0, 80));
  t('and both version numbers', /version 99/.test(html) && /version 1/.test(html));
  t('and offers the way out', /schemaReload/.test(html));
}

console.log('\nand the save is refused, which is the whole point');
{
  const a = app();
  a.sb.schemaMigrate({ schemaVersion: 99 }, 'book');
  vm.runInContext(`ctData = { invoices: [], catalog: {}, retail: {}, markup: {} };`, a.sb);

  t('the cost tracker will not save', a.sb.ctSave() === false);
  t('and says why, in words', a.notes.some(n => n.bad && /older BloomBooks/.test(n.m)),
    JSON.stringify(a.notes.map(n => n.m)));
  t('nothing was written to the browser', !a.store.bb_ctdata);

  // The banner has to reach every screen, not only the one it was noticed on.
  a.sb.renderSchemaWarning();
  t('the warning is rendered where every screen can see it',
    /newer version of BloomBooks/.test(a.els['bb-schema-warning'].innerHTML));
}

console.log('\nand it unblocks once the device catches up');
{
  const a = app();
  a.sb.schemaMigrate({ schemaVersion: 99 }, 'book');
  t('blocked to begin with', a.sb.schemaBlocked() === true);
  // What a reload does: the same store read again by an app that now knows it.
  a.sb.schemaMigrate({ schemaVersion: 1 }, 'book');
  t('a store it understands clears the block', a.sb.schemaBlocked() === false);
  t('and the warning goes with it', a.sb.schemaWarningHtml() === '');
}

console.log('\na migration that throws leaves the data alone');
{
  // Half-migrated is the one state nothing downstream is written for, so a
  // failed step stops rather than carrying on through the rest of the chain.
  const a = app();
  vm.runInContext(`BOOK_MIGRATIONS[0] = function () { throw new Error('boom'); };`, a.sb);
  let threw = false;
  let out;
  try { out = a.sb.schemaMigrate({ years: [2026], transactions: {} }, 'book'); }
  catch (e) { threw = true; }
  t('it does not throw at the caller', !threw);
  t('the book is still there', out && JSON.stringify(out.years) === '[2026]');
  t('and the failure is recorded rather than swallowed',
    (get(a, 'window.BB_ERRORS') || []).some(e => /Migration book/.test(e.message)) ||
    typeof get(a, 'typeof bbNoteError') === 'string');
}

console.log('\nthe steps themselves');
{
  const src = fs.readFileSync(path.join(REPO, 'schema.js'), 'utf8');
  const a = app();
  // The version IS the number of steps, so declaring one without writing it is
  // not a mistake that can be made.
  t('the version is read off the steps',
    a.sb.schemaTargetFor('book') === get(a, 'BOOK_MIGRATIONS.length'),
    a.sb.schemaTargetFor('book'));
  t('and the rule against editing a shipped one is written down',
    /NEVER EDIT A SHIPPED STEP/.test(src));

  // A second step, so the CHAIN can be exercised at all — with only one,
  // stopping and carrying on look identical.
  const b = app();
  vm.runInContext("BOOK_MIGRATIONS.push(function v1_to_v2(d) { d.two = true; return d; });", b.sb);
  const up = b.sb.schemaMigrate({ years: [2026] }, 'book');
  t('an old store is walked all the way up', up.schemaVersion === 2 && up.two === true,
    up.schemaVersion + ' / ' + up.two);

  // A step that throws stops the chain, rather than running the rest against
  // data that was never brought up to meet them.
  const c = app();
  vm.runInContext("BOOK_MIGRATIONS[0] = function () { throw new Error('boom'); };", c.sb);
  vm.runInContext("BOOK_MIGRATIONS.push(function v1_to_v2(d) { d.ranAnyway = true; return d; });", c.sb);
  const half = c.sb.schemaMigrate({ years: [2026] }, 'book');
  t('a failed step stops the ones after it', !half.ranAnyway, JSON.stringify(half));
  // Stamping the target after a failure would make the next load skip the
  // migration entirely, and the data would stay half-moved for ever.
  t('and it is not stamped as done', half.schemaVersion === 0, half.schemaVersion);
  t('so the next load tries again', c.sb.schemaMigrate(half, 'book').schemaVersion === 0);
  t('meanwhile nothing may be written', c.sb.schemaBlocked() === true);
  t('and it says so in its own words, not the newer-version ones',
    /could not be brought up to date/.test(c.sb.schemaWarningHtml()));
}

console.log('\nevery way the book is loaded goes through it');
{
  // normalizeAppData is the one choke point -- local, sheet, restored backup.
  const sync = fs.readFileSync(path.join(REPO, 'sync.js'), 'utf8');
  const inNormalize = /function normalizeAppData[^]{0,400}schemaMigrate/.test(sync);
  t('normalizeAppData migrates', inNormalize);
  t('and saveData refuses when blocked',
    /function saveData[^]{0,400}schemaBlocked/.test(sync));

  const ct = fs.readFileSync(path.join(REPO, 'cost-tracker.js'), 'utf8');
  t('ctLoad migrates what came out of the browser',
    /function ctLoad[^]{0,1200}schemaMigrate/.test(ct));
  const ctsync = fs.readFileSync(path.join(REPO, 'ct-sync.js'), 'utf8');
  t('and ctSyncStart migrates what came back from the sheet',
    /schemaMigrate\(\{ \.\.\.ctData, \.\.\.data \}, 'ct'\)/.test(ctsync));
}

console.log(fail.length ? '\n' + fail.length + ' FAILED' : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
