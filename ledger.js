// ============================================================
// YEAR MANAGEMENT
// ============================================================
function setActiveYear(yr) {
  appData.activeYear = parseInt(yr);
  saveData();
  renderMonthTabs();
  renderCurrentPanel();
}

// The year list was only ever added to by hand, so on 1 January the new year
// simply would not exist. The inconvenience is minor; the risk is not. The
// Daily Sales year selector would still be sitting on the old year, and a
// day's takings typed in without noticing would land in a year that has
// already been filed and reconciled.
//
// Sorts numerically. Array.sort() is lexicographic by default, which is
// harmless for four-digit years but wrong the moment anything else is added.
function ensureCurrentYear() {
  if (!Array.isArray(appData.years)) appData.years = [];
  const y = new Date().getFullYear();
  if (appData.years.includes(y)) return false;
  appData.years.push(y);
  appData.years.sort((a, b) => a - b);
  saveData();
  return true;
}

function promptAddYear() {
  const yr = prompt('Enter year to add (e.g. 2027):');
  if (!yr || isNaN(yr)) return;
  const y = parseInt(yr);
  if (y < 2000 || y > 2100) { notify('Invalid year', true); return; }
  if (!appData.years.includes(y)) {
    appData.years.push(y);
    appData.years.sort();
    saveData();
  }
  document.getElementById('active-year-select').value = y;
  setActiveYear(y);
  updateYearSelects();
  notify(`Year ${y} added`);
}

function updateYearSelects() {
  const sel = document.getElementById('active-year-select');
  const importSel = document.getElementById('import-year-sel');
  [sel, importSel].forEach(s => {
    if (!s) return;
    const cur = s.value;
    s.innerHTML = appData.years.map(y => `<option value="${y}">${y}</option>`).join('');
    if (cur && appData.years.includes(parseInt(cur))) s.value = cur;
    else s.value = appData.activeYear;
  });
  // Extra checkboxes in trends
  const extras = document.getElementById('extra-year-checks');
  if (extras) {
    const baseYears = [2023,2024,2025,2026];
    extras.innerHTML = appData.years.filter(y => !baseYears.includes(y))
      .map(y => `<label><input type="checkbox" value="${y}" checked onchange="renderTrendsChart()"> ${y}</label>`).join(' ');
  }
}

// ============================================================
// NAVIGATION
// ============================================================
let currentPanel = 'month-0';
let monthCatFilter = {};  // { [mi]: categoryName } — active category filter per month
let monthSort = {};  // { [mi]: {col, dir} } — active sort per month

// ---- Mobile drawer ----------------------------------------
// Below 860px the sidebar is an off-canvas drawer (see styles.css).
// State lives in one class on <body>; on desktop that class is inert,
// so these are safe to call at any width.
function setSidebarOpen(open) {
  document.body.classList.toggle('nav-open', open);
  const btn = document.getElementById('nav-toggle');
  if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}
function toggleSidebar() { setSidebarOpen(!document.body.classList.contains('nav-open')); }
function closeSidebar() { setSidebarOpen(false); }

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSidebar();
});

function switchPanel(panelId) {
  currentPanel = panelId;
  // Every nav click — sidebar tabs and generated month tabs alike —
  // funnels through here, so this is the one place the drawer needs
  // to close after a selection.
  closeSidebar();
  document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
  const tab = document.querySelector(`[data-panel="${panelId}"]`);
  if (tab) tab.classList.add('active');

  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));

  if (panelId.startsWith('month-')) {
    const mi = parseInt(panelId.split('-')[1]);
    renderMonthPanel(mi);
    const el = document.getElementById(`panel-month-${mi}`);
    if (el) el.classList.add('active');
  } else {
    const el = document.getElementById(`panel-${panelId}`);
    if (el) {
      el.classList.add('active');
      if (panelId === 'trends')       renderTrendsPanel();
      if (panelId === 'yearly')       renderYearlyPanel();
      if (panelId === 'tax')          renderTaxPanel();
      if (panelId === 'holidays')     renderHolidayPanel();
      if (panelId === 'import')       renderImportPanel();
      if (panelId === 'trainer')      renderTrainerPanel();
      if (panelId === 'daily-sales')  renderDailySalesPanel();
      if (panelId === 'sales-tax')    renderSalesTaxPanel();
      if (panelId === 'ct-dashboard') renderCtDashboard();
      if (panelId === 'ct-prices')    renderCtPrices();
      if (panelId === 'ct-gmail')     renderCtGmailPanel();
    }
  }
}

