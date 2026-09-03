/**
 * BLOOMBOOKS GMAIL INVOICE SCANNER
 * ---------------------------------
 * Runs bound to wecare@tuckahoeflorist.com. Scans for new vendor emails,
 * extracts line items (via Claude), and appends them to a Google Sheet
 * that BloomBooks reads on load.
 *
 * ---------------------------------------------------------------------------
 * BEFORE YOU PASTE THIS OVER YOUR CURRENT FILE
 *
 * This is built from the version pasted into the session on 3 Sep 2026, with
 * every change from that day applied. One thing to check first: doPost calls
 * `saveSummary(body.summary)`, and that function was NOT in what was pasted --
 * so it lives somewhere in your file that I have not seen. Search your current
 * script for `function saveSummary` and for anything else missing here, and
 * paste those back in at the bottom before saving.
 *
 * WHAT CHANGED, and why (the detail is in the .md files beside this one):
 *
 *  1. INVOICE DATES. PARSE_PROMPT told Claude to "use today's date" if the
 *     date was missing. It is never told what today is, so it substituted its
 *     own sense of now -- mid-2025 -- and 25 rows came through dated a year
 *     out. It is now given the date, and reconcileInvoiceDate checks the parse
 *     against when the mail actually arrived before writing the row.
 *
 *  2. OCR. extractInvoice sent PDFs to callClaudePdf, which has no fallback.
 *     A flatbed scan has no text layer and returns nothing. callClaudePdf is
 *     gone; everything uses callClaudePdfBlob, which retries as an image.
 *
 *  3. RETRY. A thread was labelled whether or not anything was captured, and
 *     LAST_RUN advanced regardless, so a message that FAILED was excluded for
 *     ever -- 96 of 101 never came back. A message Claude read and found
 *     nothing in is now an ANSWER (Skipped tab); one that threw is a FAILURE
 *     (retried, given up after three attempts). Identity comes from the
 *     MessageId in the sheet, not a label on the thread.
 *
 *  4. NOISE. Perri's delivery-morning mails cost a Claude call each to
 *     establish they hold no line items -- about 700 a year. Matched by
 *     subject and skipped without an API call. "Completed" is deliberately
 *     NOT skipped: it is the only independent record that a delivery happened,
 *     and it goes to a Deliveries tab so a missing invoice is findable.
 *
 *  5. SOURCES. A vendor can now be matched by LABEL instead of sender, for
 *     scan-to-email; and INVOICE_FOLDERS scans a Drive folder, for
 *     scan-to-cloud. Both are inert until configured.
 * ---------------------------------------------------------------------------
 *
 * SETUP (one time):
 * 1. Go to sheets.google.com, create a new blank sheet, name it "BloomBooks Invoice Feed".
 *    Rename its first tab to "Invoices". Copy the Sheet ID from the URL
 *    (the long string between /d/ and /edit).
 * 2. In that Sheet: Extensions → Apps Script. Delete any starter code, paste this file in.
 * 3. In the Apps Script editor: Project Settings (gear icon) → Script Properties → Add:
 *      SHEET_ID           = <the sheet ID from step 1>
 *      ANTHROPIC_API_KEY  = <your Anthropic API key from console.anthropic.com>
 * 4. Run the `setupLabelAndTrigger` function once from the editor (Run button).
 *    It will ask you to authorize — approve it while logged in as wecare@.
 *    This creates the Gmail label and a daily 6am trigger.
 * 5. Optionally run `testSingleVendor` first to sanity-check one vendor before
 *    trusting the full daily run.
 *
 * NOTE: the first run after this update will ask to authorise again, for
 * Drive. The OCR fallback writes a temporary file and trashes it, and the mail
 * path has never needed that permission before. Approve it as wecare@.
 *
 * TO ADD A NEW VENDOR LATER: just add a line to the VENDORS array below and save.
 */

