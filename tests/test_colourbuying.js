// Color Buying: stems bought by colour, week by week or month by month.
//
// Three things have to hold. The colour read off an invoice line must be the
// one a person reading it would give -- including the shorthand suppliers
// actually use (Rd/Brg, Crm, Asst, a misspelt Lavende). The owner's correction
// must win over everything, apply to every purchase of that item, and undo
// cleanly. And the counts must land in the right week or month, in stems where
// stems are known and in bunches where they are not.
//
// The Holiday Revenue report colours its roses through the same function, so a
// correction made here must show there too.
//
// Made-up invoices, written in the shapes the real ones take.
const F = require('./fixtures');
const vm = require('vm');

const els = {};
const sb = F.sandbox({ setTimeout: () => 0, clearTimeout: () => {} });
sb.document.getElementById = id => els[id] || (els[id] = { id, innerHTML: '', style: {} });
sb.navigator = { userAgent: 'test' };
let prompted = null;
sb.prompt = () => prompted;
vm.createContext(sb);
vm.runInContext(F.src(['config.js', 'utils.js', 'reports.js', 'cost-tracker.js', 'colour-buying.js']), sb, { filename: 'bb.js' });
sb.__NOTE__ = () => {};
vm.runInContext('notify = function () {}; ctSave = function () {};', sb);
const S = code => vm.runInContext(code, sb);
const J = code => JSON.parse(S('JSON.stringify(' + code + ')'));

const line = (name, family, qty, uom, total, extra) => Object.assign({ name, category: 'Flowers', family, qty, uom, unitPrice: total / qty, total }, extra || {});
const invoices = [
  { id: 'i1', date: '2026-09-01', supplier: 'A', items: [      // Tuesday -> week of Mon 31 Aug
    line('Roses Pink Geraldine 50cm', 'Roses', 50, 'Stem', 60),
    line('Geraldine 50cm', 'Roses', 25, 'Stem', 30),              // colour only from the variety
    line('SpRose Rd/Brg Rubicon 40/50cm', 'Spray Roses', 10, 'Stem', 20),
    line('Snapdragon White', 'Snapdragon', 30, 'Stem', 27),
    line('Gyp Excellence Benchmark', 'Gypsophila', 4, 'Bunch', 48)
  ] },
  { id: 'i2', date: '2026-09-08', supplier: 'B', items: [      // Monday -> week of Mon 7 Sep
    line('Cremon Lavende Dark Rossano', 'Cremon', 20, 'Stem', 30),
    line('Mum Disbud Crm Creme Brulee EC', 'Cremon', 10, 'Stem', 15),
    line('Disbud Cremon Assortment Box', 'Cremon', 40, 'Stem', 50),
    line('Stock Asst', 'Stock', 10, 'Stem', 12),
    line('Gerbera Alliance Canadian', 'Gerbera', 50, 'Stem', 40),
    line('Gerbera Canadian Yellow/Blackeye', 'Gerbera', 25, 'Stem', 22),
    line('Snapdragon White', 'Snapdragon', 20, 'Stem', 18),
    line('Wired Ribbon Red', 'Ribbon', 1, 'Each', 5, { category: 'Ribbon' })   // not a flower on this report
  ] },
  { id: 'i3', date: '2026-08-14', deliveryDate: '2026-09-13', supplier: 'C', items: [   // counts on delivery: Sun 13 Sep
    line('Gerbera Alliance Canadian', 'Gerbera', 50, 'Stem', 40),
    line('Spider Mum Green', 'Spider', 10, 'Stem', 15)
  ] }
];
sb.__CT__ = { invoices, catalog: {}, retail: {}, family: {}, familyKeywords: {}, markup: {}, templates: [] };
S('ctData = __CT__;');

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };
const colourOf = name => S(`(function(){ var it = ctData.invoices.reduce(function (a, inv) { return a.concat(inv.items); }, []).find(function (x) { return x.name === ${JSON.stringify(name)}; }); return ctFlowerColour(it).colour; })()`);