function renderCurrentPanel() { switchPanel(currentPanel); }

// ============================================================
// MONTH TABS
// ============================================================
function renderMonthTabs() {
  const container = document.getElementById('month-tabs');
  container.innerHTML = MONTHS_SHORT.map((m, i) =>
    `<div class="sidebar-tab${currentPanel === 'month-'+i ? ' active' : ''}" data-panel="month-${i}" onclick="switchPanel('month-${i}')">${m}</div>`
  ).join('');

  // Ensure month panel containers exist
  const panelsContainer = document.getElementById('month-panels');
  panelsContainer.innerHTML = MONTHS.map((_, i) =>
    `<div id="panel-month-${i}" class="panel"></div>`
  ).join('');
}

// ============================================================
// TRANSACTIONS
// ============================================================
function getTxKey(year, month) { return `${year}-${month}`; }

function getTransactions(year, month) {
  return appData.transactions[getTxKey(year, month)] || [];
}

function addTransaction(year, month, tx) {
  const key = getTxKey(year, month);
  if (!appData.transactions[key]) appData.transactions[key] = [];
  tx.id = 'tx-' + Date.now() + '-' + Math.random().toString(36).slice(2,6);
  appData.transactions[key].push(tx);
  saveData();
}

function deleteTransaction(year, month, id) {
  const key = getTxKey(year, month);
  appData.transactions[key] = (appData.transactions[key] || []).filter(t => t.id !== id);
  saveData();
}

function updateTransaction(year, month, id, updates) {
  const key = getTxKey(year, month);
  const txs = appData.transactions[key] || [];
  const idx = txs.findIndex(t => t.id === id);
  if (idx !== -1) { txs[idx] = {...txs[idx], ...updates}; saveData(); }
}

// ============================================================
// MONTH CALCULATIONS
// ============================================================
function calcMonth(year, month) {
  const allTxs = getTransactions(year, month);
  // If real transactions exist, exclude vault entries from totals to avoid double-counting
  const hasReal = allTxs.some(t => !t._vault);
  const txs = hasReal ? allTxs.filter(t => !t._vault) : allTxs;

  // From the switch-over month onwards, revenue comes from the daily sales
  // book rather than from bank deposits. Deposits are net of Stripe's fees and
  // include collected sales tax, so they understate and overstate the same
  // number at once; the day book records what was actually earned, excluding
  // tax, which is owed to New York State and was never income.
  //
  // Bank credits then stop counting entirely. They are settlements of sales the
  // day book has already recorded, so counting them again would double the
  // revenue. They stay in the ledger as the record of money arriving -- nothing
  // is deleted or rewritten, and clearing the setting restores the old
  // behaviour exactly.
  const fromDayBook = typeof dsRevenueMonth === 'function' && dsRevenueMonth(year, month);
  const passthrough = t => PASSTHROUGH_CATEGORIES.indexOf(t.category) >= 0;
  const counted = txs.filter(t =>
    !passthrough(t) &&
    !(fromDayBook && t.category === 'Revenue' && t.type === 'in'));

  const revenue = fromDayBook
    ? dsMonthTotals(year, month).revenue
    : txs.filter(t => t.category === 'Revenue' && t.type === 'in').reduce((s, t) => s + t.amount, 0);

  const cogs = counted.filter(t => t.category === 'Supplies & Materials - COGS').reduce((s, t) => s + t.amount, 0);
  // Capital comes out of expenses and is reported beside them. `net` therefore
  // means the trading result; `cashOut` and `cashNet` are what the bank did, so
  // the two can be told apart instead of one silently standing for both.
  const sum = f => counted.filter(t => t.type === 'out' && f(t.category))
                          .reduce((s, t) => s + t.amount, 0);
  const capital = sum(isCapitalCat);
  const loanPrincipal = sum(isLoanPrincipalCat);
  const ownerDraw = sum(isOwnerDrawCat);
  const nonExpense = capital + loanPrincipal + ownerDraw;
  // The owner's own money coming back IN. Not revenue, so it is outside net --
  // but it did raise the balance, so the cash line has to carry it or a month
  // the owner funded reads as a month that lost less than it did.
  const nonRevenueIn = counted.filter(t => t.type === 'in' && isNonRevenueInCat(t.category))
                              .reduce((s, t) => s + t.amount, 0);
  const expenses = sum(c => !isNonExpenseCat(c));
  const net = revenue - expenses;

  // What the account ACTUALLY did, read off every row rather than inferred
  // from net. That distinction is the whole point: from the switch-over month
  // `revenue` is the day book -- tax-exclusive and gross of processor fees --
  // while bank credits are dropped from `counted` so they cannot be counted
  // twice. So `net - nonExpense + nonRevenueIn` is NOT the bank movement in any
  // month after the switch-over, and a card that said "the bank rose $302.63"
  // was reporting a June the account actually ended about $5,329 down.
  //
  // The two agree only while revenue still comes from deposits. After that they
  // are different questions, so they get different names.
  const bankIn  = txs.filter(t => t.type === 'in').reduce((s, t) => s + t.amount, 0);
  const bankOut = txs.filter(t => t.type === 'out').reduce((s, t) => s + t.amount, 0);
  const bankNet = bankIn - bankOut;
  const cogsRatio = revenue > 0 ? (cogs / revenue * 100) : 0;
  // Category breakdown
  const byCategory = {};
  CATEGORIES.forEach(c => { byCategory[c] = 0; });
  counted.forEach(t => {
    if (byCategory[t.category] !== undefined) byCategory[t.category] += t.amount;
  });
  if (fromDayBook) byCategory['Revenue'] = revenue;
  return { revenue, cogs, expenses, net, capital, loanPrincipal, ownerDraw, nonExpense,
           nonRevenueIn, bankIn, bankOut, bankNet, cogsRatio, byCategory };
}