// ============================================================
// CONFIG — edit this list any time to add/remove vendors
// ============================================================
const VENDORS = [
  { name: 'Juliet Wholesale',      email: 'julietwholesalenj@gmail.com', mode: 'pdf'  },

  // Perri stays here even though their invoices are scanned now. Removing the
  // vendor would remove the delivery markers, and those are the safety net:
  // they are what says a delivery happened on a day no invoice was captured.
  // The ORDER acknowledgment is skipped, because parsing it as well as the
  // scanned invoice would file two records against one order -- and the
  // invoice is the one that carries the $16.50 delivery charge.
  { name: 'Perri Farms',           email: 'sales@perrifarms.com',        mode: 'body',
    skipSubjects: ['we are on our way', 'you are next',
                   'a. perri farms, inc. order*'] },

  { name: 'DVFlora',               email: 'orders@dvflora.com',          mode: 'body',
    skipSubjects: ['deleted shopping cart notice*'] },

  { name: 'Fisch Floral Supply',   email: 'info@fischfloralsupply.com',  mode: 'pdf'  },

  // Safe BECAUSE their invoice subject is "MWF Invoice: 362662", which shares
  // no prefix with either of these. Checked against all 70 of theirs. Read the
  // invoice subject before filtering on anything that looks like a vendor name.
  { name: 'Main Wholesale',        email: 'ANTHONY@mainwholesaleflorist.com', mode: 'pdf',
    skipSubjects: ['mwf receipt*', 'main wholesale florist*'] },

  // SCAN TO EMAIL. Matched on a LABEL rather than a sender: a scanner that
  // goes through your own account puts YOUR address in from:, and
  // from:(wecare@...) matches every message you have ever sent. Set one Gmail
  // filter to apply the label.
  //
  // The name must stay exactly 'Perri Farms' -- that is what BloomBooks
  // matches against the bank's "A. Perri Farms", and getting it wrong breaks
  // the payment reconciliation rather than the scan.
  //
  // { name: 'Perri Farms', label: 'BloomBooks/Scanned/Perri', mode: 'pdf' },
];

// SCAN TO CLOUD. One folder per vendor, deliberately: the folder IS the vendor
// identity, so it does not matter that scanners name files Scan_0001.pdf with
// no vendor and no reliable date. Guessing the supplier from the PDF is how a
// Fall River invoice ends up filed under Perri. Inert while empty.
const INVOICE_FOLDERS = [
  // { name: 'Perri Farms', folderId: '<the long string in the Drive folder URL>' },
];

// Subjects that mean a delivery HAPPENED, rather than a document to parse.
// Recorded with no Claude call. Keyed by vendor name, lowercased.
const DELIVERY_MARKERS = {
  'perri farms': ['completed']
};

const LABEL_NAME = 'BloomBooks/Processed';
const SHEET_TAB_NAME = 'Invoices';
const FIRST_RUN_LOOKBACK_DAYS = 30; // how far back to look the very first time
const CLAUDE_MODEL = 'claude-sonnet-4-6';
const SEARCH_CAP = 100;             // threads per vendor per run
const LOOKBACK_OVERLAP_DAYS = 3;    // re-cover recent days; the sheet dedupes
const MAX_ATTEMPTS = 3;             // before a repeatedly failing message is set aside
const DATE_DRIFT_DAYS = 45;         // how far a parsed date may sit from the email

