// ============================================================
// COST TRACKER
// ============================================================

// --- Data store ---
// ctData = {
//   invoices: [ { id, date, supplier, total, items: [{name,category,qty,uom,unitPrice,total}] } ],
//   catalog:  { "cdn mix": "Flowers", ... }   // learned category map (fuzzy key → category)
// }
const CT_CATEGORIES = ['Flowers','Greens','Plants','Glass','Ceramic','Other Containers','Floral Care','Funeral','Packaging','Ribbon','Tools/Equipment','Wedding/Event','Add-on Retail','Seasonal','Other'];
const CT_COLORS = { Flowers:'#c0392b', Greens:'#2a7a4f', Plants:'#27ae60', Glass:'#1a5fa8', Ceramic:'#8e6b4a', 'Other Containers':'#5b7a99', 'Floral Care':'#16a085', Funeral:'#4a4a5a', Packaging:'#b5a642', Ribbon:'#c2185b', 'Tools/Equipment':'#607d8b', 'Wedding/Event':'#9c6ade', 'Add-on Retail':'#e67e22', Seasonal:'#2ecc71', Other:'#888899' };

const CT_DEFAULT_MARKUP = { Flowers: 3, Greens: 3, Plants: 2.5, Glass: 2, Ceramic: 2, 'Other Containers': 2, 'Floral Care': 1.5, Funeral: 2, Packaging: 1.3, Ribbon: 2, 'Tools/Equipment': 1.5, 'Wedding/Event': 2, 'Add-on Retail': 1.8, Seasonal: 2.2, Other: 2 };

let ctData = { invoices: [], catalog: {}, retail: {}, family: {}, familyKeywords: {}, markup: {...CT_DEFAULT_MARKUP}, gmailSheetId: '', appsScriptUrl: '', importedGmailIds: [], dismissedStaleMargins: {}, templates: [], supplierAliases: {} };
let ctCharts = {};

function ctSave() {
  try { localStorage.setItem('bb_ctdata', JSON.stringify(ctData)); } catch(e) {}
}
function ctLoad() {
  try {
    const raw = localStorage.getItem('bb_ctdata');
    if (raw) ctData = { invoices:[], catalog:{}, retail:{}, family:{}, familyKeywords:{}, markup:{...CT_DEFAULT_MARKUP}, gmailSheetId:'', appsScriptUrl:'', importedGmailIds:[], dismissedStaleMargins:{}, templates:[], supplierAliases:{}, ...JSON.parse(raw) };
  } catch(e) {}
}

// --- Fuzzy category lookup ---
function ctCatalogKey(name) {
  return name.toLowerCase().replace(/[^a-z0-9 ]/g,'').replace(/\s+/g,' ').trim();
}
function ctGuessCategory(name) {
  const key = ctCatalogKey(name);
  if (ctData.catalog[key]) return ctData.catalog[key];
  // Substring matching (not strict word-boundary) so concatenated vendor abbreviations
  // like "SpRose" (Spray Rose) or "AlstroMix" still get caught correctly.
  // Order matters: more specific/narrow categories are checked before generic ones,
  // e.g. Funeral ("Casket Spray") is checked before Flowers, since both could match "spray".
  const funeralKw = ['casket','sympathy','funeral','memorial','standing spray','urn spray','easel','wreath'];
  const weddingKw = ['boutonniere','corsage','aisle runner','arch','pew clip','unity candle','cake topper','bridal'];
  const ribbonKw = ['ribbon','bow'];
  const toolsKw = ['shears','floral knife','wire cutter','clipper','frog','pin holder','floral scissors','snips'];
  const careKw = ['floral foam','oasis foam','flower food','preservative','floralife','floral tape','anchor pin','chicken wire','floral adhesive','floral glue'];
  const seasonalKw = ['glass ball','ornament','christmas','holiday pick','poinsettia pick','snowflake pick'];
  const addonKw = ['candle','chocolate','greeting card','stuffed animal','balloon','gift bag','plush'];
  const flowerKw = ['rose','sprose','lil','tulip','orchid','sunflow','delph','snap','stock','alstr','peony','dahlia','gerbera','iris','ranunc','anemon','freesia','lisianthus','cdn','mum','chrysanth','disb','pom','carna','spray rose','spray mum','spray chrysanth','protea','heliconia','anthurium','bird of paradise','hydrangea','wax','snapdragon','cremon','solidago','soledago','limonium','statice','campanula','gyps','dianthus'];
  const greensKw = ['eucal','fern','ruscus','salal','pittospo','asparagus','leather','tree fern','lemon leaf','israeli ruscus','bear grass','lily grass','monstera','palm','green','foliage','ivy','huck','myrtle','seeded','bupleur','parvifolia','teepee'];
  const ceramicKw = ['ceramic','terracotta','clay pot'];
  const glassKw = ['glass','vase'];
  const packagingKw = ['bag','tissue','cello','kraft','wrap','shipping box','staple','tape'];
  const plantsKw = ['succulent','cactus','ficus','pothos','orchid plant','bromeliad','monstera plant','bonsai','jade','aloe','dracaena','snake plant','philodendron','plant'];
  const containerKw = ['bowl','cube','cylinder','vessel','container','pot','urn','compote','jar','basket','tin','crate'];

  if (funeralKw.some(kw => key.includes(kw))) return 'Funeral';
  if (weddingKw.some(kw => key.includes(kw))) return 'Wedding/Event';
  if (ribbonKw.some(kw => key.includes(kw))) return 'Ribbon';
  if (toolsKw.some(kw => key.includes(kw))) return 'Tools/Equipment';
  if (careKw.some(kw => key.includes(kw))) return 'Floral Care';
  if (seasonalKw.some(kw => key.includes(kw))) return 'Seasonal';
  if (addonKw.some(kw => key.includes(kw))) return 'Add-on Retail';
  if (flowerKw.some(kw => key.includes(kw))) return 'Flowers';
  if (greensKw.some(kw => key.includes(kw))) return 'Greens';
  if (ceramicKw.some(kw => key.includes(kw))) return 'Ceramic';
  if (glassKw.some(kw => key.includes(kw))) return 'Glass';
  if (packagingKw.some(kw => key.includes(kw))) return 'Packaging';
  if (plantsKw.some(kw => key.includes(kw))) return 'Plants';
  if (containerKw.some(kw => key.includes(kw))) return 'Other Containers';
  return 'Other';
}
function ctLearnCategory(name, category) {
  ctData.catalog[ctCatalogKey(name)] = category;
  ctSave();
}

// --- Family/Type (finer grouping within a category, e.g. all rose colors → "Roses") ---
// Learns by keyword (first word of the item name), not per-exact-item — tag one
// "Ranunculus Cloni Pink" and every future Ranunculus variant auto-classifies too.
const DEFAULT_FAMILY_KEYWORDS = [
  ['spray rose','Spray Roses'], ['garden rose','Garden Roses'], ['rose','Roses'],
  ['snapdragon','Snapdragon'],
  ['delphinium','Delphinium'], ['delph','Delphinium'],
  ['stock','Stock'],
  ['bells of ireland','Bells of Ireland'],
  ['alstromeria','Alstroemeria'], ['alstroemeria','Alstroemeria'], ['alstro','Alstroemeria'],
  ['mini gerbera','Mini Gerbera'], ['gerbera','Gerbera'],
  ['oriental lily','Oriental Lily'], ['hybrid lily','Hybrid Lily'], ['lily','Lilies'], ['lil ','Lilies'],
  ['mini carnation','Mini Carnation'], ['carnation','Carnation'],
  ['cdn','CDN'],
  ['cremon','Cremon'],
  ['mardi gras','Mardi Gras'],
  ['soledago','Solidago'], ['solidago','Solidago'],
  ['limonium','Limonium'],
  ['statice','Statice'],
  ['mini green hydrangea','Mini Green Hydrangea'], ['hydrangea','Hydrangea'],
  ['lemon','Lemon'],
  ['leather','Leather'],
  ['baby blue','Baby Blue'],
  ['parvifolia','Parvifolia'],
  ['seeded','Seeded'],
  ['pittosporum','Pittosporum'],
  ['teepee palm','Teepee Palm'], ['teepee','Teepee Palm'],
  ['gypsophila','Gypsophila'],
  ['campanula','Campanula'],
  ['peony','Peony'],
  ['dahlia','Dahlia'],
  ['tulip','Tulips']
];

// Modifier words that commonly prefix multiple distinct families (Mini Gerbera vs Mini
// Carnation, Spray Rose vs Spray Mum, etc.) — when one of these is the first word, learn
// a two-word key instead of one, so tagging "Mini Gerbera" doesn't also capture "Mini Carnation".
const CT_GENERIC_FAMILY_MODIFIERS = ['mini','spray','garden','standard','dwarf','large','jumbo','mixed','assorted','micro','giant'];

function ctGuessFamily(name) {
  const key = ctCatalogKey(name);
  // Exact per-item override, if one was ever explicitly set (rare — mostly legacy)
  if (ctData.family && ctData.family[key]) return ctData.family[key];

  // Two-word phrases match regardless of word order, since vendors vary
  // ("Mini Gerbera" vs "Gerbera Mini Canadian") — both should hit the same rule.
  const matches = (kw) => {
    const words = kw.split(' ');
    if (words.length === 2) return key.includes(kw) || key.includes(words[1] + ' ' + words[0]);
    return key.includes(kw);
  };

  // Merge learned + built-in rules into one list and match by specificity (longest
  // keyword wins) regardless of source — a specific 2-word default (e.g. "mini gerbera")
  // must always beat a generic 1-word learned rule (e.g. "mini"), never the other way around.
  const combined = [
    ...Object.entries(ctData.familyKeywords || {}),
    ...DEFAULT_FAMILY_KEYWORDS
  ].sort((a,b)=>b[0].length-a[0].length);
  for (const [kw, fam] of combined) if (matches(kw)) return fam;
  return '';
}

function ctLearnFamily(name, family) {
  const trimmed = (family||'').trim();
  if (!trimmed) return;
  const key = ctCatalogKey(name);
  const words = key.split(/\s+/);
  // If a generic modifier shows up as either of the first two words — "Mini Gerbera"
  // or "Gerbera Mini Canadian" — learn the two-word combo (matching is order-agnostic,
  // so it doesn't matter which position it learns from) instead of just one word,
  // so distinct "Mini X" / "Mini Y" families never collide into one learned rule.
  const hasModifier = words.length > 1 && (CT_GENERIC_FAMILY_MODIFIERS.includes(words[0]) || CT_GENERIC_FAMILY_MODIFIERS.includes(words[1]));
  const learnKey = hasModifier ? (words[0] + ' ' + words[1]) : words[0];
  if (learnKey && learnKey.length > 1) {
    ctData.familyKeywords[learnKey] = trimmed;
  }
  ctSave();
}

function ctAllFamilies() {
  const learned = Object.values(ctData.familyKeywords || {});
  const defaults = DEFAULT_FAMILY_KEYWORDS.map(([,fam])=>fam);
  return [...new Set([...learned, ...defaults])].sort();
}
function ctFamilyDatalist() {
  return `<datalist id="ct-family-list">${ctAllFamilies().map(f => `<option value="${escHtml(f)}">`).join('')}</datalist>`;
}

// --- File handling ---
function ctHandleDrop(e) {
  e.preventDefault();
  document.getElementById('ct-drop-zone').classList.remove('drag');
  ctProcessFiles([...e.dataTransfer.files]);
}
function ctHandleFile(e) {
  ctProcessFiles([...e.target.files]);
  e.target.value = '';
}

// Multiple files get processed sequentially (safer for Apps Script rate limits than parallel)
// and each becomes its own review card, same pattern as the Gmail Scan results list.
window._ctUploadPending = window._ctUploadPending || [];

async function ctProcessFiles(files) {
  if (!files.length) return;
  if (!ctData.appsScriptUrl) {
    document.getElementById('ct-parse-area').innerHTML = `<div class="ct-parse-result"><div class="ct-parse-header"><h3 style="color:var(--red)">⚠️ Not connected</h3></div><div style="padding:16px;font-size:0.82rem;color:var(--mist)">Invoice parsing needs the Apps Script Web App URL set in Gmail Scan → Setup first.</div></div>`;
    return;
  }
  for (const file of files) {
    const placeholderIdx = window._ctUploadPending.length;
    window._ctUploadPending.push({ status: 'parsing', filename: file.name });
    ctRenderUploadArea();
    await ctProcessOneFile(file, placeholderIdx);
  }
}

async function ctProcessOneFile(file, idx) {
  try {
    const base64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result.split(',')[1]);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    const isPdf = file.type === 'application/pdf';
    const mediaType = isPdf ? 'application/pdf' : file.type;

    // Sent as text/plain to avoid a CORS preflight, which Apps Script web apps don't handle
    const response = await fetch(ctData.appsScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ filename: file.name, mediaType, base64 })
    });
    const result = await response.json();
    if (!result.ok) throw new Error(result.error || 'Apps Script returned an error');
    if (!result.parsed.items || result.parsed.items.length === 0) throw new Error("Claude couldn't extract line items from this file. Try a clearer image.");

    const parsed = result.parsed;
    const enriched = parsed.items.map(item => ({
      ...item,
      category: ctGuessCategory(item.name),
      family: ctGuessFamily(item.name),
      priorPrice: ctGetPriorPrice(item.name, parsed.supplier),
      stemsPerBu: item.stems_per_bunch || ctGetPriorStemsPerBunch(item.name) || null,
      removed: false
    }));
    window._ctUploadPending[idx] = { status: 'ready', parsed, enriched, filename: file.name, deliveryDate: parsed.delivery_date || null, deliveryFee: parsed.delivery_fee || 0 };
  } catch (err) {
    window._ctUploadPending[idx] = { status: 'error', filename: file.name, error: err.message };
  }
  ctRenderUploadArea();
}

function ctRenderUploadArea() {
  renderCtTemplates();
  const area = document.getElementById('ct-parse-area');
  if (window._ctUploadPending.length === 0) { area.innerHTML = ''; return; }

  area.innerHTML = ctFamilyDatalist() + window._ctUploadPending.map((p, i) => ctBuildUploadCardHtml(p, i)).join('');
}

