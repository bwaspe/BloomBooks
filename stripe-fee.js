// ============================================================
// THE STRIPE FEE, OFF THE BALANCE SUMMARY
// ============================================================
// Stripe nets its fee out of each deposit, so unlike EPX -- whose reader fee
// arrives as its own debit -- the cost appears NOWHERE in the bank. Once
// revenue is counted gross from the day book, that fee has to be entered by
// hand or it is simply missing from the books. Once a month, every month,
// retyped off a report.
//
// So the report is read instead. The parser is deliberately shape-tolerant and
// deliberately LOUD about what it found: Stripe's exports differ by account and
// change over time, and the lesson from the payouts importer is that a rigid
// matcher rejects a perfectly good file while a loose one silently grabs the
// wrong column. This one reports every label it saw, so a file it cannot read
// tells us what to fix rather than leaving us to guess.
//
// IT NEVER WRITES ON ITS OWN. It proposes a row and shows the figures; the
// ledger is money, and a parser's opinion about a third party's CSV is not
// grounds for writing into it unasked.
const SF_FEE_WORDS = /\b(fee|fees)\b/i;
const SF_DISPUTE_WORDS = /\b(dispute|disputes|chargeback|chargebacks)\b/i;
// Rows that merely MENTION fees while meaning something else. These are the
// figures that CONTAIN fees rather than being them -- taking one as the fee
// overstates the expense by two orders of magnitude, and it would look
// perfectly plausible sitting in the ledger.
//
// Deliberately narrow. 'total' is not here: "Total fees" is exactly the line
// wanted, and a row saying only "Total" never matches a fee word anyway, so
// excluding it cost the right answer and bought nothing.
const SF_NOT_FEE = /\b(gross|net|balance|payout|payouts)\b/i;

let sfFound = null;   // what the last upload read, awaiting confirmation