// ============================================================
// WEB APP — lets BloomBooks (on GitHub Pages) route manual invoice
// uploads through here, so the Anthropic API key never touches the browser.
//
// EXTRA SETUP for this part only:
//   Deploy → New deployment → type "Web app" → Execute as: Me →
//   Who has access: Anyone → Deploy → copy the /exec URL into
//   BloomBooks' Gmail Scan setup section.
// ============================================================
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    // Weekly summary push from BloomBooks — store it for the digest emailer to read
    if (body.action === 'summary') {
      saveSummary(body.summary);
      return ContentService.createTextOutput(JSON.stringify({ ok: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Otherwise, treat as a manual invoice upload
    const { filename, mediaType, base64 } = body;
    if (!base64 || !mediaType) throw new Error('Missing file data');

    let parsed;
    if (mediaType === 'application/pdf') {
      const bytes = Utilities.base64Decode(base64);
      const blob = Utilities.newBlob(bytes, mediaType, filename || 'upload.pdf');
      parsed = callClaudePdfBlob(blob, filename || 'uploaded file');
    } else {
      parsed = callClaudeImageBase64(base64, mediaType, filename || 'uploaded file');
    }

    return ContentService.createTextOutput(JSON.stringify({ ok: true, parsed }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Converts a PDF blob to a PNG image via Google Drive's export endpoint.
// Used as an OCR fallback when a PDF has no text layer (e.g. a flatbed scan,
// or a download from a vendor portal rather than a generated invoice).
//
// NOTE: Drive renders only the FIRST page. A single-page invoice is fine; a
// two-page one would parse successfully with a wrong total, which is worse
// than failing outright. The check on the first scanned invoice is therefore
// "does the total match the paper".
function pdfToImageBase64(pdfBlob) {
  try {
    const tempFile = DriveApp.createFile(pdfBlob.setName('_bb_ocr_temp.pdf'));
    const exportUrl = 'https://docs.google.com/document/d/' + tempFile.getId() + '/export?format=png';
    const token = ScriptApp.getOAuthToken();
    const resp = UrlFetchApp.fetch(exportUrl, {
      headers: { 'Authorization': 'Bearer ' + token },
      muteHttpExceptions: true
    });
    tempFile.setTrashed(true); // clean up temp file
    if (resp.getResponseCode() !== 200) {
      Logger.log('PDF-to-image conversion failed: HTTP ' + resp.getResponseCode());
      return null;
    }
    return Utilities.base64Encode(resp.getContent());
  } catch (e) {
    Logger.log('pdfToImageBase64 error: ' + e.message);
    return null;
  }
}

// ============================================================
// ONE-TIME SETUP
// ============================================================
function setupLabelAndTrigger() {
  GmailApp.getUserLabelByName(LABEL_NAME) || GmailApp.createLabel(LABEL_NAME);
  getSheet(); // creates header row if missing

  // Clear any existing triggers for scanInvoices to avoid duplicates
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'scanInvoices') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('scanInvoices').timeBased().everyDays(1).atHour(6).create();

  Logger.log('Setup complete. Label created, sheet header set, daily 6am trigger created.');
}

// Test a single vendor manually — safe to run any time, doesn't affect the trigger
function testSingleVendor() {
  const vendor = VENDORS[0]; // change index to test a different vendor
  Logger.log('Testing vendor: ' + vendor.name);
  processVendor(vendor, true);
}

// ============================================================
// MAIN SCAN
// ============================================================
function scanInvoices() {
  VENDORS.forEach(vendor => {
    try {
      processVendor(vendor, false);
    } catch (err) {
      Logger.log('Vendor failed: ' + vendor.name + ' — ' + err.message);
      logError(vendor.name, '', err.message);
    }
  });

  try {
    scanInvoiceFolders();
  } catch (err) {
    Logger.log('Folder scan failed: ' + err.message);
    logError('folders', '', err.message);
  }
}

function processVendor(vendor, isTest) {
  const label = GmailApp.getUserLabelByName(LABEL_NAME) || GmailApp.createLabel(LABEL_NAME);
  const props = PropertiesService.getScriptProperties();
  const lastRun = props.getProperty('LAST_RUN_' + vendorKey(vendor));

  // Three days of overlap. LAST_RUN is only a DATE, so the window was one day
  // wide at its edge; the sheet dedupes on MessageId, so re-covering costs
  // nothing and closes the gap.
  const lookback = lastRun ? shiftDays(lastRun, -LOOKBACK_OVERLAP_DAYS) : null;
  const sinceQuery = lookback
    ? 'after:' + lookback
    : 'newer_than:' + FIRST_RUN_LOOKBACK_DAYS + 'd';

  // A label source, for scan-to-email, or a sender. NOT filtered on the
  // processed label any more: the sheet decides what has been done.
  const source = vendor.label
    ? 'label:"' + vendor.label + '"'
    : 'from:(' + vendor.email + ')';
  const query = `${source} ${sinceQuery}`;

  const threads = GmailApp.search(query, 0, isTest ? 3 : SEARCH_CAP);

  if (threads.length === 0) {
    Logger.log('No new messages for ' + vendor.name);
    return;
  }

  const captured = loadIdColumn(SHEET_TAB_NAME, 'MessageId');
  const skipped  = loadIdColumn('Skipped', 'MessageId');
  const marked   = loadIdColumn('Deliveries', 'MessageId');
  const failed   = attemptCounts();

  threads.forEach(thread => {
    thread.getMessages().forEach(msg => {
      const id = msg.getId();
      if (captured.has(id) || skipped.has(id) || marked.has(id)) return;

      // A delivery HAPPENED. No line items to find, so no API call -- but the
      // fact and its date are what make a missing invoice findable later.
      if (isDeliveryMarker(msg, vendor)) {
        recordDelivery(vendor.name, msg);
        marked.add(id);
        return;
      }

      // Mail that was never going to be an invoice. Skipped in CODE rather
      // than in the query, so a wrong pattern shows up as an invoice sitting
      // in the Skipped tab rather than one that never existed.
      const why = shouldSkipSubject(msg, vendor);
      if (why) {
        recordSkip(vendor.name, msg, 'Subject matched "' + why + '"');
        skipped.add(id);
        return;
      }

      // Repeatedly failing. Set aside where it can be SEEN, not in a label
      // where it cannot.
      if ((failed[id] || 0) >= MAX_ATTEMPTS) {
        recordSkip(vendor.name, msg, 'Gave up after ' + MAX_ATTEMPTS + ' failed attempts');
        skipped.add(id);
        return;
      }

      try {
        const parsed = extractInvoice(msg, vendor);
        if (parsed && parsed.items && parsed.items.length > 0) {
          appendToSheet(parsed, vendor, msg);
          captured.add(id);
        } else {
          // Claude read it and found no line items. That is an ANSWER --
          // availability lists and statements land here -- not a failure.
          recordSkip(vendor.name, msg, 'No items extracted');
          skipped.add(id);
        }
      } catch (err) {
        // A FAILURE. Deliberately NOT recorded in Skipped, so the next run
        // tries again: an API error or a bad JSON response is transient.
        logError(vendor.name, id, err.message);
      }
    });
    if (!isTest) thread.addLabel(label);   // kept, for a human reading the mailbox
  });

  if (isTest) return;

  // Only advance the window when the whole backlog was seen. Advancing past a
  // truncated search is how mail goes missing with nothing logged.
  if (threads.length >= SEARCH_CAP) {
    logError(vendor.name, '', 'Search hit the ' + SEARCH_CAP +
      '-thread cap — leaving LAST_RUN where it is so the rest are picked up next run');
  } else {
    const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy/MM/dd');
    props.setProperty('LAST_RUN_' + vendorKey(vendor), today);
  }
}

// Two vendors can share a name (Perri by mail and Perri by scan), so the
// LAST_RUN key has to be the SOURCE, not the name.
function vendorKey(vendor) {
  return vendor.label ? 'label:' + vendor.label : vendor.email;
}

// Calendar days, so it stays correct across a daylight-saving change where
// adding 86,400,000 ms would not.
function shiftDays(yyyySlashMmDd, days) {
  const [y, m, d] = yyyySlashMmDd.split('/').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return Utilities.formatDate(dt, 'UTC', 'yyyy/MM/dd');
}

// ============================================================
// SCAN TO CLOUD — a Drive folder as a source
// ============================================================
function scanInvoiceFolders() {
  INVOICE_FOLDERS.forEach(src => {
    let folder;
    try { folder = DriveApp.getFolderById(src.folderId); }
    catch (e) { logError(src.name, '', 'Cannot open folder: ' + e.message); return; }

    // A "Processed" subfolder is the read marker. Moving the file is more
    // robust than remembering ids: what has been done is visible in Drive
    // itself, and a file dropped in twice is done twice on purpose rather
    // than silently ignored.
    const existing = folder.getFoldersByName('Processed');
    const done = existing.hasNext() ? existing.next() : folder.createFolder('Processed');

    const files = folder.getFilesByType(MimeType.PDF);
    let n = 0;
    while (files.hasNext() && n < 20) {          // a bounded run, like the mail scan
      const file = files.next();
      n++;
      try {
        const parsed = callClaudePdfBlob(file.getBlob(), file.getName(), file.getDateCreated());
        if (parsed && parsed.items && parsed.items.length) {
          appendFolderInvoice(parsed, src.name, file);
          file.moveTo(done);
        } else {
          logError(src.name, 'drive-' + file.getId(),
                   'No items extracted from ' + file.getName());
          // NOT moved: a failure stays put so the next run tries again.
        }
      } catch (err) {
        logError(src.name, 'drive-' + file.getId(), err.message);
      }
    }
  });
}

// The same row shape the mail scan writes, so BloomBooks needs no change: it
// dedupes on whatever MessageId holds, and a Drive file id is as good an
// identity as a Gmail one.
function appendFolderInvoice(parsed, vendorName, file) {
  appendToSheet(parsed, { name: vendorName }, {
    getId:      () => 'drive-' + file.getId(),
    getDate:    () => file.getDateCreated(),
    getSubject: () => file.getName()
  });
}

// ============================================================
// WHAT TO DO WITH A MESSAGE
// ============================================================

// EXACT match by default; a trailing * makes it a prefix.
//
// Substring matching is the tempting default and it is wrong here. 'completed'
// as a substring also swallows "Your order has been completed", and the cost
// of a false match is an invoice that is never read.
function shouldSkipSubject(msg, vendor) {
  return matchSubject(msg, vendor.skipSubjects);
}

function isDeliveryMarker(msg, vendor) {
  const list = DELIVERY_MARKERS[String(vendor.name || '').toLowerCase()];
  return !!matchSubject(msg, list);
}

function matchSubject(msg, list) {
  const subject = String(msg.getSubject() || '').trim().toLowerCase();
  const pats = list || [];
  for (let i = 0; i < pats.length; i++) {
    const pat = String(pats[i]).trim().toLowerCase();
    const hit = pat.slice(-1) === '*'
      ? subject.indexOf(pat.slice(0, -1)) === 0
      : subject === pat;
    if (hit) return pats[i];
  }
  return null;
}

// ============================================================
// EXTRACTION — tries the vendor's declared mode, falls back to the other
// ============================================================
function extractInvoice(msg, vendor) {
  const sent = msg.getDate();

  if (vendor.mode === 'pdf') {
    const pdf = findPdfAttachment(msg);
    // callClaudePdfBlob, not callClaudePdf: it falls back to an image when the
    // PDF has no text layer, which is every flatbed scan. copyBlob because
    // pdfToImageBase64 renames the blob and writes it to Drive, and a
    // GmailAttachment is not a blob you can rename.
    if (pdf) return callClaudePdfBlob(pdf.copyBlob(), vendor.name, sent);
    return callClaudeBody(msg.getPlainBody(), vendor.name, sent);
  }

  // Combine the plain body with any HTML/text attachment — some vendors (e.g.
  // DVFlora) put the real order details in an attached HTML file rather than
  // the email body itself
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

function findTextAttachment(msg) {
  const atts = msg.getAttachments();
  for (let i = 0; i < atts.length; i++) {
    const ct = atts[i].getContentType();
    if (ct === 'text/html' || ct === 'text/plain') return atts[i];
  }
  return null;
}

function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function findPdfAttachment(msg) {
  const atts = msg.getAttachments();
  for (let i = 0; i < atts.length; i++) {
    if (atts[i].getContentType() === 'application/pdf') return atts[i];
  }
  return null;
}

// ============================================================
// CLAUDE CALLS
// ============================================================
const PARSE_PROMPT = `You are parsing a wholesale florist supplier invoice or order confirmation.
Extract ALL line items. Return ONLY valid JSON, no markdown, no preamble. Format:
{
  "supplier": "supplier name",
  "date": "YYYY-MM-DD",
  "delivery_date": "YYYY-MM-DD or null",
  "other_charges": [ { "label": "string, exactly as printed", "amount": number } ],
  "invoice_number": "string or null",
  "items": [
    { "name": "product name", "qty": number, "uom": "Stem|Bunch|Each|Box|Roll|Other", "unit_price": number, "total": number, "stems_per_bunch": number or null }
  ],
  "subtotal": number,
  "total": number
}

CRITICAL — other_charges is a REQUIRED key, always an array, even if empty ([]).
Look at the totals/charges section of the document (usually near the bottom, after the line items). For EVERY line there that is a charge rather than a product — this includes but is not limited to: delivery charge, freight charge, fuel surcharge, service charge, handling fee, energy surcharge — add ONE entry to other_charges with its label copied exactly as printed and its dollar amount. Do this even if there's only one such charge. If the document has no charges section at all, or every charge on it is $0.00, return other_charges as an empty array [].

Example — an invoice's totals section reading:
  SUBTOTAL: $341.04
  DEL CHARGE: $10.00
  FUEL SURCHARGE: $8.75
  TOTAL THIS INVOICE: $359.79
...must be parsed as:
  "subtotal": 341.04, "total": 341.04,
  "other_charges": [ { "label": "DEL CHARGE", "amount": 10.00 }, { "label": "FUEL SURCHARGE", "amount": 8.75 } ]
Do NOT return "total": 359.79 — "total" reflects the line items only, never the charges section.

Rules:
- name: clean product name, no product codes (e.g. "B2124 Palm Ponytail 6in" → "Palm Ponytail 6in")
- qty and unit_price must be numbers
- Include ALL line items, even cheap ones
- "stems_per_bunch": ONLY set this if the document explicitly states a stem count for that line (e.g. "10/bu", "5 stems/bunch"). If not explicitly stated, leave it null — do not guess or assume a standard count like 10.
- Some order confirmations list items in MULTIPLE separate tables/sections. Only extract items from a section clearly labeled as NEW/current (e.g. "Items Recently Added to Cart", "New Items", or an unlabeled primary table). DO NOT include items from a section labeled "Previously Ordered Items" or similar — those were already ordered earlier and already captured in that earlier order's own confirmation email, so re-including them here would double-count them.
- "total" and "subtotal" must equal the sum of the line items ONLY — anything in other_charges is always separate, never added in
- uom: normalize abbreviations — "Bu" or "Bunch" → "Bunch", "Ea" or "Each" → "Each", "St" or "Stem" → "Stem", "Bx" or "Box" → "Box"
- "date" is the order/invoice date exactly as printed on the document. If the document shows a month and day but no year, use the year from the current date given below. If the document shows no date at all, set "date" to null. Do NOT guess it, and do NOT substitute today's date yourself — you do not know what today is unless it is stated below.
- "delivery_date" is when the order actually SHIPS or gets DELIVERED — look for labels like "Ship Date", "Delivery Date", "Requested Delivery", "Delivery Window", or similar. This is often different from the order date, especially for presale/holiday orders placed weeks ahead. If you cannot find an explicit ship/delivery date anywhere in the document, set delivery_date to null — do not guess or default it to the order date yourself.
- If supplier name unclear, use the domain or company name visible
- If this text has no invoice/order line items at all, return {"items":[]}

Before returning your JSON, double-check: did you look at the totals/charges section for any delivery, freight, or fuel surcharge lines and list them in "other_charges"? Does "total" exclude them? If not, fix it before responding.`;

// The model has no idea what day it is, so a prompt telling it to "use today's
// date" got its own sense of now -- mid-2025 -- and 25 rows came through dated
// a year out. Both anchors are given: the day the mail arrived is the better
// one, because an invoice is emailed within a day or two of being issued.
function dateContext(msgDate) {
  const tz = Session.getScriptTimeZone();
  const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const sent  = msgDate ? Utilities.formatDate(msgDate, tz, 'yyyy-MM-dd') : today;
  return `\n\nToday's date is ${today}. This document arrived on ${sent}. ` +
         `The invoice date is almost always within a few days of that, and is ` +
         `never more than a few weeks from it.`;
}

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

  // No items means the PDF probably has no text layer — a flatbed scan, or a
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
  const trimmed = (bodyText || '').slice(0, 12000); // keep prompt reasonable
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

function callClaude(requestBody) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY script property is not set');

  const resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify(requestBody),
    muteHttpExceptions: true
  });

  if (resp.getResponseCode() !== 200) {
    throw new Error('Claude API error ' + resp.getResponseCode() + ': ' + resp.getContentText().slice(0, 300));
  }

  const data = JSON.parse(resp.getContentText());
  const text = (data.content || [])
    .map(b => b.text || '')
    .join('')
    .replace(/```json|```/g, '')
    .trim();

  const parsed = JSON.parse(text);

  // Sum the itemized other_charges into a single delivery_fee number, so
  // everything downstream keeps reading delivery_fee unchanged — this is an
  // internal representation change to make Claude's job (transcribe each
  // charge line) easier than its old job (calculate one combined number).
  if (Array.isArray(parsed.other_charges)) {
    parsed.delivery_fee = parsed.other_charges.reduce((s, c) => s + (parseFloat(c.amount) || 0), 0);
  } else if (typeof parsed.delivery_fee !== 'number') {
    parsed.delivery_fee = 0;
  }

  return parsed;
}

// ============================================================
// SHEET OUTPUT
// ============================================================
function getSheet() {
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!sheetId) throw new Error('SHEET_ID script property is not set');
  const ss = SpreadsheetApp.openById(sheetId);
  let sheet = ss.getSheetByName(SHEET_TAB_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_TAB_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Timestamp', 'MessageId', 'Vendor', 'Supplier', 'Date', 'DeliveryDate',
                     'DeliveryFee', 'InvoiceNumber', 'Total', 'ItemsJSON']);
  }
  return sheet;
}