console.log('reading a colour off the invoice line');
{
  const cases = [
    ['Roses Pink Geraldine 50cm', 'Pink'],
    ['Geraldine 50cm', 'Pink'],                          // the variety table the pink line taught
    ['SpRose Rd/Brg Rubicon 40/50cm', 'Bicolor'],        // two colours across a slash
    ['Gerbera Canadian Yellow/Blackeye', 'Yellow'],      // a slash, but only one side is a colour
    ['Cremon Lavende Dark Rossano', 'Lavender'],          // the supplier's spelling
    ['Mum Disbud Crm Creme Brulee EC', 'Cream'],
    ['Disbud Cremon Assortment Box', 'Mixed'],
    ['Stock Asst', 'Mixed'],
    ['Spider Mum Green', 'Green'],
    ['Gyp Excellence Benchmark', 'White'],               // gyp is white unless a colour is named
    ['Gerbera Alliance Canadian', null]                  // genuinely not said: left for the owner
  ];
  const got = cases.map(([n]) => colourOf(n));
  const wrong = cases.filter((c, i) => got[i] !== c[1]).map((c, i) => c[0] + ' -> ' + got[cases.indexOf(c)]);
  t('every shape of name reads as a person would read it', wrong.length === 0, wrong.join(' | ') || cases.length + ' names');
  t('  "gr" and "or" are colours only between slashes, never loose in a name',
    S(`cbExplicitColour('Gr A Roses 60cm')`) === null && S(`cbExplicitColour('Snap Or Mix')`) === 'Mixed' &&
    S(`cbExplicitColour('SpRose Pk/Gr Fibo Yantra 60cm')`) === 'Bicolor');
}

console.log('\nthe owner\'s corrections');
{
  const items = () => { S('renderColourBuying();'); return J('cbItemsShown.map(function (x) { return { name: x.name, colour: x.colour, source: x.source }; })'); };
  S(`cbView = { flower: 'all', period: 'week', count: 6, measure: 'stems' };`);
  let list = items();
  const idx = name => list.findIndex(x => x.name === name);
  t('an item nobody has named a colour for is listed first, marked Not recorded',
    list[0].name === 'Gerbera Alliance Canadian' && list[0].colour === 'Not recorded', list[0].name);

  S(`cbSetColour(${idx('Gerbera Alliance Canadian')}, 'mixed');`);
  t('choosing a colour applies to every purchase of that item, matched to the existing name',
    J('ctData.colourFixes')['gerbera alliance canadian'] === 'Mixed' && colourOf('Gerbera Alliance Canadian') === 'Mixed');
  list = items();
  S(`cbSetColour(${idx('Snapdragon White')}, 'Cream');`);
  t('  and wins over a colour written on the invoice', colourOf('Snapdragon White') === 'Cream');
  list = items();
  const snapRow = list.find(x => x.name === 'Snapdragon White');
  t('  the list says where each colour came from', snapRow.source === 'yours' && list.find(x => x.name === 'Stock Asst').source === 'invoice');
  S(`cbSetColour(${idx('Snapdragon White')}, '__invoice__');`);
  t('"As the invoice says" undoes it', colourOf('Snapdragon White') === 'White' && !('snapdragon white' in J('ctData.colourFixes')));

  list = items();
  prompted = 'dusty <b>rose</b>';
  S(`cbSetColour(${idx('Spider Mum Green')}, '__other__');`);
  t('a colour of the owner\'s own is tidied and saved', J('ctData.colourFixes')['spider mum green'] === 'Dusty Brose/B', J('ctData.colourFixes')['spider mum green']);
  prompted = null;
  list = items();
  S(`cbSetColour(${idx('Spider Mum Green')}, '__other__');`);
  t('  and cancelling the question changes nothing', J('ctData.colourFixes')['spider mum green'] === 'Dusty Brose/B');
  list = items();
  S(`cbSetColour(${idx('Spider Mum Green')}, '__invoice__');`);
  S(`cbSetColour(99, 'Red');`);
  t('  an item that is not on screen is refused', Object.keys(J('ctData.colourFixes')).length === 1);
}

console.log('\nthe counts');
{
  const periodsW = J(`cbPeriods('2026-09-13', 'week', 3)`);
  const periodsM = J(`cbPeriods('2026-09-13', 'month', 3)`);
  t('weeks start on Monday; the latest week is the one the newest delivery falls in',
    JSON.stringify(periodsW) === '["2026-08-24","2026-08-31","2026-09-07"]', periodsW.join(' '));
  t('months step back across a year end', JSON.stringify(J(`cbPeriods('2026-02-10', 'month', 3)`)) === '["2025-12","2026-01","2026-02"]' &&
    JSON.stringify(periodsM) === '["2026-07","2026-08","2026-09"]');
  const tab = J(`cbTable(cbLines(), cbPeriods('2026-09-13', 'week', 3), 'week')`);
  t('a purchase counts on its delivery date, not the invoice date',
    tab.gerbera.Mixed['2026-09-07'].stems === 100 && !tab.gerbera.Mixed['2026-08-10'], JSON.stringify(tab.gerbera.Mixed));
  t('stems add up by colour and week', tab.snapdragons.White['2026-08-31'].stems === 30 && tab.snapdragons.White['2026-09-07'].stems === 20);
  t('gypsophila is counted in bunches, not guessed stems', tab.gypsophila.White['2026-08-31'].bunches === 4 && tab.gypsophila.White['2026-08-31'].stems === 0);
  t('spend is the line total', near(tab.cremon.Lavender['2026-09-07'].cost, 30));
  t('nothing that is not one of these flowers is counted', !tab.ribbon && Object.keys(tab).every(k => J('CB_FLOWERS.map(function (f) { return f.key; })').indexOf(k) >= 0));

  S(`cbView = { flower: 'gerbera', period: 'month', count: 6, measure: 'stems' }; renderColourBuying();`);
  const html = els['ct-colours-content'].innerHTML;
  t('one flower on its own: its colours, a total row, and only its items to fix',
    /Gerbera/.test(html) && /All gerbera/.test(html) && !/Snapdragon White/.test(html) && /Gerbera Alliance Canadian/.test(html));
  S(`cbSet('period', 'week'); cbSet('count', '52'); cbSet('period', 'month');`);
  t('switching weekly to monthly keeps a sensible range', J('cbView').count === 12 && J('cbView').period === 'month');
  S(`cbSet('flower', '<img src=x>'); cbSet('measure', 'x');`);
  t('a view setting that is not on the list is refused', J('cbView').flower === 'all' && J('cbView').measure === 'stems');
}