function getRevenue(year, month) {
  return calcMonth(year, month).revenue;
}

function calcYoYGrowth(year, month) {
  const curr = getRevenue(year, month);
  const prev = getRevenue(year - 1, month);
  if (prev === 0) return null;
  return ((curr - prev) / prev * 100);
}

// ============================================================
// MONTH PANEL RENDER
// ============================================================
function renderMonthPanel(mi) {
  const year = appData.activeYear;
  const el = document.getElementById(`panel-month-${mi}`);
  if (!el) return;

  const txs = getTransactions(year, mi);
  const calc = calcMonth(year, mi);
  const yoy = calcYoYGrowth(year, mi);

  // Previous year same month revenue
  const prevRev = getRevenue(year - 1, mi);
  const yoyHtml = yoy !== null
    ? `<span class="kpi-growth ${yoy >= 0 ? 'up' : 'down'}">${yoy >= 0 ? '▲' : '▼'} ${Math.abs(yoy).toFixed(1)}% vs ${year-1}</span>`
    : '<span class="kpi-growth" style="color:var(--mist)">No prior year data</span>';

  const key = `${year}-${mi}`;
  const isReconciled = appData.reconciled && appData.reconciled[key];
  const note = appData.notes && appData.notes[key] ? appData.notes[key] : '';

  // Best/worst month detection across all years — the current (still in-progress) calendar
  // month is excluded from the "lowest month" comparison, since a partial month with only a
  // week or two of entries would otherwise almost always look like the worst month by default.
  const today = new Date();
  const curY = today.getFullYear(), curM = today.getMonth();
  const allMonthRevenues = appData.years.flatMap(y => [0,1,2,3,4,5,6,7,8,9,10,11].map(m => ({y,m,rev:getRevenue(y,m)})));
  const nonZero = allMonthRevenues.filter(x => x.rev > 0);
  const worstCandidates = nonZero.filter(x => !(x.y === curY && x.m === curM));
  const bestMonth  = nonZero.length ? nonZero.reduce((a,b) => b.rev > a.rev ? b : a) : null;
  const worstMonth = worstCandidates.length ? worstCandidates.reduce((a,b) => b.rev < a.rev ? b : a) : null;
  const isBest  = bestMonth  && bestMonth.y  === year && bestMonth.m  === mi;
  const isWorst = worstMonth && worstMonth.y === year && worstMonth.m === mi;

  el.innerHTML = `
    <div class="page-title">${MONTHS[mi]} ${year}
      ${isBest  ? '<span style="font-size:0.7rem;background:#4a7c59;color:#fff;padding:2px 8px;border-radius:99px;margin-left:8px;vertical-align:middle">🏆 Best Month</span>' : ''}
      ${isWorst ? '<span style="font-size:0.7rem;background:#c0392b;color:#fff;padding:2px 8px;border-radius:99px;margin-left:8px;vertical-align:middle">📉 Lowest Month</span>' : ''}
      ${isReconciled ? '<span style="font-size:0.7rem;background:var(--accent2);color:var(--ink);padding:2px 8px;border-radius:99px;margin-left:8px;vertical-align:middle">✓ Reconciled</span>' : ''}
    </div>
    <div class="page-subtitle">Monthly ledger & performance</div>

    <div class="kpi-row">
      <div class="kpi-card revenue">
        <div class="kpi-label">Revenue</div>
        <div class="kpi-value">${fmt(calc.revenue)}</div>
        ${yoyHtml}
      </div>
      <div class="kpi-card expense">
        <div class="kpi-label">Total Expenses</div>
        <div class="kpi-value">${fmt(calc.expenses)}</div>
        <div class="kpi-sub">${calc.nonExpense
          ? 'Payroll, COGS, overhead — not the ' + fmt(calc.nonExpense) + ' that bought or repaid'
          : 'Incl. payroll, COGS, overhead'}</div>
      </div>
      <div class="kpi-card profit">
        <div class="kpi-label">Net Income</div>
        <div class="kpi-value" style="color:${calc.net >= 0 ? 'var(--green)' : 'var(--red)'}">${fmt(calc.net)}</div>
        <div class="kpi-sub">${calc.nonExpense
          ? 'What trading earned · ' + fmt(calc.nonExpense) + ' of it went out again; the account itself '
            + (calc.bankNet >= 0 ? 'rose ' : 'fell ') + fmt(Math.abs(calc.bankNet))
          : (calc.net >= 0 ? 'Profitable' : 'Net Loss')}</div>
      </div>
      ${calc.nonExpense ? `
      <div class="kpi-card" style="border-top:3px solid var(--mist)">
        <div class="kpi-label">Left the bank, not an expense</div>
        <div class="kpi-value" style="font-size:1.1rem">${fmt(calc.nonExpense)}</div>
        <div class="kpi-sub">${[calc.capital ? fmt(calc.capital) + ' capital' : '',
                               calc.loanPrincipal ? fmt(calc.loanPrincipal) + ' loan' : '',
                               calc.ownerDraw ? fmt(calc.ownerDraw) + ' drawn' : '']
                              .filter(Boolean).join(' · ')}</div>
      </div>` : ''}
      <div class="kpi-card cogs">
        <div class="kpi-label">COGS Efficiency</div>
        <div class="kpi-value">${calc.cogsRatio.toFixed(1)}%</div>
        <div class="kpi-sub">COGS / Revenue</div>
      </div>
      ${prevRev > 0 ? `<div class="kpi-card" style="border-top:3px solid var(--mist)">
        <div class="kpi-label">${year-1} Revenue</div>
        <div class="kpi-value" style="font-size:1.1rem">${fmt(prevRev)}</div>
        <div class="kpi-sub">Prior year baseline</div>
      </div>` : ''}
    </div>

    ${(() => {
      // Only the rows touching THIS month, so the notice is about the screen
      // you are on rather than a standing complaint about the whole book.
      const mis = ledgerMisfiled(year).thisYear.filter(r =>
        (r.fromY === year && r.fromM === mi) || (r.toY === year && r.toM === mi));
      if (!mis.length) return '';
      const here = mis.filter(r => r.fromY === year && r.fromM === mi);
      const belong = mis.filter(r => r.toY === year && r.toM === mi);
      return `<div style="margin-bottom:18px;padding:10px;border-radius:6px;
                          background:var(--paper);border:1px solid var(--border)">
        <strong style="font-size:0.8rem">${mis.length} transaction${mis.length === 1 ? '' : 's'} filed under the wrong month</strong>
        <div style="font-size:0.75rem;color:var(--ink-soft);margin-top:4px">
          ${here.length ? `${here.length} sitting in ${MONTHS[mi]} that ${here.length === 1 ? 'belongs' : 'belong'} elsewhere` : ''}
          ${here.length && belong.length ? ' · ' : ''}
          ${belong.length ? `${belong.length} dated ${MONTHS[mi]} but filed elsewhere` : ''}.
          Entering one from another month's screen used to file it here rather than by its date;
          that is fixed, and these are the ones it caught.
          <strong>No year total changes</strong> — each stays in the year it is already in.
          <div style="margin-top:6px">
            <button class="btn btn-outline btn-sm no-print" style="font-size:0.68rem"
                    onclick="ledgerRefile(${year})">Re-file ${ledgerMisfiled(year).thisYear.length} by date</button>
          </div>
        </div>
      </div>`;
    })()}

    <!-- CATEGORY BREAKDOWN -->
    <div class="cat-breakdown" style="margin-bottom:22px">
      <div class="ledger-header"><h3>Category Breakdown</h3></div>
      <table>
        <thead><tr><th>Category</th><th>Total</th><th>% of Revenue</th></tr></thead>
        <tbody>
          ${CATEGORIES.map(cat => {
            const amt = calc.byCategory[cat] || 0;
            if (amt === 0) return '';
            const pct = calc.revenue > 0 ? (amt / calc.revenue * 100).toFixed(1) : '—';
            const isActive = monthCatFilter[mi] === cat;
            // Capital and the sales-tax remittance both sit in this table because
            // the money moved, but neither is in Total Expenses above. Saying so
            // on the row is what stops the column being added up by eye and
            // disagreeing with the card.
            const aside = nonExpenseNote(cat);
            return `<tr class="cat-clickable${isActive ? ' cat-active' : ''}" onclick="filterByCategory(${mi}, '${cat.replace(/'/g, "\\'")}')" style="cursor:pointer" title="Click to view ${cat} transactions">
              <td><span class="badge">${cat}</span>${isActive ? ' <span style="font-size:0.65rem;color:var(--accent2)">● filtering</span>' : ''}${
                aside ? ` <span style="font-size:0.65rem;color:var(--mist)">${aside}</span>` : ''}</td>
              <td class="${cat === 'Revenue' || isNonRevenueInCat(cat) ? 'amount-in' : 'amount-out'}">${fmt(amt)}</td>
              <td>${pct}%</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>

    <!-- SUPPLIER PIE CHART -->
    <div class="chart-wrap">
      <h3>🌿 Supplies Spend by Vendor</h3>
      <div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap">
        <div style="position:relative;width:260px;height:260px;flex-shrink:0"><canvas id="monthSupplierPie-${mi}"></canvas></div>
        <div id="monthSupplierLegend-${mi}" style="flex:1;font-size:0.75rem;line-height:2"></div>
      </div>
    </div>

    <!-- MANUAL ENTRY FORM -->
    <div class="entry-form">
      <h3>➕ Add Transaction</h3>
      <div class="form-row">
        <div class="form-group">
          <label>Date</label>
          <input type="date" id="new-date-${mi}" value="${year}-${String(mi+1).padStart(2,'0')}-01">
        </div>
        <div class="form-group" style="flex:2">
          <label>Description</label>
          <input type="text" id="new-desc-${mi}" placeholder="Transaction description">
        </div>
        <div class="form-group">
          <label>Category</label>
          <select id="new-cat-${mi}">
            ${CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Vendor</label>
          <input type="text" id="new-vendor-${mi}" placeholder="Vendor">
        </div>
        <div class="form-group">
          <label>Amount ($)</label>
          <input type="number" id="new-amount-${mi}" placeholder="0.00" step="0.01" min="0">
        </div>
        <div class="form-group">
          <label>Type</label>
          <select id="new-type-${mi}">
            <option value="in">Money In</option>
            <option value="out">Money Out</option>
          </select>
        </div>
        <div style="align-self:flex-end">
          <button class="btn btn-primary" onclick="addManualTx(${mi})">Add</button>
        </div>
      </div>
    </div>

    <!-- LEDGER -->
    <div class="ledger-wrap">
      <div class="ledger-header">
        <h3>Ledger — ${(monthCatFilter[mi] ? txs.filter(t => !t._vault && t.category === monthCatFilter[mi]) : txs.filter(t => !t._vault)).length} entries${txs.some(t => t._vault) ? ` <span style="font-size:0.7rem;color:var(--mist)">(+${txs.filter(t=>t._vault).length} vault)</span>` : ''}${monthCatFilter[mi] ? ` <button class="btn btn-outline btn-xs" onclick="filterByCategory(${mi}, null)" style="margin-left:8px;font-size:0.68rem">× ${escHtml(monthCatFilter[mi])} (clear)</button>` : ''}</h3>
        <div style="display:flex;gap:6px;align-items:center">
          ${txs.some(t => t._vault) ? `<label style="font-size:0.72rem;color:var(--mist);display:flex;align-items:center;gap:4px;cursor:pointer"><input type="checkbox" id="show-vault-${mi}" onchange="toggleVault(${mi})" style="cursor:pointer"> Show vault</label>` : ''}
          <button class="btn btn-outline btn-xs" onclick="printMonthSummary(${mi})">🖨 Print / PDF</button>
          <button class="btn btn-danger btn-xs" onclick="clearMonth(${mi})">🗑 Clear Month</button>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th class="sortable" onclick="sortLedger(${mi}, 'date')" style="cursor:pointer">Date ${sortArrow(mi, 'date')}</th>
            <th class="sortable" onclick="sortLedger(${mi}, 'desc')" style="cursor:pointer">Description ${sortArrow(mi, 'desc')}</th>
            <th class="sortable" onclick="sortLedger(${mi}, 'category')" style="cursor:pointer">Category ${sortArrow(mi, 'category')}</th>
            <th class="sortable" onclick="sortLedger(${mi}, 'vendor')" style="cursor:pointer">Vendor ${sortArrow(mi, 'vendor')}</th>
            <th class="sortable" onclick="sortLedger(${mi}, 'amount')" style="cursor:pointer">Amount ${sortArrow(mi, 'amount')}</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="ledger-body-${mi}">
          ${(() => {
            let rows = txs.filter(t => !t._vault);
            if (monthCatFilter[mi]) rows = rows.filter(t => t.category === monthCatFilter[mi]);
            rows = applySortRows(rows, monthSort[mi]);
            if (rows.length === 0) return `<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">🌱</div>${monthCatFilter[mi] ? 'No transactions in this category' : 'No transactions yet'}</div></td></tr>`;
            return rows.map(t => renderTxRow(t, mi, year)).join('');
          })()}
        </tbody>
      </table>
    </div>

    <!-- NOTES & RECONCILE -->
    <div class="entry-form" style="margin-bottom:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <h3>📝 Month Notes</h3>
        <button class="btn btn-outline btn-xs" onclick="toggleReconcile(${mi})" style="font-size:0.75rem">
          ${isReconciled ? '🔓 Un-reconcile' : '✓ Mark Reconciled'}
        </button>
      </div>
      <textarea id="notes-${mi}" rows="3" style="width:100%;background:var(--border);border:1px solid var(--blue-light);border-radius:6px;padding:8px;font-family:Inter,sans-serif;font-size:0.8rem;resize:vertical" placeholder="Add notes about this month... (e.g. Valentine's Day was slow due to snowstorm)">${escHtml(note)}</textarea>
      <div style="margin-top:6px;text-align:right">
        <button class="btn btn-outline btn-xs" onclick="saveNote(${mi})">Save Note</button>
      </div>
    </div>

  `;

  // Render supplier pie chart after DOM is updated
  setTimeout(() => {
    const supplierData = getSupplierData(txs.filter(t => !t._vault));
    renderSupplierPie(`monthSupplierPie-${mi}`, `monthSupplierLegend-${mi}`, supplierData);
  }, 0);
}

function sortArrow(mi, col) {
  const s = monthSort[mi];
  if (!s || s.col !== col) return '<span style="opacity:0.3;font-size:0.7rem">↕</span>';
  return s.dir === 'asc' ? '<span style="font-size:0.7rem">▲</span>' : '<span style="font-size:0.7rem">▼</span>';
}

function applySortRows(rows, sort) {
  if (!sort || !sort.col) return rows;
  const { col, dir } = sort;
  const mult = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    let av, bv;
    if (col === 'amount') {
      av = a.amount || 0; bv = b.amount || 0;
      return (av - bv) * mult;
    }
    if (col === 'date') {
      av = a.date || ''; bv = b.date || '';
      return av < bv ? -1 * mult : av > bv ? 1 * mult : 0;
    }
    // text columns: desc, category, vendor
    av = (a[col] || '').toString().toLowerCase();
    bv = (b[col] || '').toString().toLowerCase();
    return av < bv ? -1 * mult : av > bv ? 1 * mult : 0;
  });
}

function sortLedger(mi, col) {
  const s = monthSort[mi];
  if (s && s.col === col) {
    // toggle direction, then clear on third click
    if (s.dir === 'asc') { monthSort[mi] = { col, dir: 'desc' }; }
    else { monthSort[mi] = null; }
  } else {
    monthSort[mi] = { col, dir: 'asc' };
  }
  renderMonthPanel(mi);
}

function filterByCategory(mi, cat) {
  // Toggle off if clicking the already-active category
  if (cat && monthCatFilter[mi] === cat) {
    monthCatFilter[mi] = null;
  } else {
    monthCatFilter[mi] = cat;
  }
  renderMonthPanel(mi);
}

function renderTxRow(t, mi, year) {
  const isVault = t._vault;
  const amtClass = t.type === 'in' ? 'amount-in' : 'amount-out';
  const sign = t.type === 'in' ? '+' : '−';
  return `<tr id="row-${t.id}" ${isVault ? 'style="opacity:0.75"' : ''}>
    <td>${t.date}</td>
    <td>${escHtml(t.desc || '')}${isVault ? ' <span style="font-size:0.6rem;color:var(--mist)">[vault]</span>' : ''}</td>
    <td><span class="badge">${t.category}</span></td>
    <td>${escHtml(t.vendor || '')}</td>
    <td class="${amtClass}">${sign}${fmt(t.amount)}</td>
    <td>
      ${!isVault ? `<button class="btn btn-outline btn-xs" onclick="openEditModal('${t.id}',${mi},${year})">Edit</button>
      <button class="btn btn-danger btn-xs" style="margin-left:4px" onclick="deleteTx('${t.id}',${mi},${year})">Del</button>` : '<span style="font-size:0.62rem;color:var(--mist)">Vault</span>'}
    </td>
  </tr>`;
}

function toggleVault(mi) {
  const year = appData.activeYear;
  const show = document.getElementById(`show-vault-${mi}`).checked;
  const txs = getTransactions(year, mi);
  const tbody = document.getElementById(`ledger-body-${mi}`);
  let visible = show ? txs : txs.filter(t => !t._vault);
  if (monthCatFilter[mi]) visible = visible.filter(t => t.category === monthCatFilter[mi]);
  visible = applySortRows(visible, monthSort[mi]);
  tbody.innerHTML = visible.length === 0
    ? `<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">🌱</div>No transactions yet</div></td></tr>`
    : visible.map(t => renderTxRow(t, mi, year)).join('');
}

