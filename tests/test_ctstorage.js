// The cost tracker lives in localStorage and nowhere else — sync.js sends
// appData to the Sheet, never ctData. Both ctSave and ctLoad used to end in
// `catch(e) {}`, so a full quota lost a save in silence and a damaged value
// lost the whole tracker in silence. On the owner's phone the cost tracker
// "sometimes loads empty while the rest of the app loads fine", and the real
// reason was none of those: that browser simply never had the data.
//
// Each of the four states has to say which it is, and the damaged one must not
// be overwritten by the next save.
const F = require('./fixtures');
const vm = require('vm');

function app(store, opts) {
  const els = { 'ct-storage-warning': { innerHTML: '' } };
  const sb = F.sandbox({ setTimeout: () => 0 });
  sb.document.getElementById = id => els[id] || null;
  const notes = [];
  sb.notify = (msg, bad) => notes.push({ msg, bad });
  sb.localStorage = {
    store: Object.assign({}, store),
    getItem(k) {
      if (opts && opts.readThrows) throw new Error('SecurityError');
      return Object.prototype.hasOwnProperty.call(this.store, k) ? this.store[k] : null;
    },
    setItem(k, v) {
      if (opts && opts.writeThrows) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
      this.store[k] = v;
    }
  };
  vm.createContext(sb);
  vm.runInContext(F.src(['config.js', 'utils.js', 'ledger.js', 'cost-tracker.js']), sb, { filename: 'bb.js' });
  vm.runInContext('appData = { years: [2026], activeYear: 2026, transactions: {}, rules: [], dailySales: {} };', sb);
  return { sb, els, notes, store: sb.localStorage.store };
}

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };
const good = JSON.stringify({ invoices: [{ id: 'i1', supplier: 'Perri Farms', date: '2026-09-01', total: 10, items: [] }] });

console.log('a browser that has the data');
{
  const a = app({ bb_ctdata: good });
  a.sb.ctLoad();
  a.sb.renderCtStorageWarning();
  t('loads it', vm.runInContext('ctData.invoices.length', a.sb) === 1);
  t('and says nothing', a.els['ct-storage-warning'].innerHTML === '');
}

console.log('\na browser that has never had it — the phone');
{
  const a = app({});
  a.sb.ctLoad();
  a.sb.renderCtStorageWarning();
  const html = a.els['ct-storage-warning'].innerHTML;
  t('says the data is not in this browser', /No cost tracker data in this browser/.test(html));
  t('and explains that signing in will not bring it', /Nothing is keeping them in the Google Sheet/.test(html));
  t('and points at where to switch that on', /Settings/.test(html));
  t('and points at the way back', /Import JSON/.test(html));
}

console.log('\nstorage that refuses to be written');
{
  const a = app({ bb_ctdata: good }, { writeThrows: true });
  a.sb.ctLoad();
  const ok = a.sb.ctSave();
  a.sb.renderCtStorageWarning();
  const html = a.els['ct-storage-warning'].innerHTML;
  t('ctSave reports the failure rather than returning quietly', ok === false);
  t('the banner says nothing is being saved', /Nothing you change here is being saved/.test(html));
  t('and names the reason', /QuotaExceededError/.test(html), html.slice(0, 0));
  t('and a toast fires too, marked as bad', a.notes.some(n => n.bad && /could NOT be saved/i.test(n.msg)));
}

console.log('\nstorage that refuses to be read');
{
  const a = app({ bb_ctdata: good }, { readThrows: true });
  a.sb.ctLoad();
  a.sb.renderCtStorageWarning();
  t('says it cannot see the data, not that there is none',
    /could not be read/i.test(a.els['ct-storage-warning'].innerHTML));
  t('and does not claim anything was lost', /Nothing has been lost/.test(a.els['ct-storage-warning'].innerHTML));
}

console.log('\na damaged copy');
{
  const broken = '{"invoices":[{"id":"i1",';   // truncated, as a half-finished write leaves it
  const a = app({ bb_ctdata: broken });
  a.sb.ctLoad();
  a.sb.renderCtStorageWarning();
  const html = a.els['ct-storage-warning'].innerHTML;
  t('says the stored copy is damaged', /stored cost tracker is damaged/i.test(html));
  t('keeps the damaged copy before anything overwrites it',
    a.store['bb_ctdata_unreadable'] === broken);
  t('and says where it went', /bb_ctdata_unreadable/.test(html));

  // The dangerous sequence: a save after a failed load would replace 286KB of
  // invoices with an empty object. The kept copy is what makes that survivable.
  a.sb.ctSave();
  t('a later save cannot destroy the kept copy', a.store['bb_ctdata_unreadable'] === broken);
  t('even though the live value is now the empty default',
    JSON.parse(a.store['bb_ctdata']).invoices.length === 0);
}

console.log('\nrecovering');
{
  const a = app({ bb_ctdata: good }, { writeThrows: true });
  a.sb.ctLoad();
  a.sb.ctSave();
  t('the failure is recorded', /Nothing you change/.test(a.sb.ctStorageWarningHtml()));
  // Storage comes back — a private window closed, space freed.
  a.sb.localStorage.setItem = function (k, v) { this.store[k] = v; };
  a.sb.ctSave();
  t('and clears once a save works again', a.sb.ctStorageWarningHtml() === '');
}

console.log(fail.length ? '\n' + fail.length + ' FAILURES:\n' + fail.join('\n') : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