function ctBuildUploadCardHtml(p, idx) {
  if (p.status === 'parsing') {
    return `<div class="ct-parsing-overlay" style="margin-bottom:12px"><div class="spinner">⏳</div><br>Reading ${escHtml(p.filename)} with Claude...<br><span style="font-size:0.72rem;color:var(--mist)">This takes about 10–15 seconds</span></div>`;
  }
  if (p.status === 'error') {
    return `<div class="ct-parse-result" style="margin-bottom:12px"><div class="ct-parse-header"><h3 style="color:var(--red)">⚠️ ${escHtml(p.filename)} — Parse failed</h3>
      <button class="btn btn-outline btn-sm" onclick="ctDismissUpload(${idx})">Dismiss</button></div>
      <div style="padding:16px;font-size:0.82rem;color:var(--mist)">${escHtml(p.error)}</div></div>`;
  }
  if (p.status === 'saved') {
    return `<div style="background:var(--green-light);border:1px solid var(--green);border-radius:8px;padding:14px 18px;font-size:0.82rem;color:var(--green);margin-bottom:12px">✓ ${escHtml(p.supplier)} saved — ${p.itemCount} items added to cost tracker</div>`;
  }

  const { parsed, enriched, filename } = p;
  const activeItems = enriched.filter(i=>!i.removed);
  const itemsTotal = activeItems.reduce((s,i)=>s+ctLineTotal(i),0);
  const deliveryFee = p.deliveryFee || 0;
  const activeTotal = itemsTotal + deliveryFee;
  const removedCount = enriched.length - activeItems.length;
  // Only meaningful while every line is still present: once something has been
  // removed the document's stated total no longer describes what is being saved.
  const headerGap = (parsed.total != null && !removedCount &&
                     Math.abs(parsed.total - activeTotal) > 0.02)
    ? parsed.total - activeTotal : 0;

  const rows = enriched.map((item, i) => {
    if (item.removed) {
      return `<div class="ct-item-row" style="opacity:0.5">
        <div class="ct-item-name" style="text-decoration:line-through">${escHtml(item.name)}</div>
        <div class="ct-item-meta" style="grid-column: span 4; text-align:right">
          <button class="btn btn-outline btn-sm" onclick="ctRestoreUploadItem(${idx}, ${i})" style="font-size:0.7rem;padding:2px 8px">Undo remove</button>
        </div>
      </div>`;
    }
    const priceFlag = ctPriceFlag(item.unit_price, item.priorPrice);
    const disc = ctLineDiscount(item);
    const pack = ctPackMultiplier(item);
    const stemsInput = item.uom === 'Bunch'
      ? `<input type="number" min="1" placeholder="stems/bu" value="${item.stemsPerBu||''}" onchange="ctUpdateUploadStemsPerBu(${idx}, ${i}, this.value)" style="font-size:0.7rem;padding:2px 4px;width:60px" title="Stems per bunch, if known — enables per-stem pricing">`
      : '';
    return `<div class="ct-item-row">
      <div class="ct-item-name">${escHtml(item.name)}${pack ? `
        <div style="font-size:0.66rem;color:var(--red);margin-top:2px;font-weight:500">
          ${pack} per ${escHtml(item.uom)} — line should be $${((item.qty || 0) * pack * item.unit_price).toFixed(2)}
          <button onclick="ctApplyPackMultiplier(${idx}, ${i})" style="border:none;background:none;color:var(--blue-light);cursor:pointer;font-size:0.66rem;text-decoration:underline;padding:0 0 0 4px">fix</button>
        </div>` : ''}</div>
      <div class="ct-item-meta">
        <input type="number" step="0.01" min="0" value="${item.qty}" onchange="ctUpdateUploadItemQty(${idx}, ${i}, this.value)" style="font-size:0.72rem;padding:2px 4px;width:52px" title="Quantity">
        ${escHtml(item.uom)}${stemsInput ? ' '+stemsInput : ''}</div>
      <div class="ct-item-cat">
        <select onchange="ctUpdateUploadItemCat(${idx}, ${i}, this.value)">
          ${CT_CATEGORIES.map(c => `<option value="${c}" ${c===item.category?'selected':''}>${c}</option>`).join('')}
        </select>
      </div>
      <div class="ct-item-family">
        <input type="text" list="ct-family-list" placeholder="Family/Type" value="${escHtml(item.family)}" onchange="ctUpdateUploadItemFamily(${idx}, ${i}, this.value)" style="font-size:0.75rem;padding:4px 6px;width:110px">
      </div>
      <div class="ct-item-price">
        $<input type="number" step="0.01" min="0" value="${item.unit_price.toFixed(2)}" onchange="ctUpdateUploadItemPrice(${idx}, ${i}, this.value)" style="font-size:0.75rem;padding:2px 4px;width:62px" title="Unit price — correct it against the paper invoice">${priceFlag}
        <span style="white-space:nowrap;font-size:0.68rem;color:${disc ? 'var(--red)' : 'var(--mist)'}">
          <input type="number" step="0.1" min="0" max="99.9" value="${disc ? disc.toFixed(1) : ''}" placeholder="0" onchange="ctUpdateUploadItemDiscount(${idx}, ${i}, this.value)" style="font-size:0.68rem;padding:1px 3px;width:42px" title="Discount % — the invoice prints a reduced total for this line">% off</span>
      </div>
      <div class="ct-item-total">
        $<input type="number" step="0.01" min="0" value="${ctLineTotal(item).toFixed(2)}" onchange="ctUpdateUploadItemTotal(${idx}, ${i}, this.value)" style="font-size:0.75rem;padding:2px 4px;width:72px;font-weight:600" title="Line total as printed on the invoice">
        <button onclick="ctRemoveUploadItem(${idx}, ${i})" title="Remove this item" style="border:none;background:none;color:var(--mist);cursor:pointer;font-size:0.9rem;padding:0 0 0 6px">✕</button>
      </div>
    </div>`;
  });

  return `<div class="ct-parse-result" style="margin-bottom:14px" data-upload-idx="${idx}">
    <div class="ct-parse-header">
      <div>
        <h3>✓ ${escHtml(parsed.supplier || 'Unknown Supplier')} — ${escHtml(parsed.date || 'Date unknown')}</h3>
        <div style="font-size:0.72rem;color:var(--mist);margin-top:2px">${activeItems.length} items${removedCount?` (${removedCount} removed)`:''} · Invoice ${escHtml(parsed.invoice_number || filename)}</div>
        <div style="margin-top:6px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <label style="font-size:0.7rem;color:var(--mist)">Delivery/charge date${p.deliveryDate?' (auto-detected)':' (not found — edit if charged on delivery)'}:</label>
          <input type="date" value="${escHtml(p.deliveryDate||'')}" onchange="ctUpdateUploadDeliveryDate(${idx}, this.value)" style="font-size:0.72rem;padding:3px 6px">
          <label style="font-size:0.7rem;color:var(--mist);margin-left:8px">Delivery fee:</label>
          <input type="number" step="0.01" value="${deliveryFee}" onchange="ctUpdateUploadDeliveryFee(${idx}, this.value)" style="font-size:0.72rem;padding:3px 6px;width:70px">
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <span style="font-size:0.85rem;font-weight:600;color:var(--ink)">$${activeTotal.toFixed(2)}</span>
        <button class="btn btn-primary btn-sm" onclick="ctSaveUploadInvoice(${idx})">Save Invoice</button>
        <button class="btn btn-outline btn-sm" onclick="ctSaveAsTemplate(${idx})" title="Remember these items so this delivery starts pre-filled next time">Save as standing order</button>
        <button class="btn btn-outline btn-sm" onclick="ctDismissUpload(${idx})">Discard</button>
      </div>
    </div>
    ${headerGap !== 0 ? `
      <div style="padding:8px 18px;background:#fff3cd;border-bottom:1px solid #ffc107;font-size:0.75rem;color:var(--ink)">
        The invoice header says <strong>$${parsed.total.toFixed(2)}</strong>, the lines and fee come to
        <strong>$${activeTotal.toFixed(2)}</strong> — ${headerGap > 0 ? 'short by' : 'over by'}
        <strong>$${Math.abs(headerGap).toFixed(2)}</strong>.
        ${headerGap > 0
          ? `<button class="btn btn-outline btn-sm" style="font-size:0.68rem;padding:2px 8px;margin-left:6px"
                     onclick="ctAssignUploadGap(${idx})">Record it as a delivery charge</button>`
          : 'Check the lines against the paper.'}
      </div>` : ''}
    <div style="padding:8px 18px;background:var(--paper);border-bottom:1px solid var(--border);display:flex;gap:16px;font-size:0.68rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--mist)">
      <span style="flex:2">Item</span><span style="flex:1">Qty</span><span style="flex:1">Category</span><span style="min-width:110px">Family/Type</span><span style="min-width:70px;text-align:right">Unit</span><span style="min-width:70px;text-align:right">Total</span>
    </div>
    ${rows.join('')}
    ${deliveryFee > 0 ? `<div style="padding:6px 18px;font-size:0.75rem;color:var(--mist);border-top:1px dashed var(--border)">+ Delivery fee: $${deliveryFee.toFixed(2)}</div>` : ''}
    <div style="padding:12px 18px;text-align:right;border-top:1px solid var(--border);background:var(--paper)">
      <span style="font-size:0.72rem;color:var(--mist)">Review categories, remove anything that doesn't belong (like a standing order), then </span>
      <button class="btn btn-primary btn-sm" onclick="ctSaveUploadInvoice(${idx})">Save Invoice →</button>
    </div>
  </div>`;
}

function ctUpdateUploadDeliveryFee(idx, val) {
  const p = window._ctUploadPending[idx];
  if (!p) return;
  p.deliveryFee = parseFloat(val) || 0;
}

function ctUpdateUploadStemsPerBu(idx, itemIdx, val) {
  const item = window._ctUploadPending[idx]?.enriched[itemIdx];
  if (!item) return;
  const num = parseInt(val);
  item.stemsPerBu = (num && num > 0) ? num : null;
}

function ctUpdateUploadDeliveryDate(idx, dateVal) {
  const p = window._ctUploadPending[idx];
  if (!p) return;
  p.deliveryDate = dateVal || null;
}

// A line total is NOT always quantity times price. Suppliers discount single
// items by a percentage and print the reduced figure: three bunches of aster at
// $10.00 came to $26.07 on Perri's invoice, 13% off, and multiplying would
// overstate that one line by $3.93.
//
// The gap is not always a discount, though. Perri also prices roses per STEM
// while recording one bunch, so the printed total is 25x the line and the ratio
// runs the other way. Treating that as a negative discount would be nonsense,
// so only a shortfall counts -- an excess means the quantity is under-recorded,
// which is a different problem and left alone here.
function ctLineDiscount(item) {
  const gross = (item.qty || 0) * (item.unit_price || 0);
  if (!gross || item.total == null) return 0;
  const pct = (1 - item.total / gross) * 100;
  return pct > 0.05 && pct < 100 ? pct : 0;
}

const ctLineTotal = item =>
  (item.total != null ? item.total : (item.qty || 0) * (item.unit_price || 0));

// The printed total over quantity times price. Below 1 is a discount; above 1
// means the quantity is under-recorded, as when Perri prices roses per stem and
// records one bunch. A PRICE correction has to preserve either of them --
// rebuilding the total from qty x price collapsed a $42.75 line to $1.71.
// A QUANTITY correction deliberately does not: the reason to retype a quantity
// is usually that it was the wrong one, and 1 -> 25 on that line should give
// $42.75 rather than multiplying the error by 25 again.
// A box of 16 bunches gets parsed two ways. Usually '16 Bunch @ $7.99' with a
// total of $127.84, which is right. Sometimes '1 Box @ $7.99' with the 16 in
// stemsPerBu and a total of $7.99, which drops $119.85 off the line -- it
// happened three times in August on one Perri item alone.
//
// stemsPerBu is doing two jobs: stems per bunch on a Bunch line, units per pack
// on a Box line. That is why the unit of measure has to gate this. On the 212
// saved Bunch lines that carry a stem count the price IS per bunch and the
// total is already right; multiplying those would be a disaster. Only a
// container unit qualifies, and only when the total still equals qty x price,
// which is the signature of the multiplier having been dropped.
const CT_PACK_UNITS = /^(box|case|carton|flat|bundle|pack|other)$/i;

function ctPackMultiplier(item) {
  const per = Number(item.stemsPerBu) || 0;
  if (per <= 1 || !CT_PACK_UNITS.test(String(item.uom || ''))) return 0;
  const gross = (item.qty || 0) * (item.unit_price || 0);
  if (!gross) return 0;
  return Math.abs(ctLineTotal(item) - gross) < 0.005 ? per : 0;
}

function ctApplyPackMultiplier(idx, itemIdx) {
  const item = window._ctUploadPending[idx]?.enriched[itemIdx];
  if (!item) return;
  const per = ctPackMultiplier(item);
  if (!per) return;
  item.total = (item.qty || 0) * per * (item.unit_price || 0);
  ctRenderUploadArea();
}

// The parser puts a delivery charge into the header total without extracting it
// as a line or a fee. Seven saved invoices are short that way -- $18.75 five
// times from Main Wholesale, $25.00 from Alexander Hay, $15.00 from Juliet. The
// money reached the invoice total but landed in no category at all.
//
// Assigning it also rewrites parsed.total down to the items subtotal, because
// the save computes `(parsed.total || itemsTotal) + deliveryFee` and would
// otherwise count the charge twice.
function ctAssignUploadGap(idx) {
  const p = window._ctUploadPending[idx];
  if (!p || p.parsed.total == null) return;
  const items = p.enriched.filter(i => !i.removed).reduce((s, i) => s + ctLineTotal(i), 0);
  const gap = p.parsed.total - (items + (p.deliveryFee || 0));
  if (gap <= 0.02) return;
  p.deliveryFee = (p.deliveryFee || 0) + gap;
  p.parsed.total = items;
  ctRenderUploadArea();
  notify(`Recorded $${gap.toFixed(2)} as a delivery charge`);
}

function ctLineRatio(item) {
  const gross = (item.qty || 0) * (item.unit_price || 0);
  if (!gross || item.total == null) return 1;
  const r = item.total / gross;
  return Number.isFinite(r) && r > 0 ? r : 1;
}

// Price and quantity are editable because the parser misreads things, and
// because a standing order starts from last month's figures and has to be
// corrected against the paper. Each rewrites item.total -- a stale parsed total
// is truthy and would win over the correction, since every downstream sum reads
// `i.total || i.qty * i.unit_price` -- but each PRESERVES the discount, which
// an earlier version silently threw away on the first keystroke.
function ctUpdateUploadItemPrice(idx, itemIdx, val) {
  const item = window._ctUploadPending[idx]?.enriched[itemIdx];
  if (!item) return;
  const n = parseFloat(val);
  if (!Number.isFinite(n) || n < 0) return;
  const ratio = ctLineRatio(item);            // read before the price moves
  item.unit_price = n;
  item.total = item.qty * n * ratio;
  ctRenderUploadArea();
}

function ctUpdateUploadItemQty(idx, itemIdx, val) {
  const item = window._ctUploadPending[idx]?.enriched[itemIdx];
  if (!item) return;
  const n = parseFloat(val);
  if (!Number.isFinite(n) || n < 0) return;
  const disc = ctLineDiscount(item);
  item.qty = n;
  item.total = n * item.unit_price * (1 - disc / 100);
  ctRenderUploadArea();
}

function ctUpdateUploadItemDiscount(idx, itemIdx, val) {
  const item = window._ctUploadPending[idx]?.enriched[itemIdx];
  if (!item) return;
  const n = val === '' ? 0 : parseFloat(val);
  if (!Number.isFinite(n) || n < 0 || n >= 100) return;
  item.total = (item.qty || 0) * (item.unit_price || 0) * (1 - n / 100);
  ctRenderUploadArea();
}

// The total is editable directly as well, because that is the figure actually
// printed on the invoice -- typing it is quicker and less error-prone than
// working out what percentage produces it. The discount then follows from it.
function ctUpdateUploadItemTotal(idx, itemIdx, val) {
  const item = window._ctUploadPending[idx]?.enriched[itemIdx];
  if (!item) return;
  const n = parseFloat(val);
  if (!Number.isFinite(n) || n < 0) return;
  item.total = n;
  ctRenderUploadArea();
}

function ctUpdateUploadItemCat(idx, itemIdx, category) {
  const item = window._ctUploadPending[idx]?.enriched[itemIdx];
  if (!item) return;
  item.category = category;
  ctLearnCategory(item.name, category);
}

function ctUpdateUploadItemFamily(idx, itemIdx, family) {
  const item = window._ctUploadPending[idx]?.enriched[itemIdx];
  if (!item) return;
  item.family = family.trim();
}

function ctRemoveUploadItem(idx, itemIdx) {
  const item = window._ctUploadPending[idx]?.enriched[itemIdx];
  if (!item) return;
  item.removed = true;
  ctRenderUploadArea();
}

function ctRestoreUploadItem(idx, itemIdx) {
  const item = window._ctUploadPending[idx]?.enriched[itemIdx];
  if (!item) return;
  item.removed = false;
  ctRenderUploadArea();
}

function ctDismissUpload(idx) {
  window._ctUploadPending.splice(idx, 1);
  ctRenderUploadArea();
}

function ctPriceFlag(current, prior) {
  if (prior === null) return ' <span class="ct-flag new">new</span>';
  const diff = ((current - prior) / prior) * 100;
  if (diff > 5) return ` <span class="ct-flag up">▲${diff.toFixed(0)}%</span>`;
  if (diff < -5) return ` <span class="ct-flag down">▼${Math.abs(diff).toFixed(0)}%</span>`;
  return '';
}

// Delivery date if set (e.g. presale/holiday orders invoiced early but delivered/charged later),
// otherwise the invoice's own date. Use this everywhere spend needs to land in the right period.
function ctEffDate(inv) {
  return inv.deliveryDate || inv.date;
}

function ctGetPriorPrice(itemName, supplierName) {
  const key = ctCatalogKey(itemName);
  // Look for last recorded price from same supplier for same item
  for (let i = ctData.invoices.length - 1; i >= 0; i--) {
    const inv = ctData.invoices[i];
    if (!ctSameSupplierStrong(inv.supplier, supplierName)) continue;
    const match = inv.items.find(it => ctCatalogKey(it.name) === key);
    if (match) return match.unitPrice;
  }
  // Try any supplier
  for (let i = ctData.invoices.length - 1; i >= 0; i--) {
    const inv = ctData.invoices[i];
    const match = inv.items.find(it => ctCatalogKey(it.name) === key);
    if (match) return match.unitPrice;
  }
  return null;
}

// Last known stems-per-bunch for this item — a starting suggestion, not a rule, since
// this genuinely varies batch to batch (e.g. CDN can be 5, 7, or 10 stems/bunch).
// Always shown editable, never silently applied.
function ctGetPriorStemsPerBunch(itemName) {
  const key = ctCatalogKey(itemName);
  for (let i = ctData.invoices.length - 1; i >= 0; i--) {
    const match = ctData.invoices[i].items.find(it => ctCatalogKey(it.name) === key && it.stemsPerBu);
    if (match) return match.stemsPerBu;
  }
  return null;
}

function ctSaveUploadInvoice(idx) {
  const p = window._ctUploadPending[idx];
  if (!p || p.status !== 'ready') return;
  const { parsed, enriched, filename } = p;
  const active = enriched.filter(i => !i.removed);

  if (active.length === 0) {
    notify('Nothing to save — all items were removed');
    return;
  }

  const itemsTotal = active.reduce((s,i) => s + (i.total || i.qty*i.unit_price), 0);
  const deliveryFee = p.deliveryFee || 0;
  // If items were removed, the document's stated total no longer applies — recalculate from what's kept, plus the fee
  const useTotal = active.length === enriched.length ? ((parsed.total || itemsTotal) + deliveryFee) : (itemsTotal + deliveryFee);

  const invoice = {
    id: 'inv-' + Date.now() + '-' + idx,
    date: parsed.date || new Date().toISOString().slice(0,10),
    deliveryDate: p.deliveryDate || null,
    deliveryFee,
    supplier: ctCanonicalSupplier(parsed.supplier),
    invoiceNumber: parsed.invoice_number || filename,
    total: useTotal,
    items: active.map(i => ({
      name: i.name,
      category: i.category,
      family: i.family || '',
      qty: i.qty,
      uom: i.uom,
      unitPrice: i.unit_price,
      stemsPerBu: i.stemsPerBu || null,
      discountPct: ctLineDiscount(i) || undefined,
      total: i.total != null ? i.total : i.qty * i.unit_price
    }))
  };

  active.forEach(i => {
    ctLearnCategory(i.name, i.category);
    if (i.family) ctLearnFamily(i.name, i.family);
  });

  ctData.invoices.push(invoice);
  ctSave();

  window._ctUploadPending[idx] = { status: 'saved', filename, supplier: invoice.supplier, itemCount: invoice.items.length };
  ctRenderSavedUploadCard(idx);
  notify(`Invoice from ${invoice.supplier} saved`);
  renderCtDashboard();
  renderCtPrices();
}

