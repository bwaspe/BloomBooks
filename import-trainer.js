// ============================================================
// IMPORT / PARSER ENGINE
// ============================================================
let stagingRows = [];
let ignoredRows = [];

// Set when a statement parsed with no Type column and rows landed as money in
// -- the signature of an Amex export read as a bank file. Held rather than
// toasted, because the toast fades and a statement booked backwards does not.
let bankSignWarning = 0;

// ============================================================
// RULE RESOLUTION
// ============================================================
// YOUR rules are checked before the built-in ones. It used to be the other
// way round, with the built-ins returning immediately on a match -- so a
// built-in ignore silently won every time and a rule added in the Logic
// Trainer for the same vendor was never even consulted. That made the
// trainer useless for precisely the case you would reach for it: correcting
// a built-in that is wrong for you.
//
// Returns { ignore, reason, source } or { category, vendor, reason, source }
// or null when nothing matched. `source` is carried so the UI can say which
// list a decision came from.
function resolveRules(upper, sign) {
  const lists = [
    { rules: appData.rules || [], source: 'your rule' },
    { rules: BUILTIN_RULES,       source: 'built-in' },
  ];
  for (const { rules, source } of lists) {
    for (const rule of rules) {
      if (!rule || !rule.keyword) continue;
      if (!upper.includes(String(rule.keyword).toUpperCase())) continue;
      if (rule.ignore) return { ignore: true, reason: rule.keyword, source };
      if (rule.sign === 'any' || rule.sign === sign) {
        return { category: rule.category, vendor: rule.vendor || '', reason: rule.keyword, source };
      }
      // Matched the keyword but not the direction — keep looking.
    }
  }
  return null;
}

// ============================================================
// FILE UPLOAD
// ============================================================
// Splits delimited text into rows, honouring quoted fields. Bank exports are
// commonly CSV with commas and quotes inside descriptions, which a naive
// split() tears apart mid-field.
function parseDelimited(text) {
  const delim = (text.split('\n')[0].match(/\t/g) || []).length >= 2 ? '\t' : ',';
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === delim) { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}

// Bank and card downloads don't come in the column order the parsers expect,
// and they carry a header row. Where a header is present the columns are
// matched by name and re-emitted in the expected order; without one the rows
// are passed through untouched, which is what a paste from a spreadsheet
// already is.
function normalizeStatement(rows, source) {
  if (!rows.length) return '';
  const head = rows[0].map(h => String(h).trim().toLowerCase());
  // Try each pattern against EVERY header before moving to the next pattern.
  // Testing each header against all patterns instead lets a weak early match
  // beat a strong later one: Chase's first column is "Details", which a loose
  // /^detail/ grabs before /description/ ever reaches the real Description
  // column — and the import then reads "DEBIT" as the payee.
  const find = (...pats) => {
    for (const p of pats) {
      const i = head.findIndex(h => p.test(h));
      if (i >= 0) return i;
    }
    return -1;
  };

  const iDesc = find(/description/, /^detail/);
  const iAmt = find(/^amount$/, /amount/);
  const looksLikeHeader = iDesc >= 0 && iAmt >= 0;
  if (!looksLikeHeader) return rows.map(r => r.join('\t')).join('\n');

  const iDate = find(/post.*date/, /transaction date/, /^date$/, /date/);
  const iType = find(/^type$/, /^details$/, /transaction type/);
  const body = rows.slice(1);

  return body.map(r => {
    const g = i => (i >= 0 && r[i] != null ? String(r[i]).trim() : '');
    if (source === 'amex') {
      // parseAmex reads cols 0, 2 and 5.
      return [g(iDate), '', g(iDesc), '', '', g(iAmt)].join('\t');
    }
    // The Chase parser reads Date, Description, Amount, TxType.
    return [g(iDate), g(iDesc), g(iAmt), g(iType)].join('\t');
  }).join('\n');
}

