// ============================================================
// BANK RECONCILIATION
// ============================================================
// Checks a Chase statement file against the book as it is uploaded. Going
// forward only: each upload is reconciled as it arrives, and history is left
// as it stands.
//
// Three questions, in order of how much they matter:
//
//   1. Is the statement itself complete? Its running balance has to step by
//      exactly each row's amount. Where it does not, a row is missing -- and
//      the size of the step is the size of the missing row.
//
//   2. Does it join the last statement? The point where the previous upload
//      ended has to appear in this one at the same balance. Judged by BALANCE,
//      not by date: two of the owner's real downloads looked like gaps by date
//      and were weekends, opening on exactly the balance the last one closed on.
//
//   3. Is every row in the book exactly once, in its own month? That is what
//      catches a failed import, a duplicate, and a row counted in the wrong
//      month.
//
// Nothing here needs a balance stored on a ledger row. That was tried first:
// the sheet keeps seven fields per row and the balance was not one of them, so
// it was written and then silently wiped on the next load. Reading the file
// each time needs nothing kept except where the last statement ended.

const RC_DATE_SLACK_DAYS = 5;     // how far a book row may be re-dated and still match
const RC_HISTORY_KEEP = 24;

let rcCurrent = null;             // { name, text } -- the statement on screen

function rcSigned(r) { return r.type === 'in' ? r.amount : -r.amount; }
function rcRound(n) { return Math.round(n * 100) / 100; }
function rcMonthKey(iso) { return (+iso.slice(0, 4)) + '-' + (+iso.slice(5, 7) - 1); }
function rcDays(a, b) { return Math.round((Date.parse(a) - Date.parse(b)) / 86400000); }
function rcDay(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  return d.getUTCDate() + ' ' + MONTHS_SHORT[d.getUTCMonth()];
}
function rcDescKey(s) { return String(s || '').slice(0, 20).toLowerCase(); }

// The statement, read by the importer's own parser so both see the same rows
// with the same descriptions and the same directions. Oldest first.
function rcParseStatement(text) {
  const table = parseDelimited(String(text || ''));
  if (detectStatementSource(table) !== 'bank') {
    return { error: 'Not a Chase statement — reconciliation reads the bank export only' };
  }
  const lines = normalizeStatement(table, 'bank').split('\n').filter(l => l.trim());
  const opts = { signedAmounts: bankLinesAreSigned(lines) };
  const noDate = () => ({ year: NaN, month: NaN });
  const rows = [];
  lines.forEach((line, idx) => {
    const p = parseBankLine(line, idx, noDate, opts);
    if (!p || !p.row || !/^\d{4}-\d{2}-\d{2}$/.test(p.row.date)) return;
    rows.push({
      date: p.row.date, amount: p.row.amount, type: p.row.type, desc: p.row.desc,
      bal: p.row.bal, category: p.row.category,
      ignored: !!(p.hit && p.hit.ignore), idx
    });
  });
  if (!rows.length) return { error: 'That file had no transactions I could read' };
  // Chase writes newest first. Reversing keeps each day's rows in the order the
  // balance moved through them, which sorting by date would not.
  if (rows[0].date > rows[rows.length - 1].date ||
      rows[0].date === rows[rows.length - 1].date) rows.reverse();
  if (rows.some(r => r.bal == null)) {
    return { error: 'This file has no Balance column, so it cannot be checked for gaps' };
  }
  return { rows };
}

// Question 1: does every balance account for its row?
function rcChain(rows) {
  const breaks = [];
  let totalIn = 0, totalOut = 0;
  rows.forEach((r, i) => {
    if (r.type === 'in') totalIn += r.amount; else totalOut += r.amount;
    if (i === 0) return;
    const prev = rows[i - 1];
    const expected = rcRound(prev.bal + rcSigned(r));
    const gap = rcRound(r.bal - expected);
    if (Math.abs(gap) < 0.005) return;
    // A row read the wrong way round steps the balance by twice its amount in
    // the opposite direction. Anything else is a row the file does not have.
    const backwards = Math.abs(gap + 2 * rcSigned(r)) < 0.01;
    breaks.push({ after: prev, row: r, expected, actual: r.bal, gap, backwards });
  });
  const first = rows[0], last = rows[rows.length - 1];
  return {
    from: first.date, to: last.date, count: rows.length,
    opening: rcRound(first.bal - rcSigned(first)), closing: rcRound(last.bal),
    totalIn: rcRound(totalIn), totalOut: rcRound(totalOut), breaks
  };
}

