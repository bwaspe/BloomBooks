// Does the page that ships actually hold together?
//
// Every other suite here runs the SOURCE FILES in Node. None of them opens
// index.html, so none of them can see the class of fault that has nothing to
// do with the logic: a script tag pointing at a file that was renamed, a new
// file added with no tag, a cache marker bumped on nineteen lines out of
// twenty, a stray syntax error in a file no test happens to load.
//
// Those faults do not fail quietly. They produce a blank screen, or -- worse,
// because it looks like it worked -- an app running one stale file alongside
// twenty fresh ones. The cache marker has been bumped by hand on every deploy
// this project has ever had, which is exactly the kind of thing that is right
// until the once it is not.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };

const refs = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))(\?v=([^"]*))?"/g)]
  .map(m => ({ file: m[1], marker: m[3] || null, external: /^https?:\/\//.test(m[1]) }))
  .filter(r => !r.external);

console.log('every file the page asks for is really there');
{
  t('the page references a sensible number of local files', refs.length >= 20, refs.length);
  refs.forEach(r => {
    t(r.file + ' exists', fs.existsSync(path.join(REPO, r.file)));
  });
}

console.log('\nand every local file the repo has is on the page');
{
  // The other direction, which is how a new module gets written, tested and
  // then never loaded. ct-sync.js and errors.js were both added by hand.
  const onPage = new Set(refs.map(r => r.file));
  const onDisk = fs.readdirSync(REPO)
    .filter(f => /\.js$/.test(f) && f !== 'service-worker.js');
  onDisk.forEach(f => {
    t(f + ' is loaded by the page', onPage.has(f),
      onPage.has(f) ? '' : 'written but never loaded');
  });
}

console.log('\nthe cache marker is the same on all of them');
{
  // One file left on the previous marker is served from cache while the rest
  // are fresh, so the app runs a mixture of two versions -- which looks like a
  // logic bug and is not one.
  const markers = [...new Set(refs.map(r => r.marker))];
  t('every reference carries a marker', refs.every(r => !!r.marker),
    refs.filter(r => !r.marker).map(r => r.file).join(', '));
  t('and they are all the same one', markers.length === 1, markers.join(' / '));
}

console.log('\nevery file parses');
{
  // A syntax error in a file no suite happens to load reaches the shop as a
  // blank screen. Parsing is not running, but it catches that.
  refs.filter(r => /\.js$/.test(r.file)).forEach(r => {
    let err = '';
    try { new vm.Script(fs.readFileSync(path.join(REPO, r.file), 'utf8'), { filename: r.file }); }
    catch (e) { err = e.message; }
    t(r.file + ' parses', !err, err);
  });
}

console.log('\nand so does the block inlined in the page');
{
  // The error collector lives in index.html, so no file-level check covers it.
  const inline = [...html.matchAll(/<script>([^]*?)<\/script>/g)].map(m => m[1]);
  t('there is an inline script to check', inline.length >= 1, inline.length);
  inline.forEach((src, i) => {
    let err = '';
    try { new vm.Script(src, { filename: 'inline#' + i }); } catch (e) { err = e.message; }
    t('inline script ' + (i + 1) + ' parses', !err, err);
  });
}

console.log('\nthe load order still holds');
{
  const order = refs.filter(r => /\.js$/.test(r.file)).map(r => r.file);
  const at = f => order.indexOf(f);
  // config.js declares the state everything else reaches for; init.js runs
  // last because it starts the app.
  t('config.js is first', at('config.js') === 0, order[0]);
  t('init.js is last', at('init.js') === order.length - 1, order[order.length - 1]);
  // settings.js calls bbSettingsDefaults() as it parses, and that reads ctData.
  t('cost-tracker.js is loaded before settings.js',
    at('cost-tracker.js') < at('settings.js'));
  // ct-sync.js reads the claim out of bbSettings.
  t('settings.js is loaded before ct-sync.js', at('settings.js') < at('ct-sync.js'));
}

console.log(fail.length ? '\n' + fail.length + ' FAILED' : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
