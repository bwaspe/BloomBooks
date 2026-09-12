// What survives a trip to the sheet and back.
//
// The figures for the year-on-year comparison were typed in, saved, and gone
// on the next refresh. They were written to localStorage correctly; the sheet
// then loaded over the top of them, and the sheet had never been told about
// them. The metadata cell was built from a hand-kept list of keys, so adding a
// setting to appData and forgetting to add it there lost the setting -- with no
// error, and only after a reload. It had already happened to salesSheets,
// deferrals, holidayBuy and monthClose; each fix added a warning comment to the
// list and left the trap in place.
//
// So this suite runs the REAL push and the REAL load against a fake sheet --
// only fetch is stubbed -- and asserts that a key nobody has heard of comes
// back. Re-implementing either side here would prove nothing about the app.
const F = require('./fixtures');
const vm = require('vm');

const sb = F.sandbox({
  setTimeout, clearTimeout,
  sessionStorage: { store: {}, getItem(k) { return this.store[k] || null; },
                    setItem(k, v) { this.store[k] = v; },
                    removeItem(k) { delete this.store[k]; } }
});

// One cell range -> one array of rows, which is all a Google sheet is here.
const SHEET = { rows: null, puts: 0 };
sb.fetch = async (url, opts) => {
  const ok = body => ({ ok: true, status: 200, json: async () => body, text: async () => '' });
  if (opts && opts.method === 'PUT') {
    SHEET.rows = JSON.parse(opts.body).values;
    SHEET.puts++;
    return ok({});
  }
  if (/VaultTotals/.test(url)) return ok({ values: [] });
  const rows = SHEET.rows || [];
  // A1:A20 asks for column A alone; A1:C200 for all three. Google returns
  // each row trimmed to the columns requested, and trailing empties dropped.
  const cols = /!A1%3AA/.test(url) || /!A1:A/.test(url) ? 1 : 3;
  return ok({ values: rows.map(r => r.slice(0, cols)) });
};

let out = null;
sb.__OUT__ = o => { out = o; };
sb.__SHEET__ = SHEET;

const done = vm.runInNewContext(F.src(['config.js', 'utils.js', 'sync.js']) + `
;(async function(){
  updateYearSelects = function () {};
  renderMonthTabs = function () {};
  accessToken = 'test-token';

  appData = {
    years: [2025, 2026], activeYear: 2026,
    transactions: { '2026-8': [{ id: 1, date: '2026-09-11', desc: 'Delaware Valley',
                                 category: 'COGS', vendor: 'DV', amount: 230.29, type: 'out' }] },
    dailySales: { '2026-8': { '11': { counter: { s: 1234.56 } } } },
    notes: { '2026-8': 'a note' },
    rules: [{ keyword: 'VALLEY BANK', sign: 'out', category: 'Loan Repayment', vendor: 'Valley Bank' }],
    // The setting that was being lost.
    // Both halves, and a year part-entered: the tax figure comes off the
    // ledger, the processor's fees come off a Stripe payout summary, and they
    // arrive weeks apart. A year holding only one of them must keep it.
    basisAdjust: { 2023: { tax: 7903.11, fees: 4120.88 },
                   2024: { tax: 24787.55, fees: 11903.42 },
                   2025: { tax: 26094.39 } },
    // And a stand-in for the NEXT one somebody adds. Nothing in sync.js
    // mentions this key by name; if it comes back, the rule holds generally.
    __futureSetting: { deep: { value: 42 } },
    _savedAt: 1000
  };

  await pushToSheet();

  // Read now, not at the end: the last section of this suite rewrites the
  // cell to stand in for an older sheet.
  var metaCell  = JSON.parse(__SHEET__.rows[0][0]);
  var metaKeys  = Object.keys(metaCell).sort();
  var metaChars = __SHEET__.rows[0][0].length;
  var metaBulk  = ('transactions' in metaCell) || ('dailySales' in metaCell);
  var monthRows = __SHEET__.rows.length - 1;

  // Load into a clean slate. No localStorage, so the sheet wins outright --
  // which is the situation on a refresh, since a save stamps both copies with
  // the same _savedAt and the tie goes to the sheet.
  appData = {};
  await loadFromSheet();
  var back = appData;

  // And separately: a sheet written before a container existed must not crash
  // the first thing that writes into it.
  var older = JSON.parse(__SHEET__.rows[0][0]);
  delete older.notes; delete older.reconciled; delete older.rules;
  __SHEET__.rows[0][0] = JSON.stringify(older);
  var after = null;
  appData = {};
  await loadFromSheet();
  try {
    appData.notes['2026-8'] = 'written into a container the sheet never had';
    appData.rules.push({ keyword: 'x' });
    after = { notes: appData.notes['2026-8'], rules: appData.rules.length,
              reconciled: typeof appData.reconciled, threw: false };
  } catch (e) { after = { threw: true, msg: e.message }; }

  __OUT__({
    puts: __SHEET__.puts,
    metaKeys: metaKeys,
    metaHasBulk: metaBulk,
    metaCellChars: metaChars,
    monthRowCount: monthRows,
    back: {
      basisAdjust: JSON.stringify(back.basisAdjust),
      fees2023: (back.basisAdjust[2023] || {}).fees,
      fees2025: (back.basisAdjust[2025] || {}).fees,
      future: JSON.stringify(back.__futureSetting),
      rules: (back.rules || []).length,
      notes: (back.notes || {})['2026-8'],
      years: JSON.stringify(back.years),
      txAmount: ((back.transactions || {})['2026-8'] || [{}])[0].amount,
      daily: (((back.dailySales || {})['2026-8'] || {})['11'] || {}).counter,
      activeYear: back.activeYear
    },
    olderSheet: after
  });
})();`, sb, { filename: 'bb.js' });

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };

done.then(() => {
  const o = out;

  console.log('what goes up');
  t('the metadata cell carries neither bulk collection',
    o.metaHasBulk === false,
    o.metaCellChars + ' chars, well inside the 50,000 limit');
  t('  because the load side tells the two sheet formats apart by exactly that',
    o.metaHasBulk === false);
  t('the transactions and daily figures ride in the month rows instead',
    o.monthRowCount === 24, o.monthRowCount + ' rows for two years');
  console.log('      (metadata keys: ' + o.metaKeys.join(', ') + ')');

  console.log('\nand what comes back');
  t('the year-comparison figures — the ones that were being lost',
    o.back.basisAdjust === '{"2023":{"tax":7903.11,"fees":4120.88},' +
      '"2024":{"tax":24787.55,"fees":11903.42},"2025":{"tax":26094.39}}',
    o.back.basisAdjust);
  t('  both halves of each year, and a year still missing its fees',
    o.back.fees2023 === 4120.88 && o.back.fees2025 === undefined,
    '2023 fees $' + o.back.fees2023 + ', 2025 fees not yet entered');
  t('a key sync.js has never heard of, which is the general rule',
    o.back.future === '{"deep":{"value":42}}', o.back.future);
  t('the settings that were lost one at a time before it: rules, notes, years',
    o.back.rules === 1 && o.back.notes === 'a note' && o.back.years === '[2025,2026]',
    o.back.rules + ' rule, note "' + o.back.notes + '", years ' + o.back.years);
  t('and the bulk collections arrive from their own columns',
    o.back.txAmount === 230.29 && o.back.daily && o.back.daily.s === 1234.56,
    '$' + o.back.txAmount + ' out, $' + (o.back.daily || {}).s + ' counter');
  console.log('      (one push, one load: ' + o.puts + ' PUT)');

  console.log('\nand a sheet written before a container existed');
  t('does not crash the first thing that writes into it',
    o.olderSheet.threw === false,
    o.olderSheet.threw ? o.olderSheet.msg : 'notes and rules were writable');
  t('  the missing containers come back empty rather than absent',
    o.olderSheet.reconciled === 'object' && o.olderSheet.rules === 1,
    'reconciled is an ' + o.olderSheet.reconciled);

  console.log(fail.length ? '\n' + fail.length + ' FAILURES:\n' + fail.join('\n') : '\nall assertions passed');
  process.exit(fail.length ? 1 : 0);
}).catch(e => { console.log('  FAIL  suite threw: ' + e.message); process.exit(1); });
