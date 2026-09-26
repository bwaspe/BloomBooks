// The Logic Trainer panel explained a rule the app no longer has.
//
// It said any transaction carrying the owner's name was "always ignored
// during import". That rule was removed because it was doing real damage --
// Chase puts the account holder in the ACH description, so it quietly threw
// away a flower order and two Amex payments the owner had authorised, and the
// books could not tie to the bank balance. What replaced it CATEGORISES those
// rows instead. The screen went on describing the old behaviour.
//
// A screen that explains a feature which is not there is worse than one that
// explains nothing: it is believed. So the claim and the code are checked
// against each other here rather than left to be noticed.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');

// config.js declares with const, so it is read out of the context rather than
// off the sandbox.
const sb = { console };
vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(REPO, 'config.js'), 'utf8'), sb, { filename: 'config.js' });
const RULES = vm.runInContext('BUILTIN_RULES', sb);

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };

// The panel's built-in-rules box, which is the part that makes claims.
const box = (html.match(/<strong>🔒[^]*?<\/div>\s*<\/div>/) || [''])[0];

console.log('the built-in rules box describes rules that exist');
{
  t('the box is still there to check', box.length > 50, box.length);

  const ignoring = RULES.filter(r => r && r.ignore);
  t('no built-in rule discards a row any more', ignoring.length === 0,
    JSON.stringify(ignoring.map(r => r.keyword)));

  // The exact wording that was wrong. Not a substring search for "ignore" --
  // the box may legitimately say what it no longer does.
  t('so the box does not claim anything is always ignored',
    !/always ignored/i.test(box), (box.match(/.{0,40}always ignored.{0,40}/i) || [''])[0]);
}

console.log('\nand every rule the box names is really there');
{
  // Keywords quoted in <code> inside the box have to match a live rule, or the
  // screen is teaching a keyword that files nothing.
  const quoted = [...box.matchAll(/<code>([^<]+)<\/code>/g)].map(m => m[1].trim());
  t('the box quotes at least one keyword', quoted.length > 0, quoted.join(' | '));
  quoted.forEach(q => {
    const hit = RULES.find(r => r && String(r.keyword).toLowerCase() === q.toLowerCase());
    t('“' + q + '” is a real built-in rule', !!hit,
      hit ? hit.category : 'no rule with that keyword');
  });
}

console.log('\nand the categories it promises are the ones the rules file to');
{
  const owner = RULES.filter(r => r && /barami/i.test(String(r.keyword)));
  t('the owner rules are matched on the Zelle wording, not the bare name',
    owner.length > 0 && owner.every(r => /zelle/i.test(String(r.keyword))),
    owner.map(r => r.keyword).join(' | '));
  t('one files a draw', owner.some(r => r.category === 'Owner Draw'));
  t('one files a contribution', owner.some(r => r.category === 'Owner Contribution'));
  owner.forEach(r => {
    t('the box names the category “' + r.category + '”',
      box.indexOf(r.category) >= 0);
  });

  // They sit last so a named supplier wins first, whatever the ACH description
  // happens to carry. The box says so; this is what makes that true.
  const lastNamed = RULES.map((r, i) => ({ r, i })).filter(x => /barami/i.test(String(x.r.keyword)));
  const others = RULES.map((r, i) => ({ r, i }))
    .filter(x => !/barami/i.test(String(x.r.keyword)) && !/atm withdrawal/i.test(String(x.r.keyword)));
  t('and they really are matched after every named supplier',
    lastNamed.every(x => others.every(o => o.i < x.i)),
    lastNamed.map(x => x.i).join(',') + ' vs max ' + Math.max(...others.map(o => o.i)));
}

console.log(fail.length ? '\n' + fail.length + ' FAILED' : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
