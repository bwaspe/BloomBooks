// Some rows in the price history could not be clicked at all.
//
// The name goes into a JS string, inside an HTML attribute -- two layers, and
// only apostrophes were being escaped. Seventy-five item names carry inch
// marks, `Vase Cylinder Clear Glass 8"x4"H` among them, and a bare double quote
// closes the onclick attribute early. The browser then sees malformed markup
// and the handler is simply not there; nothing errors, the row just does
// nothing when pressed.
//
// ctJsArg does both layers in the right order: backslash, then apostrophe, then
// HTML. Order matters -- escape the HTML first and the backslash you add
// afterwards lands inside an entity.
const F = require('./fixtures');
const vm = require('vm');

const BK = 'bloom-books-backup-2026-09-08-1904.json';
const raw = F.file(BK);
if (!raw) F.skip('needs ' + BK + ' — put it in Downloads or set BLOOMBOOKS_FIXTURES');
const j = JSON.parse(raw);

const sb = F.sandbox({ appData: j.appData });
sb.localStorage.store.bb_ctdata = JSON.stringify(j.ctData);
let out = null;
sb.__OUT__ = o => { out = o; };

vm.runInNewContext(F.src(['config.js', 'utils.js', 'cost-tracker.js']) + `
;(function(){
  ctLoad();

  var cases = {
    inchMark:   ctJsArg('Vase Cylinder Clear Glass 8"x4"H'),
    apostrophe: ctJsArg("Mother's Day Special"),
    backslash:  ctJsArg('Ribbon 5\\\\8 Satin'),
    ampersand:  ctJsArg('Salt & Pepper Eucalyptus'),
    angle:      ctJsArg('Vase <6in> Clear'),
    empty:      ctJsArg(''),
    nully:      ctJsArg(null)
  };

  // Every real name in the book, through the attribute it actually lands in.
  var names = {};
  ctData.invoices.forEach(function (inv) { (inv.items || []).forEach(function (it) {
    if (it.name) names[it.name] = true; }); });
  var all = Object.keys(names);

  var unsafe = [], withInch = 0;
  all.forEach(function (n) {
    if (/"/.test(n)) withInch++;
    var attr = ctJsArg(n);
    // A raw quote would end the attribute; a raw < would end the tag.
    if (/["<>]/.test(attr)) unsafe.push(n);
  });

  // And the button really does carry the whole id.
  var btn = ctOpenLineBtn('inv-8"x4"-01', 'open it');

  // The onclick value is whatever sits between the first pair of quotes. If a
  // raw quote in the id had closed it early, the captured value stops short --
  // which is precisely how the handler went missing without any error.
  var m = btn.match(/onclick="([^"]*)"/);
  __OUT__({ cases: cases, total: all.length, withInch: withInch, unsafe: unsafe,
            btn: btn, onclick: m ? m[1] : null });
})();`, sb, { filename: 'ct.js' });

const fail = [];
const t = (l, c, d) => { if (!c) fail.push(l); console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l + (d !== undefined ? '  [' + d + ']' : '')); };
const o = out, c = o.cases;

console.log('the character that broke it');
t('an inch mark cannot close the attribute early',
  c.inchMark === 'Vase Cylinder Clear Glass 8&quot;x4&quot;H', c.inchMark);
t('an apostrophe cannot close the JS string',
  c.apostrophe === "Mother\\'s Day Special", c.apostrophe);
t('a backslash is doubled, so it escapes itself rather than the next character',
  c.backslash === 'Ribbon 5\\\\8 Satin', c.backslash);

console.log('\nand the rest of what HTML cares about');
t('an ampersand becomes an entity', c.ampersand === 'Salt &amp; Pepper Eucalyptus', c.ampersand);
t('angle brackets cannot end the tag',
  c.angle === 'Vase &lt;6in&gt; Clear', c.angle);
t('nothing in, nothing out', c.empty === '' && c.nully === '');

console.log('\nevery name in the book, through the attribute it lands in');
t(o.total + ' distinct names, ' + o.withInch + ' of them carrying an inch mark',
  o.withInch > 0, o.withInch + ' would have been unclickable');
t('not one produces a character that would break the markup',
  o.unsafe.length === 0, o.unsafe.slice(0, 3).join('; ') || 'none');

console.log('\nand the open button survives an id with quotes in it');
t('the attribute is not cut short by the quote in the id',
  !!o.onclick && /\)$/.test(o.onclick.trim()), o.onclick);
t('and the whole id survives inside it',
  !!o.onclick && o.onclick.indexOf('inv-8&quot;x4&quot;-01') >= 0);

console.log(fail.length ? '\n' + fail.length + ' FAILURES:\n' + fail.join('\n') : '\nall assertions passed');
process.exit(fail.length ? 1 : 0);
