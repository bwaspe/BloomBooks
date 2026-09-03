# Gmail scanner: the Errors tab, and why a failure is never seen again

## First: what the 101 errors actually are

The Errors tab has been filling since 3 July and nothing has ever read it.

```
  96  No items extracted
   4  Unexpected token 'T', "This docum"... is not valid JSON
   1  Unexpected token 'T', "The email "... is not valid JSON

  55  Perri Farms        35  Main Wholesale        11  DVFlora
```

**The 96 are delivery-status mail, not lost invoices.** Perri sends three
emails on a delivery morning — on the way, nearby, completed — and every one
is scanned, sent to Claude, and correctly found to contain no line items.
The counts say exactly that: 55 Perri errors across 24 days, averaging 2.3,
with **nine days landing on exactly 3**. The single 7-error day is 3 July,
the first run, clearing a 30-day backlog.

The money agrees. Invoiced against paid, 1 July to 3 September:

```
                  invoiced      paid    difference
  Perri              $6,674    $7,516         $841
  Main Wholesale     $6,350    $6,108        -$242
  Juliet             $1,923    $2,697         $773
  Fisch              $2,054    $2,086          $32
  DVFlora            $1,468    $1,487          $19
```

Differences that size are payment timing. Nothing is missing.

**The 5 JSON failures are different.** The model returned prose beginning
"This docum..." and "The email ..." rather than JSON — it was looking at a
real document and explained itself instead of answering. Those five deserve
a retry, and under the current design they cannot get one.

So there are two separate things to fix: stop paying to scan mail that was
never going to be an invoice, and stop treating a genuine failure as a
settled answer.

---

## Change 1 — recognise the status mail without paying to read it

Roughly 700 Claude calls a year go into establishing that "You Are Next"
holds no line items. They also bury the failures that matter.

**Filter in CODE, not in the Gmail query.** A query exclusion is invisible by
definition: if a pattern is wrong, the invoice it swallows leaves no trace
anywhere. Matching after the fetch costs nothing extra — Gmail reads are
free, the Claude call is what costs — and every skip is written to the
Skipped tab **with its subject**, so a mistake shows up as an invoice sitting
in a list rather than as an invoice that never existed.

```js
const VENDORS = [
  { name: 'Juliet Wholesale',    email: 'julietwholesalenj@gmail.com', mode: 'pdf'  },
  { name: 'Perri Farms',         email: 'sales@perrifarms.com',        mode: 'body',
    // Three of these on every delivery morning. 55 errors across 24 days,
    // nine of those days landing on exactly 3.
    skipSubjects: ['we are on our way', 'you are next', 'completed'] },
  { name: 'DVFlora',             email: 'orders@dvflora.com',          mode: 'body',
    skipSubjects: ['deleted shopping cart notice*'] },
  { name: 'Fisch Floral Supply', email: 'info@fischfloralsupply.com',  mode: 'pdf'  },
  { name: 'Main Wholesale',      email: 'ANTHONY@mainwholesaleflorist.com', mode: 'pdf',
    // Safe BECAUSE their invoice subject is "MWF Invoice: 362662" -- it shares
    // no prefix with either of these. Checked against all 70 of theirs.
    skipSubjects: ['mwf receipt*', 'main wholesale florist*'] },
];
```

```js
// EXACT match by default; a trailing * makes it a prefix.
//
// Substring matching is the tempting default and it is wrong here. 'completed'
// as a substring also swallows "Your order has been completed" -- and the cost
// of a false match is an invoice that is never read, which is the one outcome
// this whole file is about. Exact is safe because these subjects are whole
// subjects; * is there for the two that carry a trailing account number.
function shouldSkipSubject(msg, vendor) {
  const subject = String(msg.getSubject() || '').trim().toLowerCase();
  const list = vendor.skipSubjects || [];
  for (let i = 0; i < list.length; i++) {
    const pat = String(list[i]).trim().toLowerCase();
    const hit = pat.slice(-1) === '*'
      ? subject.indexOf(pat.slice(0, -1)) === 0
      : subject === pat;
    if (hit) return list[i];
  }
  return null;
}
```

called first in the message loop, before anything is sent to Claude:

```js
      const why = shouldSkipSubject(msg, vendor);
      if (why) { recordSkip(vendor.name, msg, 'Subject matched "' + why + '"'); return; }
```

### Two of these need care

**Filtering Main Wholesale on their own name is safe here, but only because
it was checked.** The instinct is that a vendor's name in a skip pattern will
also match their invoices — it usually would. Theirs are titled
`MWF Invoice: 362662`, which shares no prefix with `Main Wholesale Florist`,
so the two lists cannot collide. That is a fact about this vendor, not a
general rule: read the invoice subject before filtering on anything that
looks like a vendor name.

If their promotional subjects turn out to vary more than the prefix covers,
Gmail's own classification needs no guessing at all:

```js
  const query = `from:(${vendor.email}) -category:promotions ${sinceQuery}`;
```

**"completed" is why the match is exact.** As a substring it also swallows
"Your order has been completed", and the cost of a wrong match is an invoice
nobody ever reads. Matching the whole subject removes that: a mail titled
exactly "Completed" is the status one, anything longer is not. Perri's 36
invoices in the window all came through while those status mails were
erroring, so nothing about their subjects collides today — and if Perri
invoices ever stop appearing, the Skipped tab is where they will be.

**"MWF Receipt" is a judgement call, not an obvious skip.** A receipt is a
financial document; the reason it is safe to ignore here is that the money is
already captured from the bank, and Main Wholesale's actual invoices arrive
separately — 47 of them in the window (70 in the book), against 35 receipt errors. If a
counter pickup ever arrives ONLY as a receipt, its line items would be lost
while its money still showed up. Worth knowing rather than acting on.

---

## Change 2 — a failure is not an answer

Three things combine so that any message the scanner mishandles is excluded
from every future run, permanently and silently.

```js
threads.forEach(thread => {
  messages.forEach(msg => {
    try { ...append... } catch (err) { logError(...); }   // failure recorded
  });
  if (!isTest) thread.addLabel(label);                     // labelled ANYWAY
});
props.setProperty('LAST_RUN_' + vendor.email, today);      // window moves ANYWAY
```

The next run then excludes the thread by label AND by date. Of the 101
errored messages, **5 later succeeded** — each on a day a hand run had been
used, which does not label — and **96 never came back**.

There is also a subtler trap in labelling the thread rather than the
message: Gmail labels are thread-level, so `thread.addLabel` cannot mean
"this message is done". A vendor replying into an already-labelled thread is
invisible for ever. It has not bitten yet because these vendors start a new
thread each time. It would bite silently the day one of them stopped.

Identity should come from what was actually written down.

```js
// What has already been captured, read from the sheet itself rather than
// inferred from a thread label -- the sheet is the record, and a label on a
// thread says nothing about the messages inside it.
function loadIdColumn(tabName, headerName) {
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const ss = SpreadsheetApp.openById(sheetId);
  const sheet = ss.getSheetByName(tabName);
  if (!sheet || sheet.getLastRow() < 2) return new Set();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const col = headers.indexOf(headerName) + 1;
  if (col < 1) return new Set();
  return new Set(sheet.getRange(2, col, sheet.getLastRow() - 1, 1)
    .getValues().map(r => String(r[0]).trim()).filter(Boolean));
}

// A message Claude READ and found no line items in -- an availability list, a
// statement, a status mail that slipped past the subject filter. Recorded so
// it is not re-sent every night, which is the only job the thread label was
// really doing.
function recordSkip(vendorName, msg, reason) {
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const ss = SpreadsheetApp.openById(sheetId);
  let sheet = ss.getSheetByName('Skipped');
  if (!sheet) {
    sheet = ss.insertSheet('Skipped');
    sheet.appendRow(['Timestamp', 'Vendor', 'MessageId', 'Subject', 'Reason']);
  }
  sheet.appendRow([new Date(), vendorName, msg.getId(), msg.getSubject(), reason]);
}

// How many times each message has thrown. A transient failure should be
// retried; an endless one should be set aside where it can be SEEN.
function attemptCounts() {
  const counts = {};
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const ss = SpreadsheetApp.openById(sheetId);
  const sheet = ss.getSheetByName('Errors');
  if (!sheet || sheet.getLastRow() < 2) return counts;
  sheet.getRange(2, 3, sheet.getLastRow() - 1, 1).getValues()
    .forEach(r => { const id = String(r[0]).trim(); if (id) counts[id] = (counts[id] || 0) + 1; });
  return counts;
}
```

