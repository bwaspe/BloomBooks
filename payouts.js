// ===========================================================================
// Stripe payouts — did every one reach the bank?
//
// The last step of the month close that had no tool behind it. Stripe's own
// payout list is the only genuinely independent record of the largest channel:
// the day book is keyed from FloraNext, and comparing the two only proves the
// copy was faithful. A payout with no deposit behind it is the one thing here
// that means money is actually unaccounted for.
//
// Export from dashboard.stripe.com/payouts, then upload the CSV.
// ===========================================================================

const PO_WINDOW_DAYS = 4;      // arrival date to bank credit
const PO_CENT = 0.005;

let poReport = null;

// Stripe's export is a proper CSV with quoted fields ("JPMORGAN CHASE BANK, NA"
// carries a comma), so it is split with the shared reader rather than a naive
// split on commas.
function poParse(text) {
  const rows = (typeof parseDelimited === 'function')
    ? parseDelimited(text)
    : text.split(/\r?\n/).filter(Boolean).map(l => l.split(','));
  if (!rows.length) return { payouts: [], error: 'That file had no rows.' };

  const head = rows[0].map(h => String(h).trim().toLowerCase());
  const col = re => head.findIndex(h => re.test(h));
  const iAmt = col(/^amount$/);
  // Arrival is when the money lands; Created is when Stripe initiated it. The
  // bank sees the arrival, so that is what a deposit is matched against.
  const iArr = col(/arrival/);
  const iCreated = col(/^created/);
  const iId = col(/^id$/);
  const iStatus = col(/^status$/);
  if (iAmt < 0 || (iArr < 0 && iCreated < 0)) {
    return { payouts: [], error: 'No Amount and Arrival Date columns — is this the payouts export?' };
  }

  const payouts = [];
  rows.slice(1).forEach(r => {
    const amt = parseFloat(String(r[iAmt] || '').replace(/[$,]/g, ''));
    const when = String(r[iArr >= 0 ? iArr : iCreated] || '').trim().slice(0, 10);
    if (!Number.isFinite(amt) || !/^\d{4}-\d{2}-\d{2}$/.test(when)) return;
    const status = iStatus >= 0 ? String(r[iStatus] || '').trim().toLowerCase() : 'paid';
    // A payout still in flight has not reached the bank yet, so its absence
    // there is not a discrepancy.
    if (status && status !== 'paid') return;
    payouts.push({ id: iId >= 0 ? String(r[iId] || '') : '', amount: amt, date: when });
  });
  payouts.sort((a, b) => a.date.localeCompare(b.date));
  return { payouts, error: payouts.length ? '' : 'No paid payouts found in that file.' };
}

function poLooksLikeStripe(t) {
  return /stripe/i.test((t.vendor || '') + ' ' + (t.desc || ''));
}

function poReconcile(payouts) {
  if (!payouts.length) return null;
  const from = payouts[0].date, to = payouts[payouts.length - 1].date;

  // Every income row in the covered months plus the next, since a payout at a
  // month end lands in the following one.
  const rows = [];
  const seen = {};
  const add = (y, m) => {
    const key = `${y}-${m}`;
    if (seen[key]) return;
    seen[key] = 1;
    ((appData.transactions || {})[key] || []).forEach((t, i) => {
      if ((t.type || '') === 'in') rows.push({ t, key, i });
    });
  };
  const start = new Date(from + 'T00:00:00Z'), end = new Date(to + 'T00:00:00Z');
  for (let d = new Date(start); d <= end; d.setUTCMonth(d.getUTCMonth() + 1)) {
    add(d.getUTCFullYear(), d.getUTCMonth());
  }
  add(end.getUTCMonth() === 11 ? end.getUTCFullYear() + 1 : end.getUTCFullYear(),
      end.getUTCMonth() === 11 ? 0 : end.getUTCMonth() + 1);

  let booksThrough = '';
  Object.keys(appData.transactions || {}).forEach(k =>
    (appData.transactions[k] || []).forEach(t => {
      const d = String(t.date || '');
      if (d > booksThrough) booksThrough = d;
    }));

  const used = {};
  const matched = [], missing = [], pending = [];
  payouts.forEach(p => {
    const until = new Date(new Date(p.date + 'T00:00:00Z').getTime() + PO_WINDOW_DAYS * 864e5)
      .toISOString().slice(0, 10);
    const hits = rows.filter(r => !used[r.key + ':' + r.i] &&
      Math.abs(r.t.amount - p.amount) <= PO_CENT &&
      String(r.t.date || '') >= p.date && String(r.t.date || '') <= until);
    // A Stripe-looking row first, then the earliest -- a payout lands when it
    // lands, and a same-amount coincidence later is not it.
    hits.sort((a, b) => (poLooksLikeStripe(b.t) - poLooksLikeStripe(a.t)) ||
                        String(a.t.date).localeCompare(String(b.t.date)));
    if (hits.length) {
      used[hits[0].key + ':' + hits[0].i] = 1;
      matched.push({ p, tx: hits[0].t, guessed: !poLooksLikeStripe(hits[0].t) });
    } else if (booksThrough && p.date > booksThrough) {
      // The bank simply is not entered this far yet. Not a discrepancy.
      pending.push(p);
    } else {
      missing.push(p);
    }
  });

  // The other direction: a deposit tagged Stripe with no payout behind it.
  const extra = rows.filter(r => !used[r.key + ':' + r.i] && poLooksLikeStripe(r.t) &&
    String(r.t.date || '') >= from && String(r.t.date || '') <= to).map(r => r.t);

  return { from, to, matched, missing, pending, extra, booksThrough,
           total: payouts.reduce((s, p) => s + p.amount, 0),
           missingTotal: missing.reduce((s, p) => s + p.amount, 0) };
}

