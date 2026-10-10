// What an item has been filed as before beats a guess about its name.
//
// ctLearnFamily learns the FIRST WORD of a name. So tagging one "Snap White
// Canadian Large" as a pot cover writes snap -> 6" Pot cover, and every
// snapdragon the shop buys reads as a pot cover from then on, on every future
// invoice, with the mistake nowhere near where it shows up.
//
// That is not hypothetical. One such line is in the book, against sixteen
// correct ones for the same item and twenty-four for its pink sibling -- and
// the review card was still saying pot cover weeks later.
const F = require('./fixtures');
const vm = require('vm');

function app(invoices, rules) {
  const sb = F.sandbox({ setTimeout: () => 0 });
  sb.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  vm.createContext(sb);
  vm.runInContext(F.src(['config.js', 'utils.js', 'ledger.js', 'cost-tracker.js']), sb, { filename: 'bb.js' });
  sb.__CT__ = { invoices: invoices || [], catalog: {}, retail: {}, family: {}, familyKeywords: {},
                markup: {}, templates: [] };
  vm.runInContext('ctData = __CT__;', sb);
  sb.__RULES__ = rules || [];
  vm.runInContext('bbFamilyRules = function () { return __RULES__; };', sb);
  return sb;
}

const line = (name, family) => ({ name, category: 'Flowers', family, qty: 10, uom: 'Stem',
                                  unitPrice: 1, total: 10 });
const inv = (id, items) => ({ id, date: '2026-09-01', deliveryDate: '2026-09-01', supplier: 'Perri', items });

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };

// The rule as one mis-click leaves it.
const badRule = [{ keyword: 'snap', family: '6" Pot cover', priority: 0 }];

console.log('one mis-click no longer rewrites a whole family');
{
  const book = [];
  for (let i = 0; i < 16; i++) book.push(inv('i' + i, [line('Snap White Canadian Large', 'Snapdragon')]));
  book.push(inv('bad', [line('Snap White Canadian Large', '6" Pot cover')]));   // the slip
  for (let i = 0; i < 24; i++) book.push(inv('p' + i, [line('Snap Pink Canadian Large', 'Snapdragon')]));

  const sb = app(book, badRule);
  t('the bad rule really is in force', sb.bbFamilyRules()[0].family === '6" Pot cover');
  t('but the item the slip was made on still reads Snapdragon',
    sb.ctGuessFamily('Snap White Canadian Large') === 'Snapdragon',
    sb.ctGuessFamily('Snap White Canadian Large'));
  t('and so does its sibling, which was never mis-tagged',
    sb.ctGuessFamily('Snap Pink Canadian Large') === 'Snapdragon',
    sb.ctGuessFamily('Snap Pink Canadian Large'));
}

console.log('\nmajority, not most recent');
{
  // The slip is the LAST thing filed. Taking the newest would hand the whole
  // family to it -- which is exactly the failure being fixed, one step later.
  const book = [];
  for (let i = 0; i < 5; i++) book.push(inv('i' + i, [line('Snap White Canadian Large', 'Snapdragon')]));
  book.push(inv('last', [line('Snap White Canadian Large', '6" Pot cover')]));

  const sb = app(book, badRule);
  t('five against one still reads Snapdragon',
    sb.ctGuessFamily('Snap White Canadian Large') === 'Snapdragon',
    sb.ctGuessFamily('Snap White Canadian Large'));
}

console.log('\na book that is genuinely split answers nothing');
{
  // Two filings each way is not evidence, and pretending it is would be worse
  // than falling back to the keyword the owner can see and correct.
  const sb = app([
    inv('a', [line('Snap White Canadian Large', 'Snapdragon')]),
    inv('b', [line('Snap White Canadian Large', '6" Pot cover')])
  ], badRule);
  t('a tie gives no prior', sb.ctPriorFamily('Snap White Canadian Large') === '');
  t('so the keyword rule decides, as it did before',
    sb.ctGuessFamily('Snap White Canadian Large') === '6" Pot cover',
    sb.ctGuessFamily('Snap White Canadian Large'));
}

console.log('\nan item never bought before still follows the rules');
{
  // No evidence, so nothing to prefer. This is also what keeps the Settings
  // rules meaningful: they are what a NEW item is judged by.
  const sb = app([inv('a', [line('Snap White Canadian Large', 'Snapdragon')])], badRule);
  t('a new item takes the keyword', sb.ctGuessFamily('Snap Burgundy Brand New') === '6" Pot cover',
    sb.ctGuessFamily('Snap Burgundy Brand New'));
  t('and the known one does not', sb.ctGuessFamily('Snap White Canadian Large') === 'Snapdragon');
}

console.log('\nthe explicit override still outranks everything');
{
  const sb = app([
    inv('a', [line('Snap White Canadian Large', 'Snapdragon')]),
    inv('b', [line('Snap White Canadian Large', 'Snapdragon')])
  ], badRule);
  vm.runInContext("ctData.family['snap white canadian large'] = 'Something Else';", sb);
  t('a per-item override beats the prior filings',
    sb.ctGuessFamily('Snap White Canadian Large') === 'Something Else',
    sb.ctGuessFamily('Snap White Canadian Large'));
}

console.log('\nit only ever looks at the same product');
{
  const sb = app([
    inv('a', [line('Snap White Canadian Large', 'Snapdragon'),
              line('Rose Freedom Red', 'Roses')])
  ], []);
  t('a different item does not vote', sb.ctPriorFamily('Rose Freedom Red') === 'Roses');
  t('and an unsaved name has no prior at all', sb.ctPriorFamily('Never Seen') === '');
  t('nor does an empty name', sb.ctPriorFamily('') === '');
  // Lines saved with no family are silence, not a vote for blank.
  const sb2 = app([inv('a', [line('Snap White Canadian Large', '')]),
                   inv('b', [line('Snap White Canadian Large', 'Snapdragon')])], []);
  t('a blank family is not counted', sb2.ctPriorFamily('Snap White Canadian Large') === 'Snapdragon');
}

console.log(fail.length ? '\n' + fail.length + ' FAILED' : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