function addManualTx(mi) {
  const year = appData.activeYear;
  const date = document.getElementById(`new-date-${mi}`).value;
  const desc = document.getElementById(`new-desc-${mi}`).value.trim();
  const cat = document.getElementById(`new-cat-${mi}`).value;
  const vendor = document.getElementById(`new-vendor-${mi}`).value.trim();
  const amount = parseFloat(document.getElementById(`new-amount-${mi}`).value);
  const type = document.getElementById(`new-type-${mi}`).value;

  if (!date || !desc || isNaN(amount) || amount <= 0) {
    notify('Please fill all required fields', true); return;
  }

  // Filed by the DATE, not by the panel you happen to be standing on. It used
  // to take the month from `mi` and the year from the active-year selector
  // while the date came from the box, so a March payment entered from the
  // January screen was filed under January carrying a March date -- right in
  // every report that reads the date, wrong in every one that reads the bucket.
  // Four van payments went in that way.
  const d = new Date(date + 'T00:00:00Z');
  if (isNaN(d.getTime())) { notify('That date cannot be read', true); return; }
  const y = d.getUTCFullYear(), m = d.getUTCMonth();

  addTransaction(y, m, { date, desc, category: cat, vendor, amount, type });
  renderMonthPanel(mi);
  // Say where it went when that is not where you are, or a row filed correctly
  // somewhere else looks like a row that vanished.
  notify(y === year && m === mi
    ? 'Transaction added'
    : `Added to ${MONTHS[m]} ${y} — that is the date on it`);
}

