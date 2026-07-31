// ============================================================
// CONSTANTS & CATEGORIES
// ============================================================
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const CATEGORIES = [
  'Revenue','Payroll','Payroll1','Supplies & Materials - COGS',
  'Taxes','Utilities','Transpo','Vehicles','Office','Insurance',
  'FSN','Repairs/Maintenance','Rent','Phone/Internet','Marketing'
];

const EXPENSE_CATS = CATEGORIES.filter(c => c !== 'Revenue');

// Built-in hardcoded rules (always applied before user rules)
const BUILTIN_RULES = [
  // IGNORE
  { keyword: 'BARAMI WASPE',              ignore: true },
  { keyword: 'AMERICAN EXPRESS',          ignore: true },
  { keyword: 'AMEX',                      ignore: true },
  { keyword: 'MP GARDENS',               ignore: true },
  { keyword: 'COUNTRY MARKETS',          ignore: true },
  // REVENUE
  { keyword: 'FLOWER SHOP',              sign: 'in',  category: 'Revenue',                        vendor: 'Flower Shop' },
  { keyword: 'STRIPE',                   sign: 'any', category: 'Revenue',                        vendor: 'Stripe' },
  { keyword: 'REMOTE ONLINE DEPOSIT',    sign: 'any', category: 'Revenue',                        vendor: 'Check Deposit' },
  { keyword: 'MERCH SETL',               sign: 'any', category: 'Revenue',                        vendor: 'Merchant Settlement' },
  // FSN
  { keyword: 'FLOWER SHOP',              sign: 'out', category: 'FSN',                            vendor: 'FSN' },
  { keyword: 'TELEFLORA',                sign: 'any', category: 'FSN',                            vendor: 'Teleflora' },
  // COGS
  { keyword: 'MAIN WHOLESALE FLORIST',   sign: 'any', category: 'Supplies & Materials - COGS',    vendor: 'Main Wholesale Florist' },
  // PAYROLL — Zelle employee payments
  { keyword: 'Zelle payment to Rowan',    sign: 'any', category: 'Payroll', vendor: 'Rowan G. Kochman' },
  { keyword: 'Zelle payment to Brittani', sign: 'any', category: 'Payroll', vendor: 'Brittani' },
  { keyword: 'Zelle payment to Karen',    sign: 'any', category: 'Payroll', vendor: 'Karen Kubinec' },
  // GUSTO: FEE (ID:9138864007) = Office; TAX/payroll (ID:9138864001) = Payroll
  { keyword: '9138864007',               sign: 'any', category: 'Office',   vendor: 'Gusto (Fee)' },
  { keyword: '9138864001',               sign: 'any', category: 'Payroll',  vendor: 'Gusto (Payroll Tax)' },
  // RENT — only CHECK_PAID entries (not CHECK_DEPOSIT which are revenue)
  { keyword: 'CHECK_PAID',               sign: 'any', category: 'Rent',     vendor: 'Rent Check' },
  // UTILITIES
  { keyword: 'CON ED',                   sign: 'any', category: 'Utilities', vendor: 'Con Edison' },
  // AMEX VENDORS
  { keyword: 'AMAZON TIPS',              ignore: true },
  { keyword: 'MOBILE PAYMENT',           ignore: true },
  { keyword: 'YOUR CASH REWARD',         ignore: true },
  { keyword: 'TRADER JOE',               sign: 'any', category: 'Supplies & Materials - COGS', vendor: 'Trader Joes' },
  { keyword: 'ALEXANDER HAY',            sign: 'any', category: 'Supplies & Materials - COGS', vendor: 'Alexander Hay' },
  { keyword: 'DELAWARE VALLEY FLOR',     sign: 'any', category: 'Supplies & Materials - COGS', vendor: 'Delaware Valley Florist' },
  { keyword: 'A PERRI FARMS',            sign: 'any', category: 'Supplies & Materials - COGS', vendor: 'A. Perri Farms' },
  { keyword: 'FISCH FLORAL',             sign: 'any', category: 'Supplies & Materials - COGS', vendor: 'Fisch Floral Supply' },
  { keyword: 'CLIFTON WHOLESALE',        sign: 'any', category: 'Supplies & Materials - COGS', vendor: 'Clifton Wholesale Florist' },
  { keyword: 'AMAZON',                   sign: 'any', category: 'Office',        vendor: 'Amazon' },
  { keyword: 'STATE FARM',               sign: 'any', category: 'Insurance',     vendor: 'State Farm' },
  { keyword: 'TRAVELERS PER INS',        sign: 'any', category: 'Insurance',     vendor: 'Travelers Insurance' },
  { keyword: 'GOOGLE *ADS',              sign: 'any', category: 'Marketing',     vendor: 'Google Ads' },
  { keyword: 'GOOGLE *WORKSPACE',        sign: 'any', category: 'Office',        vendor: 'Google Workspace' },
  { keyword: 'VERIZON',                  sign: 'any', category: 'Phone/Internet', vendor: 'Verizon' },
  { keyword: 'FLORANEXT',                sign: 'any', category: 'Office',        vendor: 'Floranext' },
  { keyword: 'EXXONMOBIL',              sign: 'any', category: 'Transpo',       vendor: 'Exxon' },
  { keyword: 'PASSNY TOLLBYMAI',         sign: 'any', category: 'Transpo',       vendor: 'NY Tolls' },
  { keyword: 'SP MERI-MERI',            sign: 'any', category: 'Office',        vendor: 'Meri-Meri' },
];