// Which statement is this? Worth deciding from the file rather than trusting
// the dropdown, because the two parsers disagree about what a positive number
// means. Amex writes purchases as positive; Chase writes money leaving the
// account as negative. Feed an Amex export to the bank parser and every
// purchase is booked as revenue — which is exactly what happened once the
// upload button made importing a single click and the dropdown easy to miss.
//
// Chase carries Details / Posting Date / Type / Balance columns. The current
// Amex export is only Date, Description, Amount.
function detectStatementSource(rows) {
  if (!rows.length) return null;
  const head = rows[0].map(h => String(h).trim().toLowerCase());
  const has = re => head.some(h => re.test(h));
  if (!has(/description/) || !has(/amount/)) return null;   // no header to read
  if (has(/posting date/) || has(/^balance$/) || has(/^details$/) || has(/^type$/)) return 'bank';
  // Amex names columns nothing else does. Counting them is not enough: the
  // wide export is six columns and some are wider still, so a length test
  // recognised only the narrow shape and let every wide one through as a bank
  // file -- where its positive purchases all booked as revenue.
  if (has(/card ?member/) || has(/^account ?#?$/) || has(/^receipt$/) ||
      has(/appears on your statement/) || has(/extended details/)) return 'amex';
  if (has(/^date$/) && head.length <= 4) return 'amex';
  return null;
}

function loadStatementFile(evt) {
  const file = evt.target.files && evt.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const sel = document.getElementById('import-source-sel');
      const rows = parseDelimited(String(e.target.result));

      const detected = detectStatementSource(rows);
      if (detected && detected !== sel.value) {
        sel.value = detected;
        if (typeof updateImportPlaceholder === 'function') updateImportPlaceholder();
        notify(detected === 'amex' ? 'Looks like an Amex export — switched the source to Amex'
                                   : 'Looks like a Chase export — switched the source to Bank');
      }
      const source = sel.value;
      const tsv = normalizeStatement(rows, source);
      if (!tsv.trim()) { notify('That file had no rows I could read', true); return; }
      document.getElementById('import-text').value = tsv;
      parseImport();
    } catch (err) {
      notify('Could not read that file: ' + (err && err.message || err), true);
    }
  };
  reader.onerror = () => notify('Could not read that file', true);
  reader.readAsText(file);
  evt.target.value = '';   // let the same file be picked again
}

function renderImportPanel() {
  updateYearSelects();
  document.getElementById('import-year-sel').value = appData.activeYear;
}

function updateImportPlaceholder() {
  const src = document.getElementById('import-source-sel').value;
  const ta = document.getElementById('import-text');
  if (src === 'amex') {
    ta.placeholder = 'Paste Amex TSV here...\n\nExpected columns: Date | Receipt | Description | Card Member | Account # | Amount\nNegative amounts (payments) are automatically ignored.';
  } else {
    ta.placeholder = 'Paste Chase bank TSV here...\n\nExpected columns: Date | Description | Amount | TxType';
  }
}

function parseAmex() {
  const raw = document.getElementById('import-text').value.trim();
  if (!raw) { notify('Paste some text first', true); return; }

  stagingRows = [];
  const lines = raw.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);

  lines.forEach((line, idx) => {
    const cols = line.split('\t');
    if (cols.length < 3) return;

    // Amex has shipped two shapes. The older six-column export is
    // Date | Receipt | Description | Card Member | Account # | Amount; the
    // current download is just Date | Description | Amount. Requiring six
    // columns silently produced zero rows from a current export.
    const wide = cols.length >= 6;
    const rawDate = cols[0].trim();
    const desc    = (wide ? cols[2] : cols[1]).trim();
    const rawAmt  = (wide ? cols[5] : cols[2]).trim();

    const amt = parseFloat(rawAmt.replace(/,/g, ''));
    if (isNaN(amt)) return;

    // Parse date MM/DD/YYYY
    let date;
    const dm = rawDate.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (dm) {
      date = `${dm[3]}-${dm[1].padStart(2,'0')}-${dm[2].padStart(2,'0')}`;
    } else {
      const yr = parseInt(document.getElementById('import-year-sel').value);
      const mo = parseInt(document.getElementById('import-month-sel').value);
      date = `${yr}-${String(mo+1).padStart(2,'0')}-01`;
    }

    const txYear  = dm ? parseInt(dm[3]) : parseInt(document.getElementById('import-year-sel').value);
    const txMonth = dm ? parseInt(dm[1]) - 1 : parseInt(document.getElementById('import-month-sel').value);

    const upper = desc.toUpperCase();
    const hit = resolveRules(upper, 'out');   // all Amex charges are 'out'

    // A negative amount is a payment to the card, not a purchase — counting it
    // would double-count against the bank statement, where the same money
    // already appears leaving the account. Listed as ignored rather than
    // dropped, so nothing disappears without saying why.
    if (amt <= 0) {
      ignoredRows.push({
        _id: 'stage-' + idx, line: line.slice(0, 120), desc: desc.slice(0, 60),
        date, txYear, txMonth, amount: Math.abs(amt), type: 'out',
        category: 'Office', vendor: desc.slice(0, 40), status: 'review',
        reason: 'negative amount', source: 'a payment to the card, not a purchase'
      });
      return;
    }

    // Clean description
    const indName = desc.match(/IND NAME:\s*([^\t]+?)(?:\s+TRN:|$)/i);
    const cleanDesc = indName ? indName[1].trim() : desc.slice(0, 60);

    // Built whole either way. An ignored row keeps every field a staged one
    // has, so "don't ignore this" is a move between two lists rather than a
    // re-parse -- and the row it restores is identical to the one that would
    // have been staged.
    const row = {
      _id: 'stage-' + idx,
      line: line.slice(0, 120),
      desc: cleanDesc,
      date, txYear, txMonth,
      amount: amt,
      type: 'out',
      category: (hit && !hit.ignore && hit.category) || 'Office',
      vendor: (hit && !hit.ignore && hit.vendor) || desc.slice(0, 40),
      status: 'review'
    };

    if (hit && hit.ignore) ignoredRows.push({ ...row, reason: hit.reason, source: hit.source });
    else stagingRows.push(row);
  });
}

