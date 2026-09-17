// ============================================================
// COLOR BUYING — stems bought by colour, week by week or month by month
// ============================================================
// Read off the supplier invoices in the cost tracker, for the flowers the
// owner buys by colour: roses, spray roses, snapdragons, gypsophila, gerbera,
// stock, cremon and spider mums. Each purchase counts on its delivery date,
// like the rest of the cost tracker.
//
// Where a colour comes from, in order:
//   1. the owner's own correction for that item -- set on this screen, it
//      wins over everything, including a colour written in the name;
//   2. a colour written in the invoice line ("Snapdragon White");
//   3. for roses, the variety table the rose lines teach (ctRoseColorMap);
//   4. gypsophila with no colour named is white -- the invoices never say it;
//   5. otherwise "Not recorded", which the owner can answer once.
//
// The same resolution colours the roses on the Holiday Revenue report, so the
// two screens cannot disagree about one line.

const CB_UNKNOWN = 'Not recorded';

// Words read as colours beyond the rose list. Kept short on purpose: a word
// that is also part of a variety name ("Coral Reef" is a peach rose) would be
// read before the variety table got its say.
const CB_EXTRA_COLOURS = [
  ['bronze', 'Bronze'], ['fuchsia', 'Hot Pink'], ['magenta', 'Hot Pink'],
  ['lilac', 'Lavender'], ['mauve', 'Lavender'], ['blue', 'Blue']
];
const CB_COLOURS = (typeof CT_ROSE_COLORS !== 'undefined' ? CT_ROSE_COLORS : []).concat(CB_EXTRA_COLOURS);

// Spellings and shorthands the invoices actually use.
const CB_ABBR = Object.assign({}, typeof CT_COLOR_ABBR !== 'undefined' ? CT_COLOR_ABBR : {}, {
  crm: 'cream', creme: 'cream', lavende: 'lavender', fuschia: 'fuchsia',
  asst: 'assorted', assort: 'assorted', assortment: 'assorted', assorment: 'assorted'
});
// Only between slashes, where "Pk/Gr" can mean nothing but two colours. Loose,
// "gr" and "or" would read a grade or a conjunction as a colour.
const CB_SLASH_ABBR = { gr: 'green', grn: 'green', or: 'orange', wh: 'white', yl: 'yellow', pnk: 'pink', pur: 'purple' };

const CB_FLOWERS = [
  { key: 'roses',       label: 'Roses',       fam: /^(garden\s+)?roses?$/i },
  { key: 'spray-roses', label: 'Spray Roses', fam: /spray\s*roses?/i },
  { key: 'snapdragons', label: 'Snapdragons', fam: /snap/i },
  { key: 'gypsophila',  label: 'Gypsophila',  fam: /gyp/i },
  { key: 'gerbera',     label: 'Gerbera',     fam: /gerb/i },
  { key: 'stock',       label: 'Stock',       fam: /^stock$/i },
  { key: 'cremon',      label: 'Cremon',      fam: /cremon/i },
  { key: 'spider',      label: 'Spider Mums', fam: /spider/i }
];

const CB_SWATCH = {
  White: '#ffffff', Cream: '#f3e9c6', Ivory: '#f6f1e1', Yellow: '#f2c832', Orange: '#f08a24',
  Peach: '#f4b183', Pink: '#f29bb8', 'Light Pink': '#f8cfdc', 'Hot Pink': '#e0338a', Red: '#c62828',
  Burgundy: '#7b1f3a', Lavender: '#b39ddb', Purple: '#7e57c2', Green: '#8bc34a', Bronze: '#a0673a',
  Blue: '#5c8fd6', Bicolor: 'linear-gradient(135deg,#e0338a 50%,#f2c832 50%)',
  Mixed: 'conic-gradient(#c62828,#f2c832,#8bc34a,#5c8fd6,#b39ddb,#c62828)'
};

// ---- reading a colour ---------------------------------------------------------

function cbWordColour(word) {
  const w = CB_SLASH_ABBR[word] || CB_ABBR[word] || word;
  const hit = CB_COLOURS.find(c => c[0] === w);
  return hit ? hit[1] : null;
}

