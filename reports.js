// ============================================================
// TAX SUMMARY PANEL
// ============================================================
function getYearTx(yr) {
  // Flatten all non-vault transactions for the year (or vault if no real tx)
  let all = [];
  MONTHS_SHORT.forEach((_, mi) => {
    const allTxs = getTransactions(yr, mi);
    const hasReal = allTxs.some(t => !t._vault);
    const txs = hasReal ? allTxs.filter(t => !t._vault) : allTxs;
    all = all.concat(txs);
  });
  return all;
}

function isCashRevenue(t) {
  if (t.category !== 'Revenue') return false;
  const d = (t.desc || '').toLowerCase();
  const v = (t.vendor || '').toLowerCase();
  return d === 'cash' || v === 'cash';
}

function isPayrollTax(t) {
  // Gusto payroll-tax draft (ID 9138864001) — identified by vendor tag or description
  const v = (t.vendor || '').toLowerCase();
  const d = (t.desc || '').toLowerCase();
  return v.includes('gusto') && (v.includes('payroll tax') || d.includes('9138864001'));
}

function isSalesTax(t) {
  if (t.category !== 'Taxes') return false;
  const d = (t.desc || '').toLowerCase();
  const v = (t.vendor || '').toLowerCase();
  return d.includes('sales tax') || d.includes('sw2620818643') || v.includes('sales tax');
}

function isPropertyTax(t) {
  if (t.category !== 'Taxes') return false;
  const d = (t.desc || '').toLowerCase();
  const v = (t.vendor || '').toLowerCase();
  return d.includes('property') || v.includes('property');
}