// Recorded against every month the file covers, so the month-close checklist
// ticks itself rather than being taken on trust.
function poRecord(rec) {
  if (typeof dsMarkDone !== 'function' || !rec) return;
  const months = {};
  rec.matched.forEach(m => { const d = m.p.date; months[`${+d.slice(0,4)}-${+d.slice(5,7) - 1}`] = 1; });
  rec.missing.forEach(p => { const d = p.date; months[`${+d.slice(0,4)}-${+d.slice(5,7) - 1}`] = 1; });
  Object.keys(months).forEach(key => {
    const inMonth = p => `${+p.date.slice(0,4)}-${+p.date.slice(5,7) - 1}` === key;
    dsMarkDone(key, 'payouts', {
      matched: rec.matched.filter(m => inMonth(m.p)).length,
      missing: rec.missing.filter(inMonth).length,
    });
  });
}

async function poHandleFile(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = '';
  if (!file) return;
  poReport = { loading: true, name: file.name };
  poRender();
  try {
    const text = await file.text();
    const { payouts, error } = poParse(text);
    if (error) throw new Error(error);
    const rec = poReconcile(payouts);
    poRecord(rec);
    poReport = { rec, count: payouts.length };
  } catch (err) {
    console.error('Stripe payouts:', err);
    poReport = { error: (err && err.message) || String(err) };
  }
  poRender();
  if (typeof renderDailySalesPanel === 'function') renderDailySalesPanel();
}

function poRender() {
  const el = document.getElementById('po-report');
  if (el) el.innerHTML = poReportHtml();
}

function poReportHtml() {
  if (!poReport) return '';
  if (poReport.error) {
    return `<div style="font-size:0.8rem;color:var(--red);margin-top:10px">${escHtml(poReport.error)}</div>`;
  }
  if (poReport.loading) {
    return `<div style="font-size:0.8rem;color:var(--mist);margin-top:10px">Reading ${escHtml(poReport.name)}…</div>`;
  }
  const r = poReport.rec;
  if (!r) return '';
  const bad = r.missing.length;

  return `
    <div style="margin-top:12px">
      <div style="padding:9px 12px;border-radius:6px;font-size:0.8rem;
                  background:${bad ? 'var(--red-light, #fdecea)' : 'var(--green-light, #eef7ee)'}">
        ${bad
          ? `<strong>${bad} payout${bad === 1 ? '' : 's'} totalling ${fmt(r.missingTotal)}</strong>
             reached your Stripe account but ${bad === 1 ? 'is' : 'are'} not in the bank.
             This is the one check that finds missing money — look these up.`
          : `<strong>All ${r.matched.length} payouts the books reach are in the bank.</strong>
             ${fmt(r.total)} over ${escHtml(r.from)} to ${escHtml(r.to)}.`}
      </div>

      ${r.missing.length ? `
        <table style="width:100%;font-size:0.75rem;margin-top:8px">
          <thead><tr style="color:var(--mist)">
            <th style="text-align:left">Arrived</th><th style="text-align:right">Amount</th>
            <th style="text-align:left">Stripe id</th></tr></thead>
          <tbody>${r.missing.map(p => `
            <tr><td>${escHtml(p.date)}</td>
                <td style="text-align:right">${fmt(p.amount)}</td>
                <td style="color:var(--mist)">${escHtml(String(p.id).slice(0, 22))}</td></tr>`).join('')}
          </tbody></table>` : ''}

      ${r.pending.length ? `
        <div style="font-size:0.73rem;color:var(--mist);margin-top:6px">
          ${r.pending.length} later payout${r.pending.length === 1 ? '' : 's'} totalling
          ${fmt(r.pending.reduce((s, p) => s + p.amount, 0))} are not judged either way —
          the books only run to ${escHtml(r.booksThrough)}.
        </div>` : ''}

      ${r.extra.length ? `
        <div style="font-size:0.73rem;color:var(--mist);margin-top:6px">
          ${r.extra.length} deposit${r.extra.length === 1 ? '' : 's'} tagged Stripe with no payout
          behind ${r.extra.length === 1 ? 'it' : 'them'}:
          ${r.extra.slice(0, 6).map(t => `${escHtml(t.date)} ${fmt(t.amount)}`).join(', ')}.
          Usually something else that landed under the same name.
        </div>` : ''}
    </div>`;
}

function poPanelHtml() {
  return `
    <div class="ledger-wrap" style="margin-top:18px">
      <div class="ledger-header" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <h3 style="margin:0">Check Stripe payouts</h3>
        <span style="font-size:0.7rem;color:var(--mist)">
          Stripe's own record, matched to the bank. Export from
          dashboard.stripe.com/payouts.
        </span>
        <button class="btn btn-outline btn-sm no-print" style="margin-left:auto"
                onclick="document.getElementById('po-file').click()">Upload payouts CSV</button>
        <input type="file" id="po-file" accept=".csv,.tsv,.txt" style="display:none"
               onchange="poHandleFile(event)">
      </div>
      <div id="po-report" style="padding:0 16px 14px">${poReportHtml()}</div>
    </div>`;
}
