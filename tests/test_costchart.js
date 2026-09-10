const F = require('./fixtures');
// Cost per stem over time, per FAMILY. The owner's constraint decides the
// grouping: there are many varieties and sizes, and a designer cannot be asked
// to hold "Delphinium Dark Blue Bella Andes Large" in their head. Delphinium
// they can.
const fs = require('fs'), vm = require('vm');
const BK = 'bloom-books-backup-2026-09-02-1936.json';
const __raw = F.file(BK);
if (!__raw) F.skip('needs ' + BK + ' — put it in Downloads or set BLOOMBOOKS_FIXTURES');
const j = JSON.parse(__raw);
const src = fs.readFileSync(F.APP + '/cost-tracker.js', 'utf8');
const el = () => ({ innerHTML: '', value: '', options: { length: 0 }, style: {},
                    classList: { add(){}, remove(){} }, appendChild(){},
                    addEventListener(){}, querySelectorAll: () => [], getContext: () => ({}) });
const sb = { appData: j.appData, console, notify: () => {}, saveData: () => {}, switchPanel: () => {},
  escHtml: String, fmt: n => '$' + n,
  Chart: function () { return { destroy() {} }; }, easterSunday: y => new Date(Date.UTC(y, 3, 5)),
  document: { getElementById: () => null, querySelector: () => null,
              querySelectorAll: () => [], createElement: el },
  localStorage: { store: { bb_ctdata: JSON.stringify(j.ctData) },
                  getItem(k) { return this.store[k] || null; },
                  setItem(k, v) { this.store[k] = v; } } };
sb.window = sb;
let out = null; sb.__OUT__ = o => { out = o; };

vm.runInNewContext(src + `
;(function(){
  ctLoad();
  const S = f => ctFamilyCostSeries(f);
  const d = S('Delphinium'), h = S('Hydrangea'), r = S('Roses');

  // Every variety of a family lands on ONE series, whatever it is called.
  const names = {};
  d.points.forEach(p => { names[p.name] = 1; });

  // Sorted by date, or the line zig-zags through time.
  let sorted = true;
  for (let i = 1; i < r.points.length; i++) if (r.points[i].d < r.points[i-1].d) sorted = false;

  // A line with no stem count must be LEFT OUT, not plotted per bunch on the
  // same axis -- $10 a bunch beside $1.40 a stem would look like a 7x spike.
  const bunchLine = { name: 'Delphinium Test No Count', category: 'Flowers',
                      family: 'Delphinium', qty: 3, uom: 'Bunch', stemsPerBu: null,
                      unitPrice: 10, total: 30 };
  ctData.invoices.push({ id: 'inv-chart-test', supplier: 'T', date: '2026-09-01',
                         deliveryDate: '2026-09-01', total: 30, items: [bunchLine] });
  const withBunch = S('Delphinium');
  ctData.invoices.pop();

  // A family nobody has priced draws no retail line rather than a zero one.
  const noRetail = (function () {
    const keep = ctData.retail; ctData.retail = {};
    const x = S('Delphinium'); ctData.retail = keep; return x.retail;
  })();

  __OUT__({
    families: ctChartableFamilies(),
    delph: { n: d.points.length, first: d.points[0].per, last: d.points[d.points.length-1].per,
             retail: d.retail, retailCount: d.retailCount, members: d.members, varieties: Object.keys(names).length },
    hyd:   { n: h.points.length, retail: h.retail,
             first: h.points[0].per, last: h.points[h.points.length-1].per },
    roses: { n: r.points.length, retail: r.retail,
             first: r.points[0].per, last: r.points[r.points.length-1].per },
    sorted: sorted,
    excluded: { added: withBunch.skipped - d.skipped, points: withBunch.points.length - d.points.length },
    noRetail: noRetail,
    unknownFamily: S('Wombat').points.length
  });
})();`, sb, { filename: 'ct.js' });

const fail = [];
const t = (l, c, dd) => { if (!c) fail.push(l); console.log(`  ${c ? 'PASS' : 'FAIL'}  ${l}${dd !== undefined ? '  [' + dd + ']' : ''}`); };
const o = out;
const x = (retail, cost) => (retail / cost).toFixed(1) + 'x';

console.log('it groups by family, so a designer sees one line per flower');
t('every Delphinium variety lands on one series',
  o.delph.varieties > 3 && o.delph.n > 10,
  o.delph.varieties + ' varieties, ' + o.delph.n + ' purchases');
t('the points are in date order', o.sorted);
t('only flowers with two or more priced purchases are offered',
  o.families.length > 10 && o.families.indexOf('Delphinium') >= 0, o.families.length + ' families');
t('a family nobody buys returns nothing rather than throwing', o.unknownFamily === 0);

console.log('\nand it answers the question actually being asked');
t('Delphinium has risen and sits under a 4x markup',
  o.delph.last > o.delph.first && (o.delph.retail / o.delph.last) < 4,
  '$' + o.delph.first.toFixed(2) + ' -> $' + o.delph.last.toFixed(2) +
  ' against $' + o.delph.retail.toFixed(2) + ' = ' + x(o.delph.retail, o.delph.last));
t('Hydrangea is flat but ALSO under 4x — a pricing question, not a cost one',
  (o.hyd.retail / o.hyd.last) < 4,
  '$' + o.hyd.last.toFixed(2) + ' against $' + o.hyd.retail.toFixed(2) + ' = ' + x(o.hyd.retail, o.hyd.last));
t('Roses are comfortably above it, as the owner said',
  (o.roses.retail / o.roses.last) > 4,
  '$' + o.roses.last.toFixed(2) + ' against $' + o.roses.retail.toFixed(2) + ' = ' + x(o.roses.retail, o.roses.last));

console.log('\nand it does not lie about the axis');
t('a bunch line with no stem count is excluded, not plotted per bunch',
  o.excluded.added === 1 && o.excluded.points === 0,
  'skipped +' + o.excluded.added + ', plotted +' + o.excluded.points);
t('a family with no retail price set draws no line rather than a zero one',
  o.noRetail === null, o.noRetail);
t('the retail average says how many varieties it covers',
  o.delph.retailCount > 0 && o.delph.retailCount < o.delph.members,
  o.delph.retailCount + ' of ' + o.delph.members + ' priced');

console.log(fail.length ? `\n${fail.length} FAILURES:\n` + fail.join('\n') : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