function renderTaxPanel() {
  const yr = appData.activeYear;
  const el = document.getElementById('tax-summary-content');
  const allTx = getYearTx(yr);

  // Category totals, but: exclude cash revenue from Revenue, and drop Payroll1 entirely
  const totals = {};
  CATEGORIES.forEach(c => totals[c] = 0);
  allTx.forEach(t => {
    if (totals[t.category] === undefined) return;
    if (t.category === 'Payroll1') return;          // excluded from accountant view
    if (isCashRevenue(t)) return;                    // cash revenue excluded
    // Sales tax remitted is money held for the state, not an expense. Excluded
    // here too, so the accountant's view and the monthly P&L agree.
    if (PASSTHROUGH_CATEGORIES.indexOf(t.category) >= 0) return;
    totals[t.category] += t.amount;
  });

  // Tax sub-line breakdown
  const payrollTax = allTx.filter(isPayrollTax).reduce((s,t) => s + t.amount, 0);
  const salesTax   = allTx.filter(isSalesTax).reduce((s,t) => s + t.amount, 0);
  const propertyTax= allTx.filter(isPropertyTax).reduce((s,t) => s + t.amount, 0);

  const revenue = totals['Revenue'] || 0;
  const totalExp = CATEGORIES.filter(c => c !== 'Revenue' && c !== 'Payroll1').reduce((s,c) => s + (totals[c]||0), 0);
  const net = revenue - totalExp;

  el.innerHTML = `
    <div style="display:flex;gap:12px;margin-bottom:24px;flex-wrap:wrap">
      <div class="kpi-card revenue" style="min-width:160px"><div class="kpi-label">Total Revenue</div><div class="kpi-value">${fmt(revenue)}</div></div>
      <div class="kpi-card expense" style="min-width:160px"><div class="kpi-label">Total Expenses</div><div class="kpi-value">${fmt(totalExp)}</div></div>
      <div class="kpi-card profit" style="min-width:160px"><div class="kpi-label">Net Income</div><div class="kpi-value" style="color:${net>=0?'var(--green)':'var(--red)'}">${fmt(net)}</div></div>
    </div>

    <div class="ledger-wrap" style="margin-bottom:20px">
      <div class="ledger-header"><h3>🧾 Tax Breakdown (for accountant)</h3></div>
      <table>
        <thead><tr><th>Tax Type</th><th>Annual Total</th></tr></thead>
        <tbody>
          <tr><td><span class="badge">Payroll Tax</span></td><td class="amount-out">${fmt(payrollTax)}</td></tr>
          <tr><td><span class="badge">Sales Tax</span></td><td class="amount-out">${fmt(salesTax)}</td></tr>
          <tr><td><span class="badge">Property Tax</span></td><td class="amount-out">${fmt(propertyTax)}</td></tr>
        </tbody>
      </table>
    </div>

    <div class="ledger-wrap">
      <div class="ledger-header">
        <h3>📊 ${yr} Category Totals</h3>
        <button class="btn btn-outline btn-xs" onclick="exportTaxCSV(${yr})">⬇ Export CSV</button>
      </div>
      <table>
        <thead><tr><th>Category</th><th>Annual Total</th><th>% of Revenue</th><th>Monthly Avg</th></tr></thead>
        <tbody>
          ${CATEGORIES.filter(c => c !== 'Payroll1' && totals[c] > 0).map(c => {
            const pct = revenue > 0 ? (totals[c]/revenue*100).toFixed(1) : '—';
            const avg = totals[c] / 12;
            return `<tr>
              <td><span class="badge">${c}</span></td>
              <td class="${c==='Revenue'?'amount-in':'amount-out'}">${fmt(totals[c])}</td>
              <td>${pct}%</td>
              <td>${fmt(avg)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

function exportTaxCSV(yr) {
  const allTx = getYearTx(yr);
  const totals = {};
  CATEGORIES.forEach(c => totals[c] = 0);
  allTx.forEach(t => {
    if (totals[t.category] === undefined) return;
    if (t.category === 'Payroll1') return;
    if (isCashRevenue(t)) return;
    totals[t.category] += t.amount;
  });
  const payrollTax = allTx.filter(isPayrollTax).reduce((s,t) => s + t.amount, 0);
  const salesTax   = allTx.filter(isSalesTax).reduce((s,t) => s + t.amount, 0);
  const propertyTax= allTx.filter(isPropertyTax).reduce((s,t) => s + t.amount, 0);
  const rev = totals['Revenue'] || 0;

  let csv = 'Section,Item,Annual Total,% of Revenue,Monthly Avg\n';
  csv += `Tax Breakdown,Payroll Tax,${payrollTax.toFixed(2)},,\n`;
  csv += `Tax Breakdown,Sales Tax,${salesTax.toFixed(2)},,\n`;
  csv += `Tax Breakdown,Property Tax,${propertyTax.toFixed(2)},,\n`;
  CATEGORIES.filter(c => c !== 'Payroll1' && totals[c] > 0).forEach(c => {
    const pct = rev > 0 ? (totals[c]/rev*100).toFixed(1) : '0';
    csv += `Category Totals,"${c}",${totals[c].toFixed(2)},${pct}%,${(totals[c]/12).toFixed(2)}\n`;
  });
  const blob = new Blob([csv], {type:'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bloom-books-tax-${yr}.csv`;
  a.click();
  notify('Tax summary exported');
}

// ============================================================
// HOLIDAY REVENUE PANEL
// ============================================================
const HOLIDAYS = [
  { key: 'valentines', label: "Valentine's Day 💕", month: 1 },
  { key: 'mothers',    label: "Mother's Day 🌸",    month: 4 },
  { key: 'christmas',  label: "Christmas 🎄",       month: 11 },
  { key: 'thanksgiving', label: "Thanksgiving 🍂",  month: 10 },
  { key: 'easter',     label: "Easter 🐣",          month: 3 },
  { key: 'other',      label: "Other Holiday",      month: -1 },
];

function renderHolidayPanel() {
  const el = document.getElementById('holiday-content');
  if (!appData.holidays) appData.holidays = {};

  const rows = appData.years.map(yr => {
    const data = {};
    HOLIDAYS.forEach(h => {
      const key = `${yr}-${h.month !== -1 ? h.month : 'other'}`;
      data[h.key] = (appData.holidays[key] || 0);
    });
    return { yr, data };
  });

  el.innerHTML = `
    <p style="color:var(--mist);font-size:0.8rem;margin-bottom:16px">Enter the revenue you earned specifically from each holiday, or pull it straight from the Sales sheets below. This helps you understand how dependent your business is on key dates.</p>
    ${holidaySetupHtml()}
    ${holidayRefreshHtml()}
    <div class="ledger-wrap">
      <table>
        <thead>
          <tr>
            <th>Holiday</th>
            ${appData.years.map(y => `<th>${y}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${HOLIDAYS.map(h => `
            <tr>
              <td><strong>${h.label}</strong></td>
              ${appData.years.map(yr => {
                const key = `${yr}-${h.month !== -1 ? h.month : 'other'}`;
                const val = appData.holidays[key] || 0;
                return `<td><input type="number" value="${val}" step="0.01" min="0"
                  style="width:90px;background:var(--border);border:1px solid var(--blue-light);border-radius:4px;padding:4px;font-family:Inter,sans-serif;font-size:0.8rem"
                  onchange="saveHoliday('${key}', this.value)"></td>`;
              }).join('')}
            </tr>`).join('')}
          <tr style="font-weight:600;border-top:2px solid var(--blue-light)">
            <td>Total Holiday Revenue</td>
            ${appData.years.map(yr => {
              const total = HOLIDAYS.reduce((s,h) => {
                const key = `${yr}-${h.month !== -1 ? h.month : 'other'}`;
                return s + (appData.holidays[key] || 0);
              }, 0);
              const yearRev = MONTHS_SHORT.reduce((s,_,mi) => s + getRevenue(yr,mi), 0);
              const pct = yearRev > 0 ? (total/yearRev*100).toFixed(1) : '0';
              return `<td class="amount-in">${fmt(total)}<div style="font-size:0.7rem;color:var(--mist)">${pct}% of revenue</div></td>`;
            }).join('')}
          </tr>
        </tbody>
      </table>
    </div>`;
}

function saveHoliday(key, val) {
  if (!appData.holidays) appData.holidays = {};
  appData.holidays[key] = parseFloat(val) || 0;
  saveData();
  // Re-render totals row without full re-render
  renderHolidayPanel();
}

// ============================================================
// TRENDS PANEL
// ============================================================
let trendsChartInst = null;
let growthChartInst = null;
let cogsChartInst = null;

function renderTrendsPanel() {
  updateYearSelects();
  renderTrendsChart();
  renderCogsChart();
}

function renderCogsChart() {
  const checkboxes = document.querySelectorAll('#panel-trends input[type=checkbox]');
  const activeYears = Array.from(checkboxes).filter(c => c.checked).map(c => parseInt(c.value)).sort();
  const yearColors = { 2023:'#8b9b8e', 2024:'#c9a84c', 2025:'#4a7c59', 2026:'#c0392b' };
  const defaultColors = ['#7a5c8a','#2980b9','#e67e22','#16a085'];
  let ci = 0;
  function getColor(y) { return yearColors[y] || defaultColors[ci++ % defaultColors.length]; }

  const datasets = activeYears.map(yr => ({
    label: String(yr),
    data: MONTHS_SHORT.map((_, mi) => {
      const rev = getRevenue(yr, mi);
      if (rev === 0) return null;
      const calc = calcMonth(yr, mi);
      return parseFloat(calc.cogsRatio.toFixed(1));
    }),
    borderColor: getColor(yr),
    backgroundColor: getColor(yr) + '33',
    fill: false,
    tension: 0.3,
    pointRadius: 4,
    borderWidth: 2,
    spanGaps: false
  }));

  if (cogsChartInst) cogsChartInst.destroy();
  const ctx = document.getElementById('cogsChart');
  if (!ctx) return;
  cogsChartInst = new Chart(ctx.getContext('2d'), {
    type: 'line',
    data: { labels: MONTHS_SHORT, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { font: { family: 'Inter' } } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y}%` } }
      },
      scales: {
        x: { ticks: { font: { family: 'Inter' } } },
        y: {
          ticks: { font: { family: 'Inter' }, callback: v => v + '%' },
          title: { display: true, text: 'COGS % of Revenue', font: { family: 'Inter' } }
        }
      }
    }
  });
}