function cbNorm(name) {
  let s = ' ' + String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ') + ' ';
  Object.keys(CB_ABBR).forEach(a => { s = s.split(' ' + a + ' ').join(' ' + CB_ABBR[a] + ' '); });
  return s.replace(/\s+/g, ' ');
}

// The colour a line's own name gives, or null.
function cbExplicitColour(name) {
  // Two colours joined by a slash are one two-tone flower: "SpRose Rd/Brg".
  const runs = String(name || '').toLowerCase().match(/[a-z]+(?:\s*\/\s*[a-z]+)+/g) || [];
  for (const run of runs) {
    const cols = run.split('/').map(p => cbWordColour(p.trim())).filter(Boolean);
    if (cols.filter((c, i, a) => a.indexOf(c) === i).length >= 2) return 'Bicolor';
  }
  const s = cbNorm(name);
  let best = null, at = Infinity;
  CB_COLOURS.forEach(([k, v]) => {
    const i = s.indexOf(' ' + k + ' ');
    if (i >= 0 && i < at) { at = i; best = v; }
  });
  return best;
}

function cbFixes() {
  return (typeof ctData !== 'undefined' && ctData && ctData.colourFixes && typeof ctData.colourFixes === 'object') ? ctData.colourFixes : {};
}

// { colour, source } for one invoice line. source: 'yours' | 'invoice' | 'variety' | 'usual' | null.
function ctFlowerColour(item, roseMap) {
  const name = (item && item.name) || '';
  const fix = cbFixes()[ctCatalogKey(name)];
  if (fix) return { colour: fix, source: 'yours' };
  const explicit = cbExplicitColour(name);
  if (explicit) return { colour: explicit, source: 'invoice' };
  const fam = (typeof ctItemFamily === 'function' ? ctItemFamily(item) : (item && item.family)) || '';
  if (/rose/i.test(fam) && typeof ctRoseColor === 'function') {
    const c = ctRoseColor(name, roseMap || ctRoseColorMap());
    if (c) return { colour: c, source: 'variety' };
  }
  if (/gyp/i.test(fam)) return { colour: 'White', source: 'usual' };
  return { colour: null, source: null };
}

// ---- the figures --------------------------------------------------------------

