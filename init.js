// ============================================================
// INIT
// ============================================================
function autoBackup() {
  try {
    // Only backup if there's real data (more than just vault entries)
    const txCount = Object.values(appData.transactions).reduce((s, arr) => s + arr.filter(t => !t._vault).length, 0);
    if (txCount === 0 && ctData.invoices.length === 0) return;
    const timestamp = new Date().toISOString().slice(0,16).replace('T','-').replace(':','');
    const blob = new Blob([JSON.stringify({ version: 2, appData, ctData }, null, 2)], {type: 'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bloom-books-backup-${timestamp}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch(e) {}
}

function initApp() {
  // Load local data immediately as fallback
  loadFromLocal();
  ensureVaultData();
  ctLoad();

  // Populate category selects in edit modal
  const editCatSel = document.getElementById('edit-category');
  if (editCatSel) editCatSel.innerHTML = CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('');

  // Before any year selector is built, so a new calendar year is present the
  // first time the app is opened in it rather than the day someone notices.
  ensureCurrentYear();

  updateYearSelects();
  renderMonthTabs();
  switchPanel('month-0');

  // Auto-backup on load (only if real data exists)
  setTimeout(autoBackup, 3000);
  // OAuth will call finalizeInit() when cloud data is loaded

  // Silent check for new Gmail-scanned invoices, if a Sheet is connected
  if (ctData.gmailSheetId) setTimeout(() => ctFetchGmailInvoices(true), 1500);
  setTimeout(() => ctPushWeeklySummary(), 3000);
}

// Close modal on overlay click
document.getElementById('edit-modal').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});

initApp();
