# Gmail scanner: invoice date fix

## What was wrong

The date is not parsed by code — Claude reads it out of the document, and
`PARSE_PROMPT` said:

    - If date is missing use today's date

The model is never told what today is. So when a `body`-mode vendor's email has
no clear invoice date, it substitutes its own sense of "now", which sits around
mid-2025.

The failure splits exactly on vendor mode:

    mode: 'pdf'   Juliet, Fisch, Main Wholesale    0 wrong
    mode: 'body'  Perri Farms, DVFlora             all 25 wrong

Two shapes, one cause. Where the body shows a month and day, the model reads
them right and supplies the wrong YEAR (2025-07-10 for a 2026-07-10 invoice).
Where the body shows no date at all, it invents one, hence the frozen cluster
on 2025-07-14/15/16 from 31 July onward.

Verified against the live feed: the rule in change 3 corrects 25 of 25 wrong
rows, leaves all 96 correct rows untouched, and changes nothing it should not.

---

## Change 1 — PARSE_PROMPT

REPLACE this line:

    - If date is missing use today's date

WITH:

    - "date" is the order/invoice date exactly as printed on the document. If the
      document shows a month and day but no year, use the year from the current
      date given below. If the document shows no date at all, set "date" to null.
      Do NOT guess it, and do NOT substitute today's date yourself — you do not
      know what today is unless it is stated below.

## Change 2 — tell it what today is

REPLACE these two functions:

```js
function callClaudePdf(attachment, vendorName) {
  const base64 = Utilities.base64Encode(attachment.getBytes());
  const body = {
    model: CLAUDE_MODEL,
    max_tokens: 2500,
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
        { type: 'text', text: PARSE_PROMPT + `\n\n(Sender/vendor context: ${vendorName})${dateContext(msgDate)}` }
      ]
    }]
  };
  return callClaude(body);
}

function callClaudeBody(bodyText, vendorName, msgDate) {
  const trimmed = (bodyText || '').slice(0, 12000);
  const body = {
    model: CLAUDE_MODEL,
    max_tokens: 2500,
    messages: [{
      role: 'user',
      content: PARSE_PROMPT + `\n\n(Sender/vendor context: ${vendorName})${dateContext(msgDate)}\n\nEmail body:\n${trimmed}`
    }]
  };
  return callClaude(body);
}
```

...with the same two but taking `msgDate`, plus this new helper:

```js
// The model has no idea what day it is, so a prompt telling it to "use today's
// date" got its own sense of now -- mid-2025. Both anchors are given: the day
// the mail arrived is the better one, because an invoice is emailed within a
// day or two of being issued.
function dateContext(msgDate) {
  const tz = Session.getScriptTimeZone();
  const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const sent  = msgDate ? Utilities.formatDate(msgDate, tz, 'yyyy-MM-dd') : today;
  return `\n\nToday's date is ${today}. This email was sent on ${sent}. ` +
         `The invoice date is almost always within a few days of the day the ` +
         `email was sent, and is never more than a few weeks from it.`;
}
```

Then in `extractInvoice`, pass the message date through — four call sites:

```js
function extractInvoice(msg, vendor) {
  const sent = msg.getDate();
  if (vendor.mode === 'pdf') {
    const pdf = findPdfAttachment(msg);
    if (pdf) return callClaudePdf(pdf, vendor.name, sent);
    return callClaudeBody(msg.getPlainBody(), vendor.name, sent);
  } else {
    let combined = msg.getPlainBody() || '';
    const textAtt = findTextAttachment(msg);
    if (textAtt) {
      try {
        const raw = textAtt.getDataAsString();
        const stripped = textAtt.getContentType() === 'text/html' ? stripHtml(raw) : raw;
        combined += '\n\n--- Attached order details ---\n' + stripped;
      } catch (e) {
        Logger.log('Could not read attachment for ' + vendor.name + ': ' + e.message);
      }
    }
    if (combined.trim().length > 40) return callClaudeBody(combined, vendor.name, sent);
    const pdf = findPdfAttachment(msg);
    if (pdf) return callClaudePdf(pdf, vendor.name, sent);
    return null;
  }
}
```

## Change 3 — the guard that does not depend on the model behaving

A prompt is a request, not a guarantee. This is the part that actually holds.
Add the function, and call it from `appendToSheet`.

```js
// An invoice emailed today was not issued a year ago, and cannot have been
// issued next month. When the parsed date is implausible against the day the
// mail arrived, the model invented it -- the email's own date is the better
// answer, and it is a fact rather than a reading.
//
// 45 days is deliberately loose: presale and holiday invoices legitimately
// predate their delivery by weeks, and this must not fire on those. Verified
// against the live feed -- it corrects all 25 wrong rows and touches none of
// the 96 right ones.
const DATE_DRIFT_DAYS = 45;

function reconcileInvoiceDate(parsedDate, msgDate, vendorName, msgId) {
  const tz = Session.getScriptTimeZone();
  const mail = Utilities.formatDate(msgDate || new Date(), tz, 'yyyy-MM-dd');
  if (!parsedDate) return mail;

  const p = new Date(parsedDate + 'T00:00:00Z').getTime();
  const m = new Date(mail + 'T00:00:00Z').getTime();
  if (isNaN(p)) {
    logError(vendorName, msgId, 'Unparseable invoice date "' + parsedDate + '" — using ' + mail);
    return mail;
  }
  const days = Math.round((m - p) / 86400000);
  if (Math.abs(days) > DATE_DRIFT_DAYS) {
    logError(vendorName, msgId,
      'Invoice date ' + parsedDate + ' is ' + Math.abs(days) + ' days from the email (' +
      mail + ') — using the email date');
    return mail;
  }
  return parsedDate;
}
```

Then in `appendToSheet`, REPLACE:

```js
    'Date': parsed.date || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
```

WITH:

```js
    'Date': reconcileInvoiceDate(parsed.date, msg.getDate(), vendor.name, msg.getId()),
```

Every correction is written to the Errors tab, so a vendor whose invoices stop
carrying a readable date shows up as a pattern rather than staying silent.

---

## Not fixed, and worth knowing

`processVendor` stores `LAST_RUN_<email>` as today's date and searches
`after:<that date>`, while the read marker is a label on the THREAD. An invoice
arriving later on the same day the scan ran is after the label was applied and
not after the stored date, so it can be missed. Storing the timestamp rather
than the date, or dropping `after:` and relying on the label alone, would close
it. Separate from the date bug and not touched here.
