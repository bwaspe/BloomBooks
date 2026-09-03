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
    // Two of the three delivery-morning mails. "Completed" is deliberately
    // NOT here -- see "Completed is evidence" below.
    skipSubjects: ['we are on our way', 'you are next'] },
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

**"Completed" is evidence, and I was wrong to throw it away.**

Perri sometimes place an order that never triggers an acknowledgment email at
all. On 7 August two of them went missing: $159.52 of paperwork captured
against a $244.97 card charge, with $85.45 simply absent. Nothing in the
scanner can conjure an email that was never sent — but the delivery-morning
mails still arrive, and **"Completed" is the only independent record that a
Perri delivery happened on a given day.**

Filtering it away removes the one signal that would catch a missing order on
the day, rather than weeks later against a bank statement. So it is not in
skipSubjects. Instead it is recorded, without a Claude call, as a delivery
marker:

```js
// A delivery happened. No line items, nothing to parse, and no API call --
// just the fact and the date, which is what makes a missing order findable.
const DELIVERY_MARKERS = { 'perri farms': ['completed'] };

function recordDelivery(vendorName, msg) {
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  const ss = SpreadsheetApp.openById(sheetId);
  let sheet = ss.getSheetByName('Deliveries');
  if (!sheet) {
    sheet = ss.insertSheet('Deliveries');
    sheet.appendRow(['Timestamp', 'Vendor', 'MessageId', 'DeliveryDate', 'Subject']);
  }
  const tz = Session.getScriptTimeZone();
  sheet.appendRow([new Date(), vendorName, msg.getId(),
                   Utilities.formatDate(msg.getDate(), tz, 'yyyy-MM-dd'), msg.getSubject()]);
}
```

called in the message loop before anything else:

```js
      const markers = DELIVERY_MARKERS[String(vendor.name).toLowerCase()] || [];
      if (markers.indexOf(String(msg.getSubject() || '').trim().toLowerCase()) !== -1) {
        recordDelivery(vendor.name, msg);
        recordSkip(vendor.name, msg, 'Delivery marker — recorded, not parsed');
        return;
      }
```

Still no Claude call, so the saving stands. What it buys is the question worth
asking: **Perri delivered on 12 August and no invoice was captured for that
day.** BloomBooks already reads this sheet; a Deliveries tab is one more read
and the comparison is a date join.

The exact-match rule still matters for the two that ARE skipped: "you are
next" as a substring would swallow "Your order is next in line", and the cost
of a wrong match is an invoice nobody ever reads.

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

---

# The acknowledgment is not the invoice

Nothing adds a delivery charge automatically. `PARSE_PROMPT` asks Claude to
transcribe every line from the charges section into `other_charges`, and
`callClaude` sums those into `delivery_fee`. If the document does not state a
charge, none is recorded — which is right, because inventing a cost that is
not on the paper is how books stop being trustworthy.

The trouble is which document is being read — but the unit is the **delivery
day, not the document**. Several orders placed for one day's delivery carry
one charge between them and produce one acknowledgment each, so counting fees
per document says nothing. Per day, across 29 Perri delivery days:

```
                                 days   carry a fee
  gmail acknowledgments only       12       3   (25%)
  at least one uploaded invoice    17      15   (88%)
```

Only one day in 29 carries two fees, which confirms the rule: **one charge
per delivery.** The scanned mail is an **order acknowledgment** — "A. Perri
Farms, Inc. Order #594619-0", sent when the order is placed. The uploaded
document is the **invoice**, and that is where the $16.50 appears. An
acknowledgment says what was ordered; an invoice says what is being billed,
and freight only exists on the second.

**11 delivery days carry no charge at all — roughly $180.** Not the $820 the
raw payment gap suggests; most of that is payment timing. Small money, but it
accrues on every delivery day where no invoice is uploaded alongside.

Two oddities in the same data, both worth a look rather than a fix here:
**$0.05 on 2 September**, which is a misread rather than a charge, and
**$49.00 alongside $16.50 on 10 May**, which is Mother's Day and plausibly a
real second delivery.

**Do not have the script fill this in.** A default charge written onto a
document that does not state one is a guess recorded as a fact, and it would
be wrong on the deliveries that genuinely carry none. Two honest options:

1. **Scan the invoice as well.** If Perri emails one — from any address, even
   a different one — add it to VENDORS. The MessageId dedupe means an
   acknowledgment and its invoice both landing is harmless; BloomBooks would
   show two records for one order, which is a reason to prefer replacing the
   acknowledgment rather than adding to it.