function ctRenderSavedUploadCard(idx) {
  const el = document.querySelector(`[data-upload-idx="${idx}"]`);
  const p = window._ctUploadPending[idx];
  const html = `<div style="background:var(--green-light);border:1px solid var(--green);border-radius:8px;padding:14px 18px;font-size:0.82rem;color:var(--green);margin-bottom:12px">✓ ${escHtml(p.supplier)} saved — ${p.itemCount} items added to cost tracker</div>`;
  if (el) el.outerHTML = html;
  else ctRenderUploadArea();
}

// ============================================================
// GMAIL SCAN — reads invoices scanned by Apps Script from a Google Sheet
// ============================================================

function renderCtGmailPanel() {
  const el = document.getElementById('ct-gmail-sheetid');
  if (el) el.value = ctData.gmailSheetId || '';

  const urlEl = document.getElementById('ct-appsscript-url');
  if (urlEl) urlEl.value = ctData.appsScriptUrl || '';

  const status = document.getElementById('ct-gmail-sheet-status');
  if (status) status.textContent = ctData.gmailSheetId
    ? '✓ Connected'
    : 'Not connected yet — paste your Sheet ID above, then Save.';

  const grid = document.getElementById('ct-markup-inputs');
  if (grid) {
    grid.innerHTML = CT_CATEGORIES.map(c => `
      <div class="form-group" style="margin:0">
        <label style="font-size:0.72rem;color:var(--mist)">${c}</label>
        <div style="display:flex;align-items:center;gap:4px">
          <input type="number" step="0.1" min="0" id="ct-markup-${c}" value="${ctData.markup[c] ?? CT_DEFAULT_MARKUP[c]}" style="width:100%">
          <span style="font-size:0.72rem;color:var(--mist)">×</span>
        </div>
      </div>`).join('');
  }

  renderCtSupplierSuggestions();

  const mergeFrom = document.getElementById('ct-merge-from');
  const mergeTo = document.getElementById('ct-merge-to');
  if (mergeFrom && mergeTo) {
    const suppliers = [...new Set(ctData.invoices.map(i=>i.supplier))].sort();
    const opts = suppliers.map(s => {
      const count = ctData.invoices.filter(i=>i.supplier===s).length;
      return `<option value="${escHtml(s)}">${escHtml(s)} (${count} invoice${count!==1?'s':''})</option>`;
    }).join('');
    mergeFrom.innerHTML = opts;
    mergeTo.innerHTML = opts;
  }

  const lastChecked = document.getElementById('ct-gmail-last-checked');
  if (lastChecked) {
    lastChecked.textContent = ctData.gmailLastChecked
      ? `Last checked: ${new Date(ctData.gmailLastChecked).toLocaleString()}`
      : '';
  }
}

function ctSaveGmailSettings() {
  const val = document.getElementById('ct-gmail-sheetid').value.trim();
  const scriptUrl = document.getElementById('ct-appsscript-url').value.trim();
  ctData.gmailSheetId = val;
  ctData.appsScriptUrl = scriptUrl;
  ctSave();
  notify(val ? 'Sheet connected' : 'Sheet disconnected');
  renderCtGmailPanel();
  if (val) ctFetchGmailInvoices();
}

function ctExportBackup() {
  const blob = new Blob([JSON.stringify(ctData, null, 2)], {type: 'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bloombooks-cost-tracker-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  notify('Cost tracker backup downloaded');
}

// ============================================================
// SUPPLIER NAMES
// ============================================================
// The parser reads the supplier off whatever the invoice header happens to say,
// and that wording moves -- 'Main Wholesale Florist NY' one week, 'MAIN
// WHOLESALE FLORIST' the next, 'DV Flora' against 'DVFlora'. Each variant
// became a separate supplier with its own price history and its own slice of
// every chart.
//
// Merging by hand fixed the invoices already saved and recorded NOTHING, so the
// next invoice recreated the variant and it had to be merged again. That is the
// reason it never stopped. Two changes: a name is resolved to one already known
// before an invoice is saved, and every merge is remembered so that pairing
// holds for good.

const CT_SUPPLIER_NOISE = /\b(inc|llc|ltd|co|corp|company|the|and|of|wholesale|florist|florists|floral|flower|flowers|supply|supplies|greenhouse|greenhouses|nursery|farm|farms|imports?|distributors?|group|usa|ny|nj|ct|pa)\b/g;

const ctSupplierNorm = s =>
  String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

// 'DV Flora' and 'DVFlora' differ only by a space, which no token rule catches.
const ctSupplierSquash = s => ctSupplierNorm(s).replace(/ /g, '');

// What is left once the words every florist's name contains are removed. A
// trailing 's' goes too, so Greenhouse and Greenhouses are one word.
function ctSupplierCore(s) {
  return new Set(ctSupplierNorm(s).replace(CT_SUPPLIER_NOISE, ' ')
    .split(/\s+/).filter(w => w.length >= 3).map(w => w.replace(/s$/, '')));
}

const ctSetsEqual = (a, b) => a.size === b.size && a.size > 0 && [...a].every(x => b.has(x));

// Safe enough to apply without asking: the distinctive part of the name is
// identical, only the boilerplate around it differs.
function ctSameSupplierStrong(a, b) {
  if (!a || !b) return false;
  if (ctSupplierNorm(a) === ctSupplierNorm(b)) return true;
  if (ctSupplierSquash(a) === ctSupplierSquash(b)) return true;
  return ctSetsEqual(ctSupplierCore(a), ctSupplierCore(b));
}

// Looser: one name's distinctive words are a subset of the other's. Good enough
// to SUGGEST, never to apply silently -- 'Main Wholesale' and 'Main St Nursery'
// would both reduce to {main}, and merging those would fuse two real suppliers
// and their price histories with no way back.
function ctSameSupplierLikely(a, b) {
  if (ctSameSupplierStrong(a, b)) return true;
  const A = ctSupplierCore(a), B = ctSupplierCore(b);
  if (!A.size || !B.size) return false;
  const [small, big] = A.size <= B.size ? [A, B] : [B, A];
  return [...small].every(x => big.has(x)) && [...small].some(x => x.length >= 4);
}

function ctSupplierAliases() {
  if (!ctData.supplierAliases) ctData.supplierAliases = {};
  return ctData.supplierAliases;
}

// Resolve a freshly parsed name to one already in use. Every invoice-creating
// path runs through this, so a variant never gets in rather than being cleaned
// up afterwards.
function ctCanonicalSupplier(name) {
  const raw = String(name || '').trim();
  if (!raw) return 'Unknown';
  const learned = ctSupplierAliases()[ctSupplierNorm(raw)];
  if (learned) return learned;
  // Prefer the spelling already used most, so the winner is stable rather than
  // whichever invoice happens to sit first in the array.
  const counts = {};
  ctData.invoices.forEach(i => { if (i.supplier) counts[i.supplier] = (counts[i.supplier] || 0) + 1; });
  const known = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  for (const k of known) {
    if (k !== raw && ctSameSupplierStrong(k, raw)) return k;
  }
  return raw;
}

// Pairs worth offering to merge: distinct names that are probably one supplier.
function ctSupplierSuggestions() {
  const counts = {};
  ctData.invoices.forEach(i => { if (i.supplier) counts[i.supplier] = (counts[i.supplier] || 0) + 1; });
  const names = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  const out = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      if (ctSameSupplierLikely(names[i], names[j])) {
        // The more-used spelling survives, so the merge moves the fewest rows.
        out.push({ keep: names[i], drop: names[j],
                   keepCount: counts[names[i]], dropCount: counts[names[j]],
                   strong: ctSameSupplierStrong(names[i], names[j]) });
      }
    }
  }
  return out;
}

function ctApplySuggestion(keep, drop) {
  ctMergeSupplierNames(drop, keep, true);
}

// The shared body: rename, then REMEMBER, which is the part that was missing.
function ctMergeSupplierNames(fromName, toName, skipConfirm) {
  if (!fromName || !toName || fromName === toName) return false;
  const count = ctData.invoices.filter(i => i.supplier === fromName).length;
  if (!skipConfirm && count === 0) { notify(`No invoices found under "${fromName}"`); return false; }
  if (!skipConfirm && !confirm(
      `This will permanently rename ${count} invoice${count !== 1 ? 's' : ''} from "${fromName}" to "${toName}". This can't be automatically undone. Continue?`)) return false;

  ctData.invoices.forEach(inv => { if (inv.supplier === fromName) inv.supplier = toName; });
  // Without this line the next invoice from that supplier recreates the variant
  // and the merge has to be done again -- which is what kept happening.
  ctSupplierAliases()[ctSupplierNorm(fromName)] = toName;
  ctSave();
  notify(`Merged "${fromName}" into "${toName}" — ${count} invoice${count !== 1 ? 's' : ''} updated, and remembered`);
  renderCtGmailPanel();
  renderCtDashboard();
  renderCtPrices();
  return true;
}

function renderCtSupplierSuggestions() {
  const el = document.getElementById('ct-supplier-suggestions');
  if (!el) return;
  const pairs = ctSupplierSuggestions();
  const learned = Object.keys(ctSupplierAliases()).length;
  const footer = learned
    ? `<div style="font-size:0.72rem;color:var(--mist);margin-top:8px">
         ${learned} pairing${learned === 1 ? '' : 's'} remembered — new invoices under those names are filed
         automatically. <a href="#" onclick="ctForgetSupplierAliases();return false"
         style="color:var(--blue-light)">Forget them</a>.</div>`
    : '';

  if (!pairs.length) {
    el.innerHTML = `<div style="font-size:0.75rem;color:var(--mist);margin-bottom:10px">
      No supplier names look like duplicates right now.${footer}</div>`;
    return;
  }
  el.innerHTML = `
    <div style="margin-bottom:12px;padding:10px 12px;border-radius:8px;background:#fff3cd;border:1px solid #ffc107">
      <strong style="font-size:0.8rem">${pairs.length === 1
        ? 'One name looks like a duplicate'
        : pairs.length + ' names look like duplicates'}</strong>
      <div style="font-size:0.72rem;color:var(--ink-soft);margin:2px 0 8px">
        The more-used spelling is kept, so the fewest invoices move. Check each one —
        two real suppliers can share a word.
      </div>
      ${pairs.map(p => `
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:4px 0">
          <button class="btn btn-primary btn-sm" style="font-size:0.72rem;padding:3px 10px"
                  onclick="ctApplySuggestion(${JSON.stringify(p.keep).replace(/"/g, '&quot;')}, ${JSON.stringify(p.drop).replace(/"/g, '&quot;')})">Merge</button>
          <span style="font-size:0.76rem">
            <strong>${escHtml(p.drop)}</strong> <span style="color:var(--mist)">(${p.dropCount})</span>
            → <strong>${escHtml(p.keep)}</strong> <span style="color:var(--mist)">(${p.keepCount})</span>
          </span>
          ${p.strong ? '' : '<span style="font-size:0.68rem;color:var(--mist)">· partial match, check it</span>'}
        </div>`).join('')}
      ${footer}
    </div>`;
}

function ctForgetSupplierAliases() {
  ctData.supplierAliases = {};
  ctSave();
  renderCtGmailPanel();
  notify('Supplier pairings forgotten');
}

function ctMergeSuppliers() {
  const fromName = document.getElementById('ct-merge-from')?.value;
  const toName = document.getElementById('ct-merge-to')?.value;
  if (!fromName || !toName) return;
  if (fromName === toName) { notify('Pick two different names to merge'); return; }

  ctMergeSupplierNames(fromName, toName);
}

function ctResetCostData() {
  const uploadCount = ctData.invoices.filter(i => i.id.startsWith('inv-') && !i.id.startsWith('inv-gmail-')).length;
  const gmailCount = ctData.invoices.length - uploadCount;

  const warning = uploadCount > 0
    ? `This will permanently delete ${uploadCount} manually-uploaded invoice${uploadCount!==1?'s':''} — there is NO other copy of these anywhere. ${gmailCount > 0 ? `The other ${gmailCount} Gmail-scanned invoice${gmailCount!==1?'s':''} can be re-pulled from the Sheet afterward.` : ''}\n\nDownload a backup first? Click Cancel to go back and use "Download Backup" if you're not sure.\n\nType-confirm: are you sure you want to permanently delete this data?`
    : `This will clear all cost tracker data. Gmail-scanned invoices can be re-pulled from the Sheet afterward.\n\nAre you sure you want to reset?`;

  if (!confirm(warning)) return;

  // Sheet connection, Apps Script URL, and your markup settings are preserved —
  // only invoice history, category memory, family memory, and retail prices are cleared.
  const keepSheetId = ctData.gmailSheetId;
  const keepAppsScriptUrl = ctData.appsScriptUrl;
  const keepMarkup = ctData.markup;

  ctData = {
    invoices: [], catalog: {}, retail: {}, family: {}, familyKeywords: {},
    markup: keepMarkup,
    gmailSheetId: keepSheetId, appsScriptUrl: keepAppsScriptUrl,
    importedGmailIds: []
  };
  ctSave();
  renderCtGmailPanel();
  renderCtDashboard();
  renderCtPrices();
  document.getElementById('ct-gmail-results').innerHTML = '';
  document.getElementById('ct-parse-area').innerHTML = '';
  notify('Cost tracker data reset — connection and markup settings kept');
}

function ctSaveMarkup() {
  CT_CATEGORIES.forEach(c => {
    const input = document.getElementById(`ct-markup-${c}`);
    const num = parseFloat(input?.value);
    ctData.markup[c] = isNaN(num) ? CT_DEFAULT_MARKUP[c] : num;
  });
  ctSave();
  notify('Markup saved');
}

// The Sheets API (with valueRenderOption=UNFORMATTED_VALUE) returns real date cells
// as a serial day-count (Sheets epoch = Dec 30, 1899), and text cells as plain strings.
// Handle both so this keeps working regardless of how the Apps Script wrote the cell.
function ctParseSheetsApiDate(raw) {
  if (raw === undefined || raw === null || raw === '') return new Date().toISOString().slice(0,10);
  if (typeof raw === 'number') {
    const ms = Date.UTC(1899, 11, 30) + raw * 86400000;
    return new Date(ms).toISOString().slice(0,10);
  }
  const s = String(raw).trim();
  const iso = s.match(/^\d{4}-\d{2}-\d{2}/);
  if (iso) return iso[0];
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0,10);
  return s.slice(0,10);
}

