// ===========================================================================
// EPX merchant statement — read the month's PDF and check it against the books.
//
// The invoice checker asks "is there an invoice behind every payment out". This
// is the other direction: is there a deposit in the books behind every card
// batch EPX actually released. A batch that never got entered is money the
// books do not know arrived, and nothing else in BloomBooks would notice.
//
// Two things about this shop's EPX arrangement shape the whole report:
//
//  1. EPX SURCHARGES THE CUSTOMER, so the shop pays no processing fee. The
//     "Fees Paid" the statement deducts is recovered inside the sales figure it
//     is deducted from. Reporting that $45.91 as a cost would be wrong by the
//     whole amount -- the real monthly cost is the service fee alone.
//  2. The bank date is NOT the statement date. A batch dated 08/01 releases and
//     lands a business day or two later, so matching on the statement's own
//     date finds nothing. The window is what makes this work at all.
// ===========================================================================

const EPX_MATCH_WINDOW_DAYS = 6;   // 08/01 has been seen landing on 08/03
const EPX_CENT = 0.005;

// (1,234.56) is negative on a merchant statement. Counts are bare integers and
// money always carries two decimals, which is what separates them below.
function epxNum(tok) {
  const neg = /^\(.*\)$/.test(tok);
  const n = parseFloat(tok.replace(/[(),$]/g, ''));
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

// Money only: anything with two decimal places. Item counts are dropped, which
// is what lets a row be read positionally without counting columns.
function epxMoney(line) {
  const out = [];
  (line.match(/\(?\$?-?[\d,]+\.\d{2}\)?/g) || []).forEach(tok => {
    const n = epxNum(tok);
    if (n !== null) out.push(n);
  });
  return out;
}

function epxInts(line) {
  return (line.replace(/\(?\$?-?[\d,]+\.\d{2}\)?/g, ' ').match(/\b\d+\b/g) || []).map(Number);
}

function epxIso(year, mmdd) {
  const m = /^(\d{2})\/(\d{2})$/.exec(mmdd);
  return m ? `${year}-${m[1]}-${m[2]}` : null;
}

function epxParseStatement(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const out = { merchant: '', invoice: '', label: '', from: null, to: null, year: null,
                days: [], brands: [], charges: [], notices: [],
                gross: 0, fees: 0, billing: 0, net: 0, items: 0 };

  // The period lives in the page footer, e.g. "08/01/26 - 08/31/26". Everything
  // else is MM/DD with no year, so this is what dates the whole statement.
  const per = /(\d{2})\/(\d{2})\/(\d{2})\s*-\s*(\d{2})\/(\d{2})\/(\d{2})/.exec(text);
  if (per) {
    out.year = 2000 + Number(per[3]);
    out.from = `${out.year}-${per[1]}-${per[2]}`;
    out.to = `${2000 + Number(per[6])}-${per[4]}-${per[5]}`;
  }
  const mLabel = /Merchant Statement\s*\n?\s*([A-Z][a-z]+ \d{4})/.exec(text);
  if (mLabel) out.label = mLabel[1];
  const mMerch = /Merchant#\s*(\d+)/.exec(text);
  if (mMerch) out.merchant = mMerch[1];
  const mInv = /Invoice#\s*([\w-]+)/.exec(text);
  if (mInv) out.invoice = mInv[1];

  let inSummary = false, inCharges = false, day = null, dayBilling = 0;
  lines.forEach(line => {
    if (/^Deposit Detail Summary/i.test(line)) { inSummary = true; return; }
    if (/^Details/i.test(line)) { inSummary = false; return; }
    if (/^Billing Detail/i.test(line)) { inCharges = true; inSummary = false; return; }

    if (inSummary) {
      const money = epxMoney(line);
      if (/^Merchant Deposit\s+(\S+)/i.test(line) && money.length >= 3) {
        out.brands.push({ brand: /^Merchant Deposit\s+(\S+)/i.exec(line)[1],
                          items: epxInts(line)[0] || 0, sales: money[0] });
      } else if (/^Fees Paid/i.test(line) && money.length >= 2) out.fees = money[1];
      else if (/^Billing/i.test(line) && money.length >= 2) out.billing = money[1];
      return;
    }

    if (inCharges) {
      const money = epxMoney(line);
      if (/^Total Charges/i.test(line)) { inCharges = false; return; }
      if (money.length) {
        const desc = line.replace(/\s*\d[\d,]*\s+[\d.]+\s*\(?\$?-?[\d,]+\.\d{2}\)?\s*$/, '').trim();
        if (desc) out.charges.push({ desc, amount: money[money.length - 1] });
      }
      return;
    }

    // A date at the start of a line opens that day's block; the Daily Total
    // line closes it. Both forms appear -- a date line carries deposits of its
    // own, and the fee lines that follow are part of the same day.
    const d = /^(\d{2}\/\d{2})\b/.exec(line);
    if (d) day = d[1];

    // EPX takes its monthly service charge out of the LAST batch of the month,
    // so that day's release is the sale minus the charge. Captured per day and
    // added back below, or every month-end looks like an under-recorded sale by
    // exactly the charge over the tax rate -- which is how it first showed up,
    // as six false alarms across eight statements.
    //
    // Matched anywhere in the line, not just at the start: on a day whose only
    // entry IS the charge, it shares the line with the date ("08/31 Billing").
    if (/\bBilling\b/i.test(line) && day && !/^Daily Total:/i.test(line)) {
      const money = epxMoney(line);
      if (money.length >= 2) dayBilling += Math.abs(money[1]);
      return;
    }

    if (/^Daily Total:/i.test(line) && day) {
      const money = epxMoney(line);
      if (money.length >= 3) {
        out.days.push({ date: epxIso(out.year, day), mmdd: day,
                        gross: money[0], offset: money[1], net: money[2],
                        billing: dayBilling, items: epxInts(line)[0] || 0 });
      }
      day = null;
      dayBilling = 0;
      return;
    }

    if (/^Period Total:/i.test(line)) {
      const money = epxMoney(line);
      if (money.length >= 3) { out.gross = money[0]; out.net = money[2]; out.items = epxInts(line)[0] || 0; }
    }
  });

  // Forward-dated charges buried in the small print are real money and easy to
  // miss -- this one lands on a statement two to four months away.
  const reg = /Annual Regulatory Fee of \$([\d,]+\.\d{2})/i.exec(text);
  if (reg) out.notices.push(`An annual regulatory fee of $${reg[1]} is coming on a later statement.`);

  return out;
}

// The shop's real cost. Processing fees are recovered by the customer
// surcharge, so they are NOT a cost -- only what EPX bills outright is.
function epxRealCost(parsed) {
  return Math.abs(parsed.billing || 0);
}

// ---------------------------------------------------------------------------
// Against the books
// ---------------------------------------------------------------------------
function epxLedgerRows(fromIso, toIso) {
  const rows = [];
  const seen = {};
  const push = (y, m) => {
    const key = `${y}-${m}`;
    if (seen[key]) return;
    seen[key] = 1;
    (appData.transactions[key] || []).forEach((t, i) => rows.push({ t, key, i }));
  };
  const start = new Date(fromIso + 'T00:00:00Z');
  const end = new Date(toIso + 'T00:00:00Z');
  // The period's months plus the next, since a month-end batch lands in it.
  for (let d = new Date(start); d <= end; d.setUTCMonth(d.getUTCMonth() + 1)) {
    push(d.getUTCFullYear(), d.getUTCMonth());
  }
  push(end.getUTCFullYear(), end.getUTCMonth() + 1 > 11 ? 0 : end.getUTCMonth() + 1);
  if (end.getUTCMonth() + 1 > 11) push(end.getUTCFullYear() + 1, 0);
  return rows;
}

function epxLooksLikeEpx(t) {
  const s = ((t.desc || '') + ' ' + (t.vendor || '')).toLowerCase();
  return /epx|merchant settlement|merchant dep/.test(s);
}

function epxAddDays(iso, n) {
  return new Date(new Date(iso + 'T00:00:00Z').getTime() + n * 864e5).toISOString().slice(0, 10);
}

// How far the books actually go. A statement covers the whole month, but the
// bank is usually only entered up to some point in it -- so without this every
// deposit after that point is reported as missing, the warning is mostly noise,
// and a genuinely missed batch hides among a dozen false ones.
function epxBooksThrough(rows) {
  let last = '';
  rows.forEach(r => { const d = String(r.t.date || ''); if (d > last) last = d; });
  return last;
}

function epxReconcile(parsed) {
  if (!parsed || !parsed.from) return null;
  const rows = epxLedgerRows(parsed.from, parsed.to);
  const booksThrough = epxBooksThrough(rows);
  const used = {};
  const matched = [], missing = [], pending = [];

  // One settlement does not always arrive as one ledger row. In March 2026 each
  // was entered as TWO -- the sale under Revenue and its tax under Sales Tax
  // Collected -- so looking only for a single row of the full amount reported
  // eight of ten deposits missing in a month where every penny was present.
  // EPX-looking rows sharing a date are therefore also tried as a group.
  const groups = {};
  rows.forEach(r => {
    if (!epxLooksLikeEpx(r.t)) return;
    const d = String(r.t.date || '');
    (groups[d] = groups[d] || []).push(r);
  });

  parsed.days.forEach(day => {
    if (!day.date || Math.abs(day.net) < EPX_CENT) return;
    // The monthly service charge is netted on the statement but is often taken
    // from the bank as its own debit, so the credit that arrives is the release
    // plus that charge. Both readings are accepted.
    const wants = [day.net];
    if (day.billing) wants.push(day.net + day.billing);
    const until = epxAddDays(day.date, EPX_MATCH_WINDOW_DAYS);
    const inWindow = dt => dt >= day.date && dt <= until;
    const free = r => !used[r.key + ':' + r.i];

    let hit = null, note = '';
    for (const want of wants) {
      const wantType = want >= 0 ? 'in' : 'out';
      const singles = rows.filter(r => free(r) && (r.t.type || '') === wantType &&
        Math.abs(Math.abs(r.t.amount) - Math.abs(want)) <= EPX_CENT && inWindow(String(r.t.date || '')));
      // An EPX-looking row is preferred, then the earliest -- a settlement lands
      // as soon as it lands, and a same-amount coincidence later is not it.
      singles.sort((a, b) => (epxLooksLikeEpx(b.t) - epxLooksLikeEpx(a.t)) ||
                             String(a.t.date).localeCompare(String(b.t.date)));
      if (singles.length) { hit = [singles[0]]; break; }

      const amt = r => (r.t.type === 'out' ? -r.t.amount : r.t.amount);
      const dates = Object.keys(groups).filter(inWindow).sort();
      for (const dt of dates) {
        const g = groups[dt].filter(free);
        if (g.length < 2) continue;
        // Pairs first -- a sale and its tax. Two settlements can land on one
        // date (03/23 carried four rows for two batches), so taking the whole
        // day's total would match neither of them.
        for (let a = 0; a < g.length && !hit; a++) {
          for (let b = a + 1; b < g.length && !hit; b++) {
            if (Math.abs(amt(g[a]) + amt(g[b]) - want) <= EPX_CENT) hit = [g[a], g[b]];
          }
        }
        if (hit) { note = 'split'; break; }
        const sum = g.reduce((s, r) => s + amt(r), 0);
        if (Math.abs(sum - want) <= EPX_CENT) { hit = g; note = 'split'; break; }
      }
      if (hit) break;
    }

    if (hit) {
      hit.forEach(r => { used[r.key + ':' + r.i] = 1; });
      matched.push({ day, tx: hit[0].t, rows: hit, split: note === 'split',
                     guessed: !epxLooksLikeEpx(hit[0].t) });
    } else if (booksThrough && day.date > booksThrough) {
      pending.push(day);          // the bank simply is not entered this far yet
    } else {
      missing.push(day);
    }
  });

  // The other direction: an EPX deposit in the books that this statement does
  // not account for. Usually a date landing outside the period, sometimes a
  // duplicate entry.
  const extra = rows.filter(r => {
    if (used[r.key + ':' + r.i]) return false;
    if (!epxLooksLikeEpx(r.t)) return false;
    const dt = String(r.t.date || '');
    return dt >= parsed.from && dt <= epxAddDays(parsed.to, EPX_MATCH_WINDOW_DAYS);
  }).map(r => r.t);

  const missingTotal = missing.reduce((s, d) => s + d.net, 0);
  const pendingTotal = pending.reduce((s, d) => s + d.net, 0);
  return { matched, missing, pending, extra, missingTotal, pendingTotal, booksThrough,
           expected: parsed.days.reduce((s, d) => s + d.net, 0) };
}

// ---------------------------------------------------------------------------
// Against the day book
//
// EPX IS ALWAYS A COUNTER SALE -- the card machine on the counter, nothing
// else. That is what makes this check possible at all: one channel in the day
// book maps to one merchant account, so every batch on the statement should
// have a counter sale behind it.
//
// Two facts, both confirmed against the August 2026 statement day by day:
//
//   The surcharge exactly funds the processing fee, so what EPX RELEASES is
//   the sale including tax. gross - fees = net = sale x (1 + tax rate).
//
//   The statement's date is the SETTLEMENT date, a day or so after the sale.
//   Six of nine August batches sat exactly one day after their day-book entry,
//   and a Saturday sale settles on the Sunday, so the pairing walks backwards
//   from the statement date rather than assuming a fixed offset.
//
// A difference here is a counter sale keyed wrong, or not keyed at all --
// which nothing else in the books would ever surface.
// ---------------------------------------------------------------------------
const EPX_SALE_LOOKBACK_DAYS = 4;
const EPX_CHANNEL = 'epx';

function epxTaxRate() {
  return typeof DS_TAX_RATE === 'number' ? DS_TAX_RATE : 0.08375;
}

// Day-book entries for the EPX channel over a date range. Day keys carry no
// leading zero and the month is zero-based, which is the shape the rest of the
// day book uses.
function epxDayBookSales(fromIso, toIso) {
  const out = [];
  if (typeof appData === 'undefined' || !appData.dailySales) return out;
  const start = new Date(fromIso + 'T00:00:00Z'), end = new Date(toIso + 'T00:00:00Z');
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate();
    const month = appData.dailySales[`${y}-${m}`];
    const rec = month && month[String(day)] && month[String(day)][EPX_CHANNEL];
    if (!rec) continue;
    const s = typeof rec === 'object' ? Number(rec.s) || 0 : Number(rec) || 0;
    if (s) out.push({ date: d.toISOString().slice(0, 10), sales: s });
  }
  return out;
}