Then the loop, with the two outcomes finally distinguished:

```js
  const captured = loadIdColumn(SHEET_TAB_NAME, 'MessageId');
  const skipped  = loadIdColumn('Skipped', 'MessageId');
  const failed   = attemptCounts();

  threads.forEach(thread => {
    thread.getMessages().forEach(msg => {
      const id = msg.getId();
      if (captured.has(id) || skipped.has(id)) return;

      if ((failed[id] || 0) >= 3) {
        recordSkip(vendor.name, msg, 'Gave up after 3 failed attempts');
        return;
      }

      try {
        const parsed = extractInvoice(msg, vendor);
        if (parsed && parsed.items && parsed.items.length > 0) {
          appendToSheet(parsed, vendor, msg);
          captured.add(id);
        } else {
          // Claude read it and found no line items. That is an ANSWER.
          recordSkip(vendor.name, msg, 'No items extracted');
        }
      } catch (err) {
        // A FAILURE. Deliberately not recorded in Skipped, so the next run
        // tries again -- an API error or a bad JSON response is transient.
        logError(vendor.name, id, err.message);
      }
    });
    if (!isTest) thread.addLabel(label);  // kept, for a human reading the mailbox
  });
```

and the query stops filtering on the label, because the sheet now decides:

```js
  const query = `from:(${vendor.email}) ${skip} ${sinceQuery}`;
```

---

## Change 3 — a window that overlaps, and a cap that speaks up

`LAST_RUN` is a DATE and the search is `after:` it, so the window is only as
fine as a day. Three duplicate rows in the feed (2 July then 3 July, 6 then
7, 9 then 10) show the previous day IS re-covered, so nothing is being lost
here today — but the margin is one day wide and rests on Gmail's boundary
behaviour. Three days of overlap costs nothing now that the sheet dedupes.

The cap is the sharper one. `GmailApp.search(query, 0, 25)` silently returns
the first 25 threads and `LAST_RUN` advances past the rest, which are then
outside the window for ever. Volume sits under 25 today. A trigger that fails
for a fortnight — an expired authorisation, an Anthropic outage, a quota —
puts it over, and the overflow disappears without a word.

```js
  const SEARCH_CAP = 100;
  const lookback = lastRun ? shiftDays(lastRun, -3) : null;
  const sinceQuery = lookback
    ? 'after:' + lookback
    : 'newer_than:' + FIRST_RUN_LOOKBACK_DAYS + 'd';

  const threads = GmailApp.search(query, 0, isTest ? 3 : SEARCH_CAP);

  // ... process ...

  // Only advance the window when the whole backlog was seen. Advancing past a
  // truncated search is how mail goes missing with nothing logged.
  if (threads.length >= SEARCH_CAP) {
    logError(vendor.name, '', 'Search hit the ' + SEARCH_CAP +
      '-thread cap — leaving LAST_RUN where it is so the rest are picked up next run');
  } else {
    const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy/MM/dd');
    props.setProperty('LAST_RUN_' + vendor.email, today);
  }
```

```js
function shiftDays(yyyySlashMmDd, days) {
  const [y, m, d] = yyyySlashMmDd.split('/').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);   // calendar days, DST-safe
  return Utilities.formatDate(dt, 'UTC', 'yyyy/MM/dd');
}
```

---

## Checked, and NOT broken

- **Same-day mail arriving after the 6am run is not lost.** I assumed it was.
  The three duplicate rows prove `after:<stored date>` still re-finds the
  previous day, so the window does cover it.
- **No shortfall between invoices captured and money paid.** Nothing is
  missing from the books because of any of this.

## Worth doing in BloomBooks, not here

The Gmail Scan panel already reports coverage — "the sheet holds N rows from
X to Y". It could report the Errors and Skipped tabs the same way, so a
vendor whose invoices stop parsing shows as a number that climbs rather than
as silence. That is the failure this whole write-up is really about: not
that anything went wrong, but that for two months nothing would have said so.
