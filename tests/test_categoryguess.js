const F = require('./fixtures');
// The Fall River invoice would not populate the Mother's Day flower table
// because four of its five lines were categorised "Other" -- three peony lines
// and an aster. The quantity table counts Flowers and Greens only, so $1,010 of
// real flowers sat outside it.
//
// 'peony' was in the keyword list; the item said "Peonies", and a substring
// match cannot bridge a plural. 'aster' was missing entirely -- and cannot be
// added as a substring, because "Easter" contains it.
//
// The guard that matters: the owner has taught this thing 62 names by hand.
// Adding keywords must not change a single answer that is already right.
const fs = require('fs'), vm = require('vm');
const { execSync } = require('child_process');
const BK = 'bloom-books-backup-2026-09-02-1936.json';
const __raw = F.file(BK);
if (!__raw) F.skip('needs ' + BK + ' — put it in Downloads or set BLOOMBOOKS_FIXTURES');
const j = JSON.parse(__raw);
const ROOT = F.APP + '/';

const NOW = fs.readFileSync(ROOT + 'cost-tracker.js', 'utf8');
const WAS = execSync('git show HEAD:cost-tracker.js', { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 }).toString();

function guessAll(src) {
  const el = () => ({ innerHTML: '', value: '', style: {}, classList: { add(){}, remove(){} },
                      appendChild(){}, addEventListener(){}, querySelectorAll: () => [] });
  const sb = { appData: j.appData, console, notify: () => {}, saveData: () => {}, switchPanel: () => {},
    escHtml: String, fmt: n => '$' + n,
    Chart: function () { return { destroy() {} }; }, easterSunday: y => new Date(Date.UTC(y, 3, 5)),
    document: { getElementById: () => null, querySelector: () => null,
                querySelectorAll: () => [], createElement: el },
    localStorage: { store: { bb_ctdata: JSON.stringify(j.ctData) },
                    getItem(k) { return this.store[k] || null; },
                    setItem(k, v) { this.store[k] = v; } } };
  sb.window = sb;
  let out = null;
  sb.__OUT__ = o => { out = o; };
  vm.runInNewContext(src + `
;(function(){
  ctLoad();
  // Ask what the KEYWORDS alone say, not what the owner has taught it -- that is
  // what a brand-new invoice line gets.
  var taught = ctData.catalog; ctData.catalog = {};
  var res = {}, seen = {};
  ctData.invoices.forEach(function (inv) { (inv.items || []).forEach(function (it) {
    var k = ctCatalogKey(it.name);
    if (seen[k]) return; seen[k] = 1;
    res[it.name] = { guess: ctGuessCategory(it.name), owner: it.category };
  }); });
  ctData.catalog = taught;
  // A few names that must NOT be swept up by the new word-boundary keywords.
  var traps = {};
  ['Easter Basket 10in', 'Easter Lily 6in', 'Easter Egg Pick',
   'Wax Tissue Botanical 24x36', 'Lemon Leaf Bunch', 'Glass Cylinder Vase',
   'Bell Cup Vase Ceramic', 'Grass Green Bear Grass'].forEach(function (n) {
    traps[n] = ctGuessCategory(n); });
  __OUT__({ res: res, traps: traps });
})();`, sb, { filename: 'ct.js' });
  return out;
}

const was = guessAll(WAS);
const now = guessAll(NOW);

// Ask the live function about a literal name, rather than looking one up in the
// book -- the expectations name shapes to test, not rows that happen to exist.
const guessOne = (() => {
  const el = () => ({ innerHTML: '', value: '', style: {}, classList: { add(){}, remove(){} },
                      appendChild(){}, addEventListener(){}, querySelectorAll: () => [] });
  const sb = { appData: j.appData, console, notify: () => {}, saveData: () => {},
    switchPanel: () => {}, escHtml: String, fmt: n => '$' + n,
    Chart: function () { return { destroy() {} }; }, easterSunday: y => new Date(Date.UTC(y, 3, 5)),
    document: { getElementById: () => null, querySelector: () => null,
                querySelectorAll: () => [], createElement: el },
    localStorage: { store: {}, getItem: () => null, setItem() {} } };
  sb.window = sb;
  vm.runInNewContext(NOW + '\n;window.__ASK__ = n => ctGuessCategory(n);', sb, { filename: 'ct.js' });
  return sb.__ASK__;
})();

// What counts as "the owner corrected this" needs care. The stored category on
// a line is NOT ground truth: for a name nobody ever touched it is just whatever
// the guesser said at upload time, so comparing the guesser against it asks
// whether the guesser agrees with its own past self. Circular.
//
// A CORRECTION is where the stored category differs from what the OLD keywords
// would have said -- somebody typed that. Those must never be contradicted.
// Where stored and old guess agree, the value was a default and may be stale;
// those are allowed to move, and printed so the movement can be eyeballed.
const names = Object.keys(now.res);
const changed = [], fixed = [], broke = [], staleFixed = [];
names.forEach(n => {
  const a = was.res[n], b = now.res[n];
  if (!a || a.guess === b.guess) return;
  const corrected = a.guess !== b.owner;      // the owner typed something else
  changed.push({ n, from: a.guess, to: b.guess, owner: b.owner, corrected });
  if (corrected) {
    if (b.guess === b.owner) fixed.push({ n, from: a.guess, to: b.guess });
    else broke.push({ n, from: a.guess, to: b.guess, owner: b.owner });
  } else {
    staleFixed.push({ n, from: a.guess, to: b.guess });
  }
});

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log(`  ${c ? 'PASS' : 'FAIL'}  ${l}${d !== undefined ? '  [' + d + ']' : ''}`); };

