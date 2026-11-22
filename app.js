/**
 * Phlo — Minimal Cycle Tracker
 * Core Application Logic
 */

(function () {
  'use strict';

  // --- Constants & Config ---
  const STORAGE_KEY = 'phlo_periods';
  const DB_NAME = 'phlo_db';
  const DB_STORE = 'keyval';
  const PERIOD_DURATION_DAYS = 5;

  // --- State ---
  let periods = []; // Array of 'YYYY-MM-DD' start dates, sorted descending
  let activeFileHandle = null;
  let currentCalDate = new Date(); // Month currently displayed
  let pendingSelectedDate = null; // Date clicked for confirmation

  // --- DOM Elements ---
  const cycleNumberEl = document.getElementById('cycle-number');
  const cycleLabelEl = document.getElementById('cycle-label');
  const cycleSubtextEl = document.getElementById('cycle-subtext');
  const statusPillTextEl = document.getElementById('status-pill-text');
  const fabAddPeriodBtn = document.getElementById('fab-add-period');

  // Calendar Elements
  const calendarModal = document.getElementById('calendar-modal');
  const calMonthYearEl = document.getElementById('cal-month-year');
  const daysGridEl = document.getElementById('days-grid');
  const calPrevBtn = document.getElementById('cal-prev');
  const calNextBtn = document.getElementById('cal-next');
  const calTodayBtn = document.getElementById('cal-today-btn');
  const calCloseBtn = document.getElementById('cal-close-btn');

  // Confirm Modal Elements
  const confirmModal = document.getElementById('confirm-modal');
  const confirmTitleEl = document.getElementById('confirm-title');
  const confirmMsgEl = document.getElementById('confirm-message');
  const confirmOkBtn = document.getElementById('confirm-ok-btn');
  const confirmCancelBtn = document.getElementById('confirm-cancel-btn');

  // Drawer & Persistence Elements
  const menuBtn = document.getElementById('menu-btn');
  const drawerBackdrop = document.getElementById('drawer-backdrop');
  const drawerCloseBtn = document.getElementById('drawer-close-btn');
  const storageStatusBadge = document.getElementById('storage-status-badge');
  const fsStatusBadge = document.getElementById('fs-status-badge');
  const fsLinkBtn = document.getElementById('fs-link-btn');
  const fsBtnText = document.getElementById('fs-btn-text');
  const exportJsonBtn = document.getElementById('export-json-btn');
  const importFileInput = document.getElementById('import-file-input');
  const showQrBtn = document.getElementById('show-qr-btn');
  const copySyncLinkBtn = document.getElementById('copy-sync-link-btn');
  const exportIcsBtn = document.getElementById('export-ics-btn');
  const periodsHistoryList = document.getElementById('periods-history-list');
  const clearAllDataBtn = document.getElementById('clear-all-data-btn');

  // QR Modal
  const qrModal = document.getElementById('qr-modal');
  const qrDisplay = document.getElementById('qr-code-display');
  const qrCloseBtn = document.getElementById('qr-close-btn');

  // Toast
  const toastEl = document.getElementById('toast');

  // --- Utility Functions ---
  function showToast(message, duration = 3000) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toastEl._timer);
    toastEl._timer = setTimeout(() => {
      toastEl.classList.remove('show');
    }, duration);
  }

  function formatDateISO(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function parseDateISO(isoStr) {
    const [y, m, d] = isoStr.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function parseDateUTC(isoStr) {
    const [y, m, d] = isoStr.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  }

  function formatDisplayDate(isoStr) {
    const d = parseDateISO(isoStr);
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  function getTodayISO() {
    return formatDateISO(new Date());
  }

  function daysDifference(dateStr1, dateStr2) {
    // Returns (date1 - date2) in whole calendar days using UTC to prevent DST variance
    const msPerDay = 1000 * 60 * 60 * 24;
    return Math.round((parseDateUTC(dateStr1) - parseDateUTC(dateStr2)) / msPerDay);
  }

  // --- IndexedDB Simple Key-Value Store ---
  function getDB() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        resolve(null);
        return;
      }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(DB_STORE)) {
          db.createObjectStore(DB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
  }

  async function idbGet(key) {
    const db = await getDB();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(DB_STORE, 'readonly');
        const req = tx.objectStore(DB_STORE).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  }

  async function idbSet(key, value) {
    const db = await getDB();
    if (!db) return;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).put(value, key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  }

  // --- Data Persistence ---
  function sortPeriods(arr) {
    return Array.from(new Set(arr)).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  }

  async function saveState() {
    // 1. LocalStorage
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(periods));
    } catch (e) {
      console.warn('LocalStorage save failed', e);
    }

    // 2. IndexedDB
    await idbSet('periods', periods);

    // 3. File System Access API (if linked)
    if (activeFileHandle) {
      await writeToFileHandle(activeFileHandle, periods);
    }

    // Refresh UI
    updateCycleDisplay();
    renderCalendar();
    renderHistoryList();
  }

  async function loadState() {
    let loaded = null;

    // Try LocalStorage first
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) loaded = JSON.parse(raw);
    } catch (e) {
      console.warn('LocalStorage load failed', e);
    }

    // If empty, try IndexedDB
    if (!loaded || !Array.isArray(loaded)) {
      const fromIdb = await idbGet('periods');
      if (fromIdb && Array.isArray(fromIdb)) loaded = fromIdb;
    }

    periods = sortPeriods(Array.isArray(loaded) ? loaded : []);

    // Check for linked file handle
    await restoreFileHandle();

    // Check URL Hash for Cross-device sync data
    checkUrlSync();

    // Request persistent storage
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().then((isPersisted) => {
        if (storageStatusBadge) {
          storageStatusBadge.textContent = isPersisted ? 'Persistent' : 'Standard';
          storageStatusBadge.className = isPersisted ? 'badge badge-success' : 'badge';
        }
      });
    }

    updateCycleDisplay();
    renderCalendar();
    renderHistoryList();
  }

  // --- Cycle Day Calculation & Flo-style UI Update ---
  function updateCycleDisplay() {
    const todayStr = getTodayISO();

    // Find all periods on or before today
    const pastOrCurrentPeriods = periods.filter((p) => p <= todayStr);

    if (pastOrCurrentPeriods.length === 0) {
      // Check if there are any future periods
      const futurePeriods = periods.filter((p) => p > todayStr);
      if (futurePeriods.length > 0) {
        const nextPeriod = futurePeriods[futurePeriods.length - 1]; // earliest future
        const diff = daysDifference(nextPeriod, todayStr);
        cycleNumberEl.textContent = '—';
        cycleLabelEl.textContent = 'Upcoming';
        cycleSubtextEl.textContent = `Period in ${diff} day${diff === 1 ? '' : 's'}`;
        statusPillTextEl.textContent = `Starts on ${formatDisplayDate(nextPeriod)}`;
      } else {
        cycleNumberEl.textContent = '—';
        cycleLabelEl.textContent = 'Cycle Day';
        cycleSubtextEl.textContent = 'Tap + to log your period';
        statusPillTextEl.textContent = 'No period logged yet';
      }
      return;
    }

    // Most recent period on or before today
    const latestPeriod = pastOrCurrentPeriods[0];
    const diff = daysDifference(todayStr, latestPeriod);
    const cycleDay = diff + 1;

    cycleNumberEl.textContent = cycleDay;
    cycleLabelEl.textContent = 'Cycle Day';

    if (cycleDay <= PERIOD_DURATION_DAYS) {
      cycleSubtextEl.textContent = `Period day ${cycleDay} of ${PERIOD_DURATION_DAYS}`;
      statusPillTextEl.textContent = `Period started ${formatDisplayDate(latestPeriod)}`;
    } else {
      cycleSubtextEl.textContent = `Started ${formatDisplayDate(latestPeriod)}`;
      statusPillTextEl.textContent = `Day ${cycleDay} of current cycle`;
    }
  }

  // --- Calendar Logic with 5-Day Soft Pastel Red Highlighting ---
  function renderCalendar() {
    if (!daysGridEl) return;
    daysGridEl.innerHTML = '';

    const year = currentCalDate.getFullYear();
    const month = currentCalDate.getMonth();

    // Set month-year title
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    calMonthYearEl.textContent = `${monthNames[month]} ${year}`;

    // Compute first day of the month & total days
    const firstDayDate = new Date(year, month, 1);
    const lastDayDate = new Date(year, month + 1, 0);
    const totalDays = lastDayDate.getDate();

    // Monday-first indexing: 0 = Mon, 6 = Sun
    let startDayIndex = firstDayDate.getDay() - 1;
    if (startDayIndex === -1) startDayIndex = 6;

    // Pad leading empty cells
    for (let i = 0; i < startDayIndex; i++) {
      const emptyCell = document.createElement('div');
      emptyCell.className = 'cal-day-cell empty';
      daysGridEl.appendChild(emptyCell);
    }

    const todayStr = getTodayISO();

    // Map each day
    for (let day = 1; day <= totalDays; day++) {
      const cellDate = new Date(year, month, day);
      const dayISO = formatDateISO(cellDate);

      const cell = document.createElement('div');
      cell.className = 'cal-day-cell';
      cell.dataset.date = dayISO;

      if (dayISO === todayStr) {
        cell.classList.add('is-today');
      }

      // Check 5-day period highlight
      // 5 days including the start: diff in [0, 1, 2, 3, 4]
      let isPeriodDay = false;
      let isStartDay = false;
      let isEndDay = false;

      for (const p of periods) {
        const diff = daysDifference(dayISO, p);
        if (diff >= 0 && diff < PERIOD_DURATION_DAYS) {
          isPeriodDay = true;
          if (diff === 0) isStartDay = true;
          if (diff === PERIOD_DURATION_DAYS - 1) isEndDay = true;
        }
      }

      if (isPeriodDay) {
        cell.classList.add('period-highlight');
        if (isStartDay) cell.classList.add('period-start', 'is-start-day');
        if (isEndDay) cell.classList.add('period-end');
      }

      const inner = document.createElement('div');
      inner.className = 'cal-day-inner';
      inner.textContent = day;
      cell.appendChild(inner);

      // Click handler to confirm period start
      cell.addEventListener('click', () => onDayClick(dayISO));

      daysGridEl.appendChild(cell);
    }
  }

  // --- Day Click & Confirmation Dialog ---
  function onDayClick(dayISO) {
    pendingSelectedDate = dayISO;
    const formatted = formatDisplayDate(dayISO);
    const isAlreadyStart = periods.includes(dayISO);

    if (isAlreadyStart) {
      confirmTitleEl.textContent = 'Remove Period Start';
      confirmMsgEl.textContent = `Remove period starting on ${formatted}?`;
      confirmOkBtn.textContent = 'Remove';
      confirmOkBtn.className = 'btn btn-danger';
    } else {
      confirmTitleEl.textContent = 'Log Period Start';
      confirmMsgEl.textContent = `Set ${formatted} as the first day of your period? (5 days will be highlighted)`;
      confirmOkBtn.textContent = 'Confirm';
      confirmOkBtn.className = 'btn btn-primary';
    }

    confirmModal.classList.add('active');
  }

  confirmOkBtn.addEventListener('click', async () => {
    if (!pendingSelectedDate) return;
    const dateToToggle = pendingSelectedDate;
    confirmModal.classList.remove('active');

    if (periods.includes(dateToToggle)) {
      periods = periods.filter((p) => p !== dateToToggle);
      showToast(`Removed period for ${formatDisplayDate(dateToToggle)}`);
    } else {
      periods.push(dateToToggle);
      periods = sortPeriods(periods);
      showToast(`Period logged for ${formatDisplayDate(dateToToggle)}!`);
    }

    await saveState();
    pendingSelectedDate = null;
  });

  confirmCancelBtn.addEventListener('click', () => {
    confirmModal.classList.remove('active');
    pendingSelectedDate = null;
  });

  // --- Calendar Navigation ---
  fabAddPeriodBtn.addEventListener('click', () => {
    currentCalDate = new Date(); // Open to current month
    renderCalendar();
    calendarModal.classList.add('active');
  });

  calCloseBtn.addEventListener('click', () => {
    calendarModal.classList.remove('active');
  });

  calPrevBtn.addEventListener('click', () => {
    currentCalDate.setMonth(currentCalDate.getMonth() - 1);
    renderCalendar();
  });

  calNextBtn.addEventListener('click', () => {
    currentCalDate.setMonth(currentCalDate.getMonth() + 1);
    renderCalendar();
  });

  calTodayBtn.addEventListener('click', () => {
    currentCalDate = new Date();
    renderCalendar();
  });

  // Close modals on clicking outside content
  calendarModal.addEventListener('click', (e) => {
    if (e.target === calendarModal) calendarModal.classList.remove('active');
  });
  confirmModal.addEventListener('click', (e) => {
    if (e.target === confirmModal) confirmModal.classList.remove('active');
  });
  drawerBackdrop.addEventListener('click', (e) => {
    if (e.target === drawerBackdrop) drawerBackdrop.classList.remove('active');
  });
  qrModal.addEventListener('click', (e) => {
    if (e.target === qrModal) qrModal.classList.remove('active');
  });

  // --- Drawer / Menu Navigation ---
  menuBtn.addEventListener('click', () => {
    drawerBackdrop.classList.add('active');
    renderHistoryList();
  });

  drawerCloseBtn.addEventListener('click', () => {
    drawerBackdrop.classList.remove('active');
  });

  // --- History List Rendering ---
  function renderHistoryList() {
    if (!periodsHistoryList) return;
    periodsHistoryList.innerHTML = '';

    if (periods.length === 0) {
      periodsHistoryList.innerHTML = '<div class="empty-state">No period start dates recorded yet.</div>';
      return;
    }

    periods.forEach((p) => {
      const item = document.createElement('div');
      item.className = 'history-item';

      const dateSpan = document.createElement('span');
      dateSpan.className = 'history-date';
      dateSpan.textContent = formatDisplayDate(p);

      const delBtn = document.createElement('button');
      delBtn.className = 'history-del-btn';
      delBtn.setAttribute('aria-label', `Delete period on ${p}`);
      delBtn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
      `;

      delBtn.addEventListener('click', async () => {
        if (confirm(`Remove period starting on ${formatDisplayDate(p)}?`)) {
          periods = periods.filter((itemDate) => itemDate !== p);
          await saveState();
          showToast(`Deleted ${formatDisplayDate(p)}`);
        }
      });

      item.appendChild(dateSpan);
      item.appendChild(delBtn);
      periodsHistoryList.appendChild(item);
    });
  }

  // --- File System Access API (Direct Save File on Device) ---
  const hasFSA = 'showSaveFilePicker' in window;

  if (!hasFSA) {
    if (fsStatusBadge) {
      fsStatusBadge.textContent = 'Not Supported';
      fsStatusBadge.className = 'badge';
    }
    if (fsBtnText) {
      fsBtnText.textContent = 'Use Backup & Restore Below';
    }
    if (fsLinkBtn) {
      fsLinkBtn.disabled = true;
      fsLinkBtn.title = 'Direct file linking is not supported by this browser (e.g., iOS Safari). Use Save Backup or QR Sync instead.';
    }
  }

  async function restoreFileHandle() {
    if (!hasFSA) return;
    try {
      const handle = await idbGet('file_handle');
      if (handle) {
        // Check if permission already granted
        const permission = await handle.queryPermission({ mode: 'readwrite' });
        if (permission === 'granted') {
          activeFileHandle = handle;
          updateFsBadge(handle.name);
        } else {
          // Keep handle in standby, can re-request on click
          updateFsBadge(handle.name + ' (tap to link)');
        }
      }
    } catch (e) {
      console.warn('Could not restore file handle', e);
    }
  }

  function updateFsBadge(filename) {
    if (fsStatusBadge) {
      fsStatusBadge.textContent = filename ? `Linked: ${filename}` : 'Not Linked';
      fsStatusBadge.className = filename ? 'badge badge-success' : 'badge badge-accent';
    }
    if (fsBtnText && filename) {
      fsBtnText.textContent = `Update Linked File (${filename})`;
    }
  }

  async function writeToFileHandle(handle, data) {
    try {
      const permission = await handle.queryPermission({ mode: 'readwrite' });
      if (permission !== 'granted') {
        const requested = await handle.requestPermission({ mode: 'readwrite' });
        if (requested !== 'granted') return;
      }
      const writable = await handle.createWritable();
      const content = JSON.stringify({ version: 1, app: 'phlo', periods: data }, null, 2);
      await writable.write(content);
      await writable.close();
      showToast(`Auto-saved to ${handle.name}`);
    } catch (e) {
      console.warn('Failed to write to file handle', e);
    }
  }

  if (fsLinkBtn && hasFSA) {
    fsLinkBtn.addEventListener('click', async () => {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: 'phlo-data.json',
          types: [{
            description: 'Phlo Save File',
            accept: { 'application/json': ['.json'] }
          }]
        });

        activeFileHandle = handle;
        await idbSet('file_handle', handle);
        await writeToFileHandle(handle, periods);
        updateFsBadge(handle.name);
        showToast(`Save file linked to ${handle.name}!`);
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error(err);
          showToast('Failed to link save file.');
        }
      }
    });
  }

  // --- Manual Backup & Restore (JSON File) ---
  exportJsonBtn.addEventListener('click', () => {
    const backupData = {
      app: 'phlo',
      version: 1,
      exportedAt: new Date().toISOString(),
      periods: periods
    };
    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `phlo-backup-${getTodayISO()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Backup file downloaded!');
  });

  importFileInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const parsed = JSON.parse(evt.target.result);
        let importedPeriods = [];

        if (Array.isArray(parsed)) {
          importedPeriods = parsed;
        } else if (parsed && Array.isArray(parsed.periods)) {
          importedPeriods = parsed.periods;
        }

        // Validate YYYY-MM-DD
        const validPeriods = importedPeriods.filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item));

        if (validPeriods.length === 0) {
          showToast('No valid period dates found in file.');
          return;
        }

        // Merge with existing
        periods = sortPeriods([...periods, ...validPeriods]);
        await saveState();
        showToast(`Imported ${validPeriods.length} period records!`);
        drawerBackdrop.classList.remove('active');
      } catch (err) {
        console.error(err);
        showToast('Invalid backup file.');
      }
      importFileInput.value = '';
    };
    reader.readAsText(file);
  });

  // --- Cross-Device Sync (URL Hash & QR Code) ---
  function getSyncUrl() {
    const jsonStr = JSON.stringify(periods);
    const encoded = encodeURIComponent(btoa(jsonStr));
    const url = new URL(window.location.href);
    url.hash = `sync=${encoded}`;
    return url.href;
  }

  showQrBtn.addEventListener('click', () => {
    const syncUrl = getSyncUrl();
    try {
      if (typeof window.generateQRCodeSVG === 'function') {
        qrDisplay.innerHTML = window.generateQRCodeSVG(syncUrl, 220);
        qrModal.classList.add('active');
      } else {
        showToast('QR Code generator unavailable.');
      }
    } catch (e) {
      console.error(e);
      showToast('Could not generate QR code.');
    }
  });

  qrCloseBtn.addEventListener('click', () => {
    qrModal.classList.remove('active');
  });

  copySyncLinkBtn.addEventListener('click', async () => {
    const syncUrl = getSyncUrl();
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(syncUrl);
        showToast('Sync link copied! Open on any device.');
      } else {
        prompt('Copy this link to open on another device:', syncUrl);
      }
    } catch (e) {
      prompt('Copy this link to open on another device:', syncUrl);
    }
  });

  function checkUrlSync() {
    const hash = window.location.hash;
    if (hash && hash.startsWith('#sync=')) {
      try {
        const raw = hash.replace('#sync=', '');
        const decodedStr = atob(decodeURIComponent(raw));
        const imported = JSON.parse(decodedStr);

        if (Array.isArray(imported) && imported.length > 0) {
          setTimeout(async () => {
            if (confirm(`Sync data detected with ${imported.length} period records. Would you like to import them now?`)) {
              periods = sortPeriods([...periods, ...imported]);
              await saveState();
              showToast(`Imported ${imported.length} period records from link!`);
            }
            // Clear hash
            history.replaceState(null, '', window.location.pathname + window.location.search);
          }, 300);
        }
      } catch (e) {
        console.warn('Failed to parse sync hash', e);
      }
    }
  }

  // --- Export to Calendar (.ics) ---
  exportIcsBtn.addEventListener('click', () => {
    if (periods.length === 0) {
      showToast('No periods to export.');
      return;
    }

    let icsContent = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Phlo//Minimal Cycle Tracker//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH'
    ];

    periods.forEach((p, idx) => {
      const startDate = parseDateISO(p);
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + PERIOD_DURATION_DAYS); // inclusive 5-day span

      const startICS = p.replace(/-/g, '');
      const endICS = formatDateISO(endDate).replace(/-/g, '');

      icsContent.push(
        'BEGIN:VEVENT',
        `UID:phlo-${p}-${idx}@phlo.app`,
        `DTSTAMP:${startICS}T000000Z`,
        `DTSTART;VALUE=DATE:${startICS}`,
        `DTEND;VALUE=DATE:${endICS}`,
        'SUMMARY:Period',
        'DESCRIPTION:Logged via Phlo Cycle Tracker',
        'STATUS:CONFIRMED',
        'END:VEVENT'
      );
    });

    icsContent.push('END:VCALENDAR');

    const blob = new Blob([icsContent.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `phlo-calendar-${getTodayISO()}.ics`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Calendar .ics downloaded!');
  });

  // --- Clear All Data ---
  clearAllDataBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to clear all logged periods? This cannot be undone unless you have a backup file.')) {
      periods = [];
      await saveState();
      showToast('All period data cleared.');
      drawerBackdrop.classList.remove('active');
    }
  });

  // --- Service Worker Registration for Offline PWA ---
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((err) => {
        console.warn('SW registration skipped', err);
      });
    });
  }

  // Initialize
  document.addEventListener('DOMContentLoaded', loadState);
})();