2. **Flag it in BloomBooks rather than invent it — per DELIVERY DAY.** The
   app already knows $16.50 is Perri's habit, because 16 uploaded invoices
   say so. A delivery day from a supplier with a habitual charge, where no
   document that day carries one, is worth a line: the same flag-don't-write
   pattern as recipe pricing and stale margins. Per day is the crux — flagged
   per document it would fire on three of the four acknowledgments for a
   single delivery and be wrong every time.

The Gmail scan is the fewest steps and should stay the default, so option 1
is only better if Perri emails an invoice at all. If they do not — if it is
only ever pulled from the portal, photographed or scanned — then option 2 is
the whole answer, because it turns "did I remember to upload the invoice for
that day" into something the app asks rather than something to remember.

---

# Scanning a folder of invoices

Yes, and almost all of it already exists. The script has a daily trigger, a
PDF parser (`callClaudePdfBlob`, with an OCR fallback for scans with no text
layer), a sheet to append to, and BloomBooks already reads that sheet. What is
missing is one more source.

**A Google Drive folder, not a local one.** BloomBooks runs in a browser on
GitHub Pages and cannot watch a folder on the office machine — the File System
Access API needs a click every session and cannot run unattended, which is the
opposite of what is wanted. The Apps Script already runs daily on Google's
side, so pointing it at a Drive folder costs nothing new.

```js
// One folder per source is deliberate: a scanner that saves everything into
// one place gives no vendor, and guessing the supplier from a PDF is how a
// Fall River invoice ends up filed under Perri.
const INVOICE_FOLDERS = [
  { name: 'Perri Farms', folderId: '<the Drive folder id>' },
];
```

```js
function scanInvoiceFolders() {
  INVOICE_FOLDERS.forEach(src => {
    let folder;
    try { folder = DriveApp.getFolderById(src.folderId); }
    catch (e) { logError(src.name, '', 'Cannot open folder: ' + e.message); return; }

    // A "Processed" subfolder is the read marker. Moving the file is more
    // robust than remembering ids: what has been done is visible in Drive
    // itself, and a file dropped in twice is done twice on purpose rather
    // than silently ignored.
    const done = folder.getFoldersByName('Processed').hasNext()
      ? folder.getFoldersByName('Processed').next()
      : folder.createFolder('Processed');

    const files = folder.getFilesByType(MimeType.PDF);
    let n = 0;
    while (files.hasNext() && n < 20) {          // a bounded run, like the mail scan
      const file = files.next();
      n++;
      try {
        const parsed = callClaudePdfBlob(file.getBlob(), file.getName());
        if (parsed && parsed.items && parsed.items.length) {
          appendFolderInvoice(parsed, src.name, file);
          file.moveTo(done);
        } else {
          logError(src.name, file.getId(), 'No items extracted from ' + file.getName());
          // NOT moved: a failure stays where it is so the next run tries again.
        }
      } catch (err) {
        logError(src.name, file.getId(), err.message);
      }
    }
  });
}
```

```js
// The same row shape the mail scan writes, so BloomBooks needs no change at
// all: it dedupes on whatever is in MessageId, and a Drive file id is as good
// an identity as a Gmail one.
function appendFolderInvoice(parsed, vendorName, file) {
  appendToSheet(parsed, { name: vendorName }, {
    getId:   () => 'drive-' + file.getId(),
    getDate: () => file.getDateCreated(),
    getSubject: () => file.getName()
  });
}
```

and one line added to the daily run:

```js
function scanInvoices() {
  VENDORS.forEach(vendor => { ... });
  try { scanInvoiceFolders(); }
  catch (err) { logError('folders', '', err.message); }
}
```

## Getting the scans into that folder

The one manual link, and there are three ways depending on the hardware:

1. **Google Drive for Desktop** on the office machine. The scanner saves to a
   local folder that syncs to Drive. Closest to "it just happens".
2. **Scan to email**, to an address the script already watches. If the scanner
   can email a PDF, it needs no folder at all — add that address to VENDORS
   with `mode: 'pdf'` and it goes through the existing path.
3. **The Drive app on a phone**, for a photograph. Same folder, same result.

## Two things to know

**A folder invoice reads as scan-sourced in BloomBooks.** Its id becomes
`inv-gmail-drive-<fileId>`, because that prefix is how the app tells a scanned
invoice from an uploaded one. Nothing breaks; the "via Gmail scan" wording in
any analysis just covers both. Worth renaming the prefix if that distinction
ever matters.

