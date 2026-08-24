// ============================================================
// HOLIDAY REVENUE — REFRESH FROM THE SALES SHEETS
// ============================================================
// Reads the "Sales <year>" workbooks and totals the daily figures into the
// holiday windows the Holiday Revenue page displays. Uses the Sheets access
// token this app already holds; no extra OAuth scope.
//
// Every guard below exists because the real sheets tripped it when these
// figures were first extracted by hand on 2026-08-03. None is hypothetical:
//
//   * Sales 2026's Sep-Dec tabs held byte-identical copies of Sales 2025's,
//     left over from duplicating the workbook. Read naively, this writes last
//     year's Christmas into this year, every single refresh, silently.
//   * Sales 2023 starts in JULY, so tab order does not imply January.
//   * Dec 9 2023 was blank in the Total row while the payment rows below it
//     held $775 of sales — a formula never filled down.
//   * The Total row sits at a different row number in different years.
//
// So: every tab is validated against the calendar before it is believed, and
// nothing is written without being shown first.

const HOLIDAY_TAB_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DOW_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// ---- date maths -------------------------------------------
// Easter moves; Mother's Day and Thanksgiving are nth-weekday rules. Computed,
// never tabulated, so this keeps working in years nobody thought about.
function easterSunday(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mo = Math.floor((h + l - 7 * m + 114) / 31);
  const da = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, mo - 1, da));
}
function nthWeekdayOf(y, month, weekday, n) {
  const first = new Date(Date.UTC(y, month, 1));
  const shift = (weekday - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(y, month, 1 + shift + (n - 1) * 7));
}
const hsAddDays = (d, n) => new Date(d.getTime() + n * 86400000);
const hsIso = d => d.toISOString().slice(0, 10);

// The windows, per the owner's rules: a week up to and including each holiday,
// except Thanksgiving (Mon-Thu of that week) and Christmas (all of December).
function holidayWindowsFor(y) {
  const valentine = new Date(Date.UTC(y, 1, 14));
  const easter = easterSunday(y);
  const mother = nthWeekdayOf(y, 4, 0, 2);
  const thanks = nthWeekdayOf(y, 10, 4, 4);
  return [
    { key: `${y}-1`,  label: "Valentine's Day", from: hsAddDays(valentine, -6), to: valentine },
    { key: `${y}-3`,  label: 'Easter',          from: hsAddDays(easter, -6),    to: easter },
    { key: `${y}-4`,  label: "Mother's Day",    from: hsAddDays(mother, -6),    to: mother },
    { key: `${y}-10`, label: 'Thanksgiving',    from: hsAddDays(thanks, -3),    to: thanks },
    { key: `${y}-11`, label: 'Christmas',       from: new Date(Date.UTC(y, 11, 1)), to: new Date(Date.UTC(y, 11, 31)) },
  ];
}

// ---- config -----------------------------------------------
// Accepts a full Google Sheets URL or a bare id, so the browser address bar
// can just be pasted in.
function extractSheetId(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : s;
}
function getSalesSheetId(year) {
  return (appData.salesSheets || {})[year] || '';
}
function setSalesSheetId(year, value) {
  if (!appData.salesSheets) appData.salesSheets = {};
  const id = extractSheetId(value);
  if (id) appData.salesSheets[year] = id; else delete appData.salesSheets[year];
  saveData();
  renderHolidayPanel();
}

// ---- reading a workbook -----------------------------------
const hsNum = v => {
  const raw = String(v == null ? '' : v).replace(/[$,\s]/g, '');
  if (raw === '' ) return null;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : null;
};

