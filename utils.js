// ============================================================
// UTILITIES
// ============================================================
function fmt(n) {
  if (isNaN(n)) return '$0.00';
  return '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtK(n) {
  if (Math.abs(n) >= 1000) return '$' + (n/1000).toFixed(1) + 'k';
  return '$' + n;
}
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ============================================================
// NETWORK
// ============================================================

// A fetch that failed at the network layer rather than returning a status.
// Safari words this "Load failed", Chrome "Failed to fetch". Note that it is
// indistinguishable from a genuinely blocked domain, which is exactly what
// made this hard to diagnose.
function isTransientNetworkError(e) {
  return /load failed|failed to fetch|networkerror|network error/i.test((e && e.message) || '');
}

// iOS Safari aborts requests issued in the moment the OAuth popup closes and
// focus returns to the page. Every cloud call this app makes fires precisely
// then -- straight out of the sign-in callback -- so the first one lands in
// that window and dies with no HTTP status at all.
//
// This is not a blocked network, though it looks identical to one. diag.html
// establishes that from the same phone, in the same normal Safari tab: the
// Sheets domain is reachable, a plain request answers, and a preflighted
// request carrying an Authorization header comes back 401 as expected. The
// only difference is that page never goes through a popup transition.
//
// So a network-class failure is treated as transient and retried a few times
// before it's believed. Anything that came back with an HTTP status -- 401,
// 403, 429 -- is a real answer and is returned immediately, never retried.
async function fetchRetry(url, opts, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(url, opts);
    } catch (e) {
      lastErr = e;
      if (!isTransientNetworkError(e)) throw e;   // a real failure; don't paper over it
      if (i < attempts - 1) {
        await new Promise(r => setTimeout(r, 400 * Math.pow(2, i)));  // 400ms, then 800ms
      }
    }
  }
  throw lastErr;
}