function renderTrendsChart() {
  const checkboxes = document.querySelectorAll('#panel-trends input[type=checkbox]');
  const activeYears = Array.from(checkboxes).filter(c => c.checked).map(c => parseInt(c.value)).sort();

  const yearColors = {
    2023: '#8b9b8e',
    2024: '#c9a84c',
    2025: '#4a7c59',
    2026: '#c0392b'
  };
  const defaultColors = ['#7a5c8a','#2980b9','#e67e22','#16a085'];
  let colorIdx = 0;

  function getColor(y) {
    if (yearColors[y]) return yearColors[y];
    return defaultColors[colorIdx++ % defaultColors.length];
  }

  const datasets = activeYears.map(yr => ({
    label: String(yr),
    data: MONTHS_SHORT.map((_, mi) => getRevenue(yr, mi)),
    backgroundColor: getColor(yr) + 'cc',
    borderColor: getColor(yr),
    borderWidth: 1.5,
    borderRadius: 3
  }));

  // Growth annotations (current = last active year vs previous)
  if (trendsChartInst) trendsChartInst.destroy();
  const ctx = document.getElementById('trendsChart').getContext('2d');
  trendsChartInst = new Chart(ctx, {
    type: 'bar',
    data: { labels: MONTHS_SHORT, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { font: { family: 'Inter' }, color: '#1a1a2e' } },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${fmtK(ctx.parsed.y)}`
          }
        }
      },
      scales: {
        x: { grid: { color: '#e8e8f0' }, ticks: { font: { family: 'Inter' } } },
        y: { grid: { color: '#e8e8f0' }, ticks: { font: { family: 'Inter' }, callback: v => fmtK(v) } }
      }
    }
  });

  // Growth chart
  if (growthChartInst) growthChartInst.destroy();
  const growthYears = activeYears.filter(y => activeYears.includes(y - 1));
  const growthDatasets = growthYears.map(yr => ({
    label: `${yr} vs ${yr-1}`,
    data: MONTHS_SHORT.map((_, mi) => {
      const g = calcYoYGrowth(yr, mi);
      return g !== null ? parseFloat(g.toFixed(1)) : 0;
    }),
    backgroundColor: MONTHS_SHORT.map((_, mi) => {
      const g = calcYoYGrowth(yr, mi);
      return g !== null && g >= 0 ? 'rgba(74,124,89,0.7)' : 'rgba(192,57,43,0.7)';
    }),
    borderColor: getColor(yr),
    borderWidth: 1.5,
    borderRadius: 3
  }));

  const ctx2 = document.getElementById('growthChart').getContext('2d');
  growthChartInst = new Chart(ctx2, {
    type: 'bar',
    data: { labels: MONTHS_SHORT, datasets: growthDatasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { font: { family: 'Inter' }, color: '#1a1a2e' } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y}%` } }
      },
      scales: {
        x: { grid: { color: '#e8e8f0' }, ticks: { font: { family: 'Inter' } } },
        y: {
          grid: { color: '#e8e8f0' },
          ticks: { font: { family: 'Inter' }, callback: v => v + '%' },
          suggestedMin: -30, suggestedMax: 30
        }
      }
    }
  });
}

