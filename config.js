// ============================================================
// CONSTANTS & CATEGORIES
// ============================================================
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// 'Payment Processing' is for Stripe's and Venmo's cut. Both net their fees out
// of what they deposit, so unlike EPX -- whose reader fee arrives as its own
// debit, and whose processing is surcharged to the customer -- the cost appears
// nowhere in the bank. Once revenue is counted gross from the day book, that
// cost has to be entered as an expense or it is simply missing from the books.
// One figure per processor per month, from their own reports.
//
// Note a category is stored on each transaction as a plain string, so renaming
// one later leaves historical entries pointing at the old name. Worth settling
// on the wording before entries exist rather than after.
const CATEGORIES = [
  'Revenue','Payroll','Payroll1','Supplies & Materials - COGS',
  'Taxes','Sales Tax Remitted','Utilities','Transpo','Vehicles','Office','Insurance',
  'FSN','Payment Processing','Repairs/Maintenance','Rent','Phone/Internet','Marketing',
  'Capital Expenditure','Loan Repayment','Interest','Owner Draw'
];

// Money that passes through the business without ever being earned or spent.
// Sales tax is collected on New York State's behalf and handed over; it is not
// revenue when it arrives and not an expense when it leaves.
//
// Both halves have to be excluded or neither. Revenue already excludes it --
// the day book records sales tax-exclusive -- so counting the remittance as an
// expense would drop net income by the entire tax bill for money that was never
// the shop's. Categorised separately from 'Taxes', which holds real expenses
// like payroll tax.
//
// These transactions stay in the ledger. The money genuinely left the bank and
// the record of that matters; it simply is not an expense.
const PASSTHROUGH_CATEGORIES = ['Sales Tax Remitted'];

// Money the shop spent that bought something lasting rather than being consumed
// -- a cooler, a van, a build-out. It is deducted over the asset's life on the
// depreciation schedule, not in the month the cheque cleared, so counting it as
// an expense makes a month that invested look like a month that lost money.
// The $10,000 basement cooler sat in Repairs/Maintenance and turned a summer
// that traded slightly UP into one that read as down.
//
// NOT the same treatment as a passthrough, and the difference matters. Sales
// tax was never the shop's money, so it can leave both sides and nothing is
// owed an explanation. Capital IS the shop's money and it really did leave the
// bank -- so it is taken out of the operating result and then shown on its own,
// or net income quietly stops accounting for the balance. Every screen that
// removes it from expenses has to state it somewhere.
//
// What belongs here is a judgement the accountant makes, not this app: broadly,
// something that lasts beyond the year and improves or adds to what the shop
// has, rather than keeping it running. Repairs/Maintenance is still the right
// home for fixing what is already there.
const CAPITAL_CATEGORIES = ['Capital Expenditure'];

// The other half of the van. A loan repayment is not an expense either, but for
// a different reason: it does not buy anything, it pays down what is owed. Only
// the INTEREST is a cost, which is why Interest is its own ordinary expense
// category -- with nowhere to put it, it was being swallowed by the repayment.
//
// The books had the whole $522.39 a month under Vehicles, so they showed about
// $6,270 a year of expense that mostly was not one. The accountant corrects it
// afterwards because the van is on the depreciation schedule; that made the
// return right and left these books wrong.
//
// Split it once a year, not monthly: Valley Bank states the year's interest,
// which goes in as a single Interest row. Amortising twelve payments by hand to
// reach the same figure is work with nothing at the end of it.
const LOAN_PRINCIPAL_CATEGORIES = ['Loan Repayment'];

// Money the owner takes out. Not an expense on a sole trader, a single-member
// LLC or a partnership: the owner is taxed on the profit whether it is drawn or
// left in, so a draw never reduces it. Which is why the accountant does not
// want it -- and also why leaving it out entirely is wrong HERE. It left the
// bank, so without it these books cannot reconcile to the balance.
//
// (An S-corp is the exception: there the owner's reasonable wages are real
// payroll and belong under Payroll, not here. Worth knowing which you are.)
//
// Note BUILTIN_RULES still IGNORES rows matching the owner's name outright, so
// a draw does not reach the ledger at all. Recording it as a draw rather than
// discarding it is the change that makes the bank tie out; the rule is left
// alone because flipping it also pulls in whatever else that name matched.
const OWNER_DRAW_CATEGORIES = ['Owner Draw'];

// Money that genuinely left the bank without being an operating expense. Kept
// as one list because every screen has the same duty towards all of them --
// take them out of the expense total, then say on the same screen where they
// went, or net income quietly stops explaining the balance.
const NON_EXPENSE_CATEGORIES = CAPITAL_CATEGORIES
  .concat(LOAN_PRINCIPAL_CATEGORIES)
  .concat(OWNER_DRAW_CATEGORIES);

function isCapitalCat(c) { return CAPITAL_CATEGORIES.indexOf(c) >= 0; }
function isLoanPrincipalCat(c) { return LOAN_PRINCIPAL_CATEGORIES.indexOf(c) >= 0; }
function isOwnerDrawCat(c) { return OWNER_DRAW_CATEGORIES.indexOf(c) >= 0; }
function isNonExpenseCat(c) { return NON_EXPENSE_CATEGORIES.indexOf(c) >= 0; }

// What a non-expense row should say about itself, wherever it is listed beside
// real expenses.
function nonExpenseNote(c) {
  if (isCapitalCat(c)) return 'not an expense — depreciated';
  if (isLoanPrincipalCat(c)) return 'not an expense — repays what is owed';
  if (isOwnerDrawCat(c)) return 'not an expense — your own money out';
  if (PASSTHROUGH_CATEGORIES.indexOf(c) >= 0) return 'not an expense — held for the state';
  return '';
}

const EXPENSE_CATS = CATEGORIES.filter(c =>
  c !== 'Revenue' && !PASSTHROUGH_CATEGORIES.includes(c) && !NON_EXPENSE_CATEGORIES.includes(c));

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
  // 'DELAWARE VALLEY', not 'DELAWARE VALLEY FLOR': Amex writes the long name
  // but Chase's ACH records shorten it to "ORIG CO NAME:DELAWARE VALLEY", so
  // the longer keyword silently missed every bank-paid purchase. The only
  // other payee starting DEL is DELUXE BUS SYS., so there is no collision.
  { keyword: 'DELAWARE VALLEY',          sign: 'any', category: 'Supplies & Materials - COGS', vendor: 'Delaware Valley Florist' },
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