// ============================================================
// DATA STORE
// ============================================================
let appData = {
  transactions: {},   // { "2023-0": [ {id,date,desc,category,vendor,amount,type} ] }
  rules: [],          // [ {keyword, sign, category, vendor} ]
  years: [2023, 2024, 2025, 2026],
  activeYear: 2025,
  notes: {},          // { "2025-0": "text..." }
  reconciled: {},     // { "2025-0": true }
  holidays: {}        // { "2025-0": { valentines: 0, mothers: 0, christmas: 0, other: 0 } }
};

// ============================================================
// VAULT DATA (historical pre-BloomBooks totals)
// Source of truth is the private Google Sheet tab defined by VAULT_TAB.
// Layout of that tab (row 1 is a header and is ignored):
//   A=year  B=revenue|expenses  C..N = Jan..Dec amounts
// Cached in localStorage so the figures survive offline / pre-auth loads.
// ============================================================
let VAULT_REVENUE  = {};
let VAULT_EXPENSES = {};

const VAULT_TAB       = 'VaultTotals';
const VAULT_CACHE_KEY = 'bloombooks_vault_v1';

function loadVaultFromCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(VAULT_CACHE_KEY) || 'null');
    if (!cached) return false;
    VAULT_REVENUE  = cached.revenue  || {};
    VAULT_EXPENSES = cached.expenses || {};
    return true;
  } catch (e) { return false; }
}

function parseVaultRows(rows) {
  const rev = {}, exp = {};
  (rows || []).forEach(row => {
    const year = parseInt(row[0], 10);
    const kind = String(row[1] || '').trim().toLowerCase();
    if (!year || (kind !== 'revenue' && kind !== 'expenses')) return; // skips header/blank rows
    const months = [];
    for (let mi = 0; mi < 12; mi++) {
      const n = parseFloat(String(row[mi + 2] == null ? '' : row[mi + 2]).replace(/[$,\s]/g, ''));
      months.push(Number.isFinite(n) ? n : 0);
    }
    if (kind === 'revenue') rev[year] = months; else exp[year] = months;
  });
  return { rev, exp };
}

async function loadVaultTotals() {
  if (!accessToken) { loadVaultFromCache(); return; }
  try {
    const url = `${SHEETS_BASE}/${SHEET_ID}/values/${encodeURIComponent(VAULT_TAB + '!A1:N200')}`;
    const res = await fetchRetry(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
    if (!res.ok) { loadVaultFromCache(); return; }
    const { rev, exp } = parseVaultRows((await res.json()).values);
    if (!Object.keys(rev).length && !Object.keys(exp).length) { loadVaultFromCache(); return; }
    VAULT_REVENUE  = rev;
    VAULT_EXPENSES = exp;
    try {
      localStorage.setItem(VAULT_CACHE_KEY, JSON.stringify({ revenue: rev, expenses: exp }));
    } catch (e) {}
  } catch (e) {
    console.warn('Vault totals load failed:', e);
    loadVaultFromCache();
  }
}

function ensureVaultData() {
  // rules now sync to the sheet metadata; ensure it's always a valid array
  if (!Array.isArray(appData.rules)) appData.rules = [];
  const vaultYears = new Set(
    [].concat(
      Object.keys(VAULT_REVENUE),
      Object.keys(VAULT_EXPENSES),
      (appData.years || [])
    ).map(Number).filter(Boolean)
  );
  vaultYears.forEach(year => {
    MONTHS_SHORT.forEach((_, mi) => {
      const key = `${year}-${mi}`;
      if (!appData.transactions[key]) {
        appData.transactions[key] = [];
      }
      // Add vault entries if none exist for that month
      const hasVault = appData.transactions[key].some(t => t._vault);
      if (!hasVault) {
        const rev = VAULT_REVENUE[year] && VAULT_REVENUE[year][mi];
        const exp = VAULT_EXPENSES[year] && VAULT_EXPENSES[year][mi];
        if (rev) {
          appData.transactions[key].unshift({
            id: `vault-rev-${year}-${mi}`,
            date: `${year}-${String(mi+1).padStart(2,'0')}-01`,
            desc: 'Total Revenue (Vault)',
            category: 'Revenue',
            vendor: 'Flower Shop',
            amount: rev,
            type: 'in',
            _vault: true
          });
        }
        if (exp) {
          appData.transactions[key].push({
            id: `vault-exp-${year}-${mi}`,
            date: `${year}-${String(mi+1).padStart(2,'0')}-01`,
            desc: 'Total Expenses (Vault)',
            category: 'Supplies & Materials - COGS',
            vendor: 'Various',
            amount: exp,
            type: 'out',
            _vault: true
          });
        }
      }
    });
  });
}