**It does not replace the acknowledgment scan, it backs it up.** Both may land
for the same order — one from the email, one from the paper — and they will
NOT dedupe against each other, because their ids differ. Two records for one
order is worse than one. Either scan the invoices INSTEAD of the
acknowledgments for that vendor (drop them from VENDORS), or accept that the
folder is only for the ones that never arrived by email.

The second is fiddly to get right by hand. The first is cleaner and matches
what the money says: the invoice is the document that is actually billed, and
it carries the delivery charge the acknowledgment leaves off.

---

# Scan to email, and what happens to Perri

## Do NOT drop Perri from VENDORS

The instinct is right — their acknowledgment is superseded by the scanned
invoice, and keeping both would put two records against one order. But
removing the vendor entirely also removes the **delivery markers**, and those
are the whole safety net: they are what says a delivery happened on a day no
invoice was captured. Without them, a scan you forget to do disappears in
exactly the way 7 August did.

So Perri stays, and stops being parsed:

```js
  { name: 'Perri Farms', email: 'sales@perrifarms.com', mode: 'body',
    // The invoice is scanned now, so the ORDER acknowledgment is skipped --
    // parsing both would file two records against one order, and the invoice
    // is the one that carries the $16.50 delivery charge.
    skipSubjects: ['we are on our way', 'you are next',
                   'a. perri farms, inc. order*'] },
```

`Completed` stays out of that list, so it still lands in Deliveries. What the
pair then gives you is better than today: **Perri delivered on the 12th, and
nothing was captured for the 12th** — which catches a forgotten scan on the
day, not five weeks later against a card charge.

## The scanned invoices arrive as their own source

Match on a LABEL, not a sender. A scanner that emails from a device address
would work with `from:`, but one that goes through your own account — a phone
forward, or scan-to-self — has your address in `from:`, and
`from:(wecare@tuckahoeflorist.com)` matches every message you have ever sent.

```js
// A label, so it does not matter what address the scan arrives from. Set one
// Gmail filter -- has attachment, subject contains whatever the scanner puts
// there -- to apply it, or apply it by hand on a phone in two taps.
const VENDORS = [
  ...,
  { name: 'Perri Farms', label: 'BloomBooks/Scanned/Perri', mode: 'pdf' },
];
```

and the query builder learns one branch:

```js
  const source = vendor.label
    ? 'label:"' + vendor.label + '"'
    : 'from:(' + vendor.email + ')';
  const query = `${source} ${skip} ${sinceQuery}`;
```

The name on the VENDORS entry is what lands in the sheet's Vendor column, so
it must stay `Perri Farms` — that is what ctSameVendor matches against the
bank's `A. Perri Farms`, and getting it wrong breaks the payment reconciliation
rather than the scan.

## The trap: a flatbed scan has no text layer

This one will bite on the first attempt if it is not fixed first.

`extractInvoice` sends mail attachments to `callClaudePdf`. The manual-upload
path uses `callClaudePdfBlob`, which is the same call **plus a fallback**: when
a PDF returns no items it re-sends it as an image, because a PDF with no text
layer has nothing for a document parse to read.

A vendor's emailed invoice is generated from their system and has a text
layer. **A flatbed scan does not.** Sent to `callClaudePdf` it returns
`{items:[]}`, gets logged as "No items extracted", and — before the retry
change above — is never looked at again.

```js
function extractInvoice(msg, vendor) {
  const sent = msg.getDate();
  if (vendor.mode === 'pdf') {
    const pdf = findPdfAttachment(msg);
    // callClaudePdfBlob, not callClaudePdf: it falls back to an image when the
    // PDF has no text layer, which is every flatbed scan.
    if (pdf) return callClaudePdfBlob(pdf.copyBlob(), vendor.name, sent);
    return callClaudeBody(msg.getPlainBody(), vendor.name, sent);
  }
  ...
}
```

Worth doing for every `mode: 'pdf'` vendor, not just the scans — it can only
help, and `callClaudePdf` then has no callers left.

Note `pdfToImageBase64` writes a temp file to Drive and trashes it. That is
already how manual uploads work, so it is proven, but it means the script
needs Drive permission — it will ask to re-authorise the first time the folder
or the OCR path runs under the new code.

## What to check on the first one

Scan one Perri invoice, run `testSingleVendor` with the index pointing at the
new entry, and look at the row it writes:

- **Total** matches the paper to the cent
- **DeliveryFee** is $16.50, not 0 — the whole reason for scanning invoices
- **Date** is the invoice date, not today
- **ItemsJSON** has every line, including the cheap ones

If DeliveryFee is 0 on an invoice that shows a delivery charge, the parse read
the totals block wrong and that is worth fixing before scanning fifty of them.
