// The scanner's supplier list, now read from the Settings tab.
//
// The argument worth pinning is the FALLBACK. A scanner that reads no mail
// fails silently -- no error, no invoices, and nobody notices for weeks -- so
// a settings cell that cannot be read must leave it reading the list in the
// code, not stop it. Everything else here is the shape mapping.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function script(settingsCell, opts) {
  opts = opts || {};
  const logged = [];
  const sb = {
    JSON, String, Array, Number, Object, Date, Math, isNaN,
    Logger: { log: m => logged.push(String(m)) },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (k === 'SHEET_ID' ? (opts.sheetId === undefined ? 'SHEETID' : opts.sheetId) : null),
        setProperty: () => {}
      })
    },
    SpreadsheetApp: {
      openById: () => {
        if (opts.openThrows) throw new Error('no access');
        return {
          getSheetByName: name => {
            if (name !== 'Settings' || opts.noTab) return null;
            return {
              getLastRow: () => (settingsCell === undefined ? 0 : 1),
              getRange: () => ({ getValue: () => settingsCell })
            };
          }
        };
      }
    },
    GmailApp: {}, UrlFetchApp: {}, Utilities: {}, DriveApp: {}, ScriptApp: {},
    ContentService: {}, HtmlService: {}, CacheService: {}, Session: {}
  };
  vm.createContext(sb);
  const src = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
  vm.runInContext(src, sb, { filename: 'Code.gs' });
  // const declarations live in the context lexical scope, not on the sandbox.
  const builtIn = vm.runInContext('VENDORS', sb);
  return { sb, logged, builtIn };
}

const cell = obj => JSON.stringify(obj);
const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };

console.log('a list that cannot be read falls back to the code');
{
  const noTab = script(undefined, { noTab: true });
  t('no Settings tab yet — the built-in list is used',
    noTab.sb.getVendors() === noTab.builtIn);

  const empty = script('');
  t('an empty cell falls back too', empty.sb.getVendors() === empty.builtIn);

  const junk = script('{ this is not json');
  t('a mangled cell falls back rather than throwing',
    junk.sb.getVendors() === junk.builtIn);
  t('and says so in the log, so it is diagnosable',
    junk.logged.some(m => /using the built-in vendor list/.test(m)));

  const noVendors = script(cell({ schemaVersion: 1, categories: {} }));
  t('settings with no vendors key at all falls back',
    noVendors.sb.getVendors() === noVendors.builtIn);

  const emptyList = script(cell({ vendors: [] }));
  t('an EMPTY list falls back — a shop with no suppliers is a mistake, not a setting',
    emptyList.sb.getVendors() === emptyList.builtIn);

  const allOff = script(cell({ vendors: [{ name: 'X', email: 'x@y.com', active: false }] }));
  t('every row switched off falls back for the same reason',
    allOff.sb.getVendors() === allOff.builtIn);

  const noId = script(cell({ vendors: [] }), { sheetId: null });
  t('no SHEET_ID configured falls back', noId.sb.getVendors() === noId.builtIn);

  const denied = script(cell({ vendors: [] }), { openThrows: true });
  t('and a sheet it cannot open falls back', denied.sb.getVendors() === denied.builtIn);
}

console.log('\nthe list the panel writes is what the scanner reads');
{
  const a = script(cell({ vendors: [
    { name: 'Fall River', email: 'sales@fallriver.com', label: '', mode: 'pdf',
      skipSubjects: ['order confirmation*'], active: true },
    { name: 'Perri Farms', email: '', label: 'BloomBooks/Scanned/Perri', mode: 'body', active: true },
    { name: 'Stood down', email: 'old@supplier.com', mode: 'pdf', active: false },
    { name: '', email: 'half@typed.com', mode: 'pdf', active: true },
    { name: 'No source yet', email: '', label: '', mode: 'pdf', active: true }
  ] }));
  const v = a.sb.getVendors();

  t('only the usable, switched-on rows are read', v.length === 2, v.length);
  t('a sender becomes email', v[0].email === 'sales@fallriver.com' && !v[0].label);
  t('its skip subjects come across', v[0].skipSubjects.join('|') === 'order confirmation*');
  t('a Gmail label becomes label, with no email',
    v[1].label === 'BloomBooks/Scanned/Perri' && !v[1].email);
  t('body mode survives', v[1].mode === 'body');

  // A supplier stood down has to actually stop being read -- the sheet list
  // REPLACES the built-in one rather than being merged with it, or removing a
  // supplier would never take.
  t('a row switched off is gone, not merged back in from the code',
    !v.some(x => x.name === 'Stood down'));
  t('and so is every supplier in the built-in list that is not in the sheet',
    !v.some(x => x.name === 'Juliet Wholesale'));

  // A half-filled row is somebody mid-typing. Read, it would search Gmail for
  // everything or for nothing.
  t('a row with no name is skipped', !v.some(x => x.email === 'half@typed.com'));
  t('a row with no sender and no label is skipped',
    !v.some(x => x.name === 'No source yet'));
}

console.log('\nthe LAST_RUN key still follows the source, not the name');
{
  // Two vendors can share a name (Perri by mail and Perri by scan); keying the
  // last-run marker on the name would make one of them skip the other's mail.
  const a = script(cell({ vendors: [
    { name: 'Perri Farms', email: 'sales@perrifarms.com', mode: 'body', active: true },
    { name: 'Perri Farms', email: '', label: 'BloomBooks/Scanned/Perri', mode: 'pdf', active: true }
  ] }));
  const v = a.sb.getVendors();
  t('two rows can share a name', v.length === 2);
  t('and they key differently',
    a.sb.vendorKey(v[0]) !== a.sb.vendorKey(v[1]),
    a.sb.vendorKey(v[0]) + ' vs ' + a.sb.vendorKey(v[1]));
}

console.log('\nmode is never trusted as typed');
{
  const a = script(cell({ vendors: [
    { name: 'A', email: 'a@b.com', mode: 'BODY', active: true },
    { name: 'B', email: 'b@b.com', mode: 'attachment', active: true },
    { name: 'C', email: 'c@b.com', active: true }
  ] }));
  const v = a.sb.getVendors();
  // 'body' exactly, or an attachment. Anything else reading as 'body' would
  // send the email text to Claude for a supplier whose invoice is a PDF.
  t('a mode that is not exactly body reads as an attachment',
    v[0].mode === 'pdf' && v[1].mode === 'pdf' && v[2].mode === 'pdf',
    v.map(x => x.mode).join(','));
}

console.log(fail.length ? '\n' + fail.length + ' FAILED' : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