// Question 2: does it pick up where the last reconciled statement ended?
function rcContinuity(rows, chain, last) {
  if (!last) return { status: 'first' };
  if (chain.to < last.date) return { status: 'older', last };
  // The last statement's end point, found inside this one.
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].date === last.date && Math.abs(rows[i].bal - last.bal) < 0.005) {
      return { status: 'joins', last, how: 'overlap' };
    }
  }
  if (chain.from >= last.date && Math.abs(chain.opening - last.bal) < 0.005) {
    return { status: 'joins', last, how: 'adjacent' };
  }
  if (chain.from > last.date) {
    return { status: 'gap', last, moved: rcRound(chain.opening - last.bal) };
  }
  return { status: 'mismatch', last };
}

// Question 3: is each statement row in the book, once, in its own month?
function rcMatch(rows, chain) {
  const lo = new Date(Date.parse(chain.from) - 7 * 86400000).toISOString().slice(0, 10);
  const hi = new Date(Date.parse(chain.to) + 7 * 86400000).toISOString().slice(0, 10);
  const pool = [];
  Object.keys(appData.transactions || {}).forEach(key => {
    (appData.transactions[key] || []).forEach(tx => {
      if (tx._vault || !tx.date || tx.date < lo || tx.date > hi) return;
      pool.push({ key, tx, used: false });
    });
  });

  const results = rows.map(r => ({ row: r, status: r.ignored ? 'ignored' : null, book: null }));
  const same = (p, r) => !p.used && p.tx.type === r.type && Math.abs(p.tx.amount - r.amount) < 0.005;
  // Strictest first, across every row, so a loose match for one row can never
  // take the book entry that is an exact match for another.
  const passes = [
    ['found',  (p, r) => p.tx.date === r.date && String(p.tx.desc || '').toLowerCase().includes(rcDescKey(r.desc))],
    ['found',  (p, r) => p.tx.date === r.date],
    ['redated', (p, r) => Math.abs(rcDays(p.tx.date, r.date)) <= RC_DATE_SLACK_DAYS]
  ];
  passes.forEach(([status, test]) => {
    results.forEach(res => {
      if (res.status) return;
      const hit = pool.find(p => same(p, res.row) && test(p, res.row));
      if (!hit) return;
      hit.used = true;
      res.status = status;
      res.book = hit;
    });
  });
  results.forEach(res => { if (!res.status) res.status = 'missing'; });

  const misfiled = results.filter(res => res.book && res.book.key !== rcMonthKey(res.book.tx.date));

  // A duplicate is a book row left over after every statement row has taken
  // its own, identical to one that was taken. Two genuine identical charges on
  // one day are two statement rows, so each consumes one book row first.
  const taken = pool.filter(p => p.used);
  const duplicates = pool.filter(p => !p.used && p.tx.date >= chain.from && p.tx.date <= chain.to &&
    taken.some(q => q.tx.date === p.tx.date && q.tx.type === p.tx.type &&
                    Math.abs(q.tx.amount - p.tx.amount) < 0.005 &&
                    rcDescKey(q.tx.desc) === rcDescKey(p.tx.desc)));

  return {
    results,
    found: results.filter(r => r.status === 'found').length,
    redated: results.filter(r => r.status === 'redated'),
    missing: results.filter(r => r.status === 'missing').map(r => r.row),
    ignored: results.filter(r => r.status === 'ignored').map(r => r.row),
    misfiled, duplicates
  };
}

function reconcileStatement(text) {
  const parsed = rcParseStatement(text);
  if (parsed.error) return { error: parsed.error };
  const rows = parsed.rows;
  const chain = rcChain(rows);
  const recon = appData.bankRecon || {};
  // Once this statement is recorded, the remembered end point IS its own end,
  // and judging it against that would report it joining itself. Judge it
  // against the point that stood before it was recorded.
  let last = recon.last || null;
  const entry = (recon.history || []).find(h => h.from === chain.from && h.to === chain.to);
  if (entry && last && last.date === chain.to && Math.abs(last.bal - chain.closing) < 0.005) {
    last = entry.prev || null;
  }
  const continuity = rcContinuity(rows, chain, last);
  const match = rcMatch(rows, chain);
  const clean = chain.breaks.length === 0 &&
                ['first', 'joins', 'older'].indexOf(continuity.status) >= 0 &&
                match.missing.length === 0 && match.duplicates.length === 0 &&
                match.misfiled.length === 0;
  return { rows, chain, continuity, match, clean };
}