async function ctFetchGmailInvoices(silent) {
  if (!ctData.gmailSheetId) {
    if (!silent) notify('Connect a Google Sheet first (Setup section above)');
    return;
  }
  if (!accessToken) {
    if (!silent) notify('Sign in to BloomBooks first — the Gmail Scan sheet is read using your Google sign-in.');
    return;
  }
  const resultsEl = document.getElementById('ct-gmail-results');
  if (!silent && resultsEl) resultsEl.innerHTML = `<div style="font-size:0.82rem;color:var(--mist);padding:12px">Checking Sheet for new invoices...</div>`;

  try {
    // Authenticated read via the same Sheets API + token used for the main sync, instead of
    // the old anonymous gviz endpoint — this lets the sheet be shared only with your Google
    // account rather than requiring "Anyone with the link."
    const url = `${SHEETS_BASE}/${ctData.gmailSheetId}/values/${encodeURIComponent('Invoices!A1:Z5000')}?valueRenderOption=UNFORMATTED_VALUE`;
    const resp = await fetchRetry(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
    if (resp.status === 401) { handleAuthExpiry(); throw new Error('Your sign-in expired — sign in again, then retry the scan.'); }
    if (!resp.ok) throw new Error('Could not reach the Sheet — make sure the Sheet ID is correct and the sheet is shared with the Google account you sign into BloomBooks with.');
    const data = await resp.json();
    const allRows = data.values || [];
    if (allRows.length === 0) throw new Error('The "Invoices" sheet looks empty — nothing to scan yet.');

    const cols = allRows[0].map(c => String(c ?? '').trim());
    const idx = name => cols.indexOf(name);
    const rows = allRows.slice(1);

    const iMsgId = idx('MessageId'), iVendor = idx('Vendor'), iSupplier = idx('Supplier'),
          iDate = idx('Date'), iDeliveryDate = idx('DeliveryDate'), iDeliveryFee = idx('DeliveryFee'), iInvNum = idx('InvoiceNumber'), iTotal = idx('Total'), iItems = idx('ItemsJSON');

    const seen = new Set(ctData.importedGmailIds || []);
    const candidates = [];

    rows.forEach(r => {
      const messageId = r[iMsgId];
      if (!messageId || seen.has(messageId)) return;
      let items = [];
      try { items = JSON.parse(r[iItems] || '[]'); } catch(e) { return; }
      if (!items.length) return;
      const rawDeliveryDate = iDeliveryDate >= 0 ? r[iDeliveryDate] : null;
      candidates.push({
        messageId,
        vendor: r[iVendor] || '',
        supplier: ctCanonicalSupplier(r[iSupplier] || r[iVendor]),
        date: ctParseSheetsApiDate(r[iDate]),
        deliveryDate: rawDeliveryDate ? ctParseSheetsApiDate(rawDeliveryDate) : null,
        deliveryFee: iDeliveryFee >= 0 ? (parseFloat(r[iDeliveryFee]) || 0) : 0,
        invoiceNumber: r[iInvNum] || '',
        total: parseFloat(r[iTotal]) || items.reduce((s,i)=>s+(i.total||i.qty*i.unit_price||0),0),
        items
      });
    });

    ctData.gmailLastChecked = Date.now();
    ctSave();
    renderCtGmailPanel();

    if (candidates.length === 0) {
      if (!silent && resultsEl) resultsEl.innerHTML = `<div style="font-size:0.82rem;color:var(--mist);padding:12px">No new invoices found.</div>`;
      return;
    }

    if (silent) {
      notify(`${candidates.length} new invoice${candidates.length!==1?'s':''} found from Gmail scan`);
      switchPanel('ct-gmail'); // surface it rather than hide a silent find
    }
    ctShowGmailResults(candidates);

  } catch(err) {
    ctData.gmailLastChecked = Date.now();
    ctSave();
    if (resultsEl) resultsEl.innerHTML = `<div style="font-size:0.82rem;color:var(--red);padding:12px">⚠️ ${err.message}</div>`;
  }
}

// True when we know enough to price this item per-stem rather than per-bunch
// (only applies when uom is Bunch AND a stem count was actually captured)
function ctIsPerStem(item) {
  return item.uom === 'Bunch' && item.stemsPerBu && item.stemsPerBu > 0;
}

function ctSuggestedRetail(item) {
  const markup = ctData.markup[item.category] ?? CT_DEFAULT_MARKUP[item.category] ?? 2;
  const unitPrice = item.unit_price ?? item.unitPrice ?? 0;
  if (ctIsPerStem(item)) {
    return (unitPrice / item.stemsPerBu) * markup; // per-stem suggested retail
  }
  return unitPrice * markup; // per-bunch/each/etc, as invoiced
}

function ctRetailFlag(item) {
  const key = ctCatalogKey(item.name);
  const stored = ctData.retail[key];
  const suggested = ctSuggestedRetail(item);
  const unitLabel = ctIsPerStem(item) ? '/stem' : `/${escHtml(item.uom||'unit')}`;
  if (stored === undefined) {
    return `<input type="number" step="0.01" placeholder="set retail${unitLabel}" data-retail-key="${key}" style="width:90px;font-size:0.75rem" title="Suggested: $${suggested.toFixed(2)}${unitLabel}">`;
  }
  const diff = Math.abs(stored - suggested);
  if (diff < 0.01) return `<span style="font-size:0.72rem;color:var(--mist)">$${stored.toFixed(2)}${unitLabel} ✓</span>`;
  return `<span class="ct-flag ${suggested > stored ? 'up' : 'down'}" title="Currently $${stored.toFixed(2)}${unitLabel}">→ $${suggested.toFixed(2)}${unitLabel}?</span>`;
}

function ctShowGmailResults(candidates) {
  window._ctGmailPending = candidates.map(inv => ({
    ...inv,
    items: inv.items.map(item => ({ ...item, category: ctGuessCategory(item.name), family: ctGuessFamily(item.name), stemsPerBu: item.stems_per_bunch || ctGetPriorStemsPerBunch(item.name) || null, removed: false }))
  }));

  const el = document.getElementById('ct-gmail-results');
  el.innerHTML = ctFamilyDatalist() + window._ctGmailPending.map((inv, invIdx) => ctBuildGmailCardHtml(inv, invIdx)).join('')
    + `<div style="font-size:0.72rem;color:var(--mist);margin-top:4px;padding:0 4px">
    💡 Retail flags only appear once you've set a price for that item at least once. Family/Type learns by the item's first word, so tagging one variant applies to future ones too. Remove any line items that don't belong (like a standing order) before saving.
  </div>`;
}

function ctBuildGmailCardHtml(inv, invIdx) {
  const activeItems = inv.items.filter(i=>!i.removed);
  const itemsTotal = activeItems.reduce((s,i)=>s+(i.total||i.qty*i.unit_price),0);
  const deliveryFee = inv.deliveryFee || 0;
  const activeTotal = itemsTotal + deliveryFee;
  const removedCount = inv.items.length - activeItems.length;

  const rows = inv.items.map((item, itemIdx) => {
    if (item.removed) {
      return `<div class="ct-item-row" style="opacity:0.5">
        <div class="ct-item-name" style="text-decoration:line-through">${escHtml(item.name)}</div>
        <div class="ct-item-meta" style="grid-column: span 4; text-align:right">
          <button class="btn btn-outline btn-sm" onclick="ctRestoreGmailItem(${invIdx}, ${itemIdx})" style="font-size:0.7rem;padding:2px 8px">Undo remove</button>
        </div>
      </div>`;
    }
    const stemsInput = item.uom === 'Bunch'
      ? `<input type="number" min="1" placeholder="stems/bu" value="${item.stemsPerBu||''}" onchange="ctUpdateGmailStemsPerBu(${invIdx}, ${itemIdx}, this.value)" style="font-size:0.7rem;padding:2px 4px;width:60px" title="Stems per bunch, if known — enables per-stem pricing">`
      : '';
    return `<div class="ct-item-row">
      <div class="ct-item-name">${escHtml(item.name)}</div>
      <div class="ct-item-meta">${item.qty} ${item.uom}${stemsInput ? ' '+stemsInput : ''}</div>
      <div class="ct-item-cat">
        <select onchange="ctUpdateGmailItemCat(${invIdx}, ${itemIdx}, this.value)">
          ${CT_CATEGORIES.map(c => `<option value="${c}" ${c===item.category?'selected':''}>${c}</option>`).join('')}
        </select>
      </div>
      <div class="ct-item-family">
        <input type="text" list="ct-family-list" placeholder="Family/Type" value="${escHtml(item.family)}" onchange="ctUpdateGmailItemFamily(${invIdx}, ${itemIdx}, this.value)" style="font-size:0.75rem;padding:4px 6px;width:100px">
      </div>
      <div class="ct-item-price">$${(item.unit_price||0).toFixed(2)}</div>
      <div class="ct-item-total" style="min-width:100px;text-align:right">${ctRetailFlag(item)}
        <button onclick="ctRemoveGmailItem(${invIdx}, ${itemIdx})" title="Remove this item" style="border:none;background:none;color:var(--mist);cursor:pointer;font-size:0.9rem;padding:0 0 0 6px">✕</button>
      </div>
    </div>`;
  }).join('');

  return `<div class="ct-parse-result" style="margin-bottom:14px" data-gmail-inv="${invIdx}">
    <div class="ct-parse-header">
      <div>
        <h3>${escHtml(inv.supplier)} — ${escHtml(inv.date)}</h3>
        <div style="font-size:0.72rem;color:var(--mist);margin-top:2px">${activeItems.length} items${removedCount?` (${removedCount} removed)`:''} · ${escHtml(inv.vendor)}${inv.invoiceNumber ? ' · #'+escHtml(inv.invoiceNumber) : ''}</div>
        <div style="margin-top:6px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <label style="font-size:0.7rem;color:var(--mist)">Delivery/charge date${inv.deliveryDate?' (auto-detected)':' (not found — edit if charged on delivery)'}:</label>
          <input type="date" value="${escHtml(inv.deliveryDate||'')}" onchange="ctUpdateGmailDeliveryDate(${invIdx}, this.value)" style="font-size:0.72rem;padding:3px 6px">
          <label style="font-size:0.7rem;color:var(--mist);margin-left:8px">Delivery fee:</label>
          <input type="number" step="0.01" value="${deliveryFee}" onchange="ctUpdateGmailDeliveryFee(${invIdx}, this.value)" style="font-size:0.72rem;padding:3px 6px;width:70px">
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <span style="font-size:0.85rem;font-weight:600">$${activeTotal.toFixed(2)}</span>
        <button class="btn btn-primary btn-sm" onclick="ctSaveGmailInvoice(${invIdx})">Save</button>
        <button class="btn btn-outline btn-sm" onclick="ctDiscardGmailInvoice(${invIdx})">Discard</button>
      </div>
    </div>
    <div style="padding:8px 18px;background:var(--paper);border-bottom:1px solid var(--border);display:flex;gap:16px;font-size:0.68rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--mist)">
      <span style="flex:2">Item</span><span style="flex:1">Qty</span><span style="flex:1">Category</span><span style="min-width:100px">Family/Type</span><span style="min-width:70px;text-align:right">Cost</span><span style="min-width:100px;text-align:right">Retail</span>
    </div>
    ${rows}
    ${deliveryFee > 0 ? `<div style="padding:6px 18px;font-size:0.75rem;color:var(--mist);border-top:1px dashed var(--border)">+ Delivery fee: $${deliveryFee.toFixed(2)}</div>` : ''}
  </div>`;
}

function ctUpdateGmailDeliveryFee(invIdx, val) {
  if (!window._ctGmailPending) return;
  window._ctGmailPending[invIdx].deliveryFee = parseFloat(val) || 0;
}

function ctUpdateGmailStemsPerBu(invIdx, itemIdx, val) {
  if (!window._ctGmailPending) return;
  const num = parseInt(val);
  window._ctGmailPending[invIdx].items[itemIdx].stemsPerBu = (num && num > 0) ? num : null;
}

function ctRerenderGmailCard(invIdx) {
  const inv = window._ctGmailPending?.[invIdx];
  if (!inv) return;
  const existing = document.querySelector(`[data-gmail-inv="${invIdx}"]`);
  if (!existing) return;
  existing.outerHTML = ctBuildGmailCardHtml(inv, invIdx);
}

function ctUpdateGmailDeliveryDate(invIdx, dateVal) {
  if (!window._ctGmailPending) return;
  window._ctGmailPending[invIdx].deliveryDate = dateVal || null;
}

function ctUpdateGmailItemCat(invIdx, itemIdx, category) {
  if (!window._ctGmailPending) return;
  window._ctGmailPending[invIdx].items[itemIdx].category = category;
}

function ctUpdateGmailItemFamily(invIdx, itemIdx, family) {
  if (!window._ctGmailPending) return;
  window._ctGmailPending[invIdx].items[itemIdx].family = family.trim();
}

function ctRemoveGmailItem(invIdx, itemIdx) {
  if (!window._ctGmailPending) return;
  window._ctGmailPending[invIdx].items[itemIdx].removed = true;
  ctRerenderGmailCard(invIdx);
}

function ctRestoreGmailItem(invIdx, itemIdx) {
  if (!window._ctGmailPending) return;
  window._ctGmailPending[invIdx].items[itemIdx].removed = false;
  ctRerenderGmailCard(invIdx);
}

function ctSaveGmailInvoice(invIdx) {
  if (!window._ctGmailPending) return;
  const pending = window._ctGmailPending[invIdx];
  if (!pending) return;
  const active = pending.items.filter(i => !i.removed);
  if (active.length === 0) {
    notify('Nothing to save — all items were removed');
    return;
  }

  const card = document.querySelector(`[data-gmail-inv="${invIdx}"]`);

  // Pick up any retail prices typed into this card's inputs
  card?.querySelectorAll('[data-retail-key]').forEach(inp => {
    const val = parseFloat(inp.value);
    if (!isNaN(val) && val > 0) ctData.retail[inp.dataset.retailKey] = val;
  });

  const itemsTotal = active.reduce((s,i)=>s+(i.total||i.qty*i.unit_price),0);
  const deliveryFee = pending.deliveryFee || 0;
  // If items were removed, the vendor's stated total no longer applies — use the recalculated one
  const useTotal = (active.length === pending.items.length ? pending.total : itemsTotal) + deliveryFee;

  const invoice = {
    id: 'inv-gmail-' + pending.messageId,
    date: pending.date,
    deliveryDate: pending.deliveryDate || null,
    deliveryFee,
    supplier: ctCanonicalSupplier(pending.supplier),
    invoiceNumber: pending.invoiceNumber,
    total: useTotal,
    items: active.map(i => ({
      name: i.name, category: i.category, family: i.family || '', qty: i.qty, uom: i.uom,
      unitPrice: i.unit_price, stemsPerBu: i.stemsPerBu || null, total: i.total || i.qty * i.unit_price
    }))
  };

  active.forEach(i => {
    ctLearnCategory(i.name, i.category);
    if (i.family) ctLearnFamily(i.name, i.family);
  });

  ctData.invoices.push(invoice);
  ctData.importedGmailIds = ctData.importedGmailIds || [];
  ctData.importedGmailIds.push(pending.messageId);
  ctSave();

  if (card) card.remove();
  notify(`Invoice from ${invoice.supplier} saved`);
  renderCtDashboard();
  renderCtPrices();
}

function ctDiscardGmailInvoice(invIdx) {
  if (!window._ctGmailPending) return;
  const pending = window._ctGmailPending[invIdx];
  if (!pending) return;
  // Mark as seen so it doesn't reappear on next check, without adding it to cost data
  ctData.importedGmailIds = ctData.importedGmailIds || [];
  ctData.importedGmailIds.push(pending.messageId);
  ctSave();
  document.querySelector(`[data-gmail-inv="${invIdx}"]`)?.remove();
}

function ctDashPeriodChanged() {
  const period = document.getElementById('ct-dash-period')?.value;
  document.getElementById('ct-dash-month-wrap').style.display = period === 'month' ? '' : 'none';
  document.getElementById('ct-dash-range-wrap').style.display = period === 'range' ? '' : 'none';
  document.getElementById('ct-dash-range-wrap2').style.display = period === 'range' ? '' : 'none';
  renderCtDashboard();
}

// --- Dashboard ---
function ctGetFilteredInvoices() {
  const period = document.getElementById('ct-dash-period')?.value || 'ytd';
  const supplier = document.getElementById('ct-dash-supplier')?.value || 'all';
  const now = new Date();
  let invoices = [...ctData.invoices];

  if (supplier !== 'all') invoices = invoices.filter(i => i.supplier === supplier);

  if (period === 'ytd') {
    const yr = now.getFullYear();
    invoices = invoices.filter(i => ctEffDate(i) && ctEffDate(i).startsWith(String(yr)));
  } else if (period === '30') {
    const cutoff = new Date(now - 30*864e5).toISOString().slice(0,10);
    invoices = invoices.filter(i => ctEffDate(i) >= cutoff);
  } else if (period === '90') {
    const cutoff = new Date(now - 90*864e5).toISOString().slice(0,10);
    invoices = invoices.filter(i => ctEffDate(i) >= cutoff);
  } else if (period === 'month') {
    const monthVal = document.getElementById('ct-dash-month')?.value; // "YYYY-MM"
    if (monthVal) invoices = invoices.filter(i => ctEffDate(i) && ctEffDate(i).startsWith(monthVal));
  } else if (period === 'range') {
    const start = document.getElementById('ct-dash-start')?.value;
    const end = document.getElementById('ct-dash-end')?.value;
    if (start) invoices = invoices.filter(i => ctEffDate(i) >= start);
    if (end) invoices = invoices.filter(i => ctEffDate(i) <= end);
  }
  return invoices;
}

// ============================================================
// STANDING ORDERS
// ============================================================
// A supplier that emails its invoices gets scanned automatically. The Perri
// standing order arrives on paper with the delivery, so it has to be entered by
// hand every week -- the same items, the same quantities, only the prices move.
//
// A template holds the item list. It does NOT hold prices: starting one pulls
// each item's most recent actual price, and the result lands in the ordinary
// review card, where the figures must be checked against the paper before
// anything saves. That distinction is the whole safety of it -- the tracker
// exists to record what things really cost, so no price may enter it unseen.
// What a template removes is the typing, not the checking.

function ctTemplates() {
  if (!ctData.templates) ctData.templates = [];
  return ctData.templates;
}

function ctSaveAsTemplate(idx) {
  const p = window._ctUploadPending[idx];
  if (!p || p.status !== 'ready') return;
  const active = p.enriched.filter(i => !i.removed);
  if (!active.length) { notify('Nothing to save as a template'); return; }
  const name = prompt('Name this standing order', `${p.parsed.supplier || 'Supplier'} standing order`);
  if (!name) return;
  ctTemplates().push({
    id: 'tpl-' + Date.now(),
    name,
    supplier: p.parsed.supplier || 'Unknown',
    deliveryFee: p.deliveryFee || 0,
    items: active.map(i => ({ name: i.name, category: i.category, family: i.family || '',
                              qty: i.qty, uom: i.uom, stemsPerBu: i.stemsPerBu || null,
                              discountPct: ctLineDiscount(i) })),
  });
  ctSave();
  renderCtTemplates();
  notify(`Saved "${name}" — start it from the Upload tab each week`);
}

function ctDeleteTemplate(id) {
  const t = ctTemplates().find(x => x.id === id);
  if (!t || !confirm(`Delete the standing order "${t.name}"? Invoices already saved from it are untouched.`)) return;
  ctData.templates = ctTemplates().filter(x => x.id !== id);
  ctSave();
  renderCtTemplates();
}

function ctStartFromTemplate(id) {
  const t = ctTemplates().find(x => x.id === id);
  if (!t) return;
  const today = new Date().toISOString().slice(0, 10);
  // Prices come from the latest real invoice for each item, never from the
  // template, so the starting figures are the last thing actually paid rather
  // than whatever was true when the template was made. Anything never seen
  // before starts at 0, which reads as "fill this in" instead of a wrong guess.
  const enriched = t.items.map(i => {
    const prior = ctGetPriorPrice(i.name, t.supplier);   // a number, or null
    const unit = prior || 0;
    const disc = i.discountPct || 0;
    return { name: i.name, qty: i.qty, uom: i.uom, unit_price: unit,
             total: i.qty * unit * (1 - disc / 100),
             category: i.category || ctGuessCategory(i.name),
             family: i.family || ctGuessFamily(i.name),
             priorPrice: prior,
             stemsPerBu: i.stemsPerBu || ctGetPriorStemsPerBunch(i.name) || null,
             removed: false };
  });
  window._ctUploadPending.push({
    status: 'ready',
    filename: t.name,
    fromTemplate: true,
    parsed: { supplier: ctCanonicalSupplier(t.supplier), date: today, invoice_number: '', total: null,
              items: enriched.map(i => ({ name: i.name, qty: i.qty, uom: i.uom, unit_price: i.unit_price })) },
    enriched,
    deliveryDate: today,
    deliveryFee: t.deliveryFee || 0,
  });
  ctRenderUploadArea();
  notify(`Started "${t.name}" — check every price against the paper before saving`);
}

function renderCtTemplates() {
  const el = document.getElementById('ct-templates');
  if (!el) return;
  const tpls = ctTemplates();
  if (!tpls.length) {
    el.innerHTML = `<div style="font-size:0.72rem;color:var(--mist);margin:10px 0 0">
      Have a delivery whose invoice never arrives by email? Upload one, then press
      <em>Save as standing order</em> on the review card — after that it starts pre-filled each week.</div>`;
    return;
  }
  el.innerHTML = `
    <div style="margin:14px 0 0;padding:10px 12px;border-radius:8px;background:var(--paper);border:1px solid var(--border)">
      <strong style="font-size:0.8rem">Standing orders</strong>
      <div style="font-size:0.72rem;color:var(--ink-soft);margin:2px 0 8px">
        Starts pre-filled at the last price actually paid. Check every figure against the paper — nothing saves until you do.
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${tpls.map(t => `
          <span style="display:inline-flex;align-items:center;gap:6px;border:1px solid var(--border);
                       border-radius:6px;padding:4px 6px 4px 10px;background:var(--surface)">
            <button class="btn btn-primary btn-sm" style="font-size:0.72rem;padding:3px 10px"
                    onclick="ctStartFromTemplate('${escHtml(t.id)}')">
              ${escHtml(t.name)} <span style="opacity:.7">· ${t.items.length} items</span>
            </button>
            <button onclick="ctDeleteTemplate('${escHtml(t.id)}')" title="Delete this standing order"
                    style="border:none;background:none;color:var(--mist);cursor:pointer;font-size:0.85rem">✕</button>
          </span>`).join('')}
      </div>
    </div>`;
}

// ============================================================
// PAYMENTS WITH NO INVOICE
// ============================================================
// The Gmail scan catches whatever a supplier emails. It cannot catch what
// arrives on paper with the delivery -- the Perri standing order -- or what is
// bought at retail. Those stay invisible until a month is totalled and the
// dashboard comes up short against the ledger's COGS. July 2026 was short
// $2,046.71 that way.
//
// The tempting fix is to generate the recurring invoice from a template on a
// schedule. That would put invented unit prices into the price history this
// whole tracker exists to keep -- and a standing order is precisely where real
// price movement matters most, since it repeats. So instead: find the payments
// no invoice accounts for and ask for the upload. It catches every gap rather
// than only the recurring one.

const CT_LAG_BACK = 16;    // Fisch settles ~10 days after delivery; 16 covers it
const CT_LAG_FWD = 3;      // and a card can post before the paperwork is dated
const CT_GRACE_DAYS = 5;   // an invoice for a payment this recent may still arrive

// A bank line and an invoice name the same supplier differently: the statement
// says 'DELAWARE VALLEY FLORSEWELL', the invoice says 'DVFlora'. Compare on
// distinctive tokens, and keep an alias map for the pairs no rule can connect.
const CT_NAME_NOISE = /\b(inc|llc|co|corp|company|the|wholesale|florist|floral|flower|flowers|supply|supplies|farm|farms|of|and|ny|nj|ct)\b/g;

function ctNameTokens(name) {
  const raw = String(name || '').trim().toLowerCase();
  const alias = (ctData.vendorAliases || {})[raw];
  const base = String(alias || raw).replace(/[^a-z0-9 ]/g, ' ').replace(CT_NAME_NOISE, ' ');
  // Four characters and up: shorter fragments match each other by accident.
  return new Set(base.split(/\s+/).filter(w => w.length >= 4));
}

function ctSameVendor(a, b) {
  const A = ctNameTokens(a), B = ctNameTokens(b);
  for (const t of A) if (B.has(t)) return true;
  return false;
}

// Only payments from the tracker's own start date onwards. Flagging purchases
// made before there were any invoices to match would bury the real gaps under
// years of history.
function ctCogsPayments() {
  const txs = (typeof appData !== 'undefined' && appData.transactions) || {};
  const out = [];
  Object.keys(txs).forEach(k => (txs[k] || []).forEach(t => {
    if (!t._vault && t.type === 'out' && t.date &&
        t.category === 'Supplies & Materials - COGS') out.push(t);
  }));
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// A single card payment often settles several invoices at once -- one Perri
// payment of 660.92 was four of them -- so try combinations, smallest first.
// Stops at four: beyond that, with enough invoices in the window some
// combination always lands on the total and a match stops being evidence.
function ctFindSubset(items, target) {
  const n = items.length;
  for (let i = 0; i < n; i++) {
    if (items[i].c === target) return [items[i]];
  }
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (items[i].c + items[j].c === target) return [items[i], items[j]];
  }
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) {
    if (items[i].c + items[j].c + items[k].c === target) return [items[i], items[j], items[k]];
  }
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++)
    for (let l = k + 1; l < n; l++) {
      if (items[i].c + items[j].c + items[k].c + items[l].c === target)
        return [items[i], items[j], items[k], items[l]];
    }
  return null;
}