function parseImport() {
  const raw = document.getElementById('import-text').value.trim();
  if (!raw) { notify('Paste some text first', true); return; }

  stagingRows = [];
  ignoredRows = [];

  const source = document.getElementById('import-source-sel').value;
  if (source === 'amex') {
    parseAmex();
    renderStagingTable();
    if (stagingRows.length === 0) notify('No parseable transactions found', true);
    else notify(`${stagingRows.length} transactions staged for review`);
    return;
  }

  // TSV format: Date \t Description \t Amount \t TxType (one row per line)
  const lines = raw.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);

  lines.forEach((line, idx) => {
    const cols = line.split('\t');
    if (cols.length < 2) return;

    const rawDate = (cols[0] || '').trim();
    const desc    = (cols[1] || '').trim();
    const rawAmt  = (cols[2] || '').trim();
    const txType  = (cols[3] || '').trim().toUpperCase();

    // On an ACH row the description ends "... IND NAME:<account holder> TRN:…".
    // IND NAME is always us — BARAMI WASPE, or MOSHOLU FLOWERS LLC — never the
    // counterparty, so matching rules against it can only ever produce false
    // positives. Measured against a real statement: five of nine keyword
    // matches fired solely on IND NAME, and two of those were genuine Delaware
    // Valley purchases being silently discarded. The other three were Amex
    // payments already matched by their real payee, so nothing is lost by
    // excluding this tail. A personal transfer where BARAMI WASPE is genuinely
    // the counterparty carries the name outside IND NAME and still matches.
    //
    // txType is appended AFTER stripping, not before: rules like CHECK_PAID
    // match on the transaction type, and stripping to end-of-string would take
    // it with them.
    const descForRules = desc.replace(/IND NAME:.*$/i, '');
    const upper   = (descForRules + ' ' + txType).toUpperCase();

    // Ignore is decided further down, once the row is fully parsed, so that an
    // ignored row can be restored without re-parsing it.

    // --- DATE from col0 MM/DD/YYYY, fallback to selectors ---
    let date, txYear, txMonth;
    const dm = rawDate.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (dm) {
      txYear  = parseInt(dm[3]);
      txMonth = parseInt(dm[1]) - 1; // 0-indexed
      date = `${dm[3]}-${dm[1].padStart(2,'0')}-${dm[2].padStart(2,'0')}`;
    } else {
      txYear  = parseInt(document.getElementById('import-year-sel').value);
      txMonth = parseInt(document.getElementById('import-month-sel').value);
      date = `${txYear}-${String(txMonth+1).padStart(2,'0')}-01`;
    }

    // --- AMOUNT from col2: TC327.7 or TC-73.99 or -277.99 or 105 ---
    let amount = null;
    let isNegative = false;
    const tcMatch = rawAmt.match(/^TC(-?)([\d.]+)$/i);
    if (tcMatch) {
      isNegative = tcMatch[1] === '-';
      amount = parseFloat(tcMatch[2]);
    } else {
      const plainMatch = rawAmt.match(/^(-?)([\d.,]+)$/);
      if (plainMatch) {
        isNegative = plainMatch[1] === '-';
        amount = parseFloat(plainMatch[2].replace(/,/g,''));
      }
    }

    if (!amount || amount <= 0) return;

    // --- SIGN: tx type column is authoritative ---
    let signGuess;
    if (/ACH_CREDIT|MISC_CREDIT|CHECK_DEPOSIT/.test(txType))                                       signGuess = 'in';
    else if (/ACH_DEBIT|DEBIT_CARD|MISC_DEBIT|QUICKPAY_DEBIT|CHASE_TO_PARTNERFI|CHECK_PAID/.test(txType)) signGuess = 'out';
    else signGuess = isNegative ? 'out' : 'in';

    // --- CATEGORY / IGNORE via rules (yours first, then built-in) ---
    const hit = resolveRules(upper, signGuess);
    const category = (hit && !hit.ignore && hit.category) || (signGuess === 'in' ? 'Revenue' : 'Office');
    const vendor = (hit && !hit.ignore && hit.vendor) || '';

    // Clean description: prefer ORIG CO NAME — the party actually paid. This
    // used to prefer IND NAME, which is the account holder, so every ACH row
    // landed in the ledger as "BARAMI WASPE" or "MOSHOLU FLOWERS LLC" instead
    // of the vendor. IND NAME stays as the fallback for rows without a company
    // name, where it is the only party named.
    const origCo = desc.match(/ORIG CO NAME:\s*(.+?)(?:\s{2,}|\s+ORIG ID:)/i);
    const indName = desc.match(/IND NAME:\s*([^\t]+?)(?:\s+TRN:|$)/i);
    const cleanDesc = (origCo && origCo[1].trim())
                   || (indName && indName[1].trim())
                   || desc.slice(0, 60);

    const row = {
      _id: 'stage-' + idx,
      line: line.slice(0, 120),
      desc: cleanDesc,
      date, txYear, txMonth, amount, type: signGuess, category, vendor,
      _txType: txType || '',    // kept so the parser can tell a typeless file
      status: 'review'
    };

    if (hit && hit.ignore) ignoredRows.push({ ...row, reason: hit.reason, source: hit.source });
    else stagingRows.push(row);
  });

  renderStagingTable();

  // A bank statement with no Type column anywhere is a warning sign, not just
  // a limitation: it is what an Amex export looks like when the source is left
  // on Bank, and the direction then comes from the sign alone. Amex writes
  // purchases as positive, so every one of them books as revenue. Uploading
  // detects the source from the file's own headers; this catches the paste.
  // A toast is the wrong shape for this: it fades, and the damage is a whole
  // statement booked backwards. It now sits above the staging table until the
  // rows are dealt with, and carries the fix.
  const sawType = stagingRows.concat(ignoredRows).some(r => r._txType);
  const ins = stagingRows.filter(r => r.type === 'in').length;
  bankSignWarning = (!sawType && ins) ? ins : 0;
  if (bankSignWarning) {
    renderStagingTable();
    notify(`No Type column — ${ins} row${ins === 1 ? '' : 's'} booked as money IN from the sign alone. Check the banner above the table.`, true);
  }

  if (stagingRows.length === 0 && ignoredRows.length === 0) notify('No parseable transactions found', true);
  else if (stagingRows.length === 0) notify(`Every row matched an ignore rule — see below`, true);
  else notify(`${stagingRows.length} transactions staged for review`);
}