// Pulls { 'YYYY-MM-DD': dailyTotal } out of one Sales workbook, plus a list of
// anything that looked wrong. Tabs that fail validation contribute nothing.
async function readSalesWorkbook(sheetId, year, problems) {
  const auth = { headers: { 'Authorization': `Bearer ${accessToken}` } };

  const metaRes = await fetchRetry(`${SHEETS_BASE}/${sheetId}?fields=sheets.properties.title`, auth);
  if (!metaRes.ok) throw new Error(metaRes.status + ' ' + (await metaRes.text()).slice(0, 200));
  const titles = ((await metaRes.json()).sheets || []).map(s => s.properties.title);

  // One tab per month; anything else in the workbook is ignored.
  const monthTabs = [];
  titles.forEach(t => {
    const m = HOLIDAY_TAB_MONTHS.indexOf(String(t).trim().slice(0, 3).toLowerCase());
    if (m >= 0) monthTabs.push({ title: t, month: m });
  });
  if (!monthTabs.length) { problems.push(`${year}: no month tabs found in that workbook`); return {}; }

  const ranges = monthTabs
    .map(t => `ranges=${encodeURIComponent(`'${t.title.replace(/'/g, "''")}'!A1:AK40`)}`)
    .join('&');
  const valRes = await fetchRetry(`${SHEETS_BASE}/${sheetId}/values:batchGet?${ranges}`, auth);
  if (!valRes.ok) throw new Error(valRes.status + ' ' + (await valRes.text()).slice(0, 200));
  const valueRanges = (await valRes.json()).valueRanges || [];

  // daily     : { 'YYYY-MM-DD': totalForTheDay }
  // byChannel : { 'YYYY-MM-DD': { '<row label>': amount } } — the payment rows
  //             above the Total, keyed by their label exactly as written. The
  //             labels drift (December 2025 says "fsn" where every other month
  //             says "FN") and the row ORDER drifts too, so callers must map by
  //             label and report anything they don't recognise rather than
  //             quietly dropping a channel's takings.
  const daily = {};
  const byChannel = {};
  monthTabs.forEach((tab, idx) => {
    const rows = (valueRanges[idx] || {}).values || [];
    const monthLen = new Date(Date.UTC(year, tab.month + 1, 0)).getUTCDate();

    // The dates run across a row as 1,2,3... Find it rather than assuming a row
    // number: these sheets have shifted over the years.
    let dateRow = -1;
    for (let r = 0; r < Math.min(rows.length, 6); r++) {
      const cells = rows[r] || [];
      let run = 0;
      for (let c = 1; c <= 28 && c < cells.length; c++) {
        if (String(cells[c]).trim() === String(c)) run++; else break;
      }
      if (run >= 28) { dateRow = r; break; }
    }
    if (dateRow < 0) { problems.push(`${year} ${tab.title}: no row of day numbers found — tab skipped`); return; }

    // How many day columns this tab actually has.
    let nDays = 0;
    const hdr = rows[dateRow];
    for (let c = 1; c < hdr.length; c++) {
      if (String(hdr[c]).trim() === String(c)) nDays = c; else break;
    }

    // Weekday row, then the Total row, located by its label in column A.
    const dowRow = rows[dateRow + 1] || [];
    let totalRow = null;
    const componentRows = [];
    for (let r = dateRow + 2; r < rows.length; r++) {
      const label = String((rows[r] || [])[0] || '').trim();
      if (/^total$/i.test(label)) { totalRow = rows[r]; break; }
      if (label) componentRows.push(rows[r]);
    }
    if (!totalRow) { problems.push(`${year} ${tab.title}: no "Total" row found — tab skipped`); return; }

    // THE GUARD THAT MATTERS. A tab named "Nov" holding last year's November
    // still says "Nov". The weekday of day 1 does not lie.
    const expectedDow = DOW_NAMES[new Date(Date.UTC(year, tab.month, 1)).getUTCDay()];
    const gotDow = String(dowRow[1] || '').trim().slice(0, 3).toLowerCase();
    if (gotDow && gotDow !== expectedDow) {
      problems.push(
        `${year} ${tab.title}: day 1 is labelled ${gotDow} but ${year} says ${expectedDow}. ` +
        `That usually means the tab still holds a previous year's figures — tab skipped.`);
      return;
    }
    if (nDays !== monthLen) {
      problems.push(`${year} ${tab.title}: ${nDays} day columns, ${year} says ${monthLen} — using the first ${Math.min(nDays, monthLen)}`);
    }

    let daySum = 0;
    for (let d = 1; d <= Math.min(nDays, monthLen); d++) {
      let v = hsNum(totalRow[d]);
      if (v === null) {
        // Total formula missing for that day; the payment rows still have it.
        const parts = componentRows.map(r => hsNum((r || [])[d])).filter(x => x !== null);
        if (parts.length) {
          const recovered = parts.reduce((a, c) => a + c, 0);
          if (recovered !== 0) {
            v = recovered;
            problems.push(`${year}-${String(tab.month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}: Total cell blank, recovered ${fmt(recovered)} from the payment rows`);
          }
        }
      }
      const iso = `${year}-${String(tab.month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

      // Per-channel figures, recorded whether or not the day has a Total.
      componentRows.forEach(r => {
        const label = String((r || [])[0] || '').trim();
        const cv = hsNum((r || [])[d]);
        if (!label || cv === null || cv === 0) return;
        if (!byChannel[iso]) byChannel[iso] = {};
        byChannel[iso][label] = (byChannel[iso][label] || 0) + cv;
      });

      if (v === null) continue;
      daily[iso] = v;
      daySum += v;
    }

    // The sheet totals its own month; disagreeing with it means we misread it.
    const sheetTotal = hsNum(totalRow[Math.min(nDays, monthLen) + 1]);
    if (sheetTotal !== null && sheetTotal !== 0 && Math.abs(sheetTotal - daySum) > 0.02) {
      problems.push(`${year} ${tab.title}: days add to ${fmt(daySum)} but the tab's own total says ${fmt(sheetTotal)}`);
    }
  });

  return { daily, byChannel };
}

