// Catching what goes wrong.
//
// Nothing in this app caught an error. A fault at the counter went into a
// console nobody opens and reached me as "it was acting weird", which is not
// something anyone can act on.
//
// The collector is inline at the top of index.html rather than in a module,
// and that placement is the point: a module loaded with the others misses a
// script that 404s, a syntax error in config.js, anything that goes wrong
// before the app is up -- the failures that leave a blank screen with no
// explanation. So the inline block is pulled OUT of the HTML here and run,
// rather than a copy of it being tested.
const F = require('./fixtures');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');

// The collector, as it really ships.
const collector = (html.match(/<script>\s*\nwindow\.BB_ERRORS = \[\][^]*?<\/script>/) || [''])[0]
  .replace(/^<script>/, '').replace(/<\/script>$/, '');

function app(opts) {
  opts = opts || {};
  const els = { 'bb-errors': { innerHTML: '' } };
  const sb = F.sandbox({ setTimeout: () => 0 });
  const handlers = {};
  sb.document.getElementById = id => els[id] || null;
  sb.document.querySelector = sel => {
    if (/config\.js/.test(sel)) return { src: 'https://x/config.js?v=20260926j' };
    if (/panel\.active/.test(sel)) return { id: 'panel-trainer' };
    return null;
  };
  sb.document.createElement = () => ({ style: {}, select: () => {}, focus: () => {} });
  sb.document.body = { appendChild: () => {}, removeChild: () => {} };
  sb.document.execCommand = () => true;
  const notes = [];
  sb.notify = (m, bad) => notes.push({ m, bad });
  sb.confirm = () => opts.confirm !== false;
  sb.navigator = {};
  const store = Object.assign({}, opts.store);
  sb.localStorage = {
    store,
    getItem(k) { return Object.prototype.hasOwnProperty.call(this.store, k) ? this.store[k] : null; },
    setItem(k, v) { if (opts.writeThrows) throw new Error('quota'); this.store[k] = v; },
    removeItem(k) { delete this.store[k]; }
  };
  sb.window = sb;
  const phase = {};
  sb.addEventListener = (name, fn, capture) => { handlers[name] = fn; phase[name] = !!capture; };
  sb.escHtml = s => String(s == null ? '' : s);
  vm.createContext(sb);
  vm.runInContext(collector, sb, { filename: 'collector' });
  vm.runInContext(fs.readFileSync(path.join(REPO, 'errors.js'), 'utf8'), sb, { filename: 'errors.js' });
  return { sb, els, notes, store, handlers, phase };
}

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };

console.log('it is listening before anything else runs');
{
  const a = app();
  t('it hooks thrown errors', typeof a.handlers.error === 'function');
  t('and rejected promises nobody handled', typeof a.handlers.unhandledrejection === 'function');
  t('and starts empty', a.sb.bbErrors().length === 0);

  // A failed <script> or <img> fires its error on the ELEMENT and does not
  // bubble, so a listener on window only ever sees it during the capture
  // phase. Registered without that flag, the failure worth catching most --
  // a script that never loaded -- is silently never caught.
  t('and it listens in the capture phase, or a script that 404s is missed',
    a.phase.error === true);
}

console.log('\na thrown error');
{
  const a = app();
  a.handlers.error({ message: 'x is not a function', filename: 'cost-tracker.js', lineno: 4210,
                     error: { stack: 'TypeError: x is not a function\n  at ctSave' } });
  const e = a.sb.bbErrors()[0];
  t('is recorded', a.sb.bbErrors().length === 1);
  t('with what happened', e.message === 'x is not a function');
  t('and where', e.where === 'cost-tracker.js:4210', e.where);
  t('and the stack', /ctSave/.test(e.stack));
  t('and which screen was open', e.panel === 'panel-trainer', e.panel);
  // Without this, "it worked yesterday" cannot be checked against what shipped.
  t('and which version of the app it was', e.ver === '20260926j', e.ver);
  t('it survives a reload, because it is written down', !!a.store.bb_errors);
}

console.log('\na script that never loaded');
{
  // The failure most worth catching, and the one a module loaded alongside the
  // others cannot see. It arrives as an event with no message on it at all.
  const a = app();
  a.handlers.error({ target: { tagName: 'SCRIPT', src: 'https://x/cost-tracker.js?v=1' } });
  const e = a.sb.bbErrors()[0];
  t('is recorded even with no message', !!e);
  t('and says what would not load', /Could not load script/.test(e.message), e.message);
  t('naming the file', /cost-tracker\.js/.test(e.where), e.where);
}