// Finds a column by header name, or creates it in the next empty column if
// missing. This lets an already-populated Sheet gain new fields without anyone
// manually editing its structure.
function ensureColumn(sheet, name) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  let idx = headers.indexOf(name);
  if (idx === -1) {
    const newCol = lastCol + 1;
    sheet.getRange(1, newCol).setValue(name);
    idx = newCol - 1;
  }
  return idx; // 0-based
}

// An invoice emailed today was not issued a year ago, and cannot have been
// issued next month. When the parsed date is implausible against the day the
// document arrived, the model invented it — the arrival date is the better
// answer, and it is a fact rather than a reading.
//
// 45 days is deliberately loose: presale and holiday invoices legitimately
// predate their delivery by weeks, and this must not fire on those. Checked
// against the live feed — it corrects all 25 wrong rows and touches none of
// the 96 right ones.
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
      'Invoice date ' + parsedDate + ' is ' + Math.abs(days) + ' days from the document (' +
      mail + ') — using the document date');
    return mail;
  }
  return parsedDate;
}

function appendToSheet(parsed, vendor, msg) {
  const sheet = getSheet();
  const values = {
    'Timestamp': new Date(),
    'MessageId': msg.getId(),
    'Vendor': vendor.name,
    'Supplier': parsed.supplier || vendor.name,
    'Date': reconcileInvoiceDate(parsed.date, msg.getDate(), vendor.name, msg.getId()),
    'DeliveryDate': parsed.delivery_date || '',
    'DeliveryFee': parsed.delivery_fee || 0,
    'InvoiceNumber': parsed.invoice_number || '',
    'Total': parsed.total || 0,
    'ItemsJSON': JSON.stringify(parsed.items)
  };

  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  // Make sure every field we need has a column, adding any that are missing
  Object.keys(values).forEach(key => { if (headers.indexOf(key) === -1) ensureColumn(sheet, key); });

  const finalHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const row = finalHeaders.map(h => values[h] !== undefined ? values[h] : '');
  sheet.appendRow(row);
}

// ============================================================
// WHAT HAS ALREADY BEEN DONE
//
// Read from the sheet, not inferred from a thread label. Gmail labels are
// thread-level, so addLabel can never mean "this message is done" -- a vendor
// replying into a labelled thread would be invisible for ever.
// ============================================================
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

// A message Claude READ and found no line items in, or one matched by subject.
// Recorded so it is not re-sent every night -- the only job the thread label
// was really doing -- and WITH its subject, so a wrong skip pattern shows up
// as an invoice sitting in a list rather than one that never existed.
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

// A delivery happened. No line items, nothing to parse, and no API call --
// just the fact and the date, which is what makes a missing order findable.
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

function logError(vendorName, msgId, message) {
  try {
    const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    const ss = SpreadsheetApp.openById(sheetId);
    let errSheet = ss.getSheetByName('Errors');
    if (!errSheet) {
      errSheet = ss.insertSheet('Errors');
      errSheet.appendRow(['Timestamp', 'Vendor', 'MessageId', 'Error']);
    }
    errSheet.appendRow([new Date(), vendorName, msgId, message]);
  } catch (e) {
    Logger.log('Could not log error to sheet: ' + e.message);
  }
}