// ---- the refresh ------------------------------------------
let holidayRefresh = null;   // { year, rows:[], problems:[] } awaiting confirmation

async function refreshHolidaysFromSheets(year) {
  year = parseInt(year, 10);
  if (!accessToken) { notify('Sign in to sync first', true); return; }
  const sheetId = getSalesSheetId(year);
  if (!sheetId) { notify(`No Sales workbook set for ${year}`, true); return; }

  holidayRefresh = { year, rows: [], problems: [], loading: true };
  renderHolidayPanel();

  const problems = [];
  let daily;
  try {
    ({ daily } = await readSalesWorkbook(sheetId, year, problems));
  } catch (e) {
    holidayRefresh = null;
    renderHolidayPanel();
    notify('Could not read that workbook: ' + describeSheetError(e), true);
    return;
  }

  // Only whole, finished windows. Christmas read on the 10th of December would
  // otherwise be written as though it were the final figure.
  const today = new Date();
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());

  const rows = [];
  for (const w of holidayWindowsFor(year)) {
    const days = [];
    for (let d = new Date(w.from); d <= w.to; d = hsAddDays(d, 1)) days.push(hsIso(d));
    const present = days.filter(k => daily[k] !== undefined);
    const total = present.reduce((s, k) => s + daily[k], 0);
    const current = (appData.holidays || {})[w.key] || 0;

    let skip = null;
    if (w.to.getTime() >= todayUtc) skip = 'not finished yet';
    else if (!present.length) skip = 'no data in the workbook';

    rows.push({
      key: w.key, label: w.label, total: Math.round(total * 100) / 100, current,
      days: present.length, of: days.length,
      window: `${hsIso(w.from).slice(5)} to ${hsIso(w.to).slice(5)}`,
      skip
    });
  }

  holidayRefresh = { year, rows, problems, loading: false };
  renderHolidayPanel();
}

function applyHolidayRefresh() {
  if (!holidayRefresh) return;
  if (!appData.holidays) appData.holidays = {};
  let n = 0;
  holidayRefresh.rows.forEach(r => {
    if (r.skip) return;
    if (r.total === r.current) return;
    appData.holidays[r.key] = r.total;
    n++;
  });
  holidayRefresh = null;
  saveData();
  renderHolidayPanel();
  notify(n ? `Updated ${n} holiday figure${n === 1 ? '' : 's'}` : 'Nothing to change');
}