// One click from the banner: flip the source and read the same text again.
function reparseAsAmex() {
  const sel = document.getElementById('import-source-sel');
  if (sel) sel.value = 'amex';
  if (typeof updateImportPlaceholder === 'function') updateImportPlaceholder();
  bankSignWarning = 0;
  parseImport();
}

function renderStagingTable() {
  const area = document.getElementById('staging-table-area');
  // Render whenever there is anything to show. This used to bail out when
  // nothing had staged, which hid the ignored list at exactly the moment it
  // mattered most -- every row ignored, and an import that looked like it had
  // simply done nothing at all.
  if (stagingRows.length === 0 && ignoredRows.length === 0) { area.innerHTML = ''; return; }

  const rows = stagingRows.filter(r => r.status !== 'saved');

  area.innerHTML = `
    ${bankSignWarning ? `
      <div style="margin-bottom:12px;padding:10px 14px;border-radius:6px;
                  background:#fdecea;border:1px solid #e0a2a2;font-size:0.8rem">
        <strong>${bankSignWarning} row${bankSignWarning === 1 ? '' : 's'} booked as money IN.</strong>
        This file has no Type column, so the direction came from the sign alone.
        Amex writes purchases as positive, so an Amex export read as a bank file
        turns every charge into revenue.
        <button class="btn btn-outline btn-sm" style="margin-left:8px"
                onclick="reparseAsAmex()">Re-read as Amex</button>
      </div>` : ''}
    ${rows.length === 0 ? '' : `
    <div class="ledger-wrap">
      <div class="ledger-header">
        <h3>🟡 Staged Transactions (${rows.length} pending)</h3>
        <button class="btn btn-primary btn-sm" onclick="saveAllStaged()">✅ Save All to Ledger</button>
        <button class="btn btn-danger btn-sm" style="margin-left:6px" onclick="cancelImport()">✕ Cancel Import</button>
      </div>
      <div class="staging-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Raw Line</th>
              <th>Date</th>
              <th>Category</th>
              <th>Vendor</th>
              <th>Amount</th>
              <th>Type</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${stagingRows.map(r => {
              if (r.status === 'saved') return '';
              const cls = r.status === 'rejected' ? 'staging-row-rejected' : r.status === 'dupe' ? 'staging-row-dupe' : 'staging-row-review';
              return `<tr class="${cls}" id="stage-row-${r._id}">
                <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:0.65rem;color:var(--mist)">${escHtml(r.line)}</td>
                <td><input class="inline-input" style="width:120px" value="${r.date}" onchange="updateStageRow('${r._id}','date',this.value)"></td>
                <td>
                  <select class="inline-input" onchange="updateStageRow('${r._id}','category',this.value)">
                    ${CATEGORIES.map(c=>`<option value="${c}"${c===r.category?' selected':''}>${c}</option>`).join('')}
                  </select>
                </td>
                <td><input class="inline-input" style="width:100px" value="${escHtml(r.vendor)}" onchange="updateStageRow('${r._id}','vendor',this.value)"></td>
                <td><input class="inline-input" style="width:80px" type="number" value="${r.amount}" onchange="updateStageRow('${r._id}','amount',parseFloat(this.value))"></td>
                <td>
                  <select class="inline-input" onchange="updateStageRow('${r._id}','type',this.value)">
                    <option value="in"${r.type==='in'?' selected':''}>In</option>
                    <option value="out"${r.type==='out'?' selected':''}>Out</option>
                  </select>
                </td>
                <td>
                  ${r.status === 'dupe' ? '<span style="font-size:0.65rem;color:var(--red);font-weight:600">⚠ Dupe?</span> ' : ''}
                  <button class="btn btn-primary btn-xs" onclick="saveStagedRow('${r._id}')">Save</button>
                  <button class="btn btn-danger btn-xs" style="margin-left:3px" onclick="rejectStagedRow('${r._id}')">Reject</button>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`}

    ${ignoredRows.length > 0 ? `
    <div class="ledger-wrap" style="margin-top:16px">
      <div class="ledger-header">
        <h3>⛔ Ignored (${ignoredRows.length}) — matched an ignore rule</h3>
        <button class="btn btn-outline btn-sm" onclick="restoreAllIgnored()">Use all of these</button>
      </div>
      <div class="staging-table-wrap">
      <table>
        <thead><tr><th>Description</th><th>Date</th><th>Amount</th><th>Ignored because</th><th></th></tr></thead>
        <tbody>
          ${ignoredRows.map((r, i) => `
            <tr style="background:#ffeaea">
              <td style="font-size:0.8rem">${escHtml(r.desc)}</td>
              <td style="font-size:0.78rem;color:var(--mist)">${escHtml(r.date || '')}</td>
              <td class="amount-out">${fmt(r.amount)}</td>
              <td>
                <span class="badge">${escHtml(r.reason)}</span>
                <div style="font-size:0.68rem;color:var(--mist);margin-top:2px">${escHtml(r.source || '')}</div>
              </td>
              <td><button class="btn btn-primary btn-xs" onclick="restoreIgnoredRow(${i})">Don't ignore</button></td>
            </tr>`).join('')}
        </tbody>
      </table>
      </div>
      <div style="padding:10px 18px;font-size:0.72rem;color:var(--mist)">
        The badge is the keyword that matched. If it is a built-in you disagree with,
        add a rule for the same vendor in the Logic Trainer — your rules are checked first.
      </div>
    </div>` : ''}
  `;
}

// Moves one ignored row into the staging list. The row was parsed in full, so
// this is a move rather than a re-parse and what lands is exactly what would
// have staged had no ignore rule matched.
function restoreIgnoredRow(idx) {
  const r = ignoredRows[idx];
  if (!r) return;
  ignoredRows.splice(idx, 1);
  delete r.reason;
  delete r.source;
  stagingRows.push(r);
  renderStagingTable();
  notify('Moved into the staging list for review');
}

function restoreAllIgnored() {
  if (!ignoredRows.length) return;
  const n = ignoredRows.length;
  ignoredRows.forEach(r => { delete r.reason; delete r.source; stagingRows.push(r); });
  ignoredRows = [];
  renderStagingTable();
  notify(`Moved ${n} row${n === 1 ? '' : 's'} into the staging list`);
}

function updateStageRow(id, field, val) {
  const r = stagingRows.find(r => r._id === id);
  if (r) r[field] = val;
}

function rejectStagedRow(id) {
  const r = stagingRows.find(r => r._id === id);
  if (r) { r.status = 'rejected'; renderStagingTable(); }
}

function saveStagedRow(id) {
  const r = stagingRows.find(r => r._id === id);
  if (!r) return;
  const yr = r.txYear  || parseInt(document.getElementById('import-year-sel').value);
  const mo = r.txMonth !== undefined ? r.txMonth : parseInt(document.getElementById('import-month-sel').value);
  addTransaction(yr, mo, {
    date: r.date, desc: r.desc.slice(0, 40), category: r.category,
    vendor: r.vendor, amount: r.amount, type: r.type
  });
  r.status = 'saved';
  renderStagingTable();
  notify('Transaction saved to ledger');
}

function cancelImport() {
  if (stagingRows.length && !confirm('Discard all staged transactions?')) return;
  stagingRows = [];
  document.getElementById('staging-table-area').innerHTML = '';
  document.getElementById('import-text').value = '';
  notify('Import cancelled');
}

function saveAllStaged() {
  let count = 0, dupes = 0;
  // Track how many of each duplicate key we're importing in this batch
  const importCounts = {};
  stagingRows.forEach(r => {
    if (r.status !== 'review') return;
    const yr = r.txYear || parseInt(document.getElementById('import-year-sel').value);
    const mo = r.txMonth !== undefined ? r.txMonth : parseInt(document.getElementById('import-month-sel').value);
    const key = `${yr}-${mo}|` + dupKey(r.date, r.amount, r.desc);
    importCounts[key] = (importCounts[key] || 0) + 1;
    const alreadyInLedger = countExisting(yr, mo, r.date, r.amount, r.desc);
    // Flag as dupe only if ledger already has >= this many of the same tx
    if (alreadyInLedger >= importCounts[key]) { dupes++; r.status = 'dupe'; return; }
    addTransaction(yr, mo, {
      date: r.date, desc: r.desc.slice(0, 40), category: r.category,
      vendor: r.vendor, amount: r.amount, type: r.type
    });
    r.status = 'saved';
    count++;
  });
  renderStagingTable();
  let msg = `${count} transactions saved to ledger`;
  if (dupes > 0) msg += ` — ${dupes} possible duplicate(s) flagged`;
  notify(msg, dupes > 0);
}

// ============================================================
// PRINT / PDF EXPORT
// ============================================================
function printMonthSummary(mi) {
  const year = appData.activeYear;
  const calc = calcMonth(year, mi);
  const txs = getTransactions(year, mi);
  const key = `${year}-${mi}`;
  const note = appData.notes && appData.notes[key] ? appData.notes[key] : '';

  const catRows = CATEGORIES.filter(c => (calc.byCategory[c]||0) > 0).map(c => {
    const amt = calc.byCategory[c];
    const pct = calc.revenue > 0 ? (amt/calc.revenue*100).toFixed(1) : '—';
    return `<tr><td>${c}</td><td>${fmt(amt)}</td><td>${pct}%</td></tr>`;
  }).join('');

  const txRows = txs.map(t =>
    `<tr><td>${t.date}</td><td>${t.desc||''}</td><td>${t.category}</td><td>${t.vendor||''}</td><td>${t.type==='in'?'+':'-'}${fmt(t.amount)}</td></tr>`
  ).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <title>Bloom Books — ${MONTHS[mi]} ${year}</title>
  <style>
    body { font-family: monospace; font-size: 12px; color: #1a1a2e; padding: 24px; }
    h1 { font-size: 20px; margin-bottom: 4px; }
    h2 { font-size: 14px; margin: 16px 0 6px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
    th, td { border: 1px solid #ddd; padding: 4px 8px; text-align: left; }
    th { background: #f5f0e8; }
    .kpis { display: flex; gap: 16px; margin: 12px 0; }
    .kpi { border: 1px solid #ddd; border-radius: 4px; padding: 8px 16px; }
    .kpi-label { font-size: 10px; color: #888; }
    .kpi-value { font-size: 18px; font-weight: bold; }
    .note { background: #fffde7; border: 1px solid #f0d060; padding: 8px; border-radius: 4px; font-style: italic; }
    @media print { body { padding: 0; } }
  </style></head><body>
  <h1>🌸 Bloom Books</h1>
  <div>${MONTHS[mi]} ${year} — Monthly Summary</div>
  <div class="kpis">
    <div class="kpi"><div class="kpi-label">Revenue</div><div class="kpi-value">${fmt(calc.revenue)}</div></div>
    <div class="kpi"><div class="kpi-label">Expenses</div><div class="kpi-value">${fmt(calc.expenses)}</div></div>
    <div class="kpi"><div class="kpi-label">Net Income</div><div class="kpi-value">${fmt(calc.net)}</div></div>
    <div class="kpi"><div class="kpi-label">COGS %</div><div class="kpi-value">${calc.cogsRatio.toFixed(1)}%</div></div>
  </div>
  ${note ? `<div class="note">📝 ${note}</div>` : ''}
  <h2>Category Breakdown</h2>
  <table><thead><tr><th>Category</th><th>Total</th><th>% of Revenue</th></tr></thead><tbody>${catRows}</tbody></table>
  <h2>Transactions (${txs.length})</h2>
  <table><thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Vendor</th><th>Amount</th></tr></thead><tbody>${txRows}</tbody></table>
  <script>window.print();<\/script></body></html>`;

  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
}

// ============================================================
// LOGIC TRAINER
// ============================================================
function renderTrainerPanel() {
  const catSel = document.getElementById('rule-category');
  catSel.innerHTML = CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('');
  renderRulesList();
}

function addRule() {
  const keyword = document.getElementById('rule-keyword').value.trim();
  const sign = document.getElementById('rule-sign').value;
  const category = document.getElementById('rule-category').value;
  const vendor = document.getElementById('rule-vendor').value.trim();
  if (!keyword) { notify('Keyword is required', true); return; }
  appData.rules.push({ keyword, sign, category, vendor });
  saveData();
  document.getElementById('rule-keyword').value = '';
  document.getElementById('rule-vendor').value = '';
  renderRulesList();
  notify('Rule added');
}

function deleteRule(idx) {
  appData.rules.splice(idx, 1);
  saveData();
  renderRulesList();
  notify('Rule deleted');
}

function renderRulesList() {
  const container = document.getElementById('rules-list');
  document.getElementById('rule-count').textContent = `(${appData.rules.length})`;
  if (appData.rules.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div>No rules yet — add one above</div>';
    return;
  }
  container.innerHTML = `<div class="rule-list">
    ${appData.rules.map((r, i) => `
      <div class="rule-row">
        <span class="rule-keyword">"${escHtml(r.keyword)}"</span>
        <span class="rule-sign">+ ${r.sign === 'any' ? 'Any' : r.sign === 'in' ? 'Money In' : 'Money Out'}</span>
        <span class="rule-arrow">→</span>
        <span class="rule-cat">${r.category}</span>
        ${r.vendor ? `<span style="color:var(--mist);font-size:0.68rem">(${escHtml(r.vendor)})</span>` : ''}
        <button class="btn btn-danger btn-xs" style="margin-left:auto" onclick="deleteRule(${i})">Remove</button>
      </div>
    `).join('')}
  </div>`;
}