function cbLines() {
  if (typeof ctData === 'undefined' || !ctData || !Array.isArray(ctData.invoices)) return [];
  const map = ctRoseColorMap();
  const out = [];
  ctData.invoices.forEach(inv => {
    const d = String((typeof ctEffDate === 'function' ? ctEffDate(inv) : (inv.deliveryDate || inv.date)) || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
    (inv.items || []).forEach(it => {
      const fam = ctItemFamily(it) || '';
      const flower = CB_FLOWERS.find(f => f.fam.test(fam));
      if (!flower) return;
      const col = ctFlowerColour(it, map);
      const st = ctLineStems(it);
      const cost = ctLineTotal(it);
      out.push({ flower: flower.key, date: d, name: String(it.name || ''), key: ctCatalogKey(it.name || ''),
                 colour: col.colour || CB_UNKNOWN, source: col.source,
                 stems: Number(st.stems) || 0, bunches: Number(st.bunches) || 0, cost: isFinite(cost) ? cost : 0 });
    });
  });
  return out;
}

// Weeks start on Monday and are named by that Monday; months by YYYY-MM.
function cbPeriodKey(iso, period) {
  if (period === 'month') return iso.slice(0, 7);
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
  d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
  return d.toISOString().slice(0, 10);
}

// The `count` periods ending with the one `latestIso` falls in, oldest first.
function cbPeriods(latestIso, period, count) {
  const keys = [];
  if (period === 'month') {
    let y = +latestIso.slice(0, 4), m = +latestIso.slice(5, 7);
    for (let i = 0; i < count; i++) {
      keys.unshift(y + '-' + String(m).padStart(2, '0'));
      if (--m === 0) { m = 12; y--; }
    }
  } else {
    const start = cbPeriodKey(latestIso, 'week');
    const d = new Date(start + 'T00:00:00Z');
    for (let i = 0; i < count; i++) {
      keys.unshift(d.toISOString().slice(0, 10));
      d.setUTCDate(d.getUTCDate() - 7);
    }
  }
  return keys;
}

function cbPeriodLabel(key, period, latestYear) {
  const y = +key.slice(0, 4), m = +key.slice(5, 7) - 1;
  if (period === 'month') return MONTHS_SHORT[m] + " '" + String(y).slice(2);
  return MONTHS_SHORT[m] + ' ' + (+key.slice(8, 10)) + (y !== latestYear ? " '" + String(y).slice(2) : '');
}

// flower -> colour -> period -> { stems, bunches, cost }
function cbTable(lines, periods, period) {
  const inRange = {};
  periods.forEach(p => { inRange[p] = 1; });
  const t = {};
  lines.forEach(l => {
    const p = cbPeriodKey(l.date, period);
    if (!inRange[p]) return;
    const f = t[l.flower] || (t[l.flower] = {});
    const c = f[l.colour] || (f[l.colour] = {});
    const cell = c[p] || (c[p] = { stems: 0, bunches: 0, cost: 0 });
    cell.stems += l.stems; cell.bunches += l.bunches; cell.cost += l.cost;
  });
  return t;
}

// ---- the screen ---------------------------------------------------------------

const CB_VIEW_KEY = 'bb_colour_view';
let cbView = null;
let cbItemsShown = [];

function cbViewState() {
  if (cbView) return cbView;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(CB_VIEW_KEY) || '{}') || {}; } catch (e) {}
  cbView = {
    flower: CB_FLOWERS.some(f => f.key === saved.flower) ? saved.flower : 'all',
    period: saved.period === 'month' ? 'month' : 'week',
    count: [6, 12, 26, 52].indexOf(+saved.count) >= 0 ? +saved.count : 12,
    measure: saved.measure === 'spend' ? 'spend' : 'stems',
    layout: saved.layout === 'avg' ? 'avg' : 'all',
    // '' for the last N weeks or months; 'YYYY-MM' for one month; 'latest' for
    // the month of the newest delivery, resolved when the screen is drawn.
    month: (/^\d{4}-\d{2}$/.test(saved.month || '') || saved.month === 'latest') ? saved.month : '',
    // Holiday buying is left out by default: the question this screen answers
    // is what an ordinary week takes, and a Mother's Day week is ten of them.
    holidays: saved.holidays === 'in' ? 'in' : 'out'
  };
  return cbView;
}

// The weeks of one month, Monday to Sunday, cut at the month's edges:
// [{ key: Monday of the week, from, to }].
function cbMonthWeeks(month) {
  const y = +month.slice(0, 4), m = +month.slice(5, 7) - 1;
  const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const weeks = [];
  for (let d = 1; d <= days; d++) {
    const iso = month + '-' + String(d).padStart(2, '0');
    const key = cbPeriodKey(iso, 'week');
    const last = weeks[weeks.length - 1];
    if (last && last.key === key) last.to = iso;
    else weeks.push({ key, from: iso, to: iso });
  }
  return weeks;
}

// The weeks or months the cost tracker actually covers: those holding at least
// one invoice of any kind.
//
// Not "every week since the first invoice". The invoices arrive in stretches --
// a fortnight around Mother's Day 2025, then nothing until June 2026 -- and a
// week with no invoice at all is a week nobody entered paperwork for, not a
// week nothing was bought. Counting those as zero halved every average.
// Which of these weeks or months are holiday buying, and for which holiday.
//
// Valentine's and Mother's Day are the whole reason an average needs this: one
// Mother's Day week held 2,746 rose stems against a normal week's 300, so a
// range containing it reports an "average week" the shop never has. The windows
// are the Holiday Revenue report's own -- three weeks before the day by
// default, or whatever start date the owner set there -- so the two screens
// agree about when holiday buying began.
function cbHolidayPeriods(periods, period) {
  const flagged = {};
  if (typeof ctHolidayOf !== 'function') return flagged;
  periods.forEach(p => {
    const days = [];
    if (period === 'month') {
      const y = +p.slice(0, 4), m = +p.slice(5, 7) - 1;
      const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      for (let d = 1; d <= last; d++) days.push(p + '-' + String(d).padStart(2, '0'));
    } else {
      const d0 = new Date(p + 'T00:00:00Z');
      for (let i = 0; i < 7; i++) { days.push(d0.toISOString().slice(0, 10)); d0.setUTCDate(d0.getUTCDate() + 1); }
    }
    for (const d of days) {
      const hit = ctHolidayOf(d);
      if (hit) { flagged[p] = hit; break; }
    }
  });
  return flagged;
}

