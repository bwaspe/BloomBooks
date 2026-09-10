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