// Rows sitting in a month bucket that disagrees with their own date.
//
// Split on purpose. A row whose date is in the SAME year as its bucket can be
// re-filed freely: no annual total moves, so nothing that has already been
// filed with the state can change. One whose date is in a different year is
// reported and left alone -- moving it would shift two years' figures at once,
// and those years are closed.
function ledgerMisfiled(year) {
  const safe = [], crossYear = [];
  Object.keys(appData.transactions || {}).forEach(key => {
    const [by, bm] = key.split('-').map(Number);
    (appData.transactions[key] || []).forEach(t => {
      if (!t.date) return;
      const d = new Date(t.date + 'T00:00:00Z');
      if (isNaN(d.getTime())) return;
      const dy = d.getUTCFullYear(), dm = d.getUTCMonth();
      if (dy === by && dm === bm) return;
      const row = { tx: t, from: key, fromY: by, fromM: bm, toY: dy, toM: dm };
      if (dy === by) safe.push(row); else crossYear.push(row);
    });
  });
  const forYear = y => safe.filter(r => r.fromY === y || r.toY === y);
  return { safe, crossYear, thisYear: year == null ? safe : forYear(year) };
}

function ledgerRefile(year) {
  const rows = ledgerMisfiled(year).thisYear;
  if (!rows.length) { notify('Nothing to re-file'); return; }
  const list = rows.slice(0, 8).map(r =>
    `${r.tx.date}  ${fmt(r.tx.amount)}  ${r.tx.vendor || r.tx.desc || ''}`.trim()).join('\n');
  if (!confirm(`Re-file ${rows.length} transaction${rows.length === 1 ? '' : 's'} ` +
               `into the month its own date says?\n\n${list}` +
               (rows.length > 8 ? `\n… and ${rows.length - 8} more` : '') +
               `\n\nNo year total changes — every one of these stays in the year it is already in.`)) return;
  rows.forEach(r => {
    const from = appData.transactions[r.from] || [];
    const i = from.indexOf(r.tx);
    if (i < 0) return;
    from.splice(i, 1);
    const to = `${r.toY}-${r.toM}`;
    if (!appData.transactions[to]) appData.transactions[to] = [];
    appData.transactions[to].push(r.tx);
  });
  saveData();
  notify(`${rows.length} re-filed by date`);
  renderCurrentPanel();
}