console.log(`${names.length} distinct item names in the book; ${changed.length} guess differently now\n`);
console.log('it fixes what it was meant to fix');
t('the three peony lines are flowers now',
  ['DVF Peonies Festiva Max SZB', 'DVF Peonies Jules Elie SZB', 'DVF Peonies Sara B SZB']
    .every(n => now.res[n] && now.res[n].guess === 'Flowers'));
t('so is the aster', now.res['VFR Aster Carniv Hot Prestispk'] &&
  now.res['VFR Aster Carniv Hot Prestispk'].guess === 'Flowers',
  now.res['VFR Aster Carniv Hot Prestispk'] && now.res['VFR Aster Carniv Hot Prestispk'].guess);
// Was a before/after diff against HEAD, which stopped meaning anything the
// moment the change was committed -- it began comparing the file with itself.
// Pinned to named expectations instead, so it keeps testing the rule rather
// than the diff.
const EXPECT = [
  ["DVF Peonies Festiva Max SZB", "Flowers"], ["Peone Jules Elie Holland", "Flowers"],
  ["VFR Aster Carniv Hot Prestispk", "Flowers"], ["Aster White Mardi Gras", "Flowers"],
  ["Strawflower Hot Pink", "Flowers"], ["Hydranga Blue Horizonte", "Flowers"],
  ["Cymbidium Pink Spray", "Flowers"], ["Agapantha Blue", "Flowers"],
  ["Zinnia Benarys Giant Mix", "Flowers"], ["Spider Lavender", "Flowers"],
  ["Corn Flower", "Flowers"], ["Riceflower Pink", "Flowers"],
  ["Tee Pee", "Greens"], ["Israel Ruskus Bundle", "Greens"],
  ["Acacia Knifeblade", "Greens"], ["Curly Willow Tips", "Greens"],
  ["Aspidistra", "Greens"], ["Explosion Grass", "Greens"],
  // and the ones a careless keyword would swallow
  // Not Ribbon -- 'sheer' is not a ribbon keyword and the owner taught this one
  // by hand. What matters is that it is not a FLOWER, which is what a 'lavender'
  // keyword made it.
  ["Easter Basket 10in", "Other Containers"], ["#9 Wired Lavender Sheer 50yd", "Other"],
  ["White Willow Basket 10in", "Other Containers"], ["Glass Cylinder Vase", "Glass"],
];
const wrong = EXPECT.filter(([n, want]) => guessOne(n) !== want)
  .map(([n, want]) => `${n}: wanted ${want}, got ${guessOne(n)}`);
t(`${EXPECT.length} named items land in the right category`, wrong.length === 0,
  wrong.join(' | '));

console.log('\nand it contradicts nothing the owner actually typed');
t('no hand-corrected name is moved away from what the owner chose', broke.length === 0,
  broke.map(b => `${b.n}: ${b.from}->${b.to} (owner ${b.owner})`).join(' | '));
console.log(`  (${staleFixed.length} names moved whose stored value was only the old default:`);
staleFixed.slice(0, 12).forEach(s => console.log(`     ${s.from} -> ${s.to}  ${s.n.slice(0, 44)}`));
console.log('   these are stale defaults, not corrections)');

console.log('\nthe collisions the word-boundary list exists to avoid');
const T = now.traps;
t('"Easter Basket" is not a flower — \\baster does not match Easter',
  T['Easter Basket 10in'] !== 'Flowers', T['Easter Basket 10in']);
t('"Easter Egg Pick" is not a flower either', T['Easter Egg Pick'] !== 'Flowers',
  T['Easter Egg Pick']);
t('"Easter Lily" still is one — it is a lily', T['Easter Lily 6in'] === 'Flowers',
  T['Easter Lily 6in']);
t('"Lemon Leaf" is greens', T['Lemon Leaf Bunch'] === 'Greens', T['Lemon Leaf Bunch']);
t('"Bear Grass" is greens', T['Grass Green Bear Grass'] === 'Greens',
  T['Grass Green Bear Grass']);
t('a glass vase is still glass', T['Glass Cylinder Vase'] === 'Glass',
  T['Glass Cylinder Vase']);

console.log('\nwhat changed (first 20 of ' + changed.length + '):');
changed.slice(0, 20).forEach(c => console.log(
  `   ${c.from.padEnd(9)} -> ${c.to.padEnd(9)} ${c.owner === c.to ? '\u2713' : '(owner: ' + c.owner + ')'}  ${c.n.slice(0, 44)}`));

console.log(fail.length ? `\n${fail.length} FAILURES:\n` + fail.join('\n') : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