console.log('\na promise nobody caught');
{
  const a = app();
  a.handlers.unhandledrejection({ reason: { message: '401 invalid credentials', stack: 'at ctSyncPushNow' } });
  t('is recorded too', a.sb.bbErrors()[0].message === '401 invalid credentials');
  t('as its own kind', a.sb.bbErrors()[0].kind === 'promise');
}

console.log('\nthe same fault over and over');
{
  // A throw inside a render loop would otherwise fill the buffer and push out
  // the FIRST occurrence, which is the one that explains what started it.
  const a = app();
  for (let i = 0; i < 200; i++) {
    a.handlers.error({ message: 'same', filename: 'a.js', lineno: 1, error: {} });
  }
  t('is one row, counted', a.sb.bbErrors().length === 1 && a.sb.bbErrors()[0].count === 200,
    a.sb.bbErrors().length + ' rows, count ' + a.sb.bbErrors()[0].count);

  // Different faults still have to be capped, or this becomes the thing that
  // fills the storage the cost tracker needs.
  const b = app();
  for (let i = 0; i < 200; i++) {
    b.handlers.error({ message: 'fault ' + i, filename: 'a.js', lineno: i, error: {} });
  }
  t('and a run of different ones is capped', b.sb.bbErrors().length <= 40, b.sb.bbErrors().length);
  t('keeping the newest', b.sb.bbErrors()[b.sb.bbErrors().length - 1].message === 'fault 199');
}

console.log('\nit must never become the fault itself');
{
  // Recording a problem in a browser that cannot write is not worth a second
  // exception on top of the first.
  const a = app({ writeThrows: true });
  let threw = false;
  try { a.handlers.error({ message: 'boom', filename: 'a.js', lineno: 1, error: {} }); }
  catch (e) { threw = true; }
  t('a storage that refuses to be written does not throw', !threw);
  t('and the error is still in memory for this session', a.sb.bbErrors().length === 1);
}

console.log('\nreading them back');
{
  const a = app();
  a.handlers.error({ message: 'first', filename: 'a.js', lineno: 1, error: { stack: 's1' } });
  a.handlers.error({ message: 'second', filename: 'b.js', lineno: 2, error: { stack: 's2' } });

  const text = a.sb.bbErrorsText();
  t('newest first, because that is the one being asked about',
    text.indexOf('second') < text.indexOf('first'));
  t('carrying the version', /20260926j/.test(text));

  a.sb.renderErrorsPanel();
  t('the panel lists them', /first/.test(a.els['bb-errors'].innerHTML) &&
    /second/.test(a.els['bb-errors'].innerHTML));

  // A badge is how a fault gets noticed without going looking for it.
  const b = app();
  t('nothing unread to begin with', b.sb.bbErrorsUnseen() === 0);
  b.handlers.error({ message: 'new one', filename: 'a.js', lineno: 1, error: {} });
  t('an unread fault shows a count', b.sb.bbErrorsUnseen() === 1);
  t('and the badge renders', /1<\/span>/.test(b.sb.bbErrorsBadgeHtml()));
  b.sb.renderErrorsPanel();
  t('reading the list clears it', b.sb.bbErrorsUnseen() === 0);
  t('and the badge goes', b.sb.bbErrorsBadgeHtml() === '');
}

console.log('\nclearing');
{
  const a = app();
  a.handlers.error({ message: 'gone soon', filename: 'a.js', lineno: 1, error: {} });
  const no = app({ confirm: false, store: { bb_errors: JSON.stringify([{ at: 1, message: 'keep' }]) } });
  no.sb.bbErrorsClear();
  t('declining keeps them', no.sb.bbErrors().length === 1);

  a.sb.bbErrorsClear();
  t('confirming empties the list', a.sb.bbErrors().length === 0);
  t('and removes the stored copy', !a.store.bb_errors);
}

console.log('\nan empty list says so, rather than looking broken');
{
  const a = app();
  a.sb.renderErrorsPanel();
  t('it explains itself', /Nothing has gone wrong/.test(a.els['bb-errors'].innerHTML));
  t('and says it needs no switching on', /nothing to switch on/.test(a.els['bb-errors'].innerHTML));
}

console.log(fail.length ? '\n' + fail.length + ' FAILED' : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