function cbInvoiceDates() {
  const out = [];
  ((typeof ctData !== 'undefined' && ctData && ctData.invoices) || []).forEach(inv => {
    const d = String((typeof ctEffDate === 'function' ? ctEffDate(inv) : (inv.deliveryDate || inv.date)) || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) out.push(d);
  });
  return out;
}

function cbCoveredPeriods(period, dates) {
  const keys = {};
  (dates || cbInvoiceDates()).forEach(d => { keys[cbPeriodKey(d, period)] = 1; });
  return keys;
}

// How much of one month the invoices cover, in weeks: each of its weeks that
// holds an invoice DATED IN THAT MONTH, counted by the days of that week inside
// the month -- so a short week at either edge is a part of a week, not a whole
// one, and a month whose only nearby invoice belongs to the next month counts
// as not covered at all.
function cbMonthCoverage(month, dates, skip) {
  const inMonth = {};
  (dates || cbInvoiceDates()).forEach(d => { if (String(d).slice(0, 7) === month) inMonth[cbPeriodKey(d, 'week')] = 1; });
  const weeks = cbMonthWeeks(month);
  let days = 0, from = '', to = '';
  weeks.forEach(w => {
    if (!inMonth[w.key] || (skip && skip[w.key])) return;
    days += Math.round((Date.parse(w.to + 'T00:00:00Z') - Date.parse(w.from + 'T00:00:00Z')) / 86400000) + 1;
    if (!from) from = w.from;
    to = w.to;
  });
  const all = weeks.length ? weeks[0].from + '|' + weeks[weeks.length - 1].to : '';
  return { days, weeks: days / 7, from, to, whole: !!days && (from + '|' + to) === all };
}

function cbSet(field, value) {
  const v = cbViewState();
  if (field === 'flower') v.flower = (value === 'all' || CB_FLOWERS.some(f => f.key === value)) ? value : 'all';
  else if (field === 'period') {
    v.period = value === 'month' ? 'month' : 'week';
    if (v.period === 'month' && v.count > 26) v.count = 12;
  }
  else if (field === 'count') {
    if (value === 'month') v.month = v.month || 'latest';
    else { v.month = ''; v.count = [6, 12, 26, 52].indexOf(+value) >= 0 ? +value : 12; }
  }
  else if (field === 'month') { if (/^\d{4}-\d{2}$/.test(String(value || ''))) v.month = String(value); }
  else if (field === 'measure') v.measure = value === 'spend' ? 'spend' : 'stems';
  else if (field === 'layout') v.layout = value === 'avg' ? 'avg' : 'all';
  else if (field === 'holidays') v.holidays = value === 'in' ? 'in' : 'out';
  try { localStorage.setItem(CB_VIEW_KEY, JSON.stringify(v)); } catch (e) {}
  renderColourBuying();
}

function cbSwatch(colour) {
  const bg = CB_SWATCH[colour];
  return `<span style="display:inline-block;width:11px;height:11px;border-radius:50%;margin-right:6px;vertical-align:-1px;
    border:1px ${bg ? 'solid var(--border)' : 'dashed var(--mist)'};background:${bg || 'transparent'}"></span>`;
}

function cbCell(c, measure) {
  if (!c) return '';
  if (measure === 'spend') return c.cost ? '$' + Math.round(c.cost).toLocaleString('en-US') : '';
  const parts = [];
  if (c.stems) parts.push(Math.round(c.stems).toLocaleString('en-US'));
  if (c.bunches) parts.push(Math.round(c.bunches).toLocaleString('en-US') + ' bu');
  return parts.join(' + ');
}

// A per-period average. Whole stems once there are ten or more; below that a
// decimal, or four gerberas a week reads as none.
function cbAverageCell(c, n, measure) {
  if (!c || !n) return '';
  const fix = x => (x >= 10 ? Math.round(x).toLocaleString('en-US') : (Math.round(x * 10) / 10).toString());
  if (measure === 'spend') return c.cost ? '$' + Math.round(c.cost / n).toLocaleString('en-US') : '';
  const parts = [];
  if (c.stems) parts.push(fix(c.stems / n));
  if (c.bunches) parts.push(fix(c.bunches / n) + ' bu');
  return parts.join(' + ');
}