// ============================================================
// YEARLY SUMMARY
// ============================================================
let yearlyChartInst = null;
let yearlyChartInst2 = null;
let yearlySupplierPieInst = null;
let yearlyChartInst3 = null;
const monthSupplierPieInsts = {};

const SUPPLIER_COLORS = [
  '#4a7c59','#c9a84c','#c0392b','#2980b9','#8e44ad',
  '#e67e22','#16a085','#7a5c8a','#d35400','#1abc9c',
  '#e74c3c','#f39c12','#27ae60','#2c3e50','#8b9b8e'
];

function getSupplierData(txs) {
  // Group COGS transactions by vendor
  const vendorTotals = {};
  txs.filter(t => t.category === 'Supplies & Materials - COGS' && t.type === 'out')
    .forEach(t => {
      const v = t.vendor || 'Unknown';
      vendorTotals[v] = (vendorTotals[v] || 0) + t.amount;
    });
  // Sort by amount desc
  const sorted = Object.entries(vendorTotals).sort((a,b) => b[1]-a[1]);
  return sorted;
}

function renderSupplierPie(canvasId, legendId, data) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  if (!data.length) {
    canvas.parentElement.innerHTML = '<div class="empty-state"><div class="empty-icon">🌱</div>No supply purchases yet</div>';
    return;
  }
  const labels = data.map(d => d[0]);
  const values = data.map(d => d[1]);
  const total  = values.reduce((s,v) => s+v, 0);
  const colors = data.map((_,i) => SUPPLIER_COLORS[i % SUPPLIER_COLORS.length]);

  // Destroy existing
  if (Chart.getChart(canvas)) Chart.getChart(canvas).destroy();

  new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 2, borderColor: '#faf7f0' }] },
    options: {
      responsive: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${fmt(ctx.parsed)} (${(ctx.parsed/total*100).toFixed(1)}%)` } }
      }
    }
  });

  // Custom legend
  const legendEl = document.getElementById(legendId);
  if (legendEl) {
    legendEl.innerHTML = data.map((d,i) => `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <div style="width:12px;height:12px;border-radius:2px;background:${colors[i]};flex-shrink:0"></div>
        <span style="flex:1;color:var(--ink)">${d[0]}</span>
        <span style="color:var(--green);font-weight:500">${fmt(d[1])}</span>
        <span style="color:var(--mist)">${(d[1]/total*100).toFixed(1)}%</span>
      </div>`).join('');
  }
}

function renderYearlyPanel() {
  const grid = document.getElementById('yearly-grid-content');
  const yearRows = appData.years.map(yr => {
    const totals = MONTHS_SHORT.reduce((acc, _, mi) => {
      const c = calcMonth(yr, mi);
      acc.revenue += c.revenue;
      acc.expenses += c.expenses;
      acc.net += c.net;
      return acc;
    }, { revenue: 0, expenses: 0, net: 0 });

    // YoY annual growth
    const prevRevTotal = MONTHS_SHORT.reduce((s, _, mi) => s + getRevenue(yr-1, mi), 0);
    const annualGrowth = prevRevTotal > 0 ? ((totals.revenue - prevRevTotal) / prevRevTotal * 100) : null;

    return { yr, ...totals, annualGrowth };
  });

  grid.innerHTML = `
    <div class="yearly-grid">
      ${yearRows.map(r => `
        <div class="year-card" onclick="setActiveYear(${r.yr});switchPanel('month-0')">
          <h4>${r.yr}</h4>
          <div class="stat-row"><span>Revenue</span><span class="amount-in">${fmt(r.revenue)}</span></div>
          <div class="stat-row"><span>Expenses</span><span class="amount-out">${fmt(r.expenses)}</span></div>
          <div class="stat-row"><span>Net Income</span><span style="color:${r.net>=0?'var(--green)':'var(--red)'}">${fmt(r.net)}</span></div>
          ${r.annualGrowth !== null ? `<div class="stat-row"><span>YoY Growth</span><span class="${r.annualGrowth>=0?'growth-up':'growth-down'}">${r.annualGrowth>=0?'▲':'▼'} ${Math.abs(r.annualGrowth).toFixed(1)}%</span></div>` : ''}
        </div>
      `).join('')}
    </div>

    <div class="chart-wrap" style="margin-bottom:20px;">
      <h3>Monthly Revenue — Annual Comparison</h3>
      <div class="chart-container" style="height:380px;"><canvas id="annualComparisonChart"></canvas></div>
    </div>
  `;

  // Annual Comparison grouped bar chart (by month, one bar per year)
  if (yearlyChartInst) yearlyChartInst.destroy();
  const yearColors = { 2023: '#8b9b8e', 2024: '#c9a84c', 2025: '#4a7c59', 2026: '#c0392b' };
  const fallbackColors = ['#7a5c8a','#2980b9','#e67e22','#16a085'];
  let fci = 0;
  const annualDatasets = appData.years.map(yr => {
    const color = yearColors[yr] || fallbackColors[fci++ % fallbackColors.length];
    return {
      label: String(yr),
      data: MONTHS_SHORT.map((_, mi) => getRevenue(yr, mi)),
      backgroundColor: color + 'cc',
      borderColor: color,
      borderWidth: 1.5,
      borderRadius: 3
    };
  });

  const ctx = document.getElementById('annualComparisonChart').getContext('2d');
  yearlyChartInst = new Chart(ctx, {
    type: 'bar',
    data: { labels: MONTHS_SHORT, datasets: annualDatasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { font: { family: 'Inter' }, color: '#1a1a2e' } },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}`
          }
        }
      },
      scales: {
        x: { grid: { color: '#e8e8f0' }, ticks: { font: { family: 'Inter' } } },
        y: { grid: { color: '#e8e8f0' }, ticks: { font: { family: 'Inter' }, callback: v => fmtK(v) }, beginAtZero: true }
      }
    }
  });

  // Annual totals bar chart (below)
  if (yearlyChartInst2) yearlyChartInst2.destroy();
  const annTotals = appData.years.map(yr => {
    const c = MONTHS_SHORT.reduce((acc,_,mi) => { const m = calcMonth(yr,mi); acc.rev+=m.revenue; acc.exp+=m.expenses; return acc; }, {rev:0,exp:0});
    return c;
  });
  const ctx2 = document.getElementById('yearlyChart').getContext('2d');
  yearlyChartInst2 = new Chart(ctx2, {
    type: 'bar',
    data: {
      labels: appData.years.map(String),
      datasets: [
        { label: 'Revenue', data: annTotals.map(t=>t.rev), backgroundColor: 'rgba(74,124,89,0.8)', borderRadius: 4 },
        { label: 'Expenses', data: annTotals.map(t=>t.exp), backgroundColor: 'rgba(192,57,43,0.7)', borderRadius: 4 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { font: { family: 'Inter' } } } },
      scales: {
        x: { ticks: { font: { family: 'Inter' } } },
        y: { ticks: { font: { family: 'Inter' }, callback: v => fmtK(v) } }
      }
    }
  });

  // Annual Category Breakdown — stacked bar by category per year
  if (yearlyChartInst3) yearlyChartInst3.destroy();
  const expCats = CATEGORIES.filter(c => c !== 'Revenue');
  const catColorMap = {
    'Payroll':'#1a5fa8','Payroll1':'#4a8abf','Supplies & Materials - COGS':'#e67e22',
    'Taxes':'#c0392b','Utilities':'#8e44ad','Transpo':'#16a085','Vehicles':'#2980b9',
    'Office':'#7f8c8d','Insurance':'#d35400','FSN':'#27ae60',
    'Repairs/Maintenance':'#8b0000','Rent':'#2c3e50','Phone/Internet':'#6c3483','Marketing':'#e74c3c'
  };
  const catDatasets = expCats.map(cat => ({
    label: cat,
    data: appData.years.map(yr =>
      MONTHS_SHORT.reduce((s, _, mi) => s + (calcMonth(yr, mi).byCategory[cat] || 0), 0)
    ),
    backgroundColor: (catColorMap[cat] || '#888') + 'cc',
    borderWidth: 0
  })).filter(ds => ds.data.some(v => v > 0));

  const ctx3 = document.getElementById('yearlyCatChart').getContext('2d');
  yearlyChartInst3 = new Chart(ctx3, {
    type: 'bar',
    data: { labels: appData.years.map(String), datasets: catDatasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { font: { family: 'Inter' }, boxWidth: 12, fontSize: 11 } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}` } }
      },
      scales: {
        x: { stacked: true, ticks: { font: { family: 'Inter' } } },
        y: { stacked: true, ticks: { font: { family: 'Inter' }, callback: v => fmtK(v) } }
      }
    }
  });

  // Supplier pie — all transactions across active year (exclude vault)
  const allYearTxs = MONTHS_SHORT.reduce((arr, _, mi) => {
    return arr.concat(getTransactions(appData.activeYear, mi).filter(t => !t._vault));
  }, []);
  setTimeout(() => renderSupplierPie('yearlySupplierPie', 'yearlySupplierLegend', getSupplierData(allYearTxs)), 0);
}

