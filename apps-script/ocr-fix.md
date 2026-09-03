# The OCR fix

A vendor's emailed invoice is generated from their system and has a text
layer. **A flatbed scan does not** — it is a picture of a page. Sent to a
document parse it comes back `{"items":[]}`, is logged as "No items
extracted", and under the current design is never looked at again.

The fallback already exists. `callClaudePdfBlob` re-sends a PDF as an IMAGE
when the document parse returns nothing, which is how manual uploads have
always worked. Mail attachments just do not use it: `extractInvoice` calls
`callClaudePdf`, which has no fallback.

So `callClaudePdf` goes away and every caller uses the one that retries.

**This also corrects my own earlier snippet**, which called
`callClaudePdfBlob(pdf.copyBlob(), vendor.name, sent)` — a third argument the
function does not take. It needs one, so that the date context from the
invoice-date fix reaches the PDF path too. Both changes are below, together,
because applying one without the other leaves a call that silently ignores its
date.

---

## Replace the whole CLAUDE CALLS block

From `function callClaudePdfBlob` down to the end of `callClaudeBody`.
`callClaudePdf` is deleted; nothing calls it afterwards.

```js
function callClaudePdfBlob(blob, label, msgDate) {
  const base64 = Utilities.base64Encode(blob.getBytes());

  // First attempt: as a document, which is right for a text-layer PDF.
  const result = callClaude({
    model: CLAUDE_MODEL,
    max_tokens: 2500,
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
        { type: 'text', text: PARSE_PROMPT + `\n\n(File: ${label})` + dateContext(msgDate) }
      ]
    }]
  });

  // No items means the PDF probably has no text layer -- a flatbed scan, or a
  // download from a vendor portal. Re-send it as an image.
  if (!result.items || result.items.length === 0) {
    Logger.log('PDF parse returned no items for ' + label + ' — retrying via image OCR');
    const imageBase64 = pdfToImageBase64(blob);
    if (imageBase64) {
      return callClaudeImageBase64(imageBase64, 'image/png', label + ' (OCR)', msgDate);
    }
  }

  return result;
}

function callClaudeImageBase64(base64, mediaType, label, msgDate) {
  return callClaude({
    model: CLAUDE_MODEL,
    max_tokens: 2500,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: PARSE_PROMPT + `\n\n(File: ${label})` + dateContext(msgDate) }
      ]
    }]
  });
}

function callClaudeBody(bodyText, vendorName, msgDate) {
  const trimmed = (bodyText || '').slice(0, 12000);   // keep the prompt reasonable
  return callClaude({
    model: CLAUDE_MODEL,
    max_tokens: 2500,
    messages: [{
      role: 'user',
      content: PARSE_PROMPT + `\n\n(Sender/vendor context: ${vendorName})` +
               dateContext(msgDate) + `\n\nEmail body:\n${trimmed}`
    }]
  });
}
```

## And extractInvoice, which is where the wrong one was called

```js
function extractInvoice(msg, vendor) {
  const sent = msg.getDate();

  if (vendor.mode === 'pdf') {
    const pdf = findPdfAttachment(msg);
    // copyBlob, not the attachment itself: pdfToImageBase64 renames it and
    // writes it to Drive, and a GmailAttachment is not a blob you can rename.
    if (pdf) return callClaudePdfBlob(pdf.copyBlob(), vendor.name, sent);
    return callClaudeBody(msg.getPlainBody(), vendor.name, sent);
  }

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
  if (pdf) return callClaudePdfBlob(pdf.copyBlob(), vendor.name, sent);
  return null;
}
```

## doPost needs nothing

It already calls `callClaudePdfBlob(blob, filename)` and
`callClaudeImageBase64(base64, mediaType, filename)`. With no third argument
`msgDate` is undefined and `dateContext` falls back to today's date, which is
correct for a file uploaded by hand right now.

---

## Two things to know before scanning fifty

**Drive permission.** `pdfToImageBase64` writes a temporary file to Drive and
trashes it. Manual uploads already do this, so it works — but the mail path
never has, so the script will ask to re-authorise the first time a scanned
attachment goes through. Approve it as **wecare@**, not a personal account.

**Only the first page is OCR'd.** The comment on `pdfToImageBase64` says so:
Drive's export renders page one. A single-page invoice is fine. A two-page
Perri order would silently lose its second page — the parse would succeed and
the total would be wrong, which is worse than failing outright.

If any of their invoices run to two pages, the first one you scan will show
it: **the total will not match the paper**. That is the check to do, and it is
the same check that catches a bad delivery-fee parse.