// Remembers where this statement ended, so the next upload can be checked for
// a gap. Never moves the end point backwards: re-checking an old file must not
// make the next new one look like it skipped a month.
function rcRecord(res, name) {
  const br = appData.bankRecon || (appData.bankRecon = {});
  const end = { date: res.chain.to, bal: res.chain.closing };
  const earlier = (br.history || []).find(h => h.from === res.chain.from && h.to === res.chain.to);
  // What this statement was checked against, kept so it can be shown again.
  const prev = earlier ? (earlier.prev || null)
             : (br.last && br.last.date <= end.date &&
                !(br.last.date === end.date && Math.abs(br.last.bal - end.bal) < 0.005) ? br.last : null);
  if (!br.last || end.date >= br.last.date) br.last = end;
  const entry = {
    prev: prev ? { date: prev.date, bal: prev.bal } : null,
    from: res.chain.from, to: res.chain.to,
    opening: res.chain.opening, closing: res.chain.closing,
    clean: !!res.clean, file: String(name || '').slice(0, 60),
    on: new Date().toISOString().slice(0, 10),
    open: res.clean ? 0 : res.match.missing.length + res.match.duplicates.length +
                          res.match.misfiled.length + res.chain.breaks.length
  };
  br.history = (br.history || []).filter(h => !(h.from === entry.from && h.to === entry.to));
  br.history.push(entry);
  br.history = br.history.slice(-RC_HISTORY_KEEP);
  saveData();
}

// ------------------------------------------------------------
// On screen
// ------------------------------------------------------------
function rcLoad(text, name) {
  rcCurrent = { text: String(text || ''), name: name || 'statement' };
  rcRender(true);
}

function rcClear() {
  rcCurrent = null;
  const el = document.getElementById('reconcile-area');
  if (el) el.innerHTML = '';
}

// Re-run after rows are saved: the ones reported missing a moment ago should
// now be found.
function rcRefresh() { if (rcCurrent) rcRender(true); }

function rcRecordClick() {
  if (!rcCurrent) return;
  const res = reconcileStatement(rcCurrent.text);
  if (res.error) return;
  if (!res.clean && !confirm('This statement still has differences from your book. ' +
      'Record it as reconciled anyway, so the next upload is checked against where it ends?')) return;
  rcRecord(res, rcCurrent.name);
  notify('Reconciled through ' + rcDay(res.chain.to) + ' — closing ' + fmt(res.chain.closing));
  rcRender(false);
}