function epxSalesCheck(parsed) {
  if (!parsed || !parsed.from) return null;
  const rate = epxTaxRate();
  const entries = epxDayBookSales(epxAddDays(parsed.from, -EPX_SALE_LOOKBACK_DAYS), parsed.to);
  const used = {};
  const rows = [];

  parsed.days.forEach(day => {
    if (!day.date || day.gross <= EPX_CENT) return;   // billing-only days have no sale
    // The monthly service charge comes out of this day's release but is not a
    // refund of the sale, so it is added back before dividing the tax out.
    const released = day.net + (day.billing || 0);
    const implied = released / (1 + rate);
    // The nearest sale on or before the settlement date. Paired by DATE, not by
    // amount, so a mis-keyed figure still pairs and shows as a difference --
    // matching on amount would quietly drop exactly the rows worth seeing.
    let best = null;
    entries.forEach(e => {
      if (used[e.date]) return;
      // STRICTLY before: the machine batches at close of day, so a sale never
      // settles on its own date. Allowing same-day let the 1st claim its own
      // takings and shunted every later batch onto the wrong day's sale.
      if (e.date >= day.date || e.date < epxAddDays(day.date, -EPX_SALE_LOOKBACK_DAYS)) return;
      if (!best || e.date > best.date) best = e;
    });
    if (best) used[best.date] = 1;
    rows.push({ day, implied, entry: best,
                diff: best ? best.sales - implied : null });
  });

  const orphans = entries.filter(e => !used[e.date] && e.date >= parsed.from);
  const off = rows.filter(r => r.entry && Math.abs(r.diff) > 0.5);
  const absent = rows.filter(r => !r.entry);
  return { rows, orphans, off, absent, rate,
           recorded: rows.reduce((s, r) => s + (r.entry ? r.entry.sales : 0), 0),
           implied: rows.reduce((s, r) => s + r.implied, 0) };
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
let epxStatement = null;

function epxRender() {
  const el = document.getElementById('epx-report');
  if (el) el.innerHTML = epxReportHtml();
}

function epxReportHtml() {
  if (!epxStatement) return '';
  if (epxStatement.error) {
    return `<div style="font-size:0.8rem;color:var(--red);margin-top:10px">
      ${escHtml(epxStatement.error)}</div>`;
  }
  // The "reading…" placeholder is not a parsed statement and has no days. It
  // used to fall straight through to the table below, where p.days.map threw
  // before the file had even been opened -- so clicking Upload did nothing at
  // all, with the real error lost inside a handler that had already thrown.
  if (epxStatement.loading || !Array.isArray(epxStatement.days)) {
    return `<div style="font-size:0.8rem;color:var(--mist);margin-top:10px">
      ${escHtml(epxStatement.label || 'Reading the statement…')}</div>`;
  }
  const p = epxStatement;
  const rec = epxReconcile(p);
  const num = n => fmt(Math.abs(n));

  const dayRow = (d, note, colour) => `
    <tr><td>${escHtml(d.mmdd)}</td>
        <td style="text-align:right">${fmt(d.gross)}</td>
        <td style="text-align:right;color:var(--mist)">${d.offset ? '(' + num(d.offset) + ')' : '—'}</td>
        <td style="text-align:right;font-weight:600">${fmt(d.net)}</td>
        <td style="font-size:0.7rem;color:${colour}">${note}</td></tr>`;

  const rows = p.days.map(d => {
    const hit = rec && rec.matched.filter(m => m.day === d)[0];
    if (hit) {
      return dayRow(d, `in the books ${hit.tx.date}` + (hit.guessed ? ' (amount matched only)' : ''),
                    hit.guessed ? 'var(--amber, #b8860b)' : 'var(--mist)');
    }
    if (rec && rec.pending.indexOf(d) >= 0) {
      return dayRow(d, 'bank not entered this far yet', 'var(--mist)');
    }
    return dayRow(d, 'not in the books', 'var(--red)');
  }).join('');

  return `
    <div style="margin-top:14px">
      <div style="display:flex;gap:14px;align-items:baseline;flex-wrap:wrap">
        <strong style="font-size:0.85rem">${escHtml(p.label || 'EPX statement')}</strong>
        <span style="font-size:0.72rem;color:var(--mist)">
          ${escHtml(p.from || '')} to ${escHtml(p.to || '')}${p.merchant ? ' · #' + escHtml(p.merchant) : ''}</span>
      </div>

      ${rec && rec.missing.length ? `
        <div style="margin-top:8px;padding:8px 10px;border-radius:6px;
                    background:var(--red-light, #fdecec);font-size:0.78rem">
          <strong>${rec.missing.length} deposit${rec.missing.length === 1 ? '' : 's'}
          totalling ${fmt(rec.missingTotal)}</strong> released by EPX with nothing matching in the
          books. Check the bank for these dates and enter what is missing.
        </div>` : `
        <div style="margin-top:8px;padding:8px 10px;border-radius:6px;
                    background:var(--green-light, #eef7ee);font-size:0.78rem">
          Every deposit on this statement that the books reach is accounted for.
        </div>`}

      ${rec && rec.pending.length ? `
        <div style="margin-top:6px;padding:8px 10px;border-radius:6px;
                    background:var(--surface);font-size:0.78rem;color:var(--mist)">
          ${rec.pending.length} later deposit${rec.pending.length === 1 ? '' : 's'} totalling
          ${fmt(rec.pendingTotal)} ${rec.pending.length === 1 ? 'is' : 'are'} not judged either way —
          the books only run to ${escHtml(rec.booksThrough)}. Upload the rest of the month's bank
          statement and check again.
        </div>` : ''}

      <table style="width:100%;font-size:0.75rem;margin-top:10px">
        <thead><tr style="color:var(--mist)">
          <th style="text-align:left">Date</th><th style="text-align:right">Card sales</th>
          <th style="text-align:right">Deducted</th><th style="text-align:right">Released</th>
          <th style="text-align:left">Deposit</th>
        </tr></thead>
        <tbody>${rows}
          <tr style="font-weight:600;border-top:1px solid var(--border)">
            <td>Total</td><td style="text-align:right">${fmt(p.gross)}</td>
            <td style="text-align:right">(${num(p.fees + p.billing)})</td>
            <td style="text-align:right">${fmt(p.net)}</td><td></td></tr>
        </tbody>
      </table>

      <div style="margin-top:10px;font-size:0.75rem;display:flex;gap:20px;flex-wrap:wrap">
        <div><span style="color:var(--mist)">Processing fees deducted</span><br>
          <strong>${num(p.fees)}</strong>
          <span style="color:var(--mist)"> — recovered by the customer surcharge, so not a cost</span></div>
        <div><span style="color:var(--mist)">What EPX actually cost you</span><br>
          <strong>${fmt(epxRealCost(p))}</strong>
          <span style="color:var(--mist)"> — the monthly service fee</span></div>
        <div><span style="color:var(--mist)">Card sales for 1099-K</span><br>
          <strong>${fmt(p.gross)}</strong>
          <span style="color:var(--mist)"> — gross, before anything deducted</span></div>
      </div>

      ${p.brands.length ? `<div style="margin-top:8px;font-size:0.72rem;color:var(--mist)">
        ${p.brands.map(b => `${escHtml(b.brand)} ${b.items} · ${fmt(b.sales)}`).join(' &nbsp;·&nbsp; ')}
      </div>` : ''}

      ${rec && rec.extra.length ? `<div style="margin-top:8px;font-size:0.73rem;color:var(--mist)">
        ${rec.extra.length} EPX deposit${rec.extra.length === 1 ? '' : 's'} in the books over this
        period that this statement does not account for:
        ${rec.extra.slice(0, 6).map(t => `${escHtml(t.date)} ${fmt(t.amount)}`).join(', ')}.
        Usually a batch from the previous month landing late.</div>` : ''}

      ${epxSalesHtml(p)}

      ${p.notices.map(n => `<div style="margin-top:8px;font-size:0.73rem;color:var(--amber, #b8860b)">
        ${escHtml(n)}</div>`).join('')}
    </div>`;
}

function epxSalesHtml(p) {
  const chk = epxSalesCheck(p);
  if (!chk || !chk.rows.length) return '';
  const bad = chk.off.length + chk.absent.length;

  return `
    <details style="margin-top:12px" ${bad ? 'open' : ''}>
      <summary style="font-size:0.8rem;cursor:pointer">
        <strong>Against the day book</strong>
        <span style="color:${bad ? 'var(--red)' : 'var(--mist)'};font-size:0.75rem">
          ${bad ? `— ${bad} day${bad === 1 ? '' : 's'} to look at`
                : '— every batch has a counter sale behind it'}</span>
      </summary>
      <div style="font-size:0.72rem;color:var(--mist);margin-top:6px">
        EPX is the counter card machine, so every batch should have a counter sale behind it.
        The surcharge funds the fee, so what EPX released is the sale including tax —
        divided back out at ${(chk.rate * 100).toFixed(3)}% below. A batch settles the next
        open day, so it is paired with the sale before it.
      </div>
      <div style="max-height:260px;overflow:auto;margin-top:6px">
        <table style="width:100%;font-size:0.73rem">
          <thead><tr style="color:var(--mist)">
            <th style="text-align:left">Settled</th><th style="text-align:right">Released</th>
            <th style="text-align:right">Sale it implies</th><th style="text-align:left">Day book</th>
            <th style="text-align:right">Recorded</th><th style="text-align:right">Difference</th>
          </tr></thead>
          <tbody>
            ${chk.rows.map(r => {
              const wrong = r.entry && Math.abs(r.diff) > 0.5;
              const colour = !r.entry ? 'var(--red)' : (wrong ? 'var(--amber, #b8860b)' : 'var(--mist)');
              return `<tr>
                <td>${escHtml(r.day.mmdd)}</td>
                <td style="text-align:right">${fmt(r.day.net)}</td>
                <td style="text-align:right">${fmt(r.implied)}</td>
                <td style="color:${colour}">${r.entry ? escHtml(r.entry.date.slice(5))
                                                      : 'no counter sale recorded'}</td>
                <td style="text-align:right">${r.entry ? fmt(r.entry.sales) : '—'}</td>
                <td style="text-align:right;color:${colour}">${
                  r.entry ? (Math.abs(r.diff) < 0.005 ? '—'
                            : (r.diff > 0 ? '+' : '') + fmt(r.diff)) : '—'}</td>
              </tr>`;
            }).join('')}
            <tr style="font-weight:600;border-top:1px solid var(--border)">
              <td>Total</td><td></td>
              <td style="text-align:right">${fmt(chk.implied)}</td>
              <td></td><td style="text-align:right">${fmt(chk.recorded)}</td>
              <td style="text-align:right">${fmt(chk.recorded - chk.implied)}</td></tr>
          </tbody>
        </table>
      </div>
      ${chk.orphans.length ? `<div style="font-size:0.72rem;color:var(--mist);margin-top:6px">
        ${chk.orphans.length} counter sale${chk.orphans.length === 1 ? '' : 's'} recorded on the EPX
        channel with no batch on this statement:
        ${chk.orphans.slice(0, 6).map(o => `${escHtml(o.date.slice(5))} ${fmt(o.sales)}`).join(', ')}.
        The last day or two of the month settle on the next statement.</div>` : ''}
    </details>`;
}

function epxPanelHtml() {
  return `
    <div class="ledger-wrap" style="margin-top:18px">
      <div class="ledger-header" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <h3 style="margin:0">Check the month against EPX</h3>
        <span style="font-size:0.7rem;color:var(--mist)">
          Upload the monthly merchant statement. Every batch EPX released is checked against a
          deposit in the books, allowing for the day or two it takes to land.
        </span>
        <button class="btn btn-outline btn-sm" style="margin-left:auto"
                onclick="document.getElementById('epx-file').click()">Upload statement</button>
        <input type="file" id="epx-file" accept=".pdf" style="display:none"
               onchange="epxHandleFile(event)">
      </div>
      <div id="epx-report" style="padding:0 16px 14px">${epxReportHtml()}</div>
    </div>`;
}

// pdf.js is fetched only when a statement is actually uploaded, so the app
// carries no cost for a feature used once a month.
let epxPdfLib = null;
async function epxLoadPdfLib() {
  if (epxPdfLib) return epxPdfLib;
  const SRC = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  const WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = SRC; s.onload = res; s.onerror = () => rej(new Error('Could not load the PDF reader'));
    document.head.appendChild(s);
  });
  const lib = window.pdfjsLib;
  if (!lib) throw new Error('The PDF reader loaded but did not register');
  lib.GlobalWorkerOptions.workerSrc = WORKER;
  epxPdfLib = lib;
  return lib;
}

async function epxPdfText(file) {
  const lib = await epxLoadPdfLib();
  const buf = await file.arrayBuffer();
  const doc = await lib.getDocument({ data: buf }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // Group by vertical position so a row of columns stays one line -- read
    // item by item, every figure would land on its own line and no row would
    // parse. The rounding is what tolerates a baseline that is not exact.
    const byRow = {};
    content.items.forEach(it => {
      const y = Math.round((it.transform[5] || 0) * 2) / 2;
      (byRow[y] = byRow[y] || []).push({ x: it.transform[4] || 0, s: it.str });
    });
    Object.keys(byRow).sort((a, b) => b - a).forEach(y => {
      pages.push(byRow[y].sort((a, b) => a.x - b.x).map(p => p.s).join(' ')
                 .replace(/\s+/g, ' ').trim());
    });
  }
  return pages.join('\n');
}

// A statement is read and then thrown away -- nothing about it is stored. So
// the fact that it was read is recorded against its own month, along with
// enough of the outcome to be worth reading the next morning: how many batches,
// and whether anything wanted looking at. The month is taken from the statement
// period, not from today, or a statement uploaded on the 3rd files itself under
// the wrong month.
function epxRecordUpload(p) {
  if (typeof dsMarkDone !== 'function' || !p || !p.from) return;
  try {
    const year = +p.from.slice(0, 4), month = +p.from.slice(5, 7) - 1;
    const chk = epxSalesCheck(p), dep = epxReconcile(p);
    dsMarkDone(`${year}-${month}`, 'epx', {
      label: p.label || '',
      batches: p.days.length,
      gross: p.gross,
      net: p.net,
      toCheck: (chk ? chk.off.length + chk.absent.length : 0) + (dep ? dep.missing.length : 0),
    });
  } catch (err) {
    // Recording that it happened must never cost the reading of it.
    console.error('EPX month-close record:', err);
  }
}

async function epxHandleFile(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = '';
  if (!file) return;
  epxStatement = { loading: true, label: 'Reading ' + file.name + '…' };
  epxRender();
  try {
    const text = await epxPdfText(file);
    const parsed = epxParseStatement(text);
    if (!parsed.days.length) throw new Error(
      'No daily totals found in that PDF. Is it an EPX merchant statement?');
    epxStatement = parsed;
    epxRecordUpload(parsed);
  } catch (err) {
    // A bare `getErrorMessage ? ...` was a ReferenceError here -- that helper
    // belongs to another project and does not exist in this one -- so the
    // handler threw while handling, and the real failure was never shown.
    console.error('EPX statement:', err);
    epxStatement = { error: (err && err.message) || String(err) };
  }
  epxRender();
}
