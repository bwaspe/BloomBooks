// ============================================================
// WHAT WENT WRONG
// ============================================================
// Nothing in this app caught an error. A fault at the counter went into a
// console nobody opens, and reached me as "it was acting weird" — which is not
// something anyone can act on. The 401 that stopped the cost tracker saving
// was only visible because it happened to land in a code path with a message
// attached; a silent throw would have shown nothing at all.
//
// The COLLECTOR is inline at the top of index.html, not here, because a
// module loaded with the others misses the failures worth having most: a
// script that 404s, a syntax error in config.js, anything that goes wrong
// before the app is up. Those are the ones that leave a blank screen. This
// file only reads what was collected and shows it.
//
// IT STAYS IN THIS BROWSER. Errors carry file paths, and a message can carry
// whatever was being worked on when it threw, so they are not written to a
// shared sheet. "Copy" puts them on the clipboard to paste to me, which keeps
// the decision to share with the person doing the sharing.
const BB_ERRORS_KEY = 'bb_errors';

function bbErrors() {
  try { return Array.isArray(window.BB_ERRORS) ? window.BB_ERRORS : []; } catch (e) { return []; }
}

function bbErrorsClear() {
  if (!confirm('Clear the list of problems?\n\nThey are only kept in this browser, so this cannot be undone. Copy them first if you have not sent them on.')) return;
  try { window.BB_ERRORS = []; localStorage.removeItem(BB_ERRORS_KEY); } catch (e) {}
  if (typeof notify === 'function') notify('Problems cleared');
  renderErrorsPanel();
}

// Plain text rather than the rendered list: it is going into a message, and a
// stack trace pasted as prose is unreadable.
function bbErrorsText() {
  return bbErrors().slice().reverse().map(e => {
    const when = new Date(e.at).toLocaleString();
    return `[${when}] ${e.kind}${e.count > 1 ? ' (x' + e.count + ')' : ''}` +
           `\n  ${e.message}` +
           (e.where ? `\n  at ${e.where}` : '') +
           (e.panel ? `\n  screen: ${e.panel}` : '') +
           (e.ver ? `\n  version: ${e.ver}` : '') +
           (e.stack ? `\n  ${e.stack.split('\n').slice(0, 4).join('\n  ')}` : '');
  }).join('\n\n') || 'No problems recorded.';
}

function bbErrorsCopy() {
  const text = bbErrorsText();
  const done = () => { if (typeof notify === 'function') notify('Copied — paste it into a message'); };
  try {
    // Only available over https and on a recent browser; the fallback is what
    // an older iPad will actually use.
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => bbErrorsCopyFallback(text));
      return;
    }
  } catch (e) { /* fall through */ }
  bbErrorsCopyFallback(text);
}

function bbErrorsCopyFallback(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    if (typeof notify === 'function') notify('Copied — paste it into a message');
  } catch (e) {
    if (typeof notify === 'function') notify('Could not copy — open the list and select it by hand', true);
  }
}

// A fault nobody has read yet. Shown as a badge so it is noticed without
// having to go looking, which is the whole point.
function bbErrorsUnseen() {
  let seen = 0;
  try { seen = Number(localStorage.getItem('bb_errors_seen')) || 0; } catch (e) {}
  return bbErrors().filter(e => e.at > seen).length;
}

function bbErrorsMarkSeen() {
  try { localStorage.setItem('bb_errors_seen', String(Date.now())); } catch (e) {}
}

function bbErrorsBadgeHtml() {
  const n = bbErrorsUnseen();
  if (!n) return '';
  return `<span style="background:var(--red);color:#fff;border-radius:10px;padding:1px 7px;
    font-size:0.68rem;margin-left:6px">${n}</span>`;
}

function bbErrorTimeAgo(ms) {
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + ' min ago';
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return hrs + (hrs === 1 ? ' hour ago' : ' hours ago');
  return new Date(ms).toLocaleString();
}

function bbErrorsHtml() {
  const list = bbErrors();
  if (!list.length) {
    return `<div style="font-size:0.75rem;color:var(--mist)">
      Nothing has gone wrong since this list was last cleared. Faults are recorded
      here automatically — there is nothing to switch on.</div>`;
  }
  const rows = list.slice().reverse();
  return `
    <div style="font-size:0.75rem;color:var(--mist);margin-bottom:10px">
      ${rows.length} recorded, newest first. They are kept in this browser only —
      <strong>Copy</strong> puts them on the clipboard to send on.
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      <button class="btn btn-outline btn-sm" onclick="bbErrorsCopy()">Copy</button>
      <button class="btn btn-danger btn-sm" onclick="bbErrorsClear()">Clear</button>
    </div>
    <div class="staging-table-wrap"><table>
      <thead><tr><th>When</th><th>What</th><th>Where</th></tr></thead>
      <tbody>${rows.map(e => `
        <tr>
          <td style="white-space:nowrap;font-size:0.72rem">${escHtml(bbErrorTimeAgo(e.at))}${
            e.count > 1 ? ` <span style="color:var(--red)">×${e.count}</span>` : ''}</td>
          <td style="font-size:0.75rem">
            ${escHtml(e.message || '(no message)')}
            ${e.stack ? `<details><summary style="cursor:pointer;font-size:0.7rem;color:var(--mist)">detail</summary>
              <pre style="font-size:0.66rem;white-space:pre-wrap;margin:4px 0 0">${escHtml(e.stack)}</pre></details>` : ''}
          </td>
          <td style="font-size:0.7rem;color:var(--mist);word-break:break-all">
            ${escHtml(e.where || '')}${e.panel ? `<div>screen: ${escHtml(e.panel)}</div>` : ''}
            ${e.ver ? `<div>v${escHtml(e.ver)}</div>` : ''}
          </td>
        </tr>`).join('')}</tbody>
    </table></div>`;
}

function renderErrorsPanel() {
  const el = document.getElementById('bb-errors');
  if (!el) return;
  el.innerHTML = bbErrorsHtml();
  bbErrorsMarkSeen();
}