const ctCents = n => Math.round(Number(n || 0) * 100);
const ctShiftDay = (d, n) =>
  new Date(new Date(d + 'T00:00:00').getTime() + n * 864e5).toISOString().slice(0, 10);

function ctUnmatchedPayments() {
  const invoices = ctData.invoices.filter(i => ctEffDate(i));
  if (!invoices.length) return [];
  // Start at the month AFTER the first invoice, not the first invoice itself.
  // The month a capture habit begins is partial by definition -- June 2026 had
  // 25 unmatched payments for that reason alone, which would bury the real ones.
  const first = invoices.reduce((m, i) => ctEffDate(i) < m ? ctEffDate(i) : m, '9999-99-99');
  const start = ctData.reconcileFrom ||
    (first.slice(5, 7) === '12' ? `${+first.slice(0, 4) + 1}-01-01`
                                : `${first.slice(0, 4)}-${String(+first.slice(5, 7) + 1).padStart(2, '0')}-01`);
  const cutoff = ctShiftDay(new Date().toISOString().slice(0, 10), -CT_GRACE_DAYS);

  // An invoice may only settle one payment, so matches are consumed as they go.
  const pool = invoices.map(i => ({ d: ctEffDate(i), c: ctCents(i.total),
                                    sup: i.supplier, used: false }));
  const out = [];
  ctCogsPayments().forEach(t => {
    if (t.date < start || t.date > cutoff) return;
    if ((ctData.dismissedPayments || {})[t.id]) return;
    const lo = ctShiftDay(t.date, -CT_LAG_BACK), hi = ctShiftDay(t.date, CT_LAG_FWD);
    const name = t.vendor || t.desc;
    const cands = pool.filter(p => !p.used && p.d >= lo && p.d <= hi && ctSameVendor(name, p.sup));
    const hit = ctFindSubset(cands, ctCents(t.amount));
    if (hit) hit.forEach(p => { p.used = true; });
    else out.push(t);
  });
  return out;
}

function ctDismissPayment(id) {
  if (!ctData.dismissedPayments) ctData.dismissedPayments = {};
  ctData.dismissedPayments[id] = true;
  ctSave();
  renderCtMissingInvoices();
}

function ctRestoreDismissedPayments() {
  ctData.dismissedPayments = {};
  ctSave();
  renderCtMissingInvoices();
  notify('Dismissed payments restored');
}

// One-off pairing for names no token rule connects. Keyed on the bank's own
// spelling, so it applies to every future payment from that vendor.
function ctLinkVendor(id) {
  const t = ctCogsPayments().find(x => x.id === id);
  const sel = document.getElementById('ct-link-' + id);
  if (!t || !sel || !sel.value) return;
  if (!ctData.vendorAliases) ctData.vendorAliases = {};
  ctData.vendorAliases[String(t.vendor || t.desc || '').trim().toLowerCase()] = sel.value;
  ctSave();
  renderCtMissingInvoices();
  notify(`Bank name linked to ${sel.value}`);
}

function renderCtMissingInvoices() {
  const el = document.getElementById('ct-missing-invoices');
  if (!el) return;
  const dismissed = Object.keys(ctData.dismissedPayments || {}).length;
  const restore = dismissed
    ? ` <a href="#" onclick="ctRestoreDismissedPayments();return false" style="color:var(--blue-light)">Restore ${dismissed} dismissed</a>.`
    : '';
  let missing = [];
  try { missing = ctUnmatchedPayments(); }
  catch (e) { el.innerHTML = ''; return; }   // never take the dashboard down with it

  if (!missing.length) {
    el.innerHTML = `<div style="margin-bottom:16px;padding:10px 12px;border-radius:6px;
      background:var(--paper);border:1px solid var(--border);font-size:0.78rem;color:var(--mist)">
      Every COGS payment since ${escHtml(ctData.invoices.length ? 'the first invoice' : '')} has an invoice behind it.${restore}</div>`;
    return;
  }

  const total = missing.reduce((s, t) => s + t.amount, 0);
  const suppliers = [...new Set(ctData.invoices.map(i => i.supplier))].sort();
  el.innerHTML = `
    <div style="margin-bottom:16px;padding:12px 14px;border-radius:8px;
                background:#fff3cd;border:1px solid #ffc107">
      <strong style="font-size:0.85rem">${missing.length} payment${missing.length === 1 ? '' : 's'}
        with no invoice — ${fmt(total)}</strong>
      <div style="font-size:0.74rem;color:var(--ink-soft);margin:4px 0 10px">
        These left the bank but nothing was uploaded or scanned to account for them. Photograph
        the paper invoice and drop it in Upload — the parser reads a phone picture.
        Dismiss anything with no invoice to find, like a retail run or a delivery fee.${restore}
      </div>
      <div class="staging-table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Vendor</th><th style="text-align:right">Amount</th>
                     <th style="width:1%"></th></tr></thead>
          <tbody>
            ${missing.slice(0, 40).map(t => `
              <tr>
                <td style="white-space:nowrap">${escHtml(t.date)}</td>
                <td>${escHtml(String(t.vendor || t.desc || '').slice(0, 40))}</td>
                <td class="amount-out" style="text-align:right">${fmt(t.amount)}</td>
                <td style="white-space:nowrap">
                  <select id="ct-link-${escHtml(t.id)}" onchange="ctLinkVendor('${escHtml(t.id)}')"
                          style="font-size:0.7rem;padding:2px 4px;max-width:130px"
                          title="If this is a supplier you already have invoices from, link the names">
                    <option value="">link to…</option>
                    ${suppliers.map(s => `<option value="${escHtml(s)}">${escHtml(s)}</option>`).join('')}
                  </select>
                  <button class="btn btn-outline btn-sm" style="font-size:0.68rem;padding:2px 7px"
                          onclick="ctDismissPayment('${escHtml(t.id)}')">dismiss</button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${missing.length > 40 ? `<div style="font-size:0.72rem;color:var(--ink-soft);margin-top:6px">
        …and ${missing.length - 40} more.</div>` : ''}
    </div>`;
}

function renderCtDashboard() {
  renderCtMissingInvoices();
  const invoices = ctGetFilteredInvoices();

  // Populate supplier filter
  const supplierSel = document.getElementById('ct-dash-supplier');
  if (supplierSel) {
    const suppliers = [...new Set(ctData.invoices.map(i => i.supplier))].sort();
    const cur = supplierSel.value;
    supplierSel.innerHTML = `<option value="all">All Suppliers</option>` + suppliers.map(s => `<option value="${escHtml(s)}" ${s===cur?'selected':''}>${escHtml(s)}</option>`).join('');
  }

  // Spend by category
  const byCat = {};
  CT_CATEGORIES.forEach(c => byCat[c] = 0);
  const bySupplier = {};
  const byMonth = {};
  let deliveryFeeTotal = 0;

  invoices.forEach(inv => {
    bySupplier[inv.supplier] = (bySupplier[inv.supplier]||0) + inv.total;
    const mo = ctEffDate(inv) ? ctEffDate(inv).slice(0,7) : 'unknown';
    byMonth[mo] = (byMonth[mo]||0) + inv.total;
    deliveryFeeTotal += (inv.deliveryFee || 0);
    inv.items.forEach(item => {
      byCat[item.category] = (byCat[item.category]||0) + item.total;
    });
  });

  const grandTotal = Object.values(byCat).reduce((a,b)=>a+b,0) + deliveryFeeTotal;

  // Categories to actually display: any with real spend, including legacy ones
  // (e.g. old "Hardgoods" entries from before the category list changed) so nothing
  // silently vanishes from the breakdown just because the master list moved on.
  const displayCats = [...new Set([...CT_CATEGORIES, ...Object.keys(byCat)])].filter(c => byCat[c] > 0);

  // KPI row
  const kpiRow = document.getElementById('ct-kpi-row');
  if (kpiRow) {
    kpiRow.innerHTML = displayCats.map(c => `
      <div class="ct-kpi" style="border-left:3px solid ${CT_COLORS[c]||'#888899'}">
        <div class="kpi-label">${escHtml(c)}</div>
        <div class="kpi-value" style="font-size:1.3rem">$${(byCat[c]||0).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0})}</div>
        <div class="kpi-sub">${grandTotal > 0 ? ((byCat[c]||0)/grandTotal*100).toFixed(1)+'% of total' : '—'}</div>
      </div>`).join('') +
      (deliveryFeeTotal > 0 ? `
      <div class="ct-kpi" style="border-left:3px solid #999">
        <div class="kpi-label">Delivery Fees</div>
        <div class="kpi-value" style="font-size:1.3rem">$${deliveryFeeTotal.toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0})}</div>
        <div class="kpi-sub">${grandTotal > 0 ? (deliveryFeeTotal/grandTotal*100).toFixed(1)+'% of total' : '—'} · not tied to a category</div>
      </div>` : '') +
      `<div class="ct-kpi total">
        <div class="kpi-label">Total Spend</div>
        <div class="kpi-value" style="font-size:1.3rem">$${grandTotal.toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0})}</div>
        <div class="kpi-sub">${invoices.length} invoice${invoices.length!==1?'s':''}</div>
      </div>`;
  }

  // Category donut
  ctDestroyChart('ct-cat-chart');
  if (document.getElementById('ct-cat-chart')) {
    const nonZeroCats = displayCats;
    if (nonZeroCats.length > 0) {
      ctCharts['ct-cat-chart'] = new Chart(document.getElementById('ct-cat-chart'), {
        type: 'doughnut',
        data: {
          labels: nonZeroCats,
          datasets: [{ data: nonZeroCats.map(c => byCat[c]), backgroundColor: nonZeroCats.map(c => CT_COLORS[c]||'#888'), borderWidth: 2, borderColor: '#fff' }]
        },
        options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'right', labels:{ font:{size:11}, boxWidth:12 } } } }
      });
    }
  }

  // Supplier bar
  ctDestroyChart('ct-supplier-chart');
  if (document.getElementById('ct-supplier-chart')) {
    const suppliers = Object.entries(bySupplier).sort((a,b)=>b[1]-a[1]);
    if (suppliers.length > 0) {
      ctCharts['ct-supplier-chart'] = new Chart(document.getElementById('ct-supplier-chart'), {
        type: 'bar',
        data: {
          labels: suppliers.map(s=>s[0]),
          datasets: [{ data: suppliers.map(s=>s[1]), backgroundColor: '#4a4a8a', borderRadius:4, borderSkipped:'bottom' }]
        },
        options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label: ctx => ' $'+Math.round(ctx.parsed.y).toLocaleString() } } }, scales:{ x:{ ticks:{font:{size:11},color:'#888'}, grid:{display:false} }, y:{ ticks:{ callback: v=>'$'+(v/1000).toFixed(0)+'k', font:{size:11}, color:'#888' }, grid:{color:'#e8e8f0'} } } }
      });
    }
  }

  // Monthly trend line
  ctDestroyChart('ct-trend-chart');
  if (document.getElementById('ct-trend-chart')) {
    const months = Object.keys(byMonth).sort();
    if (months.length > 0) {
      ctCharts['ct-trend-chart'] = new Chart(document.getElementById('ct-trend-chart'), {
        type: 'bar',
        data: {
          labels: months,
          datasets: [{ label: 'Purchasing Spend', data: months.map(m=>byMonth[m]), backgroundColor: '#4a4a8a', borderRadius:4, borderSkipped:'bottom' }]
        },
        options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label: ctx => ' $'+Math.round(ctx.parsed.y).toLocaleString() } } }, scales:{ x:{ ticks:{font:{size:11},color:'#888',maxRotation:45}, grid:{display:false} }, y:{ ticks:{ callback: v=>'$'+(v/1000).toFixed(0)+'k', font:{size:11}, color:'#888' }, grid:{color:'#e8e8f0'} } } }
      });
    }
  }

  // Price alerts
  const alertsBody = document.getElementById('ct-alerts-body');
  if (alertsBody) {
    const alerts = ctBuildAlerts();
    if (alerts.length === 0) {
      alertsBody.innerHTML = invoices.length === 0
        ? `<div class="empty-state"><div class="empty-icon">🌱</div>No invoices processed yet</div>`
        : `<div class="empty-state"><div class="empty-icon">✓</div>No significant price changes detected</div>`;
    } else {
      alertsBody.innerHTML = alerts.slice(0,10).map(a => `
        <div class="ct-item-row">
          <div class="ct-item-name">${escHtml(a.name)}</div>
          <div class="ct-item-meta">${escHtml(a.supplier)}</div>
          <div class="ct-item-cat"><span class="badge">${escHtml(a.category)}</span></div>
          <div class="ct-item-price">$${a.current.toFixed(2)} <span class="ct-flag ${a.dir}">${a.dir==='up'?'▲':'▼'}${Math.abs(a.pct).toFixed(0)}%</span></div>
          <div class="ct-item-total" style="color:var(--mist)">was $${a.prior.toFixed(2)}</div>
        </div>`).join('');
    }
  }

  // Invoice list — search, filter, and pagination live in their own function
  ctRenderInvoiceList();

  renderCtMargin(invoices);
  renderCtBudget();
  renderCtStaleMargin();
}

function renderCtMargin(invoices) {
  const el = document.getElementById('ct-margin-body');
  if (!el) return;

  let costWithRetail = 0, revenueWithRetail = 0, costWithoutRetail = 0, itemCount = 0, itemsWithRetail = 0;
  const byCat = {};
  const byItem = {};

  invoices.forEach(inv => {
    inv.items.forEach(item => {
      itemCount++;
      const key = ctCatalogKey(item.name);
      const retail = ctData.retail[key];
      if (retail !== undefined) {
        itemsWithRetail++;
        // When stems-per-bunch is known, retail is priced per stem — so the sellable
        // quantity is qty × stems, not just qty bunches
        const effectiveUnits = ctIsPerStem(item) ? item.qty * item.stemsPerBu : item.qty;
        const rev = retail * effectiveUnits;
        costWithRetail += item.total;
        revenueWithRetail += rev;
        if (!byCat[item.category]) byCat[item.category] = { cost: 0, revenue: 0 };
        byCat[item.category].cost += item.total;
        byCat[item.category].revenue += rev;
        if (!byItem[key]) byItem[key] = { name: item.name, category: item.category, cost: 0, revenue: 0 };
        byItem[key].cost += item.total;
        byItem[key].revenue += rev;
      } else {
        costWithoutRetail += item.total;
      }
    });
  });

  const coverage = itemCount > 0 ? (itemsWithRetail/itemCount*100) : 0;

  if (itemsWithRetail === 0) {
    el.innerHTML = `<div class="empty-state" style="padding:20px"><div class="empty-icon">🏷️</div>No retail prices set yet for this period's items — set some on Upload/Gmail Scan review cards or Price History to see potential margin.</div>`;
    return;
  }

  const marginDollar = revenueWithRetail - costWithRetail;
  const marginPct = revenueWithRetail > 0 ? (marginDollar/revenueWithRetail*100) : 0;

  const catRows = Object.entries(byCat)
    .map(([cat, v]) => ({ cat, margin: v.revenue - v.cost, pct: v.revenue>0 ? (v.revenue-v.cost)/v.revenue*100 : 0, ...v }))
    .sort((a,b)=>b.margin-a.margin)
    .map(c => `<div style="display:flex;gap:12px;font-size:0.78rem;padding:5px 0;align-items:center">
      <span style="flex:1">${escHtml(c.cat)}</span>
      <span style="color:var(--mist);min-width:80px;text-align:right">cost $${c.cost.toFixed(0)}</span>
      <span style="color:var(--mist);min-width:90px;text-align:right">retail $${c.revenue.toFixed(0)}</span>
      <span style="min-width:90px;text-align:right;font-weight:600;color:${c.margin>=0?'var(--green)':'var(--red)'}">$${c.margin.toFixed(0)} (${c.pct.toFixed(0)}%)</span>
    </div>`).join('');

  // Highest/lowest margin items, ranked by margin % — only among items with a retail price set
  const itemRanked = Object.values(byItem)
    .map(v => ({ ...v, margin: v.revenue - v.cost, pct: v.revenue>0 ? (v.revenue-v.cost)/v.revenue*100 : 0 }))
    .sort((a,b)=>b.pct-a.pct);

  const rankRow = it => `<div style="display:flex;gap:12px;font-size:0.78rem;padding:5px 0;align-items:center;cursor:pointer" onclick="ctJumpToPriceHistory('${it.name.replace(/'/g,"\\'")}')" title="Click to view/edit in Price History">
    <span style="flex:1;text-decoration:underline;text-decoration-style:dotted">${escHtml(it.name)} <span class="badge" style="font-size:0.62rem">${escHtml(it.category)}</span></span>
    <span style="color:var(--mist);min-width:70px;text-align:right">cost $${it.cost.toFixed(0)}</span>
    <span style="min-width:80px;text-align:right;font-weight:600;color:${it.margin>=0?'var(--green)':'var(--red)'}">${it.pct.toFixed(0)}%</span>
  </div>`;

  const marginRanking = itemRanked.length > 1 ? `
    <div style="display:flex;gap:20px;margin-top:16px;flex-wrap:wrap">
      <div style="flex:1;min-width:260px">
        <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--mist);margin-bottom:6px">🏆 Highest Margin</div>
        ${itemRanked.slice(0,5).map(rankRow).join('')}
      </div>
      <div style="flex:1;min-width:260px">
        <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--mist);margin-bottom:6px">⚠️ Lowest Margin</div>
        ${itemRanked.slice(-5).reverse().map(rankRow).join('')}
      </div>
    </div>` : '';

  el.innerHTML = `
    <div style="display:flex;gap:24px;margin-bottom:14px;flex-wrap:wrap">
      <div><div style="font-size:0.68rem;text-transform:uppercase;color:var(--mist)">Potential Revenue</div><div style="font-size:1.3rem;font-weight:600">$${revenueWithRetail.toLocaleString('en-US',{maximumFractionDigits:0})}</div></div>
      <div><div style="font-size:0.68rem;text-transform:uppercase;color:var(--mist)">Cost</div><div style="font-size:1.3rem;font-weight:600">$${costWithRetail.toLocaleString('en-US',{maximumFractionDigits:0})}</div></div>
      <div><div style="font-size:0.68rem;text-transform:uppercase;color:var(--mist)">Potential Margin</div><div style="font-size:1.3rem;font-weight:600;color:${marginDollar>=0?'var(--green)':'var(--red)'}">$${marginDollar.toLocaleString('en-US',{maximumFractionDigits:0})} (${marginPct.toFixed(0)}%)</div></div>
    </div>
    <div style="font-size:0.72rem;color:var(--mist);margin-bottom:12px">Based on ${itemsWithRetail} of ${itemCount} items (${coverage.toFixed(0)}%) that have a retail price set. ${costWithoutRetail>0?`$${costWithoutRetail.toFixed(0)} in costs excluded — no retail price on file yet.`:''}</div>
    ${catRows}
    ${marginRanking}`;
}

