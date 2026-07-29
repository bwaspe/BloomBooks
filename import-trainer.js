// ============================================================
// IMPORT / PARSER ENGINE
// ============================================================
let stagingRows = [];
let ignoredRows = [];

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
    if (cols.length < 6) return;

    const rawDate = cols[0].trim();
    // col1 = Receipt (skip)
    const desc    = cols[2].trim();
    // col3 = Card Member, col4 = Account # (skip)
    const rawAmt  = cols[5].trim();

    // Parse amount — negative = Amex payment, ignore
    const amt = parseFloat(rawAmt.replace(/,/g,''));
    if (isNaN(amt) || amt <= 0) return; // ignore payments and zero

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

    // Apply built-in ignore rules
    for (const rule of BUILTIN_RULES) {
      if (rule.ignore && upper.includes(rule.keyword.toUpperCase())) {
        ignoredRows.push({ desc: desc.slice(0,80), amount: amt, reason: rule.keyword });
        return;
      }
    }

    // Apply category rules (all Amex charges are 'out')
    let category = 'Office';
    let vendor = desc.slice(0, 40);
    for (const rule of BUILTIN_RULES) {
      if (rule.ignore) continue;
      if (upper.includes(rule.keyword.toUpperCase()) && (rule.sign === 'any' || rule.sign === 'out')) {
        category = rule.category; vendor = rule.vendor || vendor; break;
      }
    }
    for (const rule of appData.rules) {
      if (upper.includes(rule.keyword.toUpperCase()) && (rule.sign === 'any' || rule.sign === 'out')) {
        category = rule.category; vendor = rule.vendor || vendor; break;
      }
    }

    // Clean description
    const indName = desc.match(/IND NAME:\s*([^\t]+?)(?:\s+TRN:|$)/i);
    const cleanDesc = indName ? indName[1].trim() : desc.slice(0, 60);

    stagingRows.push({
      _id: 'stage-' + idx,
      line: line.slice(0, 120),
      desc: cleanDesc,
      date, txYear, txMonth,
      amount: amt,
      type: 'out',
      category, vendor,
      status: 'review'
    });
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
    const upper   = (desc + ' ' + txType).toUpperCase();

    // --- IGNORE ---
    for (const rule of BUILTIN_RULES) {
      if (rule.ignore && upper.includes(rule.keyword.toUpperCase())) {
        ignoredRows.push({ desc: desc.slice(0,80), amount: rawAmt, reason: rule.keyword });
        return;
      }
    }
    for (const rule of appData.rules) {
      if (rule.ignore && upper.includes(rule.keyword.toUpperCase())) {
        ignoredRows.push({ desc: desc.slice(0,80), amount: rawAmt, reason: rule.keyword });
        return;
      }
    }

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

    // --- CATEGORY via rules ---
    let category = signGuess === 'in' ? 'Revenue' : 'Office';
    let vendor = '';
    let matched = false;
    for (const rule of BUILTIN_RULES) {
      if (rule.ignore) continue;
      if (upper.includes(rule.keyword.toUpperCase()) && (rule.sign === 'any' || rule.sign === signGuess)) {
        category = rule.category; vendor = rule.vendor || ''; matched = true; break;
      }
    }
    if (!matched) {
      for (const rule of appData.rules) {
        if (upper.includes(rule.keyword.toUpperCase()) && (rule.sign === 'any' || rule.sign === signGuess)) {
          category = rule.category; vendor = rule.vendor || ''; break;
        }
      }
    }

    // Clean description: prefer IND NAME field
    const indName = desc.match(/IND NAME:\s*([^\t]+?)(?:\s+TRN:|$)/i);
    const cleanDesc = indName ? indName[1].trim() : desc.slice(0, 60);

    stagingRows.push({
      _id: 'stage-' + idx,
      line: line.slice(0, 120),
      desc: cleanDesc,
      date, txYear, txMonth, amount, type: signGuess, category, vendor,
      status: 'review'
    });
  });

  renderStagingTable();
  if (stagingRows.length === 0) notify('No parseable transactions found', true);
  else notify(`${stagingRows.length} transactions staged for review`);
}

function renderStagingTable() {
  const area = document.getElementById('staging-table-area');
  if (stagingRows.length === 0) { area.innerHTML = ''; return; }

  const rows = stagingRows.filter(r => r.status !== 'saved');

  area.innerHTML = `
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
    </div>

    ${ignoredRows.length > 0 ? `
    <div class="ledger-wrap" style="margin-top:16px;opacity:0.75">
      <div class="ledger-header">
        <h3>⛔ Ignored (${ignoredRows.length}) — matched ignore rules</h3>
      </div>
      <table>
        <thead><tr><th>Description</th><th>Amount</th><th>Ignored Because</th></tr></thead>
        <tbody>
          ${ignoredRows.map(r => `
            <tr style="background:#ffeaea">
              <td style="font-size:0.8rem">${escHtml(r.desc)}</td>
              <td class="amount-out">${fmt(r.amount)}</td>
              <td><span class="badge">${escHtml(r.reason)}</span></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>` : ''}
  `;
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