function sfMoney(v) {
  const n = parseFloat(String(v == null ? '' : v).replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1'));
  return Number.isFinite(n) ? n : null;
}

// A label column and an amount column, whatever they happen to be called.
// Picked by SHAPE rather than by name: the column with the most parseable
// numbers is the amount, the one with the most words is the label.
function sfColumns(rows) {
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  let amt = -1, amtScore = 0, lab = -1, labScore = 0;
  for (let c = 0; c < width; c++) {
    let nums = 0, words = 0;
    rows.slice(1).forEach(r => {
      const v = String(r[c] == null ? '' : r[c]).trim();
      if (!v) return;
      if (sfMoney(v) !== null) nums++;
      else if (/[a-z]{3}/i.test(v)) words++;
    });
    if (nums > amtScore) { amtScore = nums; amt = c; }
    if (words > labScore) { labScore = words; lab = c; }
  }
  return { amt, lab };
}

function sfParse(text) {
  const rows = (typeof parseDelimited === 'function')
    ? parseDelimited(text)
    : text.split(/\r?\n/).filter(Boolean).map(l => l.split(','));
  if (rows.length < 2) return { error: 'That file had no rows to read.' };

  const head = rows[0].map(h => String(h == null ? '' : h).trim().toLowerCase());

  // THE WRONG STRIPE REPORT, recognised and redirected. The itemized payout
  // reconciliation has a fee column too, so it would parse -- and give a fee on
  // a different basis: fees on transactions PAID OUT this month, which include
  // last month's late charges and exclude this month's. The books take revenue
  // from the day book by sale date, so the fee has to sit on activity. Sending
  // someone away with a plausible wrong number is worse than refusing.
  if (head.indexOf('automatic_payout_id') >= 0 || head.indexOf('balance_transaction_id') >= 0) {
    return { error: 'That is the itemized payout reconciliation, not the balance summary. ' +
                    'It is the right file for matching payouts — upload it on the Payouts screen. ' +
                    'For the fee, use Reports → Balance summary.' };
  }

  // THE BALANCE SUMMARY'S OWN KEYS. The report carries a `category` column of
  // machine names -- activity_fee, payouts_fee -- which is exact where prose is
  // a guess. Note the underscore: a word-boundary match on "fee" does NOT find
  // "activity_fee", because an underscore is a word character.
  const catCol = head.indexOf('category');
  const descCol = head.indexOf('description');

  // SOME EXPORTS PUT THE FEE IN ITS OWN COLUMN rather than on its own row --
  // one line per reporting category with gross, fee and net beside each other.
  // Picking the single "amount" column there reads the gross and finds no fee
  // at all. A column headed exactly fee or fees is unambiguous, so it wins.
  const feeCol = head.findIndex(h => /^fees?$/.test(h));

  const { amt, lab } = sfColumns(rows);
  if ((amt < 0 && feeCol < 0) || lab < 0) {
    return { error: 'No column of labels and amounts in that file — is it the balance summary?',
             seen: head.filter(Boolean).slice(0, 40) };
  }

  if (catCol >= 0 && amt >= 0) {
    let fees = 0, disputes = 0;
    const feeRows = [], disputeRows = [], seen = [];
    rows.slice(1).forEach(r => {
      const key = String(r[catCol] == null ? '' : r[catCol]).trim().toLowerCase();
      const v = sfMoney(r[amt]);
      if (!key || v === null) return;
      seen.push(key);
      if (!v) return;                                   // a zero line is not a cost
      const label = descCol >= 0 ? String(r[descCol] || '').trim() || key : key;
      if (/dispute|chargeback/.test(key)) { disputes += Math.abs(v); disputeRows.push(label); return; }
      // ENDS IN FEE, whether the column holds machine keys or prose:
      // activity_fee and payouts_fee in the real export, "Stripe fees" and
      // "Total fees" where it is written out. An underscore OR a space, since
      // a word boundary alone does not see one and a space alone misses the
      // other. Nothing that merely contains fees in the middle -- "Account
      // activity before fees" is the gross, not the fee.
      if (/(^|[_\s])fees?$/.test(key) && !/\b(before|excluding|excl|pre)\b/.test(key)) {
        fees += Math.abs(v); feeRows.push(label);
      }
    });
    if (fees || disputes) return { fees, disputes, feeRows, disputeRows, seen: seen.slice(0, 40) };
  }

  if (feeCol >= 0) {
    let fees = 0, disputes = 0;
    const feeRows = [], disputeRows = [], seen = [];
    rows.slice(1).forEach(r => {
      const label = String(r[lab] == null ? '' : r[lab]).trim();
      const v = sfMoney(r[feeCol]);
      if (v === null || !v) return;
      seen.push(label);
      if (SF_DISPUTE_WORDS.test(label)) { disputes += Math.abs(v); disputeRows.push(label); }
      else { fees += Math.abs(v); feeRows.push(label); }
    });
    if (fees || disputes) return { fees, disputes, feeRows, disputeRows, seen: seen.slice(0, 40) };
    // An all-zero fee column is not an answer; fall through and read the rows.
  }

  const seen = [];
  let fees = 0, disputes = 0, feeRows = [], disputeRows = [];
  rows.forEach((r, i) => {
    const label = String(r[lab] == null ? '' : r[lab]).trim();
    const value = sfMoney(r[amt]);
    if (!label || value === null) return;
    if (i === 0) return;                       // the header
    seen.push(label);
    // Stripe writes what it took as a negative. The books want a positive
    // expense, so the sign is dropped rather than carried through.
    const money = Math.abs(value);
    if (SF_DISPUTE_WORDS.test(label) && SF_FEE_WORDS.test(label)) {
      disputes += money; disputeRows.push(label); return;
    }
    if (SF_FEE_WORDS.test(label) && !SF_NOT_FEE.test(label)) {
      fees += money; feeRows.push(label); return;
    }
    if (SF_DISPUTE_WORDS.test(label) && !SF_NOT_FEE.test(label)) {
      disputes += money; disputeRows.push(label);
    }
  });

  if (!fees && !disputes) {
    return { error: 'Nothing in that file looked like a fee.', seen: seen.slice(0, 40) };
  }
  return { fees, disputes, feeRows, disputeRows, seen: seen.slice(0, 40) };
}

// The month the figures belong to, read off the file where possible. A summary
// uploaded on the 3rd belongs to the month it covers, not to today -- the same
// rule the EPX statement follows.
function sfPeriod(text) {
  const m = String(text).match(/(\d{4})-(\d{2})-\d{2}/);
  if (m) return { year: +m[1], month: +m[2] - 1 };
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return { year: prev.getFullYear(), month: prev.getMonth(), guessed: true };
}

function sfHandleFile(evt) {
  const file = evt.target.files && evt.target.files[0];
  evt.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const text = String(reader.result || '');
    const out = sfParse(text);
    sfFound = out.error ? { error: out.error, seen: out.seen } : Object.assign({}, out, sfPeriod(text));
    renderDailySalesPanel();
  };
  reader.readAsText(file);
}

// What is already in the books for that month, so a second upload does not
// quietly enter the fee twice.
function sfExisting(year, month) {
  return (appData.transactions[`${year}-${month}`] || []).filter(t =>
    t.type === 'out' && /stripe/i.test((t.vendor || '') + ' ' + (t.desc || '')));
}

