// DATA.md against the code.
//
// A map that drifts is worse than no map, because it gets believed -- the same
// argument as the Logic Trainer box, which spent months explaining a rule that
// had been removed. So the two are held against each other: every storage key
// and sheet tab named in DATA.md has to exist in the code, and every one the
// code uses has to be named in DATA.md.
//
// The second direction is the one that matters. A new store added and never
// written down is exactly how the map stops being true, and it is invisible
// until somebody needs it.
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const doc = fs.readFileSync(path.join(REPO, 'DATA.md'), 'utf8');
const sources = fs.readdirSync(REPO).filter(f => /\.js$/.test(f));
const code = sources.map(f => fs.readFileSync(path.join(REPO, f), 'utf8')).join('\n') +
             '\n' + fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(REPO, 'apps-script', 'Code.gs'), 'utf8');

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };

// Keys as the code really uses them: the literal in a storage call, or the
// value of a *_KEY / *_CACHE constant.
const keysInCode = new Set();
[...code.matchAll(/(?:local|session)Storage\.(?:getItem|setItem|removeItem)\(\s*['"`]([A-Za-z0-9_]+)/g)]
  .forEach(m => keysInCode.add(m[1]));
[...code.matchAll(/^const\s+[A-Z_]*(?:KEY|CACHE|VERSION)[A-Z_]*\s*=\s*'([a-z][A-Za-z0-9_-]+)'/gm)]
  .forEach(m => keysInCode.add(m[1]));

// A prefix, so the code never names the whole key.
keysInCode.delete('bb_ds_');
keysInCode.add('bb_ds_*');

console.log('every store the code uses is on the map');
{
  t('the code really does use a pile of them', keysInCode.size >= 12, keysInCode.size);
  [...keysInCode].sort().forEach(k => {
    const onMap = doc.indexOf('`' + k + '`') >= 0;
    t('`' + k + '` is described in DATA.md', onMap,
      onMap ? undefined
            : (doc.indexOf(k) >= 0 ? 'mentioned, but not as a key in the table' : 'missing entirely'));
  });
}

console.log('\nand every store the map names is really used');
{
  // Pulled out of the storage table, so prose mentioning a key does not count.
  const table = doc.slice(doc.indexOf('## This browser'), doc.indexOf('## The three flows'));
  const named = [...table.matchAll(/^\| `([A-Za-z0-9_*\/ `]+)`/gm)]
    .flatMap(m => m[1].split(/`?\s*\/\s*`?/))
    .map(s => s.trim())
    .filter(Boolean);
  t('the table lists them', named.length >= 12, named.length);
  named.forEach(k => {
    t('`' + k + '` is a key the code uses', keysInCode.has(k),
      keysInCode.has(k) ? undefined : 'named in DATA.md but nothing uses it');
  });
}

console.log('\nthe book sheet tabs');
{
  ['BloomData', 'AuditLog', 'VaultTotals'].forEach(tab => {
    t(tab + ' is in the code', new RegExp("'" + tab + "'").test(code));
    t(tab + ' is on the map', doc.indexOf('`' + tab + '`') >= 0);
  });
  t('and saved versions are named by their prefix',
    /VERSION_PREFIX = 'Version /.test(code) && /`Version NNN`/.test(doc));
}

console.log('\nthe scanner sheet tabs');
{
  // Four of these only the Apps Script ever writes, so the app's own source
  // cannot be the place to check them.
  const appSide = ['Settings', 'CostTracker'];
  const scriptSide = ['Invoices', 'Skipped', 'Deliveries', 'Errors', 'Summary'];
  appSide.forEach(tab => {
    t(tab + ' is in the app', new RegExp("'" + tab + "'").test(code));
    t(tab + ' is on the map', doc.indexOf('`' + tab + '`') >= 0);
  });
  scriptSide.forEach(tab => {
    t(tab + ' is in the Apps Script', new RegExp("'" + tab + "'").test(script));
    t(tab + ' is on the map', doc.indexOf('`' + tab + '`') >= 0);
  });
}

console.log('\nthe claims that would quietly stop being true');
{
  // The indirection that was missing, and cost a day.
  t('the scanner address really is mirrored into the book',
    /appData\.gmailSheetId = mine/.test(code));
  t('and the map says so', /appData\.gmailSheetId/.test(doc));

  t('the book address really is a constant, so it is reachable from nothing',
    /^const SHEET_ID\s*=\s*'/m.test(code));
  t('and the map says so', /constant in `sync\.js`/.test(doc));

  // The one the map calls out as dead.
  t('nothing reads the Summary tab in the app',
    !/Summary/.test(code.replace(/ctPushWeeklySummary/g, '')) ||
    !/getSheetByName\('Summary'\)[^]{0,400}return/.test(script));
  t('and the map admits it', /the digest emailer was never written/i.test(doc));

  t('errors are not sent anywhere', !/bb_errors[^]{0,200}SHEETS_BASE/.test(code));
  t('and the map says that is deliberate',
    /`bb_errors`[^|]*\|[^|]*\|[^|]*deliberately/.test(doc));
}

console.log(fail.length ? '\n' + fail.length + ' FAILED' : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
