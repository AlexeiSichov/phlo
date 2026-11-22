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
  const fabHistoryCalendarBtn = document.getElementById('fab-history-calendar');

  // Calendar Elements (Month Sheet)
  const calendarModal = document.getElementById('calendar-modal');
  const calMonthYearEl = document.getElementById('cal-month-year');
  const daysGridEl = document.getElementById('days-grid');
  const calPrevBtn = document.getElementById('cal-prev');
  const calNextBtn = document.getElementById('cal-next');
  const calTodayBtn = document.getElementById('cal-today-btn');
  const calCloseBtn = document.getElementById('cal-close-btn');

  // History Calendar Modal
  const historyModal = document.getElementById('history-modal');
  const historyCalendarScroll = document.getElementById('history-calendar-scroll');
  const historyCloseBtn = document.getElementById('history-close-btn');
  const historyDoneBtn = document.getElementById('history-done-btn');

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

  function getOrdinalSuffix(day) {
    if (day >= 11 && day <= 13) return 'th';
    switch (day % 10) {
      case 1: return 'st';
      case 2: return 'nd';
      case 3: return 'rd';
      default: return 'th';
    }
  }

  function formatMonthDayOrdinal(isoStr) {
    const d = parseDateISO(isoStr);
    const monthName = d.toLocaleDateString('en-US', { month: 'long' });
    const day = d.getDate();
    return `${monthName} ${day}${getOrdinalSuffix(day)}`;
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
    renderHistoryCalendar();
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
    renderHistoryCalendar();
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

  // --- Shared Day Cell Generator ---
  function createDayCell(cellDate, onCellClick) {
    const dayISO = formatDateISO(cellDate);
    const day = cellDate.getDate();
    const todayStr = getTodayISO();

    const cell = document.createElement('div');
    cell.className = 'cal-day-cell';
    cell.dataset.date = dayISO;

    if (dayISO === todayStr) {
      cell.classList.add('is-today');
    }

    // Check 5-day period highlight
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

    if (onCellClick) {
      cell.addEventListener('click', () => onCellClick(dayISO));
    }

    return cell;
  }

  // --- Calendar Logic with Fixed 6-Row Height ---
  function renderCalendar() {
    if (!daysGridEl) return;
    daysGridEl.innerHTML = '';

    const year = currentCalDate.getFullYear();
    const month = currentCalDate.getMonth();

    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    calMonthYearEl.textContent = `${monthNames[month]} ${year}`;

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

    // Map each day
    for (let day = 1; day <= totalDays; day++) {
      const cellDate = new Date(year, month, day);
      const cell = createDayCell(cellDate, (dayISO) => onDayClick(dayISO));
      daysGridEl.appendChild(cell);
    }

    // Pad trailing empty cells up to exactly 42 cells (6 full rows) to eliminate height jiggle
    const filledCells = startDayIndex + totalDays;
    const totalFixedCells = 42;
    for (let i = filledCells; i < totalFixedCells; i++) {
      const emptyCell = document.createElement('div');
      emptyCell.className = 'cal-day-cell empty';
      daysGridEl.appendChild(emptyCell);
    }
  }

  // --- Scrollable History Calendar Rendering ---
  function scrollToCurrentHistoryMonth() {
    if (!historyCalendarScroll) return;
    const curBlock = document.getElementById('history-month-current');
    if (curBlock) {
      const targetTop = curBlock.offsetTop - historyCalendarScroll.offsetTop;
      historyCalendarScroll.scrollTop = targetTop;
    }
  }

  function renderHistoryCalendar() {
    if (!historyCalendarScroll) return;
    historyCalendarScroll.innerHTML = '';

    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth();

    // Determine past months limit: at least 12 months back, or earlier if older periods exist
    let pastLimitDate = new Date(currentYear, currentMonth - 12, 1);
    if (periods.length > 0) {
      const earliestPeriodStr = periods[periods.length - 1]; // sorted descending
      const earliestDate = parseDateISO(earliestPeriodStr);
      const earliestMonthStart = new Date(earliestDate.getFullYear(), earliestDate.getMonth() - 1, 1);
      if (earliestMonthStart < pastLimitDate) {
        pastLimitDate = earliestMonthStart;
      }
    } else {
      const notice = document.createElement('div');
      notice.className = 'history-empty-notice';
      notice.innerHTML = '<strong>No periods logged yet.</strong><br>Tap the + button to log your first period.';
      historyCalendarScroll.appendChild(notice);
    }

    // Determine future months limit: 12 months into the future
    const futureLimitDate = new Date(currentYear, currentMonth + 12, 1);

    // Build months list in chronological order (past at top, future at bottom)
    const monthsToRender = [];
    let iter = new Date(pastLimitDate.getFullYear(), pastLimitDate.getMonth(), 1);
    while (iter <= futureLimitDate) {
      monthsToRender.push({
        year: iter.getFullYear(),
        month: iter.getMonth(),
        isCurrent: iter.getFullYear() === currentYear && iter.getMonth() === currentMonth
      });
      iter.setMonth(iter.getMonth() + 1);
    }

    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];

    monthsToRender.forEach(({ year, month, isCurrent }) => {
      const block = document.createElement('div');
      block.className = 'history-month-block';
      if (isCurrent) {
        block.id = 'history-month-current';
      }

      const title = document.createElement('div');
      title.className = 'history-month-title';
      if (isCurrent) {
        title.innerHTML = `${monthNames[month]} ${year} <span class="today-tag">Current</span>`;
      } else {
        title.textContent = `${monthNames[month]} ${year}`;
      }
      block.appendChild(title);

      const weekdays = document.createElement('div');
      weekdays.className = 'weekdays-grid';
      weekdays.innerHTML = '<span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span>';
      block.appendChild(weekdays);

      const grid = document.createElement('div');
      grid.className = 'days-grid-history';

      const firstDay = new Date(year, month, 1);
      const lastDay = new Date(year, month + 1, 0);
      const totalDays = lastDay.getDate();

      let startDayIndex = firstDay.getDay() - 1;
      if (startDayIndex === -1) startDayIndex = 6;

      for (let i = 0; i < startDayIndex; i++) {
        const empty = document.createElement('div');
        empty.className = 'cal-day-cell empty';
        grid.appendChild(empty);
      }

      for (let day = 1; day <= totalDays; day++) {
        const cellDate = new Date(year, month, day);
        const cell = createDayCell(cellDate, (dayISO) => onDayClick(dayISO));
        grid.appendChild(cell);
      }

      block.appendChild(grid);
      historyCalendarScroll.appendChild(block);
    });
  }

  // --- Day Click & Confirmation Dialog ---
  function onDayClick(dayISO) {
    pendingSelectedDate = dayISO;
    const formatted = formatMonthDayOrdinal(dayISO);
    const isAlreadyStart = periods.includes(dayISO);

    if (isAlreadyStart) {
      confirmTitleEl.textContent = 'Remove period';
      confirmMsgEl.textContent = `Remove period starting on ${formatted}?`;
      confirmOkBtn.textContent = 'Remove';
      confirmOkBtn.className = 'btn btn-danger';
    } else {
      confirmTitleEl.textContent = 'Log period';
      confirmMsgEl.textContent = `Mark ${formatted} as the first day of your period?`;
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
      showToast(`Removed period for ${formatMonthDayOrdinal(dateToToggle)}`);
    } else {
      periods.push(dateToToggle);
      periods = sortPeriods(periods);
      showToast(`Period logged for ${formatMonthDayOrdinal(dateToToggle)}!`);
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

  // --- History Calendar Navigation ---
  if (fabHistoryCalendarBtn) {
    fabHistoryCalendarBtn.addEventListener('click', () => {
      renderHistoryCalendar();
      historyModal.classList.add('active');
      // Scroll to current month immediately and during animation
      requestAnimationFrame(() => {
        scrollToCurrentHistoryMonth();
        setTimeout(scrollToCurrentHistoryMonth, 50);
        setTimeout(scrollToCurrentHistoryMonth, 220);
      });
    });
  }

  if (historyCloseBtn) {
    historyCloseBtn.addEventListener('click', () => {
      historyModal.classList.remove('active');
    });
  }

  if (historyDoneBtn) {
    historyDoneBtn.addEventListener('click', () => {
      historyModal.classList.remove('active');
    });
  }

  // Close modals on clicking outside content
  calendarModal.addEventListener('click', (e) => {
    if (e.target === calendarModal) calendarModal.classList.remove('active');
  });
  if (historyModal) {
    historyModal.addEventListener('click', (e) => {
      if (e.target === historyModal) historyModal.classList.remove('active');
    });
  }
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
  });

  drawerCloseBtn.addEventListener('click', () => {
    drawerBackdrop.classList.remove('active');
  });

  // --- File System Access API (Direct Save File on Device) ---
  const hasFSA = 'showSaveFilePicker' in window;

  if (!hasFSA) {
    if (fsStatusBadge) {
      fsStatusBadge.textContent = 'Not Supported';
      fsStatusBadge.className = 'badge';
    }
    if (fsBtnText) {
      fsBtnText.textContent = 'Link Save File (Not Supported on iOS)';
    }
    if (fsLinkBtn) {
      fsLinkBtn.disabled = true;
      fsLinkBtn.setAttribute('disabled', 'true');
      fsLinkBtn.classList.add('btn-disabled');
      fsLinkBtn.title = 'Direct file access is restricted by Apple on iOS browsers. Use Save Backup or QR Code Sync below instead.';
    }
    const fsDesc = document.querySelector('#fs-card .section-desc');
    if (fsDesc) {
      fsDesc.textContent = 'Direct file writing is not supported by iOS browsers (Apple restricts background filesystem access). Use Save Backup or QR Code Sync below to keep your data safe and transfer between devices.';
    }
  }

  async function restoreFileHandle() {
    if (!hasFSA) return;
    try {
      const handle = await idbGet('file_handle');
      if (handle) {
        const permission = await handle.queryPermission({ mode: 'readwrite' });
        if (permission === 'granted') {
          activeFileHandle = handle;
          updateFsBadge(handle.name);
        } else {
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
    if (fsBtnText) {
      fsBtnText.textContent = filename ? `Update Save File (${filename})` : 'Link Save File';
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
  exportJsonBtn.addEventListener('click', async () => {
    const backupData = {
      app: 'phlo',
      version: 1,
      exportedAt: new Date().toISOString(),
      periods: periods
    };
    const jsonStr = JSON.stringify(backupData, null, 2);
    const fileName = `phlo-backup-${getTodayISO()}.json`;
    const blob = new Blob([jsonStr], { type: 'application/json' });

    // On iOS / mobile with Web Share file support, trigger native iOS Share Sheet ("Save to Files")
    if (navigator.canShare) {
      try {
        const file = new File([blob], fileName, { type: 'application/json' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: 'Phlo Backup',
            text: 'Phlo cycle tracker backup file'
          });
          showToast('Backup shared / saved!');
          return;
        }
      } catch (err) {
        if (err.name === 'AbortError') return; // User cancelled share sheet
      }
    }

    // Standard download fallback
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
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
