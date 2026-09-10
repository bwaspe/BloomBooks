// Shared plumbing for the test suites.
//
// THE REPO IS PUBLIC. Nothing in here reads a fixture from inside it, and
// nothing writes one in. The suites check their answers against a real Bloom
// Books backup and against real vendor statements, and those are the shop's
// financial records -- they stay on the machine, outside the repo, and are
// found at run time. A suite whose data is absent SKIPS and says so; it does
// not fail, because "the file is on another computer" is not a bug in the app.
//
// Point BLOOMBOOKS_FIXTURES at a folder to override where they are looked for.

const fs = require('fs');
const os = require('os');
const path = require('path');

// The app's own source, two ways: this file sits in <repo>/tests.
const APP = path.resolve(__dirname, '..');

function fixtureDirs() {
  const dirs = [];
  if (process.env.BLOOMBOOKS_FIXTURES) dirs.push(process.env.BLOOMBOOKS_FIXTURES);
  dirs.push(path.join(os.homedir(), 'Downloads'));
  return dirs.filter(d => { try { return fs.statSync(d).isDirectory(); } catch (e) { return false; } });
}

function findFile(name) {
  for (const dir of fixtureDirs()) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// A suite names the EXACT backup it was written against, deliberately. Several
// assert real dollar figures off it -- "July matches the day book to the cent"
// means nothing against a different day's book, and silently swapping in the
// newest one would turn a passing suite into a liar.
function book(name) {
  const p = findFile(name);
  if (!p) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function file(name) {
  const p = findFile(name);
  return p ? fs.readFileSync(p, 'utf8') : null;
}

function src(files) {
  return files.map(f => fs.readFileSync(path.join(APP, f), 'utf8')).join('\n');
}

// Every suite runs the app's real source inside a vm with this as the window.
// Stubs are deliberately thin: a suite that needs more should say so rather
// than have a fat fake quietly answering for the app.
function sandbox(extra) {
  const el = () => ({ innerHTML: '', value: '', style: {}, options: { length: 0 },
                      classList: { add() {}, remove() {} }, appendChild() {},
                      addEventListener() {}, querySelectorAll: () => [],
                      getContext: () => ({}) });
  const sb = Object.assign({
    console,
    notify() {}, saveData() {}, switchPanel() {}, confirm: () => true,
    escHtml: s => String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    fmt: n => '$' + Number(n).toFixed(2),
    Chart: function () { return { destroy() {} }; },
    easterSunday: y => new Date(Date.UTC(y, 3, 5)),
    document: { getElementById: () => null, querySelector: () => null,
                querySelectorAll: () => [], createElement: el, addEventListener() {} },
    localStorage: { store: {}, getItem(k) { return this.store[k] || null; },
                    setItem(k, v) { this.store[k] = v; } }
  }, extra || {});
  sb.window = sb;
  return sb;
}

// Stop with a clear reason rather than a wall of failures. Exit 0: a missing
// backup is a missing backup, not a regression, and the runner counts it apart.
function skip(why) {
  console.log('  SKIP  ' + why);
  process.exit(0);
}

module.exports = { APP, book, file, src, sandbox, skip, findFile, fixtureDirs };