// The periods an average is taken over: those in range the invoices cover.
function cbCountedPeriods(periods, covered) {
  return periods.filter(p => covered[p]);
}

function cbAdd(a, b) {
  return { stems: (a ? a.stems : 0) + b.stems, bunches: (a ? a.bunches : 0) + b.bunches, cost: (a ? a.cost : 0) + b.cost };
}

function renderColourBuying() {
  const el = document.getElementById('ct-colours-content');
  if (!el) return;
  const v = cbViewState();
  const lines = cbLines();
  if (!lines.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">🎨</div>No invoices for these flowers in the cost tracker yet.</div>`;
    return;
  }
  const latest = lines.reduce((m, l) => (l.date > m ? l.date : m), '');
  // Coverage starts with the first invoice of ANY kind, not the first of these
  // flowers: a week with invoices but no gerberas is a week with no gerberas.
  const firstInvoice = (ctData.invoices || []).reduce((m, inv) => {
    const d = String((typeof ctEffDate === 'function' ? ctEffDate(inv) : (inv.deliveryDate || inv.date)) || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(d) && (!m || d < m) ? d : m;
  }, '');
  const latestYear = +latest.slice(0, 4);
  const invoiceDates = cbInvoiceDates();
  const monthMode = !!v.month;
  const month = v.month === 'latest' ? latest.slice(0, 7) : v.month;
  let periods, table, inRange, n, unit, periodLabel, rangeNote, holidayFlags = {}, dropped = [];
  if (monthMode) {
    // One month, week by week. The average is the month's total over the weeks
    // it covers, so a short week at either edge doesn't count as a whole one.
    const weeks = cbMonthWeeks(month);
    const byKey = {};
    weeks.forEach(w => { byKey[w.key] = w; });
    const allKeys = weeks.map(w => w.key);
    holidayFlags = cbHolidayPeriods(allKeys, 'week');
    const skip = v.holidays === 'out' ? holidayFlags : {};
    dropped = allKeys.filter(p => skip[p]);
    periods = allKeys.filter(p => !skip[p]);
    inRange = l => l.date.slice(0, 7) === month && !skip[cbPeriodKey(l.date, 'week')];
    table = cbTable(lines.filter(inRange), periods, 'week');
    const cover = cbMonthCoverage(month, invoiceDates, skip);
    n = cover.weeks;
    unit = 'week';
    const day = iso => +iso.slice(8, 10);
    periodLabel = p => { const w = byKey[p]; return MONTHS_SHORT[+month.slice(5, 7) - 1] + ' ' + day(w.from) + (w.to !== w.from ? '–' + day(w.to) : ''); };
    const monthName = MONTHS[+month.slice(5, 7) - 1] + ' ' + month.slice(0, 4);
    rangeNote = cover.days
      ? `Delivered in ${monthName}, by week (Monday to Sunday, cut at the month's edges). <strong style="color:var(--ink)">Average per week</strong> is the month's total over ${cover.whole
          ? `its ${cover.days} days`
          : `the ${cover.days} days in weeks the invoices cover (${escHtml(cover.from.slice(5))} to ${escHtml(cover.to.slice(5))})`}, times seven.`
      : `No invoices in the cost tracker cover ${monthName}.`;
  } else {
    const allKeys = cbPeriods(latest, v.period, v.count);
    holidayFlags = cbHolidayPeriods(allKeys, v.period);
    const skip = v.holidays === 'out' ? holidayFlags : {};
    dropped = allKeys.filter(p => skip[p]);
    periods = allKeys.filter(p => !skip[p]);
    inRange = (() => { const keys = {}; periods.forEach(p => { keys[p] = 1; }); return l => !!keys[cbPeriodKey(l.date, v.period)]; })();
    table = cbTable(lines, periods, v.period);
    const covered = cbCoveredPeriods(v.period, invoiceDates);
    const counted = cbCountedPeriods(periods, covered);
    n = counted.length;
    unit = v.period === 'month' ? 'month' : 'week';
    periodLabel = p => cbPeriodLabel(p, v.period, latestYear);
    rangeNote = `${v.measure === 'spend' ? 'Spend' : 'Stems'} by delivery date, ${unit} by ${unit}${v.period === 'week' ? ' (starting Monday)' : ''}, through ${escHtml(latest)}.
      <strong style="color:var(--ink)">Average per ${unit}</strong> is over the ${n} ${unit}${n === 1 ? '' : 's'} of these ${periods.length} that the invoices cover${n < periods.length
        ? ` — the other ${periods.length - n} hold no invoices at all, so they are missing paperwork rather than ${unit}s with nothing bought`
        : ''}.`;
  }
  const avgOnly = v.layout === 'avg';
  const shownPeriods = avgOnly ? [] : periods;
  const flowers = CB_FLOWERS.filter(f => v.flower === 'all' || f.key === v.flower);
  const sel = (attrs, opts, cur) => `<select ${attrs} style="font-size:0.82rem;padding:5px 8px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--ink);font-family:Inter,sans-serif">
    ${opts.map(o => `<option value="${escHtml(o[0])}" ${String(o[0]) === String(cur) ? 'selected' : ''}>${escHtml(o[1])}</option>`).join('')}</select>`;
  const th = 'padding:6px 8px;font-size:0.68rem;text-transform:uppercase;letter-spacing:0.04em;color:var(--mist);text-align:right;white-space:nowrap';
  const td = 'padding:5px 8px;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums';

  const sections = flowers.map(f => {
    const byColour = table[f.key] || {};
    const colours = Object.keys(byColour).map(c => {
      let total = null;
      periods.forEach(p => { if (byColour[c][p]) total = cbAdd(total, byColour[c][p]); });
      return { colour: c, cells: byColour[c], total };
    });
    if (!colours.length) return '';
    const size = x => (v.measure === 'spend' ? x.total.cost : x.total.stems + x.total.bunches);
    colours.sort((a, b) => (a.colour === CB_UNKNOWN) - (b.colour === CB_UNKNOWN) || size(b) - size(a));
    let flowerTotal = null;
    const periodTotals = {};
    colours.forEach(x => {
      flowerTotal = cbAdd(flowerTotal, x.total);
      periods.forEach(p => { if (x.cells[p]) periodTotals[p] = cbAdd(periodTotals[p], x.cells[p]); });
    });
    const avgTd = `${td};font-weight:700;background:var(--paper)`;
    return `
      <tr style="background:var(--paper)"><td colspan="${shownPeriods.length + 3}" style="padding:8px;font-weight:700">${escHtml(f.label)}</td></tr>
      ${colours.map(x => `
        <tr style="border-top:1px solid var(--border)">
          <td style="padding:5px 8px;white-space:nowrap;${x.colour === CB_UNKNOWN ? 'color:var(--red)' : ''}">${cbSwatch(x.colour)}${escHtml(x.colour)}</td>
          <td style="${avgTd}">${cbAverageCell(x.total, n, v.measure)}</td>
          ${shownPeriods.map(p => `<td style="${td}">${cbCell(x.cells[p], v.measure)}</td>`).join('')}
          <td style="${td};font-weight:600">${cbCell(x.total, v.measure)}</td>
        </tr>`).join('')}
      <tr style="border-top:1px solid var(--border)">
        <td style="padding:5px 8px;color:var(--mist)">All ${escHtml(f.label.toLowerCase())}</td>
        <td style="${avgTd}">${cbAverageCell(flowerTotal, n, v.measure)}</td>
        ${shownPeriods.map(p => `<td style="${td};color:var(--mist)">${cbCell(periodTotals[p], v.measure)}</td>`).join('')}
        <td style="${td};font-weight:700">${cbCell(flowerTotal, v.measure)}</td>
      </tr>`;
  }).join('');

  // Every item bought in the range, for correcting its colour. Unrecorded first.
  const items = {};
  lines.forEach(l => {
    if (!inRange(l)) return;
    if (v.flower !== 'all' && l.flower !== v.flower) return;
    const it = items[l.key] || (items[l.key] = { key: l.key, name: l.name, flower: l.flower, colour: l.colour, source: l.source,
                                                  lines: 0, stems: 0, bunches: 0 });
    it.lines++; it.stems += l.stems; it.bunches += l.bunches;
  });
  cbItemsShown = Object.values(items).sort((a, b) =>
    (b.colour === CB_UNKNOWN) - (a.colour === CB_UNKNOWN) || (b.stems + b.bunches) - (a.stems + a.bunches));
  const known = CB_COLOURS.map(c => c[1]).filter((c, i, a) => a.indexOf(c) === i);
  Object.values(cbFixes()).forEach(c => { if (known.indexOf(c) < 0) known.push(c); });
  known.sort();
  const sourceText = { yours: 'your choice', invoice: 'from the invoice', variety: 'from the variety', usual: 'gyp is white unless named' };
  const flowerLabel = k => (CB_FLOWERS.find(f => f.key === k) || {}).label || k;

  el.innerHTML = `
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
      ${sel(`onchange="cbSet('flower', this.value)" aria-label="Flower"`, [['all', 'All flowers']].concat(CB_FLOWERS.map(f => [f.key, f.label])), v.flower)}
      ${monthMode ? '' : sel(`onchange="cbSet('period', this.value)" aria-label="Period"`, [['week', 'Weekly'], ['month', 'Monthly']], v.period)}
      ${sel(`onchange="cbSet('count', this.value)" aria-label="Range"`, (v.period === 'month' && !monthMode
        ? [[6, 'Last 6 months'], [12, 'Last 12 months'], [26, 'Last 26 months']]
        : [[6, 'Last 6 weeks'], [12, 'Last 12 weeks'], [26, 'Last 26 weeks'], [52, 'Last 52 weeks']]).concat([['month', 'A single month']]),
        monthMode ? 'month' : v.count)}
      ${monthMode ? `<input type="month" aria-label="Month" value="${escHtml(month)}" min="${escHtml((firstInvoice || latest).slice(0, 7))}" max="${escHtml(latest.slice(0, 7))}"
          onchange="cbSet('month', this.value)"
          style="font-size:0.82rem;padding:4px 8px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--ink);font-family:Inter,sans-serif">` : ''}
      ${sel(`onchange="cbSet('measure', this.value)" aria-label="Show"`, [['stems', 'Stems'], ['spend', 'Spend']], v.measure)}
      ${sel(`onchange="cbSet('layout', this.value)" aria-label="Columns"`, [['all', unit === 'month' ? 'Every month' : 'Every week'], ['avg', 'Averages only']], avgOnly ? 'avg' : 'all')}
      ${sel(`onchange="cbSet('holidays', this.value)" aria-label="Holidays"`,
        [['out', `Ordinary ${unit}s only`], ['in', 'Holidays included']], v.holidays)}
    </div>
    <div style="font-size:0.74rem;color:var(--mist);margin-bottom:10px">
      ${rangeNote}
      ${dropped.length
        ? `${dropped.length} holiday ${unit}${dropped.length === 1 ? '' : 's'} left out (${escHtml(dropped.map(p => holidayFlags[p]).filter((h, i, a) => a.indexOf(h) === i).join(', '))}) — buying for those is nothing like an ordinary ${unit}.`
        : (v.holidays === 'out' && Object.keys(holidayFlags).length === 0 ? '' : '')}
      ${v.measure === 'stems' ? '"bu" is bunches with no stem count — gypsophila is bought by the bunch.' : ''}
      Only as complete as the invoices in the cost tracker.
    </div>
    <div class="chart-wrap" style="padding:0;overflow-x:auto">
      <table style="border-collapse:collapse;font-size:0.8rem;min-width:100%">
        <thead><tr>
          <th style="${th};text-align:left">Color</th>
          <th style="${th};color:var(--ink);background:var(--paper)">Avg / ${unit === 'month' ? 'mo' : 'wk'}</th>
          ${shownPeriods.map(p => `<th style="${th}">${escHtml(periodLabel(p))}</th>`).join('')}
          <th style="${th}">Total</th>
        </tr></thead>
        <tbody>${sections || `<tr><td style="padding:14px;color:var(--mist)" colspan="${shownPeriods.length + 3}">Nothing bought in this range.</td></tr>`}</tbody>
      </table>
    </div>

    <div class="chart-wrap">
      <h3>Fix a color</h3>
      <div style="font-size:0.74rem;color:var(--mist);margin-bottom:10px">
        Every item bought in the range above. Change one and every purchase of that item uses it, past and future —
        your choice wins over what the invoice says. Pick "As the invoice says" to undo it.
      </div>
      ${cbItemsShown.length ? `<div style="overflow-x:auto"><table style="border-collapse:collapse;font-size:0.8rem;width:100%;min-width:520px">
        <thead><tr><th style="${th};text-align:left">Item</th><th style="${th};text-align:left">Flower</th><th style="${th}">Lines</th><th style="${th}">Bought</th><th style="${th};text-align:left">Color</th></tr></thead>
        <tbody>${cbItemsShown.map((it, i) => `
          <tr style="border-top:1px solid var(--border)">
            <td style="padding:5px 8px">${escHtml(it.name)}</td>
            <td style="padding:5px 8px;color:var(--mist);white-space:nowrap">${escHtml(flowerLabel(it.flower))}</td>
            <td style="${td}">${it.lines}</td>
            <td style="${td}">${cbCell(it, 'stems')}</td>
            <td style="padding:5px 8px;white-space:nowrap">
              ${cbSwatch(it.colour)}<select onchange="cbSetColour(${i}, this.value)" aria-label="Color"
                style="font-size:0.78rem;padding:3px 6px;border:1px solid ${it.colour === CB_UNKNOWN ? 'var(--red)' : 'var(--border)'};border-radius:6px;background:var(--surface);color:var(--ink)">
                ${it.colour === CB_UNKNOWN ? `<option value="" selected>Not recorded</option>` : ''}
                ${known.map(c => `<option value="${escHtml(c)}" ${c === it.colour ? 'selected' : ''}>${escHtml(c)}</option>`).join('')}
                ${it.colour !== CB_UNKNOWN && known.indexOf(it.colour) < 0 ? `<option value="${escHtml(it.colour)}" selected>${escHtml(it.colour)}</option>` : ''}
                <option value="__other__">Other…</option>
                ${it.source === 'yours' ? `<option value="__invoice__">As the invoice says</option>` : ''}
              </select>
              <span style="font-size:0.68rem;color:var(--mist);margin-left:4px">${it.source ? escHtml(sourceText[it.source] || '') : ''}</span>
            </td>
          </tr>`).join('')}</tbody>
      </table></div>` : `<div style="font-size:0.8rem;color:var(--mist)">Nothing bought in this range.</div>`}
    </div>`;
}

// Saves the owner's colour for every purchase of one item.
function cbSetColour(i, value) {
  const it = cbItemsShown[i];
  if (!it || typeof ctData === 'undefined' || !ctData) return;
  let colour = String(value == null ? '' : value);
  if (colour === '__other__') {
    const typed = typeof prompt === 'function' ? prompt(`What color is "${it.name}"?`, it.colour === CB_UNKNOWN ? '' : it.colour) : null;
    if (typed === null) { renderColourBuying(); return; }
    colour = typed;
  }
  if (!ctData.colourFixes || typeof ctData.colourFixes !== 'object') ctData.colourFixes = {};
  if (colour === '__invoice__' || !colour.trim()) {
    delete ctData.colourFixes[it.key];
  } else {
    const clean = colour.replace(/[<>"'`&\\]/g, '').trim().slice(0, 30);
    if (!clean) { renderColourBuying(); return; }
    // Matched against the colours already in use, so "light pink" cannot become
    // a second Light Pink row.
    const known = CB_COLOURS.map(c => c[1]).concat(Object.values(ctData.colourFixes));
    ctData.colourFixes[it.key] = known.find(k => k.toLowerCase() === clean.toLowerCase()) ||
      clean.replace(/\b[a-z]/g, ch => ch.toUpperCase());
  }
  ctSave();
  if (typeof notify === 'function') {
    notify(ctData.colourFixes[it.key] ? `${it.name}: ${ctData.colourFixes[it.key]}` : `${it.name}: back to what the invoice says`);
  }
  renderColourBuying();
}