console.log('\naverages');
{
  t('an average is the total over the periods, whole stems from ten up, a decimal below',
    S(`cbAverageCell({ stems: 100, bunches: 0, cost: 80 }, 4, 'stems')`) === '25' &&
    S(`cbAverageCell({ stems: 9, bunches: 0, cost: 0 }, 4, 'stems')`) === '2.3' &&
    S(`cbAverageCell({ stems: 0, bunches: 10, cost: 0 }, 4, 'stems')`) === '2.5 bu' &&
    S(`cbAverageCell({ stems: 0, bunches: 0, cost: 81 }, 4, 'spend')`) === '$20');
  // The real book has invoices in a fortnight around Mother's Day 2025, then
  // none until June 2026. Counting those empty weeks as zero halved every
  // average, so an average is taken over the weeks the invoices cover.
  t('only weeks the invoices cover are counted, and a gap in the middle is not zero',
    JSON.stringify(J(`cbCountedPeriods(['2026-08-24', '2026-08-31', '2026-09-07'], { '2026-08-31': 1, '2026-09-07': 1 })`)) === '["2026-08-31","2026-09-07"]' &&
    JSON.stringify(J(`cbCountedPeriods(['2025-05-05', '2025-05-12', '2026-06-22'], { '2025-05-05': 1, '2026-06-22': 1 })`)) === '["2025-05-05","2026-06-22"]');
  t('  the weeks and months an invoice falls in are what counts as covered',
    JSON.stringify(J(`cbCoveredPeriods('week', ['2026-09-01', '2026-09-08'])`)) === '{"2026-08-31":1,"2026-09-07":1}' &&
    JSON.stringify(J(`cbCoveredPeriods('month', ['2026-09-01', '2025-05-02'])`)) === '{"2026-09":1,"2025-05":1}');

  // First invoice delivered 1 Sep; six weeks to 13 Sep, of which two have paperwork.
  S(`cbView = { flower: 'gerbera', period: 'week', count: 6, measure: 'stems', layout: 'all' }; renderColourBuying();`);
  let html = els['ct-colours-content'].innerHTML;
  const row = html.split('</tr>').find(r => />Mixed</.test(r)) || '';
  const cells = (row.match(/<td[^>]*>([^<]*)<\/td>/g) || []).map(c => c.replace(/<[^>]+>/g, '').trim());
  t('the average sits beside the colour: 100 gerberas over the two weeks with invoices is 50 a week',
    /Avg \/ wk/.test(html) && cells[0] === '50' && cells[cells.length - 1] === '100', JSON.stringify(cells));
  t('  and the note says how many weeks it is taken over, and why the rest are not',
    /over the 2 weeks of these 6 that the invoices cover/.test(html) && /missing paperwork/.test(html));
  S(`cbSet('layout', 'avg');`);
  html = els['ct-colours-content'].innerHTML;
  t('"Averages only" leaves the colour, its average and its total',
    /Avg \/ wk/.test(html) && !/>Aug 31</.test(html) && />Mixed</.test(html));
  S(`cbSet('layout', 'nonsense');`);
  t('  and an unknown layout falls back to every week', J('cbView').layout === 'all');
  S(`cbSet('period', 'month');`);
  t('monthly averages are per month', /Avg \/ mo/.test(els['ct-colours-content'].innerHTML));
}