function dismissHolidayRefresh() {
  holidayRefresh = null;
  renderHolidayPanel();
}

// ---- UI fragments used by renderHolidayPanel() -------------
function holidaySetupHtml() {
  const years = (appData.years || []).slice().sort((a, b) => b - a);
  return `
    <div class="staging-area" style="margin-bottom:16px">
      <h3>Refresh from the Sales sheets</h3>
      <p style="color:var(--mist);font-size:0.78rem;margin-bottom:12px">
        Totals the daily figures in each “Sales &lt;year&gt;” workbook into the windows below.
        Paste the workbook’s link once per year. Nothing is written until you approve it.
      </p>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${years.map(y => {
          const id = getSalesSheetId(y);
          return `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <strong style="width:52px">${y}</strong>
            <input type="text" value="${escHtml(id)}" placeholder="paste the Sales ${y} link or id"
              onchange="setSalesSheetId(${y}, this.value)"
              style="flex:1;min-width:200px;border:1px solid var(--border);border-radius:6px;padding:6px 8px;font-family:Inter,sans-serif;font-size:0.78rem">
            <button class="btn btn-primary btn-sm" ${id ? '' : 'disabled'}
              onclick="refreshHolidaysFromSheets(${y})">Refresh ${y}</button>
          </div>`;
        }).join('')}
      </div>
    </div>`;
}

function holidayRefreshHtml() {
  if (!holidayRefresh) return '';
  if (holidayRefresh.loading) {
    return `<div class="staging-area" style="margin-bottom:16px"><h3>Reading Sales ${holidayRefresh.year}…</h3></div>`;
  }
  const { year, rows, problems } = holidayRefresh;
  const changes = rows.filter(r => !r.skip && r.total !== r.current).length;

  return `
    <div class="staging-area" style="margin-bottom:16px;border:2px solid var(--accent2)">
      <h3>Sales ${year} — what this would write</h3>
      <div style="margin:-4px 0 12px;padding:8px 10px;border-radius:6px;background:var(--blue-light);
                  font-size:0.78rem;color:var(--ink)">
        <strong>Nothing has been saved yet.</strong> Press <em>Apply</em> at the bottom to write these figures.
      </div>
      <div class="staging-table-wrap">
      <table>
        <thead><tr><th>Holiday</th><th>Window</th><th>Days</th><th>Now</th><th>Would become</th></tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr${r.skip ? ' style="opacity:0.55"' : ''}>
              <td><strong>${r.label}</strong></td>
              <td style="font-size:0.75rem;color:var(--mist)">${r.window}</td>
              <td style="font-size:0.75rem;color:var(--mist)">${r.skip ? '—' : r.days + '/' + r.of}</td>
              <td>${fmt(r.current)}</td>
              <td>${r.skip
                    ? `<span style="color:var(--mist);font-size:0.75rem">skipped — ${r.skip}</span>`
                    : r.total === r.current
                      ? `<span style="color:var(--mist)">unchanged</span>`
                      : `<span class="amount-in">${fmt(r.total)}</span>`}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      </div>
      ${problems.length ? `
        <div style="margin-top:12px;padding:10px;border-radius:6px;background:var(--red-light);border:1px solid var(--red)">
          <strong style="font-size:0.8rem;color:var(--red)">Worth a look (${problems.length})</strong>
          <ul style="margin:6px 0 0 18px;font-size:0.75rem;color:var(--ink-soft)">
            ${problems.map(p => `<li>${escHtml(p)}</li>`).join('')}
          </ul>
        </div>` : ''}
      <div style="margin-top:12px;display:flex;gap:8px">
        <button class="btn btn-primary" onclick="applyHolidayRefresh()" ${changes ? '' : 'disabled'}>
          ${changes ? `Apply ${changes} change${changes === 1 ? '' : 's'}` : 'Nothing to apply'}
        </button>
        <button class="btn btn-outline" onclick="dismissHolidayRefresh()">Cancel</button>
      </div>
    </div>`;
}