function deleteTx(id, mi, year) {
  if (!confirm('Delete this transaction?')) return;
  deleteTransaction(year, mi, id);
  renderMonthPanel(mi);
  notify('Transaction deleted');
}

// ============================================================
// EDIT MODAL
// ============================================================
let editContext = null;

function openEditModal(id, mi, year) {
  const txs = getTransactions(year, mi);
  const tx = txs.find(t => t.id === id);
  if (!tx) return;
  editContext = { id, mi, year };

  const catSel = document.getElementById('edit-category');
  catSel.innerHTML = CATEGORIES.map(c => `<option value="${c}"${c===tx.category?' selected':''}>${c}</option>`).join('');

  document.getElementById('edit-date').value = tx.date;
  document.getElementById('edit-desc').value = tx.desc || '';
  document.getElementById('edit-vendor').value = tx.vendor || '';
  document.getElementById('edit-amount').value = tx.amount;
  document.getElementById('edit-type').value = tx.type;

  document.getElementById('edit-modal').classList.add('open');
}

function closeModal() {
  document.getElementById('edit-modal').classList.remove('open');
  editContext = null;
}

function saveEdit() {
  if (!editContext) return;
  const { id, mi, year } = editContext;
  updateTransaction(year, mi, id, {
    date: document.getElementById('edit-date').value,
    desc: document.getElementById('edit-desc').value,
    category: document.getElementById('edit-category').value,
    vendor: document.getElementById('edit-vendor').value,
    amount: parseFloat(document.getElementById('edit-amount').value),
    type: document.getElementById('edit-type').value
  });
  closeModal();
  renderMonthPanel(mi);
  notify('Transaction updated');
}