function sfConfirm() {
  if (!sfFound || sfFound.error) return;
  const { year, month, fees, disputes } = sfFound;
  const end = dsMonthEnd(year, month);
  const rows = [];
  if (fees) rows.push({ desc: 'Stripe fees', amount: Math.round(fees * 100) / 100 });
  if (disputes) rows.push({ desc: 'Stripe dispute fees', amount: Math.round(disputes * 100) / 100 });

  const existing = sfExisting(year, month);
  if (existing.length && !confirm(
      `There ${existing.length === 1 ? 'is already a Stripe row' : 'are already ' + existing.length + ' Stripe rows'} ` +
      `in ${MONTHS_SHORT[month]} ${year}, totalling ${fmt(existing.reduce((s, t) => s + t.amount, 0))}.\n\n` +
      `Add ${rows.length === 1 ? 'this one' : 'these ' + rows.length} as well?`)) return;

  const key = `${year}-${month}`;
  if (!appData.transactions[key]) appData.transactions[key] = [];
  rows.forEach(r => {
    appData.transactions[key].push({
      id: 'sf-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      date: end, desc: r.desc, category: 'Payment Processing',
      vendor: 'Stripe', amount: r.amount, type: 'out'
    });
  });
  if (typeof auditLabel === 'function') auditLabel('Stripe fee from the balance summary');
  saveData();
  dsMarkDone(key, 'fee', { fees, disputes, byFile: true });
  sfFound = null;
  notify(`Entered ${fmt(rows.reduce((s, r) => s + r.amount, 0))} for ${MONTHS_SHORT[month]} ${year}`);
  renderDailySalesPanel();
  if (typeof renderLedger === 'function') renderLedger();
}

function sfDismiss() { sfFound = null; renderDailySalesPanel(); }

function sfReportHtml() {
  if (!sfFound) return '';
  if (sfFound.error) {
    return `
      <div style="font-size:0.76rem;color:var(--red);padding:10px 0">
        ${escHtml(sfFound.error)}
        ${(sfFound.seen || []).length ? `
          <div style="color:var(--mist);margin-top:6px;font-size:0.72rem">
            What it did find: ${escHtml((sfFound.seen || []).slice(0, 12).join(', '))}${
              (sfFound.seen || []).length > 12 ? '…' : ''}.
            Send me that list if this is the right file.
          </div>` : ''}
        <button class="btn btn-outline btn-sm" style="margin-top:8px" onclick="sfDismiss()">Close</button>
      </div>`;
  }
  const { year, month, fees, disputes, guessed, feeRows, disputeRows } = sfFound;
  const total = (fees || 0) + (disputes || 0);
  const existing = sfExisting(year, month);
  return `
    <div style="font-size:0.78rem;padding:10px 0">
      <div style="margin-bottom:6px">Read from the balance summary for
        <strong>${escHtml(MONTHS_SHORT[month] + ' ' + year)}</strong>${
          guessed ? ' <span style="color:var(--amber)">(no date in the file — check this is the right month)</span>' : ''}:</div>
      <table style="font-size:0.76rem;border-collapse:collapse;margin-bottom:8px">
        ${fees ? `<tr><td style="padding:2px 16px 2px 0">Stripe fees</td>
          <td style="text-align:right">${fmt(fees)}</td>
          <td style="padding-left:12px;color:var(--mist);font-size:0.7rem">${escHtml((feeRows || []).join(', '))}</td></tr>` : ''}
        ${disputes ? `<tr><td style="padding:2px 16px 2px 0">Dispute fees</td>
          <td style="text-align:right">${fmt(disputes)}</td>
          <td style="padding-left:12px;color:var(--mist);font-size:0.7rem">${escHtml((disputeRows || []).join(', '))}</td></tr>` : ''}
      </table>
      ${existing.length ? `<div style="color:var(--amber);margin-bottom:8px">
        ${existing.length === 1 ? 'A Stripe row is' : existing.length + ' Stripe rows are'} already in that month,
        totalling ${fmt(existing.reduce((s, t) => s + t.amount, 0))}.</div>` : ''}
      <div style="color:var(--mist);margin-bottom:8px">
        ${disputes ? 'Two rows' : 'One row'} dated ${escHtml(dsMonthEnd(year, month))}, under
        <strong>Payment Processing</strong>. Dispute fees stay separate from the processing fee.
      </div>
      <button class="btn btn-primary btn-sm" onclick="sfConfirm()">Enter ${fmt(total)}</button>
      <button class="btn btn-outline btn-sm" onclick="sfDismiss()">Not now</button>
    </div>`;
}

function sfPanelHtml() {
  return `
    <div class="ledger-wrap" style="margin-top:18px">
      <div class="ledger-header" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <h3 style="margin:0">Stripe's cut for the month</h3>
        <span style="font-size:0.7rem;color:var(--mist)">
          Stripe takes its fee out of each deposit, so it never appears in the bank and has to be
          entered. Upload the balance summary — <em>Reports → Balance</em> — and it is read off that.
        </span>
        <button class="btn btn-outline btn-sm" style="margin-left:auto"
                onclick="document.getElementById('sf-file').click()">Upload balance summary</button>
        <input type="file" id="sf-file" accept=".csv,.tsv,.txt" style="display:none"
               onchange="sfHandleFile(event)">
      </div>
      <div style="padding:0 16px 14px">${sfReportHtml()}</div>
    </div>`;
}
