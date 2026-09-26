# Tests

## What these are

Each file here is a small program that runs Bloom Books' own calculations
against known numbers and checks the answers. Nothing to install, nothing to
learn — one command:

```
node tests/run.js
```

Every line is a claim about how the app should behave, and it either holds or
it doesn't:

```
  PASS  a draw is not an expense              [$480 expenses (rent + interest only)]
  PASS  a contribution is not revenue         [$9000 revenue, $5000 put in]
  PASS  which is what the bank actually did   [$6597.61 vs $6597.61]
```

## What they are for

Not for finding bugs in code being written — that's what reading it is for.
They catch the change that breaks something **nobody was looking at.**

A real example. The month card used to say "the bank rose $302.63" on a June
the account actually ended $5,329 down, because the figure was inferred from
net income rather than read off the rows. Fixing it meant renaming a field.
The suite failed within the second, naming the assertion that no longer held —
before the wrong number could reach a screen.

That is the whole job: they are how a change to the sales-tax page is stopped
from quietly moving a figure on the ledger.

## Where the data comes from

**This repo is public.** The suites check against a real Bloom Books backup and
against real Venmo statements, and those are the shop's financial records, so
they are never copied in here. `fixtures.js` finds them at run time in
`Downloads`, or wherever `BLOOMBOOKS_FIXTURES` points:

```
BLOOMBOOKS_FIXTURES=D:\books node tests/run.js
```

A suite whose backup is missing **skips and says which file it wanted**. It
does not fail — the file being on another computer is not a bug in the app:

```
  skip  venmo   needs bloom-books-backup-2026-09-08-1904.json
  1 passed, 0 failed, 16 skipped
```

Each suite names the **exact** backup it was written against, on purpose.
Several assert real figures off it — "July matches the day book to the cent"
means nothing against a different day's book, and quietly substituting the
newest backup would turn a passing suite into a liar.

`.gitignore` blocks every backup and statement pattern as a second line of
defence, in case one is ever copied in by accident.

## Running some of them

```
node tests/run.js venmo tax     only suites whose name contains venmo or tax
```

The exit code is the number of failures, so it can gate a deploy.

## A note on where these lived before

Until 10 Sep 2026 these sat in a session temp folder outside the repo. It was
cleared between sessions and **18 of 35 suites were lost** — the cost-tracker
ones mostly: pack counts, counting review, stuck families, margin units,
per-stem retail. That is why they are version-controlled now.

## Before a deploy: the smoke check

`node tests/run.js` runs the source files in Node. It cannot see a script tag
pointing at a renamed file, a cache marker bumped on nineteen lines out of
twenty, or a renderer that throws the moment it meets a real DOM. Those reach
the shop as a blank screen.

`test_build` covers the first kind without a browser — every referenced file
exists, every file on disk is loaded, every reference carries the same cache
marker, everything parses, and the load order still holds.

The rest needs the page actually running, **on a local server rather than the
live site**:

```
python -m http.server 8787 --bind 127.0.0.1
```

Then open `http://localhost:8787/index.html`. That is a different origin from
`bwaspe.github.io`, so it has **its own localStorage and cannot touch the real
book or cost tracker** — and the Google sign-in is not authorised for it, so it
cannot reach the sheets either. Everything checked there is made-up by
construction.

Two things to run in the console. Both rely on the error collector in
index.html: before it existed a throw inside a renderer vanished and the panel
simply came up empty.

**Every screen, on an empty browser.** Nothing should throw.

```js
localStorage.clear(); BB_ERRORS.length = 0;
[...document.querySelectorAll('.panel')].forEach(p => switchPanel(p.id.replace(/^panel-/, '')));
BB_ERRORS.map(e => e.kind + ': ' + e.message);      // expect []
```

**A second device** — the book, but no cost tracker data. This is the case that
shipped broken on 26 Sep 2026: the address of the scanner's sheet lived only in
`ctData`, which is exactly what a phone does not have, so it could not find the
settings and reported the cost tracker as never set up.

```js
localStorage.clear(); BB_ERRORS.length = 0;
appData.gmailSheetId = 'MADEUP-SCANNER-ID';
ctData = { invoices: [], catalog: {}, retail: {}, markup: {} };
bbSettings.costTracker = { writer: 'other', writerName: 'Office', savedAt: Date.now(), invoices: 230 };
({ findsSheet: bbSettingsSheetId(), readsOnly: ctSyncReadOnly(),
   sharesNothingBack: bbShareScannerSheetId() === false, saveRefused: ctSave() === false });
```

Then clear the storage again before leaving, so the next visit starts clean.

`.claude/launch.json` holds the same server under the name `bloombooks`, for
tooling that reads it.
