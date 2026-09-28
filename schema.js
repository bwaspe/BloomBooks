// ============================================================
// WHICH VERSION WROTE THIS
// ============================================================
// The settings have carried a schemaVersion and a migration chain since they
// were built. The two much bigger stores -- the book and the cost tracker --
// carried nothing. They are merged with defaults ad hoc on load, and there is
// no record of which version of the app wrote what is there.
//
// That costs nothing until the first shape change, and then it costs a lot in
// two directions:
//
//   FORWARD. A stored book written before a field existed has to be brought up
//   to date, once, in a step that is written and then never edited again. A
//   migration that gets rewritten stops being able to read what it already
//   wrote.
//
//   BACKWARD, which is the one nobody plans for. The office machine updates
//   and writes the new shape to the sheet. A phone with the page still open,
//   or serving a cached copy through the service worker, reads it with the OLD
//   app -- which does not know the new field, silently drops it, and writes
//   the result back. The newer data is gone and nothing said a word.
//
// So a store that is NEWER than this app is refused: it is shown, because
// showing it is harmless and hiding it would look like data loss, but nothing
// may be written over it until the app catches up.
// THE VERSION IS THE NUMBER OF STEPS, not a separate number beside them. Two
// things that have to agree are better as one thing: declaring v2 and
// forgetting to write the step, or writing the step and forgetting to bump,
// are both mistakes that cannot be made this way.

// One step per version bump. BOOK_MIGRATIONS[0] takes v0 to v1, [1] takes v1
// to v2, and so on. Everything written before this existed is v1 by
// definition -- it is the shape the app reads today -- so the first step only
// stamps it.
//
// NEVER EDIT A SHIPPED STEP. Add a new one.
const BOOK_MIGRATIONS = [
  function v0_to_v1(d) { return d; }
];
const CT_MIGRATIONS = [
  function v0_to_v1(d) { return d; }
];

// { what, saw, understand } while a store from a newer app is loaded.
let schemaBlock = null;

function schemaStepsFor(kind) { return kind === 'book' ? BOOK_MIGRATIONS : CT_MIGRATIONS; }
function schemaTargetFor(kind) { return schemaStepsFor(kind).length; }

// Returns the data, migrated where it can be. Sets schemaBlock when it cannot.
function schemaMigrate(d, kind) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return d;
  const target = schemaTargetFor(kind);
  const from = Number(d.schemaVersion) || 0;

  if (from > target) {
    schemaBlock = { what: kind === 'book' ? 'book' : 'cost tracker', saw: from, understand: target };
    if (typeof renderSchemaWarning === 'function') renderSchemaWarning();
    return d;   // shown, never written over
  }

  const steps = schemaStepsFor(kind);
  let reached = from;
  for (let v = from; v < target; v++) {
    const step = steps[v];
    if (typeof step !== 'function') { reached = v + 1; continue; }
    try {
      d = step(d) || d;
      reached = v + 1;
    } catch (e) {
      // Stop rather than run the later steps against data that was never
      // brought up to meet them. Half-migrated is the one state nothing
      // downstream is written for.
      if (typeof bbNoteError === 'function') {
        bbNoteError('error', 'Migration ' + kind + ' v' + v + ' failed: ' + (e && e.message), 'schema.js', '');
      }
      break;
    }
  }

  // NOT STAMPED AS DONE WHEN IT IS NOT. Stamping the target after a failed
  // step would make the next load skip the migration entirely and the data
  // would stay half-moved for ever, silently. It keeps the version it actually
  // reached, and writing is blocked -- because writing is what would make a
  // broken state permanent.
  d.schemaVersion = reached;
  if (reached < target) {
    schemaBlock = { what: kind === 'book' ? 'book' : 'cost tracker', saw: reached, understand: target,
                    stuck: true };
    if (typeof renderSchemaWarning === 'function') renderSchemaWarning();
    return d;
  }
  if (schemaBlock && schemaBlock.what === (kind === 'book' ? 'book' : 'cost tracker')) {
    schemaBlock = null;
    if (typeof renderSchemaWarning === 'function') renderSchemaWarning();
  }
  return d;
}

// Asked before any write, by both stores.
function schemaBlocked() { return !!schemaBlock; }

function schemaWarningHtml() {
  if (!schemaBlock) return '';
  const box = body => `
    <div style="margin:0 0 16px;padding:12px 14px;border-radius:8px;background:#fdecea;
                border:1px solid var(--red);font-size:0.82rem;line-height:1.5">${body}</div>`;

  if (schemaBlock.stuck) {
    return box(
      `<strong style="color:var(--red)">This ${escHtml(schemaBlock.what)} could not be brought up to date.</strong><br>
       It reached version ${schemaBlock.saw} of ${schemaBlock.understand} and a step failed —
       see <strong>Settings › Problems</strong> for what went wrong. Nothing is being saved,
       because saving is what would make a half-finished change permanent. You can still
       look at everything, and <strong>Export JSON</strong> still works.`);
  }
  return box(
    `<strong style="color:var(--red)">This ${escHtml(schemaBlock.what)} was saved by a newer version of BloomBooks.</strong><br>
     It was written as version ${schemaBlock.saw} and this copy of the app understands
     version ${schemaBlock.understand}. Nothing is being saved, deliberately — an older
     app would drop whatever it does not recognise and write the rest back over it.
     You can still look at everything.
     <button class="btn btn-outline btn-sm" style="margin-left:8px" onclick="schemaReload()">Update this device</button>`);
}

function renderSchemaWarning() {
  const el = document.getElementById('bb-schema-warning');
  if (el) el.innerHTML = schemaWarningHtml();
}

// A plain reload may be served the same cached files by the service worker,
// which is exactly how a device ends up running an old app against new data.
// So the cache goes first.
function schemaReload() {
  const go = () => location.reload();
  try {
    if (!('caches' in window)) return go();
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => {
        if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
          return navigator.serviceWorker.getRegistrations()
            .then(rs => Promise.all(rs.map(r => r.unregister())));
        }
      })
      .then(go, go);
  } catch (e) { go(); }
}
