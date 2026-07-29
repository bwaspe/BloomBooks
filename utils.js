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

