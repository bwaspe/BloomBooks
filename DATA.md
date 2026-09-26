# Where the data lives

Nobody could work this out from the code in under an hour, and on 26 September
2026 not knowing it cost a day: the address of the scanner's sheet was kept in
`ctData`, which is exactly what a second device does not have, so a phone could
not find the settings and reported the cost tracker as never set up.

This file is the map. **It is checked by `tests/test_datamap.js`** — every
storage key and sheet tab named here has to exist in the code, and every one in
the code has to be named here. A map that drifts is worse than no map, because
it gets believed.

---

## The short answer

There are **two spreadsheets** and **one browser's storage**, and three
separate flows between them.

| | holds | who writes it |
|---|---|---|
| **The book's sheet** | the ledger, the day book, the audit trail, saved versions | every signed-in browser |
| **The scanner's sheet** | invoices read from email, the settings, the cost tracker | the Apps Script, and the one computer that claims the cost tracker |
| **This browser** | a working copy of everything, plus per-device preferences | this browser |

The book's own address is a constant in `sync.js`, so it is reachable from
nothing. **The scanner's address is not** — it is carried in the book
(`appData.gmailSheetId`) so a second device can find it. That indirection is
the thing that was missing.

---

## The book's sheet

One spreadsheet, id hardcoded in `sync.js`.

| Tab | What | Written by |
|---|---|---|
| `BloomData` | Row 1 is everything except the bulk collections, as one JSON cell. Then one row per month: transactions in column B, day-book figures in column C. Split that way because four years of daily figures is well past the 50,000-character cell limit. | `sync.js` on every save, debounced 2s |
| `AuditLog` | What changed, when, on which computer, and what it was before. One row per save, appended and never rewritten. | `audit.js`, queued in the browser until sent |
| `VaultTotals` | Pre-BloomBooks figures. Read only. | nothing — entered by hand |
| `Version NNN` | Up to 20 rolling snapshots of `BloomData`, at most one an hour. | `versions.js` before a write, when one is due |

**A rollback restores the book and nothing else.** The cost tracker is in a
different spreadsheet on purpose: rolling the book back to undo a bookkeeping
mistake must not silently undo weeks of unrelated invoice work.

## The scanner's sheet

A second spreadsheet. Its id lives in `appData.gmailSheetId` and
`ctData.gmailSheetId`, mirrored — **written only by a device that has it**, so
a phone cannot blank it.

| Tab | What | Written by |
|---|---|---|
| `Invoices` | One row per invoice read out of email, with its line items as JSON. | the Apps Script, daily at 6am |
| `Skipped` | Messages Claude read and found no invoice in. An answer, not a failure. | the Apps Script |
| `Deliveries` | "Completed" notices. The only independent record that a delivery happened on a day no invoice arrived. | the Apps Script |
| `Errors` | Messages that threw. Retried, given up after three attempts. | the Apps Script |
| `Summary` | A daily push of prices and margin from the app. **Nothing reads it** — the digest emailer was never written. | `ctPushWeeklySummary` |
| `Settings` | Every setting, as one JSON cell. | the Settings panel, when signed in |
| `CostTracker` | The whole cost tracker: a header row, the settings chunked across rows, then one row per invoice, each stamped with the id of the write that put it there. | only the computer holding the claim |

## This browser