// ============================================================
// CLEAR MONTH
// ============================================================
function clearMonth(mi) {
  const year = appData.activeYear;
  const monthName = MONTHS[mi];
  const key = `${year}-${mi}`;
  const txs = getTransactions(year, mi);
  const nonVault = txs.filter(t => !t._vault);
  if (nonVault.length === 0) { notify('No transactions to clear'); return; }
  if (!confirm(`Delete all ${nonVault.length} imported/manual transactions from ${monthName} ${year}?\n\nVault data will be preserved. This cannot be undone.`)) return;
  appData.transactions[key] = txs.filter(t => t._vault);
  saveData();
  renderMonthPanel(mi);
  notify(`${monthName} ${year} cleared — ${nonVault.length} transactions removed`);
}

// ============================================================
// NOTES & RECONCILE
// ============================================================
function saveNote(mi) {
  const key = `${appData.activeYear}-${mi}`;
  if (!appData.notes) appData.notes = {};
  appData.notes[key] = document.getElementById(`notes-${mi}`).value;
  saveData();
  notify('Note saved');
}

function toggleReconcile(mi) {
  const key = `${appData.activeYear}-${mi}`;
  if (!appData.reconciled) appData.reconciled = {};
  appData.reconciled[key] = !appData.reconciled[key];
  saveData();
  renderMonthPanel(mi);
  notify(appData.reconciled[key] ? 'Month marked as reconciled ✓' : 'Month un-reconciled');
}

// ============================================================
// DUPLICATE DETECTION
// ============================================================
function dupKey(date, amount, desc) {
  return `${date}|${amount}|${(desc||'').slice(0,20).toLowerCase()}`;
}

function countExisting(yr, mo, date, amount, desc) {
  const txs = getTransactions(yr, mo);
  return txs.filter(t =>
    t.amount === amount &&
    t.date === date &&
    (t.desc || '').toLowerCase().includes((desc || '').slice(0, 20).toLowerCase())
  ).length;
}