console.log('\none month');
{
  const weeks = J(`cbMonthWeeks('2026-09')`);
  t('a month\'s weeks run Monday to Sunday, cut at its edges (1 Sep 2026 is a Tuesday)',
    weeks.length === 5 && weeks[0].key === '2026-08-31' && weeks[0].from === '2026-09-01' && weeks[0].to === '2026-09-06' &&
    weeks[4].from === '2026-09-28' && weeks[4].to === '2026-09-30', weeks.map(w => w.from.slice(8) + '–' + w.to.slice(8)).join(' '));
  const part = J(`cbMonthCoverage('2026-09', ['2026-09-01', '2026-09-08', '2026-09-13'])`);
  const whole = J(`cbMonthCoverage('2026-02', ['2026-02-01', '2026-02-03', '2026-02-10', '2026-02-17', '2026-02-24', '2026-02-28'])`);
  const none = J(`cbMonthCoverage('2026-08', ['2026-09-01'])`);
  t('a month is averaged over the weeks its own invoices cover, counted in days inside the month',
    part.days === 13 && !part.whole && whole.days === 28 && whole.whole && none.days === 0,
    `${part.days} / ${whole.days} / ${none.days} days`);

  S(`cbView = { flower: 'gerbera', period: 'week', count: 12, measure: 'stems', layout: 'all', month: '' }; cbSet('count', 'month');`);
  let html = els['ct-colours-content'].innerHTML;
  const row = html.split('</tr>').find(r => />Mixed</.test(r)) || '';
  const cells = (row.match(/<td[^>]*>([^<]*)<\/td>/g) || []).map(c => c.replace(/<[^>]+>/g, '').trim());
  t('"A single month" opens on the newest month, week by week, with its own labels',
    J('cbView').month === 'latest' && />Sep 1–6</.test(html) && />Sep 7–13</.test(html) && /type="month"/.test(html) &&
    !/aria-label="Period"/.test(html));
  t('  100 gerberas in the 13 days of September so far is 54 a week',
    cells[0] === '54' && cells[cells.length - 1] === '100', JSON.stringify(cells));
  t('  and the note says what the average is taken over', /13 days in weeks the invoices cover/.test(html));
  S(`cbSet('month', '2026-08');`);
  html = els['ct-colours-content'].innerHTML;
  t('picking a month with no invoices says so rather than showing zeros',
    J('cbView').month === '2026-08' && /No invoices in the cost tracker cover August 2026/.test(html));
  S(`cbSet('month', '2026-13x'); cbSet('month', '<img>');`);
  t('  a month that is not a month is refused', J('cbView').month === '2026-08');
  S(`cbSet('count', '26');`);
  t('choosing a range of weeks leaves the single month', J('cbView').month === '' && J('cbView').count === 26);
}

console.log('\nthe Holiday Revenue report uses the same colours');
{
  S(`ctData.invoices.push({ id: 'h1', date: '2026-02-10', supplier: 'A', items: [
       { name: 'Rose Novelty Blush 60cm', category: 'Flowers', family: 'Roses', qty: 100, uom: 'Stem', unitPrice: 1, total: 100 } ] });`);
  const before = J(`(function(){ var r = hcQtyByType(2026, 1); return r && r.rows ? r.rows : r; })()`);
  S(`ctData.colourFixes['rose novelty blush 60cm'] = 'Light Pink';`);
  const after = J(`(function(){ var r = hcQtyByType(2026, 1); return r && r.rows ? r.rows : r; })()`);
  const colours = rows => JSON.stringify((rows || []).filter(r => /rose/i.test(r.type)).map(r => (r.colors || []).map(c => c.color)));
  t('a correction made here recolours that rose on the holiday report',
    /Colour not recorded/.test(colours(before)) && /Light Pink/.test(colours(after)) && !/Colour not recorded/.test(colours(after)),
    colours(after));
}

function near(a, b) { return Math.abs(a - b) < 0.005; }

console.log('\nyour real invoices, if they are here');
{
  const fs = require('fs'), path = require('path');
  const dir = path.join(require('os').homedir(), 'Downloads');
  let file = null;
  try { file = fs.readdirSync(dir).filter(f => /^bloom-books-backup-.*\.json$/.test(f)).sort().pop(); } catch (e) {}
  if (!file) console.log('  (no backup on this machine: skipped)');
  else {
    const j = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    sb.__REAL__ = j.ctData;
    S('ctData = __REAL__; delete ctData.colourFixes;');
    const r = J(`(function(){ var ls = cbLines(); return { lines: ls.length, unknown: ls.filter(function (l) { return l.colour === CB_UNKNOWN; }).length,
      bad: ls.filter(function (l) { return !isFinite(l.stems) || !isFinite(l.bunches) || !isFinite(l.cost) || !/^\\d{4}-\\d{2}-\\d{2}$/.test(l.date); }).length }; })()`);
    S('renderColourBuying();');
    t('every line reads cleanly, and at least 95% have a colour without any corrections',
      r.lines > 0 && r.bad === 0 && r.unknown / r.lines <= 0.05 && /Color<\/th>/.test(els['ct-colours-content'].innerHTML),
      `${r.lines - r.unknown} of ${r.lines} lines`);
  }
}

console.log(fail.length ? '\n' + fail.length + ' FAILURES:\n' + fail.join('\n') : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