| Key | What | Goes to a sheet? |
|---|---|---|
| `bloombooks_v2` | The book. The working copy; the sheet is the shared one. | yes, `BloomData` |
| `bb_ctdata` | The cost tracker — invoices, catalog, retail prices, aliases, reconciliation, and now its own change history. | only from the claiming computer, to `CostTracker` |
| `bb_settings` | A cache of the Settings tab. The sheet wins on load. | yes, `Settings` |
| `bb_audit_queue` | Audit entries not sent yet. Nothing here may be dropped. | yes, `AuditLog`, then removed |
| `bb_audit_recent` | The last few hundred entries, to read without the sheet. | no |
| `bb_sheet_base` | Which version of the sheet this browser's book was built on. Used to spot another computer having saved since. | no |
| `bloombooksVersion` | When a saved version was last taken. | no |
| `bloombooks_vault_v1` | A cache of `VaultTotals`. | no |
| `bb_device_id` | Four random characters naming this browser. **The cost tracker claim is keyed on this**, not on the readable device string, which carries a browser and OS read off the user agent and would change under it. | no |
| `bb_errors` / `bb_errors_seen` | Faults caught by the collector at the top of `index.html`, and when they were last read. | **no, deliberately** — a message can carry whatever was being worked on when it threw |
| `bb_ctdata_before_reset` | The cost tracker as it stood before a reset, for the undo. | no |
| `bb_ctdata_unreadable` | A damaged `bb_ctdata`, kept so the next save cannot overwrite it. | no |
| `bb_colour_view` | Which colours the Colour Buying screen is showing. | no |
| `bb_ds_*` | Day-book view toggles. | no |
| `bb_token` | The Google access token. **`sessionStorage`**, not local — it dies with the tab. | no |
| `bloombooks-v3` | The service worker's cache name, not a data store. | no |

Everything marked "no" is **per device on purpose**. A view toggle is not a
setting the shop shares, and errors are not the shop's business to publish.

---

## The three flows

**The book** — every signed-in browser reads it at sign-in and writes it 2
seconds after any change. Two computers editing at once is detected: the write
is refused, the other version is kept as a saved version first, and the owner
chooses. See `versions.js`.

**The settings** — read once at sign-in, written when the Settings panel saves.
The Apps Script reads the same tab to learn which suppliers to scan, falling
back to the list in its own file if the tab cannot be read; a scanner that
reads nothing fails silently for weeks.

**The cost tracker** — **one writer, many readers.** The claiming computer
pushes 2 seconds after any change; every other device reads and is refused a
write, visibly. Nothing syncs at all until a computer claims it at
Settings › Cost tracker.

## The Apps Script

Bound to the scanner's sheet, running as `wecare@tuckahoeflorist.com`. Daily at
6am it reads each supplier's mail, sends invoices to Claude, and appends rows.
It also serves a `/exec` endpoint that BloomBooks posts manual invoice uploads
to, so the Anthropic key never reaches the browser.

**That URL has no login.** It is stored in `ctData.appsScriptUrl`, which means
it is inside every backup file — so a backup is not shareable.

## Backups, and getting back

- **The automatic one**: a JSON file of `appData` and `ctData` written to
  Downloads **on page load**, on whichever computer loaded the page. Roughly
  2MB each. It is a snapshot of that moment, not a live copy — a file written
  at 11:06 knows nothing about an edit at 11:30.
- **Export JSON / Import JSON** in the header: the same file, on demand.
- **Saved Versions**: up to 20 hourly snapshots of the book, in its own sheet.
  The book only.
- **`CostTracker` in the scanner's sheet**: the cost tracker, as of the last
  push from the claiming computer.
- **Undo the reset**: the cost tracker as it stood before a clear, kept in the
  browser that did it.

There is **no version history for the cost tracker** — the sheet holds the
latest push and nothing older. If the claiming computer pushes something wrong,
the previous copy is whatever Downloads happens to hold.

---

## What has already gone wrong here

- **The address of the scanner's sheet lived only in `ctData`** (26 Sep 2026).
  A phone has no `ctData`, so it could not find the settings, could not learn
  who keeps the cost tracker, and said it had never been set up. Now mirrored
  into the book, one way only — a device with no copy of its own must never
  write its empty one over the book's.
- **`ctData` had one copy** (until 26 Sep 2026): 229 invoices in one browser,
  unrebuildable from the `Invoices` tab because no stored invoice carries the
  messageId it came from and the ones that did come from email have been
  corrected by hand since.
- **Reset Cost Data rebuilt `ctData` from scratch** and silently destroyed
  sixteen keys nobody had listed. It clears by name now.
- **A settings allowlist lost a setting every time one was added** — silently,
  visible only after a refresh. Both sync payloads now list what must NOT go.