function renderCtBudget() {
  const el = document.getElementById('ct-budget-body');
  if (!el) return;

  const period = document.getElementById('ct-dash-period')?.value;
  if (period !== 'month') {
    el.innerHTML = `<div style="font-size:0.78rem;color:var(--mist);padding:8px 0">Select "Specific Month" in the Period filter above to see this month compared against its historical baseline.</div>`;
    return;
  }
  const monthVal = document.getElementById('ct-dash-month')?.value; // "YYYY-MM"
  if (!monthVal) { el.innerHTML = `<div style="font-size:0.78rem;color:var(--mist);padding:8px 0">Pick a month above.</div>`; return; }

  const [selYear, selMonth] = monthVal.split('-');
  const actual = ctData.invoices
    .filter(inv => ctEffDate(inv) && ctEffDate(inv).startsWith(monthVal))
    .reduce((s,inv)=>s+inv.total, 0);

  // Baseline: average spend in this same calendar month across all OTHER years on file
  const priorYearsTotals = {};
  ctData.invoices.forEach(inv => {
    const d = ctEffDate(inv);
    if (!d) return;
    const [yr, mo] = d.split('-');
    if (mo === selMonth && yr !== selYear) {
      priorYearsTotals[yr] = (priorYearsTotals[yr]||0) + inv.total;
    }
  });
  const priorYears = Object.keys(priorYearsTotals);

  if (priorYears.length === 0) {
    el.innerHTML = `<div style="font-size:0.78rem;color:var(--mist);padding:8px 0">No prior-year data for this month yet — baseline will appear automatically once you have history from at least one previous ${new Date(monthVal+'-01').toLocaleString('en-US',{month:'long'})}. This month's actual spend so far: <strong>$${actual.toLocaleString('en-US',{maximumFractionDigits:0})}</strong></div>`;
    return;
  }

  const baseline = Object.values(priorYearsTotals).reduce((a,b)=>a+b,0) / priorYears.length;
  const diff = actual - baseline;
  const diffPct = baseline > 0 ? (diff/baseline*100) : 0;
  const monthName = new Date(monthVal+'-01').toLocaleString('en-US',{month:'long'});

  el.innerHTML = `
    <div style="display:flex;gap:24px;margin-bottom:10px;flex-wrap:wrap">
      <div><div style="font-size:0.68rem;text-transform:uppercase;color:var(--mist)">${monthName} ${selYear} Actual</div><div style="font-size:1.3rem;font-weight:600">$${actual.toLocaleString('en-US',{maximumFractionDigits:0})}</div></div>
      <div><div style="font-size:0.68rem;text-transform:uppercase;color:var(--mist)">Baseline (avg of ${priorYears.length} prior ${monthName}${priorYears.length!==1?'s':''}: ${priorYears.join(', ')})</div><div style="font-size:1.3rem;font-weight:600">$${baseline.toLocaleString('en-US',{maximumFractionDigits:0})}</div></div>
      <div><div style="font-size:0.68rem;text-transform:uppercase;color:var(--mist)">vs Baseline</div><div style="font-size:1.3rem;font-weight:600;color:${diff>0?'var(--red)':'var(--green)'}">${diff>=0?'+':''}$${diff.toLocaleString('en-US',{maximumFractionDigits:0})} (${diffPct>=0?'+':''}${diffPct.toFixed(0)}%)</div></div>
    </div>`;
}

function ctGetStaleMargins() {
  const stale = [];
  Object.entries(ctData.retail).forEach(([key, retailPrice]) => {
    // Find the most recent purchase of this item, across all invoices
    let latest = null;
    for (let i = ctData.invoices.length - 1; i >= 0; i--) {
      const match = ctData.invoices[i].items.find(it => ctCatalogKey(it.name) === key);
      if (match) { latest = match; break; }
    }
    if (!latest) return;
    const suggested = ctSuggestedRetail(latest);
    const diff = Math.abs(suggested - retailPrice);
    const diffPct = retailPrice > 0 ? (diff/retailPrice*100) : 0;
    if (diffPct < 10) return;

    // Dismissed items stay hidden ONLY while the suggested price matches what was
    // dismissed. If cost moves again and produces a different suggestion, that's a
    // genuinely new discrepancy, so it reappears rather than staying silenced forever.
    const dismissedAt = ctData.dismissedStaleMargins?.[key];
    if (dismissedAt !== undefined && Math.abs(dismissedAt - suggested) < 0.01) return;

    stale.push({ key, name: latest.name, category: latest.category, retailPrice, suggested, diffPct, direction: suggested > retailPrice ? 'up' : 'down' });
  });
  return stale.sort((a,b)=>b.diffPct-a.diffPct);
}

function ctDismissStaleMargin(key, suggested) {
  ctData.dismissedStaleMargins = ctData.dismissedStaleMargins || {};
  ctData.dismissedStaleMargins[key] = suggested;
  ctSave();
  renderCtStaleMargin();
}

function renderCtStaleMargin() {
  const el = document.getElementById('ct-stale-margin-body');
  if (!el) return;

  const stale = ctGetStaleMargins();

  if (stale.length === 0) {
    el.innerHTML = `<div style="font-size:0.78rem;color:var(--mist);padding:8px 0">Nothing stale — all retail prices are within 10% of what current costs would suggest.</div>`;
    return;
  }

  el.innerHTML = stale.map(s => `
    <div style="display:flex;gap:12px;font-size:0.78rem;padding:6px 0;align-items:center;border-bottom:1px solid var(--border-soft)">
      <span style="flex:1;cursor:pointer;text-decoration:underline;text-decoration-style:dotted" onclick="ctJumpToPriceHistory('${s.name.replace(/'/g,"\\'")}')" title="Click to view/edit in Price History">${escHtml(s.name)} <span class="badge" style="font-size:0.65rem">${escHtml(s.category)}</span></span>
      <span style="color:var(--mist)">retail $${s.retailPrice.toFixed(2)}</span>
      <span class="ct-flag ${s.direction}">${s.direction==='up'?'▲':'▼'} suggests $${s.suggested.toFixed(2)}</span>
      <button onclick="event.stopPropagation(); ctDismissStaleMargin('${s.key}', ${s.suggested})" title="Dismiss — reappears if the price gap changes again" style="border:none;background:none;color:var(--mist);cursor:pointer;font-size:0.9rem;padding:0 2px">✕</button>
    </div>`).join('');
}

// ============================================================
// WEEKLY DIGEST — BloomBooks computes the summary (since it's the only
// place with access to categories/retail/margin data), pushes it to the
// Sheet, and Apps Script emails it on a schedule.
// ============================================================

function ctComputeWeeklySummary() {
  const now = new Date();
  const weekAgo = new Date(now - 7*864e5).toISOString().slice(0,10);
  const today = now.toISOString().slice(0,10);

  const weekInvoices = ctData.invoices.filter(inv => {
    const d = ctEffDate(inv);
    return d && d >= weekAgo && d <= today;
  });
  const weeklyTotal = weekInvoices.reduce((s,inv)=>s+inv.total, 0);

  const byCategory = {};
  weekInvoices.forEach(inv => inv.items.forEach(item => {
    byCategory[item.category] = (byCategory[item.category]||0) + item.total;
  }));

  // Budget: seasonal baseline (same calendar month, prior years) if available,
  // else a trailing 8-week average as an interim stand-in while history builds up
  const curMonth = today.slice(0,7);
  const curMonthNum = today.slice(5,7);
  const curYear = today.slice(0,4);
  const priorYearsTotals = {};
  ctData.invoices.forEach(inv => {
    const d = ctEffDate(inv);
    if (!d) return;
    const [yr, mo] = d.split('-');
    if (mo === curMonthNum && yr !== curYear) priorYearsTotals[yr] = (priorYearsTotals[yr]||0) + inv.total;
  });
  const priorYears = Object.keys(priorYearsTotals);
  const monthActual = ctData.invoices.filter(inv => ctEffDate(inv) && ctEffDate(inv).startsWith(curMonth)).reduce((s,inv)=>s+inv.total,0);

  let budget;
  if (priorYears.length > 0) {
    const baseline = Object.values(priorYearsTotals).reduce((a,b)=>a+b,0) / priorYears.length;
    budget = { type: 'seasonal', baseline, actual: monthActual, priorYearCount: priorYears.length };
  } else {
    const eightWeeksAgo = new Date(now - 56*864e5).toISOString().slice(0,10);
    const trailing = ctData.invoices.filter(inv => { const d = ctEffDate(inv); return d && d >= eightWeeksAgo && d < weekAgo; });
    const weeksOfData = Math.min(8, Math.max(1, Math.round((new Date(weekAgo) - new Date(eightWeeksAgo)) / 6048e5)));
    const trailingWeeklyAvg = trailing.reduce((s,inv)=>s+inv.total,0) / weeksOfData;
    budget = { type: 'trailing', baseline: trailingWeeklyAvg, actual: weeklyTotal, weeksOfData };
  }

  // Carried into the emailed digest as well as the dashboard: the failure mode
  // is nobody noticing, and an invoice that never got uploaded is exactly the
  // thing you will not think to go and look for.
  let missing = [];
  try { missing = ctUnmatchedPayments(); } catch (e) { /* never break the digest */ }

  return {
    generatedAt: new Date().toISOString(),
    weekStart: weekAgo,
    weekEnd: today,
    weeklyTotal,
    byCategory,
    staleMargins: ctGetStaleMargins().slice(0, 10),
    missingInvoices: {
      count: missing.length,
      total: missing.reduce((s, t) => s + t.amount, 0),
      oldest: missing.length ? missing[0].date : null
    },
    budget
  };
}

async function ctPushWeeklySummary() {
  if (!ctData.appsScriptUrl) return; // nothing to push to
  // Throttle to once a day — no need to hit the Sheet on every page load
  const last = ctData.lastSummaryPush ? new Date(ctData.lastSummaryPush) : null;
  if (last && (Date.now() - last.getTime()) < 20*3600e3) return;

  try {
    const summary = ctComputeWeeklySummary();
    await fetch(ctData.appsScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'summary', summary })
    });
    ctData.lastSummaryPush = new Date().toISOString();
    ctSave();
  } catch(e) { /* fails silently — a missed daily push just means the digest uses slightly older numbers */ }
}

