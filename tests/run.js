// Run every suite and print one line each.
//
//   node tests/run.js            everything
//   node tests/run.js venmo tax  only suites whose name contains one of these
//
// Exit code is the number of suites that FAILED, so a build step can gate on
// it. A suite that skipped for want of a backup is counted apart and does not
// fail the run -- see fixtures.js for why.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const want = process.argv.slice(2);
const suites = fs.readdirSync(dir)
  .filter(f => /^test_.*\.js$/.test(f))
  .filter(f => !want.length || want.some(w => f.includes(w)))
  .sort();

if (!suites.length) {
  console.log('No suites matched.');
  process.exit(0);
}

let passed = 0, failed = 0, skipped = 0;
const failures = [];

suites.forEach(f => {
  const name = f.replace(/^test_|\.js$/g, '');
  let out = '', code = 0;
  try {
    out = execFileSync(process.execPath, [path.join(dir, f)], { encoding: 'utf8' });
  } catch (e) {
    out = (e.stdout || '') + (e.stderr || '');
    code = e.status == null ? 1 : e.status;
  }
  if (code !== 0) {
    failed++; failures.push({ name, out });
    const why = (out.match(/^\s*FAIL\s+(.*)$/m) || [, out.trim().split('\n').pop()])[1];
    console.log('  FAIL  ' + name.padEnd(16) + (why || '').slice(0, 90));
  } else if (/^\s*SKIP\s/m.test(out)) {
    skipped++;
    console.log('  skip  ' + name.padEnd(16) + (out.match(/^\s*SKIP\s+(.*)$/m) || [, ''])[1]);
  } else {
    passed++;
    const n = (out.match(/PASS/g) || []).length;
    console.log('  ok    ' + name.padEnd(16) + n + ' checks');
  }
});

console.log('\n' + passed + ' passed, ' + failed + ' failed, ' + skipped + ' skipped');
if (failures.length) {
  console.log('\n--- detail ---');
  failures.forEach(f => { console.log('\n### ' + f.name + '\n' + f.out.trim()); });
}
process.exit(failed);