function rcRender(autoRecord) {
  const el = document.getElementById('reconcile-area');
  if (!el || !rcCurrent) return;
  const res = reconcileStatement(rcCurrent.text);
  if (res.error) {
    el.innerHTML = `<div class="ledger-wrap" style="margin-bottom:16px;padding:12px 16px;font-size:0.8rem;color:var(--ink-soft)">
      🏦 ${escHtml(res.error)}</div>`;
    return;
  }
  const already = (appData.bankRecon && appData.bankRecon.last) || null;
  const recordedHere = already && already.date === res.chain.to && Math.abs(already.bal - res.chain.closing) < 0.005;
  // A clean statement records itself. One with differences waits for the owner.
  if (autoRecord && res.clean && !recordedHere && res.continuity.status !== 'older') {
    rcRecord(res, rcCurrent.name);
    return rcRender(false);
  }

  const c = res.chain, m = res.match, k = res.continuity;
  const ok = '<span style="color:var(--green);font-weight:700">✓</span>';
  const bad = '<span style="color:var(--red);font-weight:700">✗</span>';
  const warn = '<span style="color:var(--gold);font-weight:700">!</span>';
  const line = (mark, html) => `<div style="display:flex;gap:8px;align-items:baseline;margin:5px 0">${mark}<div>${html}</div></div>`;
  const rowText = r => `${rcDay(r.date)} · ${r.type === 'in' ? 'in' : 'out'} ${fmt(r.amount)} · ${escHtml(String(r.desc || '').slice(0, 40))}`;
  const list = (items, fn) => `<div style="font-size:0.72rem;color:var(--ink-soft);margin:3px 0 0 2px">${
    items.slice(0, 12).map(fn).join('<br>')}${items.length > 12 ? `<br>…and ${items.length - 12} more` : ''}</div>`;

  const parts = [];

  // 1. Complete?
  if (!c.breaks.length) {
    parts.push(line(ok, `<strong>Complete.</strong> Opening ${fmt(c.opening)} + ${fmt(c.totalIn)} in − ${fmt(c.totalOut)} out
      = closing ${fmt(c.closing)}, and every balance on the statement accounts for its row.`));
  } else {
    parts.push(line(bad, `<strong>The statement's own balance doesn't add up in ${c.breaks.length} place${c.breaks.length === 1 ? '' : 's'}.</strong>` +
      list(c.breaks, b => b.backwards
        ? `${rcDay(b.row.date)}: the balance moved ${fmt(Math.abs(b.gap))} the other way after <em>${escHtml(String(b.row.desc).slice(0, 30))}</em> — exactly twice its ${fmt(b.row.amount)}, so that row is being read the wrong way round`
        : `${rcDay(b.after.date)} → ${rcDay(b.row.date)}: a row of ${fmt(Math.abs(b.gap))} ${b.gap > 0 ? 'in' : 'out'} is missing from the file`)));
  }

  // 2. Joins the last one?
  if (k.status === 'first') {
    parts.push(line(warn, `<strong>No earlier statement recorded yet.</strong> Once this one is recorded, the next upload is checked for a gap from ${rcDay(c.to)}.`));
  } else if (k.status === 'joins') {
    parts.push(line(ok, `<strong>Joins your last statement</strong>, which ended ${rcDay(k.last.date)} at ${fmt(k.last.bal)}.`));
  } else if (k.status === 'older') {
    parts.push(line(ok, `An older statement — your reconciled record already runs to ${rcDay(k.last.date)}.`));
  } else if (k.status === 'gap') {
    parts.push(line(bad, `<strong>Gap before this statement.</strong> Your last one ended ${rcDay(k.last.date)} at ${fmt(k.last.bal)};
      this one opens ${rcDay(c.from)} at ${fmt(c.opening)}. ${fmt(Math.abs(k.moved))} ${k.moved > 0 ? 'came in' : 'went out'} in between that no upload covers —
      download from ${rcDay(k.last.date)} to fill it.`));
  } else {
    parts.push(line(bad, `<strong>Doesn't join your last statement.</strong> That ended ${rcDay(k.last.date)} at ${fmt(k.last.bal)}, and no row here on that day carries that balance.`));
  }

  // 3. In the book?
  const inBook = m.found + m.redated.length;
  const toCheck = c.count - m.ignored.length;
  if (!m.missing.length) {
    parts.push(line(ok, `<strong>All ${toCheck} row${toCheck === 1 ? '' : 's'} are in your book.</strong>` +
      (m.redated.length ? ` ${m.redated.length} carr${m.redated.length === 1 ? 'ies' : 'y'} a different date there.` : '')));
  } else {
    const net = rcRound(m.missing.reduce((s, r) => s + rcSigned(r), 0));
    parts.push(line(bad, `<strong>${m.missing.length} of ${toCheck} rows ${m.missing.length === 1 ? "isn't" : "aren't"} in your book</strong> — ${fmt(Math.abs(net))} ${net < 0 ? 'out' : 'in'} net.
      If you're importing this statement now, they're in the review table below; saving them clears this.` +
      list(m.missing, rowText)));
  }
  if (m.redated.length && m.missing.length) {
    parts.push(line(ok, `${inBook} are in your book, ${m.redated.length} of them under a different date.`));
  }
  if (m.duplicates.length) {
    parts.push(line(bad, `<strong>${m.duplicates.length} row${m.duplicates.length === 1 ? ' is' : 's are'} in your book twice.</strong>` +
      list(m.duplicates, p => `${rcDay(p.tx.date)} · ${fmt(p.tx.amount)} · ${escHtml(String(p.tx.desc || '').slice(0, 40))} — in ${MONTHS[+p.key.split('-')[1]]} ${p.key.split('-')[0]}`)));
  }
  if (m.misfiled.length) {
    parts.push(line(bad, `<strong>${m.misfiled.length} row${m.misfiled.length === 1 ? ' is' : 's are'} counted in the wrong month.</strong>` +
      list(m.misfiled, res => `${rcDay(res.book.tx.date)} · ${fmt(res.book.tx.amount)} · ${escHtml(String(res.book.tx.desc || '').slice(0, 30))} — sits in ${MONTHS[+res.book.key.split('-')[1]]}`)));
  }
  if (m.ignored.length) {
    parts.push(line(warn, `${m.ignored.length} row${m.ignored.length === 1 ? ' was' : 's were'} left out by an ignore rule, so ${m.ignored.length === 1 ? 'it isn’t' : 'they aren’t'} expected in the book.` +
      list(m.ignored, rowText)));
  }

  const recordedNow = (appData.bankRecon && appData.bankRecon.last &&
    appData.bankRecon.last.date === c.to && Math.abs(appData.bankRecon.last.bal - c.closing) < 0.005);
  const footer = recordedNow
    ? `<div style="margin-top:10px;font-size:0.75rem;color:var(--green)">Recorded — the next upload will be checked from ${rcDay(c.to)}, ${fmt(c.closing)}.</div>`
    : (k.status === 'older' ? '' :
       `<div style="margin-top:10px"><button class="btn btn-outline" onclick="rcRecordClick()">Record as reconciled through ${rcDay(c.to)}</button></div>`);

  el.innerHTML = `
    <div class="ledger-wrap" style="margin-bottom:16px">
      <div class="ledger-header">
        <h3>🏦 Statement check — ${escHtml(rcDay(c.from))} to ${escHtml(rcDay(c.to))} ${c.to.slice(0, 4)}</h3>
        <span style="font-size:0.72rem;color:${res.clean ? 'var(--green)' : 'var(--red)'};font-weight:600">
          ${res.clean ? 'Reconciled' : 'Differences to look at'}</span>
      </div>
      <div style="padding:4px 16px 14px;font-size:0.8rem">${parts.join('')}${footer}</div>
    </div>`;
}