function ctBuildAlerts() {
  // For each item, find the two most recent prices and compare
  const itemMap = {}; // name → [ {date, supplier, price} ]
  [...ctData.invoices].sort((a,b)=>ctEffDate(a).localeCompare(ctEffDate(b))).forEach(inv => {
    inv.items.forEach(item => {
      const key = ctCatalogKey(item.name);
      if (!itemMap[key]) itemMap[key] = { name:item.name, category:item.category, records:[] };
      itemMap[key].records.push({ date:ctEffDate(inv), supplier:inv.supplier, price:item.unitPrice });
    });
  });
  const alerts = [];
  Object.values(itemMap).forEach(entry => {
    if (entry.records.length < 2) return;
    const recs = entry.records;
    const latest = recs[recs.length-1];
    const prior = recs[recs.length-2];
    const pct = ((latest.price - prior.price) / prior.price) * 100;
    if (Math.abs(pct) >= 5) {
      alerts.push({ name:entry.name, category:entry.category, supplier:latest.supplier, current:latest.price, prior:prior.price, pct, dir: pct>0?'up':'down' });
    }
  });
  return alerts.sort((a,b)=>Math.abs(b.pct)-Math.abs(a.pct));
}

function ctEditSavedDeliveryDate(id, dateVal) {
  const inv = ctData.invoices.find(i => i.id === id);
  if (!inv) return;
  inv.deliveryDate = dateVal || null;
  ctSave();
  notify(dateVal ? `Delivery date set to ${dateVal}` : 'Delivery date cleared — using invoice date');
  renderCtDashboard();
  renderCtPrices();
}

function ctEditInvoice(id) {
  const inv = ctData.invoices.find(i => i.id === id);
  if (!inv) return;
  // Deep copy so cancelling doesn't leave partial edits behind
  window._ctEditingInvoice = JSON.parse(JSON.stringify(inv));
  window._ctEditingInvoice.items.forEach(item => { item.removed = false; });
  ctRenderEditInvoice();
  document.getElementById('ct-edit-invoice-area')?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
}

function ctRenderEditInvoice() {
  const area = document.getElementById('ct-edit-invoice-area');
  if (!area || !window._ctEditingInvoice) { if (area) area.innerHTML = ''; return; }
  const inv = window._ctEditingInvoice;

  const activeItems = inv.items.filter(i => !i.removed);
  const itemsTotal = activeItems.reduce((s,i)=>s+(i.total || i.qty*i.unitPrice), 0);
  const deliveryFee = inv.deliveryFee || 0;
  const runningTotal = itemsTotal + deliveryFee;

  const rows = inv.items.map((item, i) => {
    if (item.removed) {
      return `<div class="ct-item-row" style="opacity:0.5">
        <div class="ct-item-name" style="text-decoration:line-through">${escHtml(item.name)}</div>
        <div class="ct-item-meta" style="grid-column: span 4; text-align:right">
          <button class="btn btn-outline btn-sm" onclick="ctEditRestoreItem(${i})" style="font-size:0.7rem;padding:2px 8px">Undo remove</button>
        </div>
      </div>`;
    }
    const stemsInput = item.uom === 'Bunch'
      ? `<input type="number" min="1" placeholder="stems/bu" value="${item.stemsPerBu||''}" onchange="ctEditUpdateStemsPerBu(${i}, this.value)" style="font-size:0.7rem;padding:2px 4px;width:60px">`
      : '';
    return `<div class="ct-item-row">
      <div class="ct-item-name"><input type="text" value="${escHtml(item.name)}" onchange="ctEditUpdateItemField(${i}, 'name', this.value)" style="font-size:0.82rem;border:none;background:transparent;width:100%"></div>
      <div class="ct-item-meta">
        <input type="number" step="0.01" min="0" value="${item.qty}" onchange="ctEditUpdateItemField(${i}, 'qty', this.value)" style="width:50px;font-size:0.75rem;padding:2px 4px">
        <select onchange="ctEditUpdateItemField(${i}, 'uom', this.value)" style="font-size:0.75rem">
          ${['Stem','Bunch','Each','Box','Roll','Other'].map(u=>`<option value="${u}" ${u===item.uom?'selected':''}>${u}</option>`).join('')}
        </select>
        ${stemsInput}
      </div>
      <div class="ct-item-cat">
        <select onchange="ctEditUpdateItemField(${i}, 'category', this.value)">
          ${CT_CATEGORIES.map(c => `<option value="${c}" ${c===item.category?'selected':''}>${c}</option>`).join('')}
        </select>
      </div>
      <div class="ct-item-family">
        <input type="text" list="ct-family-list" placeholder="Family/Type" value="${escHtml(item.family||'')}" onchange="ctEditUpdateItemField(${i}, 'family', this.value)" style="font-size:0.75rem;padding:4px 6px;width:110px">
      </div>
      <div class="ct-item-price">
        <input type="number" step="0.01" min="0" value="${item.unitPrice}" onchange="ctEditUpdateItemField(${i}, 'unitPrice', this.value)" style="width:65px;font-size:0.78rem">
      </div>
      <div class="ct-item-total" style="color:var(--mist)">$${(item.qty*item.unitPrice).toFixed(2)}
        <button onclick="ctEditRemoveItem(${i})" title="Remove this item" style="border:none;background:none;color:var(--mist);cursor:pointer;font-size:0.9rem;padding:0 0 0 6px">✕</button>
      </div>
    </div>`;
  }).join('');

  area.innerHTML = `${ctFamilyDatalist()}
    <div class="ct-parse-result" style="margin-bottom:14px;border:2px solid var(--ink)">
      <div class="ct-parse-header">
        <div>
          <h3>✏️ Editing: <input type="text" value="${escHtml(inv.supplier)}" onchange="ctEditUpdateField('supplier', this.value)" style="font-size:0.95rem;font-weight:600;border:1px solid var(--border);border-radius:4px;padding:2px 6px;width:200px"> — ${inv.date}</h3>
          <div style="font-size:0.72rem;color:var(--mist);margin-top:2px">Invoice ${escHtml(inv.invoiceNumber||'—')}</div>
          <div style="margin-top:6px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <label style="font-size:0.7rem;color:var(--mist)">Delivery date:</label>
            <input type="date" value="${escHtml(inv.deliveryDate||'')}" onchange="ctEditUpdateField('deliveryDate', this.value)" style="font-size:0.72rem;padding:3px 6px">
            <label style="font-size:0.7rem;color:var(--mist);margin-left:8px">Delivery fee:</label>
            <input type="number" step="0.01" value="${deliveryFee}" onchange="ctEditUpdateField('deliveryFee', this.value)" style="font-size:0.72rem;padding:3px 6px;width:70px">
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <span style="font-size:0.85rem;font-weight:600">$${runningTotal.toFixed(2)}</span>
          <button class="btn btn-primary btn-sm" onclick="ctSaveEditedInvoice()">Save Changes</button>
          <button class="btn btn-outline btn-sm" onclick="ctCancelEditInvoice()">Cancel</button>
        </div>
      </div>
      <div style="padding:8px 18px;background:var(--paper);border-bottom:1px solid var(--border);display:flex;gap:16px;font-size:0.68rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--mist)">
        <span style="flex:2">Item</span><span style="flex:1">Qty/UOM</span><span style="flex:1">Category</span><span style="min-width:110px">Family/Type</span><span style="min-width:70px;text-align:right">Unit</span><span style="min-width:70px;text-align:right">Total</span>
      </div>
      ${rows}
      <div style="padding:10px 18px;border-top:1px dashed var(--border)">
        <button class="btn btn-outline btn-sm" onclick="ctEditAddItem()">+ Add Item</button>
      </div>
    </div>`;
}

function ctEditUpdateField(field, val) {
  if (!window._ctEditingInvoice) return;
  window._ctEditingInvoice[field] = field === 'deliveryFee' ? (parseFloat(val)||0) : (val || null);
  ctRenderEditInvoice();
}

function ctEditUpdateItemField(idx, field, val) {
  const item = window._ctEditingInvoice?.items[idx];
  if (!item) return;
  if (field === 'qty' || field === 'unitPrice') item[field] = parseFloat(val) || 0;
  else item[field] = val;
  if (field === 'category') ctLearnCategory(item.name, val);
  if (field === 'family' && val) ctLearnFamily(item.name, val);
  ctRenderEditInvoice();
}

function ctEditUpdateStemsPerBu(idx, val) {
  const item = window._ctEditingInvoice?.items[idx];
  if (!item) return;
  const num = parseInt(val);
  item.stemsPerBu = (num && num > 0) ? num : null;
}

function ctEditRemoveItem(idx) {
  const item = window._ctEditingInvoice?.items[idx];
  if (!item) return;
  item.removed = true;
  ctRenderEditInvoice();
}

function ctEditRestoreItem(idx) {
  const item = window._ctEditingInvoice?.items[idx];
  if (!item) return;
  item.removed = false;
  ctRenderEditInvoice();
}

function ctEditAddItem() {
  if (!window._ctEditingInvoice) return;
  window._ctEditingInvoice.items.push({
    name: 'New item', category: 'Other', family: '', qty: 1, uom: 'Each', unitPrice: 0, stemsPerBu: null, removed: false
  });
  ctRenderEditInvoice();
}

function ctSaveEditedInvoice() {
  const editing = window._ctEditingInvoice;
  if (!editing) return;
  const active = editing.items.filter(i => !i.removed);
  if (active.length === 0) {
    notify('An invoice needs at least one item — add one or delete the whole invoice instead');
    return;
  }
  const idx = ctData.invoices.findIndex(i => i.id === editing.id);
  if (idx === -1) return;

  const itemsTotal = active.reduce((s,i)=>s+(i.qty*i.unitPrice), 0);
  editing.total = itemsTotal + (editing.deliveryFee || 0);
  editing.items = active.map(i => ({
    name: i.name, category: i.category, family: i.family || '', qty: i.qty, uom: i.uom,
    unitPrice: i.unitPrice, stemsPerBu: i.stemsPerBu || null, total: i.qty * i.unitPrice
  }));

  ctData.invoices[idx] = editing;
  ctSave();
  window._ctEditingInvoice = null;
  document.getElementById('ct-edit-invoice-area').innerHTML = '';
  notify('Invoice updated');
  renderCtDashboard();
  renderCtPrices();
}

function ctCancelEditInvoice() {
  window._ctEditingInvoice = null;
  const area = document.getElementById('ct-edit-invoice-area');
  if (area) area.innerHTML = '';
}

window._ctInvoicePage = window._ctInvoicePage || 0;
const CT_INVOICES_PER_PAGE = 15;

function ctInvoiceFiltersChanged() {
  window._ctInvoicePage = 0;
  ctRenderInvoiceList();
}

function ctRenderInvoiceList() {
  const invList = document.getElementById('ct-invoice-list');
  const invCount = document.getElementById('ct-invoice-count');
  const pagination = document.getElementById('ct-invoice-pagination');
  if (!invList) return;

  // Populate the supplier filter dropdown (once — preserves selection across re-renders)
  const supplierSel = document.getElementById('ct-inv-supplier-filter');
  if (supplierSel && supplierSel.options.length <= 1) {
    const suppliers = [...new Set(ctData.invoices.map(i=>i.supplier))].sort();
    supplierSel.innerHTML = `<option value="all">All Suppliers</option>` + suppliers.map(s=>`<option value="${escHtml(s)}">${escHtml(s)}</option>`).join('');
  }

  const search = (document.getElementById('ct-inv-search')?.value || '').toLowerCase();
  const supplierFilter = document.getElementById('ct-inv-supplier-filter')?.value || 'all';
  const dateStart = document.getElementById('ct-inv-date-start')?.value;
  const dateEnd = document.getElementById('ct-inv-date-end')?.value;

  let filtered = [...ctData.invoices].sort((a,b)=>ctEffDate(b).localeCompare(ctEffDate(a)));

  if (supplierFilter !== 'all') filtered = filtered.filter(i => i.supplier === supplierFilter);
  if (search) filtered = filtered.filter(i => i.supplier.toLowerCase().includes(search) || (i.invoiceNumber||'').toLowerCase().includes(search));
  if (dateStart) filtered = filtered.filter(i => ctEffDate(i) >= dateStart);
  if (dateEnd) filtered = filtered.filter(i => ctEffDate(i) <= dateEnd);

  if (invCount) invCount.textContent = `${ctData.invoices.length} invoice${ctData.invoices.length!==1?'s':''}${filtered.length!==ctData.invoices.length ? ` (${filtered.length} match filters)` : ''}`;

  if (ctData.invoices.length === 0) {
    invList.innerHTML = `<div class="empty-state"><div class="empty-icon">📄</div>No invoices yet</div>`;
    if (pagination) pagination.innerHTML = '';
    return;
  }
  if (filtered.length === 0) {
    invList.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div>No invoices match your search/filters</div>`;
    if (pagination) pagination.innerHTML = '';
    return;
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / CT_INVOICES_PER_PAGE));
  if (window._ctInvoicePage >= totalPages) window._ctInvoicePage = totalPages - 1;
  if (window._ctInvoicePage < 0) window._ctInvoicePage = 0;
  const pageStart = window._ctInvoicePage * CT_INVOICES_PER_PAGE;
  const pageItems = filtered.slice(pageStart, pageStart + CT_INVOICES_PER_PAGE);

  invList.innerHTML = `<div id="ct-edit-invoice-area"></div>` + pageItems.map(inv => `
    <div class="ct-item-row">
      <div class="ct-item-name">${escHtml(inv.supplier)}</div>
      <div class="ct-item-meta">
        Invoiced ${escHtml(inv.date)}
        <input type="date" value="${escHtml(inv.deliveryDate||'')}" onchange="ctEditSavedDeliveryDate('${inv.id}', this.value)" title="Delivery/charge date, if different" style="font-size:0.68rem;padding:1px 4px;margin-left:4px;width:118px">
        · ${inv.items.length} items
      </div>
      <div class="ct-item-cat"><span class="badge">${escHtml(inv.invoiceNumber||'—')}</span></div>
      <div class="ct-item-price" style="margin-left:auto">$${inv.total.toFixed(2)}</div>
      <div class="ct-item-total">
        <button class="btn btn-outline btn-xs" onclick="ctEditInvoice('${inv.id}')">Edit</button>
        <button class="btn btn-danger btn-xs" onclick="ctDeleteInvoice('${inv.id}')">Del</button>
      </div>
    </div>`).join('');

  if (pagination) {
    pagination.innerHTML = `
      <button class="btn btn-outline btn-xs" onclick="ctInvoicePage(-1)" ${window._ctInvoicePage===0?'disabled':''}>← Prev</button>
      <span>Page ${window._ctInvoicePage+1} of ${totalPages} (${filtered.length} invoice${filtered.length!==1?'s':''})</span>
      <button class="btn btn-outline btn-xs" onclick="ctInvoicePage(1)" ${window._ctInvoicePage>=totalPages-1?'disabled':''}>Next →</button>`;
  }
}

function ctInvoicePage(delta) {
  window._ctInvoicePage += delta;
  ctRenderInvoiceList();
}

function ctDeleteInvoice(id) {
  if (!confirm('Delete this invoice? This cannot be undone.')) return;
  ctData.invoices = ctData.invoices.filter(i => i.id !== id);
  ctSave();
  renderCtDashboard();
  renderCtPrices();
  notify('Invoice deleted');
}

function ctDestroyChart(id) {
  if (ctCharts[id]) { try { ctCharts[id].destroy(); } catch(e){} delete ctCharts[id]; }
}

// --- Price History ---
function ctPricePeriodChanged() {
  const period = document.getElementById('ct-price-period')?.value;
  document.getElementById('ct-price-month').style.display = period === 'month' ? '' : 'none';
  document.getElementById('ct-price-start').style.display = period === 'range' ? '' : 'none';
  document.getElementById('ct-price-end').style.display = period === 'range' ? '' : 'none';
  renderCtPrices();
}

function ctPriceDateFilter(dateStr) {
  const period = document.getElementById('ct-price-period')?.value || 'all';
  if (period === 'all') return true;
  const now = new Date();
  if (period === 'ytd') return dateStr && dateStr.startsWith(String(now.getFullYear()));
  if (period === '90') {
    const cutoff = new Date(now - 90*864e5).toISOString().slice(0,10);
    return dateStr >= cutoff;
  }
  if (period === 'month') {
    const monthVal = document.getElementById('ct-price-month')?.value;
    return monthVal ? (dateStr && dateStr.startsWith(monthVal)) : true;
  }
  if (period === 'range') {
    const start = document.getElementById('ct-price-start')?.value;
    const end = document.getElementById('ct-price-end')?.value;
    if (start && dateStr < start) return false;
    if (end && dateStr > end) return false;
    return true;
  }
  return true;
}

function ctEditPriceHistoryRecord(invoiceId, itemIndex, field, val) {
  const inv = ctData.invoices.find(i => i.id === invoiceId);
  if (!inv || !inv.items[itemIndex]) return;
  const item = inv.items[itemIndex];

  if (field === 'unitPrice') {
    const num = parseFloat(val);
    if (isNaN(num) || num < 0) return;
    item.unitPrice = num;
    item.total = item.qty * num;
  } else if (field === 'qty') {
    const num = parseFloat(val);
    if (isNaN(num) || num <= 0) return;
    item.qty = num;
    item.total = num * item.unitPrice;
  } else if (field === 'uom') {
    item.uom = val;
    // Stems-per-bunch only makes sense for Bunch-priced items — clear it if the unit changed away from Bunch
    if (val !== 'Bunch') item.stemsPerBu = null;
  } else if (field === 'stemsPerBu') {
    const num = parseInt(val);
    item.stemsPerBu = (num && num > 0) ? num : null;
  }

  // Recalculate the invoice total from all its items plus delivery fee
  inv.total = inv.items.reduce((s,i)=>s+(i.total||i.qty*i.unitPrice), 0) + (inv.deliveryFee||0);
  ctSave();
  notify('Updated — this changes the original invoice, so it affects margin/history calculations too');
  renderCtPrices();
  renderCtDashboard();
}

// General back-navigation — any "click to jump elsewhere" feature can call ctPushNavState()
// before navigating, so a Back button can return to the exact panel + scroll position.
window._ctNavStack = window._ctNavStack || [];

function ctPushNavState() {
  const activePanel = document.querySelector('.panel.active');
  if (!activePanel) return;
  const scroller = document.getElementById('main-content');
  window._ctNavStack.push({ panelId: activePanel.id.replace('panel-',''), scrollY: scroller ? scroller.scrollTop : 0 });
  ctUpdateBackButton();
}

function ctGoBack() {
  const state = window._ctNavStack.pop();
  if (!state) return;
  switchPanel(state.panelId);
  const scroller = document.getElementById('main-content');
  // Wait for the panel's render to finish before scrolling, so position is accurate
  setTimeout(() => { if (scroller) scroller.scrollTop = state.scrollY; }, 60);
  ctUpdateBackButton();
}

function ctUpdateBackButton() {
  const btn = document.getElementById('ct-back-btn');
  if (btn) btn.style.display = window._ctNavStack.length > 0 ? 'inline-flex' : 'none';
}

function ctJumpToPriceHistory(itemName) {
  ctPushNavState();
  switchPanel('ct-prices');
  const searchEl = document.getElementById('ct-price-search');
  const groupEl = document.getElementById('ct-price-groupby');
  if (searchEl) searchEl.value = itemName;
  if (groupEl) groupEl.value = 'item'; // jumping to one specific item, not a family rollup
  renderCtPrices();
  // Expand the matching row and scroll to it
  setTimeout(() => {
    const body = document.getElementById('ct-prices-body');
    const header = body?.querySelector('.ct-price-table-header');
    if (header) {
      const detail = header.nextElementSibling;
      if (detail) detail.style.display = 'block';
      header.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    }
  }, 50);
}

function ctSetPriceCategory(cat) {
  const sel = document.getElementById('ct-price-cat');
  if (sel) sel.value = cat;
  renderCtPrices();
}

function ctUpdatePriceHistoryRetail(key, val) {
  const num = parseFloat(val);
  if (num > 0) ctData.retail[key] = num;
  else delete ctData.retail[key];
  ctSave();
  renderCtPrices();
  renderCtDashboard(); // margin/stale-margin reports depend on retail too
}

function renderCtPrices() {
  const search = (document.getElementById('ct-price-search')?.value||'').toLowerCase();
  const cat = document.getElementById('ct-price-cat')?.value || 'all';
  const supplier = document.getElementById('ct-price-supplier')?.value || 'all';
  const groupBy = document.getElementById('ct-price-groupby')?.value || 'family';

  // Populate supplier dropdown
  const supplierSel = document.getElementById('ct-price-supplier');
  if (supplierSel) {
    const suppliers = [...new Set(ctData.invoices.map(i=>i.supplier))].sort();
    const cur = supplierSel.value;
    supplierSel.innerHTML = `<option value="all">All Suppliers</option>` + suppliers.map(s=>`<option value="${escHtml(s)}" ${s===cur?'selected':''}>${escHtml(s)}</option>`).join('');
  }
  // Populate category dropdown (hidden — used as state, tabs are the visible UI)
  const catSel = document.getElementById('ct-price-cat');
  if (catSel && catSel.options.length <= 1) {
    catSel.innerHTML = `<option value="all">All Categories</option>` + CT_CATEGORIES.map(c=>`<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');
  }

  // Build category tabs — only show ones that actually have items, so 15 possible
  // categories doesn't mean 15 tabs when you've only ever used a handful
  const tabsEl = document.getElementById('ct-price-tabs');
  if (tabsEl) {
    const catsWithData = [...new Set(ctData.invoices.flatMap(inv => inv.items.map(i=>i.category)))];
    const orderedCats = CT_CATEGORIES.filter(c => catsWithData.includes(c))
      .concat(catsWithData.filter(c => !CT_CATEGORIES.includes(c))); // legacy categories too
    const counts = {};
    ctData.invoices.forEach(inv => inv.items.forEach(i => { counts[i.category] = (counts[i.category]||0)+1; }));

    const pill = (value, label, count) => {
      const active = cat === value;
      return `<button onclick="ctSetPriceCategory('${value.replace(/'/g,"\\'")}')" style="
        font-size:0.78rem;padding:6px 14px;border-radius:20px;cursor:pointer;
        border:1px solid ${active ? 'var(--ink)' : 'var(--border)'};
        background:${active ? 'var(--ink)' : 'var(--surface)'};
        color:${active ? 'var(--surface)' : 'var(--ink)'};
        font-weight:${active?'600':'400'}">${escHtml(label)}${count!==undefined?` <span style="opacity:0.6">${count}</span>`:''}</button>`;
    };

    tabsEl.innerHTML = pill('all', 'All') + orderedCats.map(c => pill(c, c, counts[c])).join('');
  }

  // Build item → price history map (always keyed by exact item first), respecting the period filter
  const itemMap = {};
  [...ctData.invoices]
    .filter(inv => supplier === 'all' || inv.supplier === supplier)
    .filter(inv => ctPriceDateFilter(ctEffDate(inv)))
    .sort((a,b)=>ctEffDate(a).localeCompare(ctEffDate(b)))
    .forEach(inv => {
      inv.items.forEach(item => {
        if (cat !== 'all' && item.category !== cat) return;
        if (search && !item.name.toLowerCase().includes(search)) return;
        const key = ctCatalogKey(item.name);
        if (!itemMap[key]) itemMap[key] = { name:item.name, category:item.category, key, records:[] };
        itemMap[key].records.push({ date:ctEffDate(inv), supplier:inv.supplier, price:item.unitPrice, qty:item.qty, uom:item.uom, stemsPerBu:item.stemsPerBu||null, invoiceId:inv.id, itemIndex:inv.items.indexOf(item) });
      });
    });

  const body = document.getElementById('ct-prices-body');
  if (!body) return;

  let groups;
  if (groupBy === 'family') {
    // Roll exact items up into their family, or "Unassigned" if no family is set yet
    const famMap = {};
    Object.values(itemMap).forEach(item => {
      const fam = ctGuessFamily(item.name) || 'Unassigned';
      if (!famMap[fam]) famMap[fam] = { name: fam, category: item.category, key: null, records: [], members: new Set() };
      famMap[fam].records.push(...item.records);
      famMap[fam].members.add(item.name);
    });
    groups = Object.values(famMap).map(g => ({ ...g, records: g.records.sort((a,b)=>a.date.localeCompare(b.date)) }));
  } else {
    groups = Object.values(itemMap);
  }

  groups = groups.sort((a,b)=>a.name.localeCompare(b.name));

  if (groups.length === 0) {
    const period = document.getElementById('ct-price-period')?.value;
    body.innerHTML = `<div class="empty-state"><div class="empty-icon">💐</div>${ctData.invoices.length===0?'No invoices yet — upload one to see price history':(period!=='all'?'No purchases in this period':'No items match your filters')}</div>`;
    return;
  }

  body.innerHTML = ctFamilyDatalist() + groups.map(item => {
    const latest = item.records[item.records.length-1];
    // Normalize each purchase to a per-stem price where possible (Stem and Each are
    // already per-stem-equivalent in florist trade; Bunch needs a known stems-per-bunch
    // to convert). This lets suppliers who price by the bunch and suppliers who price
    // by the stem be fairly compared, rather than mixing incompatible units together.
    const toPerStem = r => {
      if (r.uom === 'Stem' || r.uom === 'Each') return r.price;
      if (r.uom === 'Bunch' && r.stemsPerBu) return r.price / r.stemsPerBu;
      return null;
    };
    const withPerStem = item.records.map(r => ({ ...r, perStem: toPerStem(r) }));
    const comparable = withPerStem.filter(r => r.perStem !== null);
    const unknownCount = item.records.length - comparable.length;
    const usePerStem = comparable.length > 0;
    const compareBasis = usePerStem ? comparable : withPerStem.map(r => ({ ...r, perStem: r.price }));
    const priceUnit = usePerStem ? '/stem' : `/${escHtml(item.records[0]?.uom || 'unit')}`;

    const firstC = compareBasis[0];
    const latestC = compareBasis[compareBasis.length-1];
    const trend = compareBasis.length > 1 ? ((latestC.perStem-firstC.perStem)/firstC.perStem*100) : null;
    const trendDir = trend > 0 ? 'up' : 'down';
    const trendHtml = trend !== null
      ? `<span class="ct-flag ${Math.abs(trend)<5 ? '' : trendDir}" style="${Math.abs(trend)<5?'background:var(--green-light);color:var(--green);border-color:var(--green)':''}">${trend>0?'▲':'▼'}${Math.abs(trend).toFixed(0)}% since first purchase</span>`
      : '<span class="ct-flag new">1 purchase</span>';

    // Average price across all recorded purchases
    const avgPrice = compareBasis.reduce((s,r)=>s+r.perStem,0) / compareBasis.length;

    // Total quantity ordered over the current period, grouped by unit — never summed across
    // different UOMs (e.g. Bunch + Each), since "42 Bunch + 10 Each" as one number would be meaningless
    const qtyByUom = {};
    item.records.forEach(r => { qtyByUom[r.uom] = (qtyByUom[r.uom]||0) + r.qty; });
    const qtyLine = Object.entries(qtyByUom).map(([uom,q]) => `${q} ${uom}${q!==1?'s':''}`).join(', ');

    // Best (lowest) price seen, and which supplier — only meaningful if 2+ distinct suppliers
    const distinctSuppliers = [...new Set(item.records.map(r=>r.supplier))];
    const bestRecord = compareBasis.reduce((min,r)=> r.perStem < min.perStem ? r : min, compareBasis[0]);
    const hasMultipleSuppliers = distinctSuppliers.length > 1;

    // Per-supplier breakdown, sorted cheapest average first — shown when comparison is meaningful
    const bySupplier = distinctSuppliers.map(s => {
      const recs = compareBasis.filter(r=>r.supplier===s);
      if (recs.length === 0) return null; // this supplier has no comparable purchases for this item
      return {
        supplier: s,
        count: recs.length,
        avg: recs.reduce((sum,r)=>sum+r.perStem,0)/recs.length,
        best: Math.min(...recs.map(r=>r.perStem))
      };
    }).filter(Boolean).sort((a,b)=>a.avg-b.avg);

    const statsLine = hasMultipleSuppliers
      ? `Total: ${qtyLine} · Avg: $${avgPrice.toFixed(2)}${priceUnit} · Best: $${bestRecord.perStem.toFixed(2)}${priceUnit} (${escHtml(bestRecord.supplier)})`
      : `Total: ${qtyLine} · Avg: $${avgPrice.toFixed(2)}${priceUnit}`;

    const supplierCompare = hasMultipleSuppliers
      ? `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">
          <div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--mist);margin-bottom:6px">Compare Suppliers ${usePerStem?'(normalized to price per stem)':''}</div>
          ${bySupplier.map((s,i) => `<div style="display:flex;gap:12px;font-size:0.75rem;padding:4px 0;align-items:center">
            <span style="flex:1">${escHtml(s.supplier)}${i===0?' <span class="ct-flag" style="background:var(--green-light);color:var(--green);border-color:var(--green)">best avg</span>':''}</span>
            <span style="color:var(--mist)">${s.count} purchase${s.count!==1?'s':''}</span>
            <span style="min-width:70px;text-align:right">avg $${s.avg.toFixed(2)}${priceUnit}</span>
            <span style="min-width:70px;text-align:right;font-weight:600">best $${s.best.toFixed(2)}${priceUnit}</span>
          </div>`).join('')}
          ${unknownCount > 0 ? `<div style="font-size:0.7rem;color:var(--mist);margin-top:6px">${unknownCount} purchase${unknownCount!==1?'s':''} excluded from this comparison — bunch pricing with no stem count on file. Add it in the rows below to include them.</div>` : ''}
        </div>`
      : '';

    const history = [...item.records].reverse().slice(0,5).map(r => {
      const stemsField = r.uom === 'Bunch'
        ? `<input type="number" min="1" placeholder="stems/bu" value="${r.stemsPerBu||''}" onchange="ctEditPriceHistoryRecord('${r.invoiceId}', ${r.itemIndex}, 'stemsPerBu', this.value)" style="font-size:0.68rem;padding:1px 4px;width:56px;margin-left:4px" title="Stems per bunch">`
        : '';
      return `<div style="display:flex;gap:8px;font-size:0.72rem;color:var(--mist);padding:3px 0;border-bottom:1px solid var(--border-soft);align-items:center">
        <span style="min-width:90px">${r.date}</span>
        <span style="flex:1">${escHtml(r.supplier)}</span>
        <input type="number" step="0.01" min="0" value="${r.qty}" onchange="ctEditPriceHistoryRecord('${r.invoiceId}', ${r.itemIndex}, 'qty', this.value)"
          style="width:48px;font-size:0.72rem;padding:1px 4px">
        <select onchange="ctEditPriceHistoryRecord('${r.invoiceId}', ${r.itemIndex}, 'uom', this.value)" style="font-size:0.7rem;padding:1px 2px">
          ${['Stem','Bunch','Each','Box','Roll','Other'].map(u=>`<option value="${u}" ${u===r.uom?'selected':''}>${u}</option>`).join('')}
        </select>
        ${stemsField}
        <input type="number" step="0.01" min="0" value="${r.price.toFixed(2)}" onchange="ctEditPriceHistoryRecord('${r.invoiceId}', ${r.itemIndex}, 'unitPrice', this.value)"
          style="font-weight:600;color:var(--ink);min-width:55px;width:65px;text-align:right;font-size:0.72rem;padding:1px 4px;margin-left:auto">
      </div>`;
    }).join('');

    // Family editing lives on Upload/Gmail Scan now — Price History just displays it
    const familyDisplay = groupBy === 'item'
      ? (ctGuessFamily(item.name) ? `<span class="badge" style="font-size:0.68rem">${escHtml(ctGuessFamily(item.name))}</span>` : '')
      : (item.members ? (() => {
          const memberList = [...item.members];
          const retailValues = memberList.map(n => ctData.retail[ctCatalogKey(n)]).filter(v => v !== undefined);
          const retailNote = retailValues.length > 0
            ? `<span style="margin-left:6px"><label style="font-size:0.68rem;color:var(--mist)">Avg retail:</label> <strong style="font-size:0.78rem">$${(retailValues.reduce((a,b)=>a+b,0)/retailValues.length).toFixed(2)}</strong> <span style="font-size:0.68rem;color:var(--mist)">(${retailValues.length} of ${memberList.length} items priced — set per-item under "Exact Item" view)</span></span>`
            : `<span style="margin-left:6px;font-size:0.68rem;color:var(--mist)">No retail prices set yet for this family — set them under "Exact Item" view</span>`;
          return `<div style="font-size:0.7rem;color:var(--mist);margin-top:4px">${memberList.length} item${memberList.length!==1?'s':''}: ${memberList.slice(0,4).map(escHtml).join(', ')}${memberList.length>4?` +${memberList.length-4} more`:''}</div>
                  <div style="margin-top:2px">${retailNote}</div>`;
        })() : '');

    // Retail price: viewable and editable here for exact items (not meaningful at the
    // family rollup level, since different members could have different retail prices)
    const retailControl = (groupBy === 'item' && item.key)
      ? `<span style="margin-left:8px" onclick="event.stopPropagation()">
          <label style="font-size:0.68rem;color:var(--mist)">Retail:</label>
          <input type="number" step="0.01" min="0" placeholder="not set" value="${ctData.retail[item.key] ?? ''}"
            onchange="ctUpdatePriceHistoryRetail('${item.key}', this.value)" style="width:70px;font-size:0.75rem;padding:2px 4px">
        </span>`
      : '';

    return `<div class="ct-price-table" style="margin-bottom:12px">
      <div class="ct-price-table-header" style="cursor:pointer" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none'">
        <div style="flex:1">
          <div style="font-weight:600;font-size:0.9rem">${escHtml(item.name)} ${groupBy === 'item' ? familyDisplay : ''}</div>
          <div style="font-size:0.72rem;color:var(--mist);margin-top:2px;display:flex;align-items:center;flex-wrap:wrap"><span class="badge">${escHtml(item.category)}</span> &nbsp; ${item.records.length} purchase${item.records.length!==1?'s':''} · latest $${latest.price.toFixed(2)}/${latest.uom} · ${statsLine}${retailControl}</div>
          ${groupBy === 'family' ? familyDisplay : ''}
        </div>
        <div style="display:flex;gap:8px;align-items:center">${trendHtml} <span style="color:var(--mist);font-size:0.8rem">▼</span></div>
      </div>
      <div style="padding:10px 18px;display:none">
        <div style="display:flex;gap:12px;font-size:0.68rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--mist);padding-bottom:6px;border-bottom:1px solid var(--border)">
          <span style="min-width:90px">Date</span><span style="flex:1">Supplier</span><span>Qty</span><span style="min-width:55px;text-align:right">Unit Price</span>
        </div>
        ${history}
        ${item.records.length > 5 ? `<div style="font-size:0.7rem;color:var(--mist);margin-top:6px">+ ${item.records.length-5} earlier purchase${item.records.length-5!==1?'s':''}</div>` : ''}
        ${supplierCompare}
      </div>
    </div>`;
  }).join('');
}

function ctUpdateItemFamily(itemKey, familyName) {
  // Deprecated — family editing now lives on Upload/Gmail Scan review cards, not Price History
}

