/**
 * Phlo — Minimal Cycle Tracker
 * Core Application Logic
 */

(function () {
  'use strict';

  // --- Constants & Config ---
  const STORAGE_KEY = 'phlo_periods';
  const WALKTHROUGH_KEY = 'phlo_walkthrough_done';
  const DB_NAME = 'phlo_db';
  const DB_STORE = 'keyval';
  const DATA_CACHE_NAME = 'phlo-user-data-v1';
  const DATA_CACHE_KEY = './phlo-data-store.json';
  const BACKUP_FILENAME = 'phlo-data.json';
  const PERIOD_DURATION_DAYS = 5;

  // --- Platform & Capability Detection ---
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const hasFSA = !isIOS && ('showSaveFilePicker' in window);
  const hasOpenFSA = !isIOS && ('showOpenFilePicker' in window);
  const isStandalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    window.navigator.standalone === true;
  const isChromiumLike = !isIOS && (/Chrome|Chromium|Edg|OPR|SamsungBrowser/.test(navigator.userAgent) || !!window.chrome);

  // --- State ---
  let periods = []; // Array of 'YYYY-MM-DD' start dates, sorted descending
  let activeFileHandle = null; // Linked file handle with 'granted' readwrite permission
  let pendingFileHandle = null; // Stored file handle needing permission re-prompt ('prompt')
  let deferredInstallPrompt = null; // Captured beforeinstallprompt event
  let isAppInstalled = isStandalone;
  let currentCalDate = new Date(); // Month currently displayed
  let pendingSelectedDate = null; // Date clicked for confirmation
  let walkthroughSteps = [];
  let walkthroughIndex = 0;

  // --- DOM Elements ---
  const cycleNumberEl = document.getElementById('cycle-number');
  const cycleLabelEl = document.getElementById('cycle-label');
  const cycleSubtextEl = document.getElementById('cycle-subtext');
  const statusPillTextEl = document.getElementById('status-pill-text');
  const recentCyclesListEl = document.getElementById('recent-cycles-list');
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
  const fsCardTitle = document.getElementById('fs-card-title');
  const fsCardDesc = document.getElementById('fs-card-desc');
  const fsStatusBadge = document.getElementById('fs-status-badge');
  const fsLinkBtn = document.getElementById('fs-link-btn');
  const fsBtnText = document.getElementById('fs-btn-text');
  const fsUnlinkBtn = document.getElementById('fs-unlink-btn');
  const exportJsonBtn = document.getElementById('export-json-btn');
  const importFileInput = document.getElementById('import-file-input');
  const showQrBtn = document.getElementById('show-qr-btn');
  const copySyncLinkBtn = document.getElementById('copy-sync-link-btn');
  const exportIcsBtn = document.getElementById('export-ics-btn');
  const openWalkthroughBtn = document.getElementById('open-walkthrough-btn');
  const clearAllDataBtn = document.getElementById('clear-all-data-btn');

  // File Link / Backup Prompt Modal
  const filePromptModal = document.getElementById('file-prompt-modal');
  const filePromptTitleEl = document.getElementById('file-prompt-title');
  const filePromptMsgEl = document.getElementById('file-prompt-message');
  const filePromptPrimaryBtn = document.getElementById('file-prompt-primary-btn');
  const filePromptSecondaryBtn = document.getElementById('file-prompt-secondary-btn');
  const filePromptDismissBtn = document.getElementById('file-prompt-dismiss-btn');

  // Walkthrough Modal
  const walkthroughModal = document.getElementById('walkthrough-modal');
  const wtStepBadge = document.getElementById('wt-step-badge');
  const wtSkipBtn = document.getElementById('wt-skip-btn');
  const wtDots = document.getElementById('wt-dots');
  const wtBody = document.getElementById('wt-body');
  const wtFooter = document.getElementById('wt-footer');

  // QR Modal
  const qrModal = document.getElementById('qr-modal');
  const qrDisplay = document.getElementById('qr-code-display');
  const qrCloseBtn = document.getElementById('qr-close-btn');

  // Toast
  const toastEl = document.getElementById('toast');

  // --- PWA Install Events ---
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (walkthroughModal && walkthroughModal.classList.contains('active')) {
      renderWalkthroughStep();
    }
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    isAppInstalled = true;
    showToast('Phlo installed on your device!');
    if (walkthroughModal && walkthroughModal.classList.contains('active')) {
      const step = walkthroughSteps[walkthroughIndex];
      if (step && step.id === 'install') {
        advanceWalkthrough();
      } else {
        renderWalkthroughStep();
      }
    }
  });

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

  function addDays(isoStr, numDays) {
    const [y, m, d] = isoStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d + numDays);
    return formatDateISO(dt);
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

  // --- Cache API Data Store ---
  async function cacheGetPeriods() {
    if (!('caches' in window)) return null;
    try {
      const cache = await caches.open(DATA_CACHE_NAME);
      const resp = await cache.match(DATA_CACHE_KEY);
      if (!resp) return null;
      const parsed = await resp.json();
      if (Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray(parsed.periods)) return parsed.periods;
      return null;
    } catch (e) {
      console.warn('Cache API load failed', e);
      return null;
    }
  }

  async function cacheSetPeriods(arr) {
    if (!('caches' in window)) return false;
    try {
      const cache = await caches.open(DATA_CACHE_NAME);
      const payload = JSON.stringify({
        version: 1,
        app: 'phlo',
        updatedAt: new Date().toISOString(),
        periods: arr
      });
      await cache.put(DATA_CACHE_KEY, new Response(payload, {
        headers: { 'Content-Type': 'application/json' }
      }));
      return true;
    } catch (e) {
      console.warn('Cache API save failed', e);
      return false;
    }
  }

  async function requestPersistentStorage() {
    if (!(navigator.storage && navigator.storage.persist)) return false;
    try {
      let isPersisted = false;
      if (navigator.storage.persisted) {
        isPersisted = await navigator.storage.persisted();
      }
      if (!isPersisted) {
        isPersisted = await navigator.storage.persist();
      }
      if (storageStatusBadge) {
        storageStatusBadge.textContent = isPersisted ? 'Persistent' : 'Standard';
        storageStatusBadge.className = isPersisted ? 'badge badge-success' : 'badge';
      }
      return isPersisted;
    } catch (e) {
      console.warn('Persistent storage request failed', e);
      return false;
    }
  }

  // --- Data Persistence ---
  function sortPeriods(arr) {
    const valid = arr.filter((item) => typeof item === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item));
    return Array.from(new Set(valid)).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  }

  function buildBackupPayload(data) {
    return {
      app: 'phlo',
      version: 1,
      exportedAt: new Date().toISOString(),
      periods: data
    };
  }

  function saveBrowserStorageSync() {
    // 1. LocalStorage
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(periods));
    } catch (e) {
      console.warn('LocalStorage save failed', e);
    }

    // 2. Update Live URL Hash for automatic bookmark sync
    updateLiveUrlHash();

    // 3. Refresh UI
    updateCycleDisplay();
    renderRecentCycles();
    renderCalendar();
    renderHistoryCalendar();
  }

  async function saveBrowserStorageAsync() {
    // IndexedDB + Cache API + request persistence
    await Promise.all([
      idbSet('periods', periods),
      cacheSetPeriods(periods),
      requestPersistentStorage()
    ]);
  }

  async function saveState(options = {}) {
    saveBrowserStorageSync();
    await saveBrowserStorageAsync();

    // File System Access API (if linked & granted)
    if (!options.skipFileWrite && hasFSA && activeFileHandle) {
      const res = await writeToFileHandle(activeFileHandle, periods);
      if (!res.ok) {
        updateFsBadge(activeFileHandle.name, 'needs-permission');
      }
    }
  }

  async function loadState() {
    let lsPeriods = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) lsPeriods = sortPeriods(parsed);
      }
    } catch (e) {
      console.warn('LocalStorage load failed', e);
    }

    const [idbRaw, cacheRaw] = await Promise.all([
      idbGet('periods'),
      cacheGetPeriods()
    ]);
    const idbPeriods = Array.isArray(idbRaw) ? sortPeriods(idbRaw) : null;
    const cachePeriods = Array.isArray(cacheRaw) ? sortPeriods(cacheRaw) : null;

    // Pick first non-empty store, or fall back to empty array
    let loaded = [];
    let needsBackfill = false;

    if (lsPeriods && lsPeriods.length > 0) {
      loaded = lsPeriods;
      if (!idbPeriods || idbPeriods.length === 0 || !cachePeriods || cachePeriods.length === 0) {
        needsBackfill = true;
      }
    } else if (idbPeriods && idbPeriods.length > 0) {
      loaded = idbPeriods;
      needsBackfill = true;
    } else if (cachePeriods && cachePeriods.length > 0) {
      loaded = cachePeriods;
      needsBackfill = true;
    }

    periods = loaded;

    // Check for linked file handle
    await restoreFileHandle();

    // Check URL Hash for Cross-device sync or bookmark data
    const hadUrlSync = checkUrlSync();

    // Backfill all browser storage layers if one was recovered
    if (needsBackfill && periods.length > 0) {
      saveBrowserStorageSync();
      await saveBrowserStorageAsync();
    } else {
      await requestPersistentStorage();
    }

    updateCycleDisplay();
    renderRecentCycles();
    renderCalendar();
    renderHistoryCalendar();

    // Show first-time walkthrough if no data is stored yet and user hasn't finished/skipped it
    const wtDone = await isWalkthroughDone();
    if (periods.length === 0 && !hadUrlSync && !wtDone) {
      openWalkthrough();
    }
  }

  // --- Live URL Bookmark Hash Updating ---
  function updateLiveUrlHash() {
    if (periods && periods.length > 0) {
      const jsonStr = JSON.stringify(periods);
      const encoded = encodeURIComponent(btoa(jsonStr));
      history.replaceState(null, '', window.location.pathname + `#data=${encoded}`);
    } else {
      history.replaceState(null, '', window.location.pathname);
    }
  }

  // --- Render 10 Last Periods / Cycles on Main Page ---
  function renderRecentCycles() {
    if (!recentCyclesListEl) return;
    recentCyclesListEl.innerHTML = '';

    if (periods.length === 0) {
      recentCyclesListEl.innerHTML = '<div class="recent-cycles-empty">No cycle history yet. Tap + to log your period.</div>';
      return;
    }

    const todayStr = getTodayISO();
    const count = Math.min(periods.length, 10);

    for (let i = 0; i < count; i++) {
      const startISO = periods[i];
      let endText = '';
      let isCurrent = false;
      let days = 0;

      if (i === 0) {
        // Most recent period
        if (startISO <= todayStr) {
          isCurrent = true;
          endText = 'Ongoing';
          days = daysDifference(todayStr, startISO) + 1;
        } else {
          // Future period
          endText = 'Upcoming';
          days = daysDifference(startISO, todayStr);
        }
      } else {
        // Completed cycle
        const nextPeriodStart = periods[i - 1];
        days = daysDifference(nextPeriodStart, startISO);
        const endISO = addDays(nextPeriodStart, -1);
        endText = formatDisplayDate(endISO);
      }

      // Proportional bar width (28-35 days standard cycle, clamp 14% to 100%)
      const barPercent = Math.min(100, Math.max(14, (days / 35) * 100));

      const card = document.createElement('div');
      card.className = 'cycle-row-card';

      const datesRow = document.createElement('div');
      datesRow.className = 'cycle-row-dates';

      const startSpan = document.createElement('span');
      startSpan.className = 'cycle-date-start';
      startSpan.textContent = formatDisplayDate(startISO);

      const endSpan = document.createElement('span');
      endSpan.className = `cycle-date-end ${isCurrent ? 'is-current' : ''}`;
      endSpan.textContent = endText;

      datesRow.appendChild(startSpan);
      datesRow.appendChild(endSpan);

      const barWrap = document.createElement('div');
      barWrap.className = 'cycle-row-bar-wrap';

      const track = document.createElement('div');
      track.className = 'cycle-bar-track';

      const fill = document.createElement('div');
      fill.className = `cycle-bar-fill ${isCurrent ? 'is-ongoing' : ''}`;
      fill.style.width = `${barPercent}%`;
      track.appendChild(fill);

      const daysSpan = document.createElement('span');
      daysSpan.className = 'cycle-days-count';
      daysSpan.textContent = `${days} day${days === 1 ? '' : 's'}`;

      barWrap.appendChild(track);
      barWrap.appendChild(daysSpan);

      card.appendChild(datesRow);
      card.appendChild(barWrap);

      recentCyclesListEl.appendChild(card);
    }
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
    const wasAlreadyStart = periods.includes(dateToToggle);
    confirmModal.classList.remove('active');
    pendingSelectedDate = null;

    if (wasAlreadyStart) {
      periods = periods.filter((p) => p !== dateToToggle);
      showToast(`Removed period for ${formatMonthDayOrdinal(dateToToggle)}`);
    } else {
      periods.push(dateToToggle);
      periods = sortPeriods(periods);
      showToast(`Period logged for ${formatMonthDayOrdinal(dateToToggle)}!`);
    }

    // Save synchronously to LocalStorage and update UI immediately
    saveBrowserStorageSync();

    // Start IndexedDB + Cache API saves in parallel (do not await before gesture-sensitive APIs)
    const asyncSavePromise = saveBrowserStorageAsync();

    // Platform backup guarantee while user activation from Confirm tap is active
    if (isIOS) {
      await triggerIOSFileBackup(periods);
    } else if (hasFSA) {
      await ensureFileBackupOnLog(periods);
    }

    await asyncSavePromise;
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
  if (filePromptModal) {
    filePromptModal.addEventListener('click', (e) => {
      if (e.target === filePromptModal) filePromptModal.classList.remove('active');
    });
  }

  // --- Drawer / Menu Navigation ---
  menuBtn.addEventListener('click', () => {
    drawerBackdrop.classList.add('active');
  });

  drawerCloseBtn.addEventListener('click', () => {
    drawerBackdrop.classList.remove('active');
  });

  // --- File System Access API & Platform Backup Handling ---
  function initPlatformFileUI() {
    if (hasFSA) return;

    if (isIOS) {
      if (fsCardTitle) fsCardTitle.textContent = 'iOS Files Backup';
      if (fsStatusBadge) {
        fsStatusBadge.textContent = 'Files Menu Active';
        fsStatusBadge.className = 'badge badge-success';
      }
      if (fsCardDesc) {
        fsCardDesc.innerHTML = 'Apple restricts background file writing on iOS, so Phlo opens the Files menu with <code>phlo-data.json</code> on every period log. Choose <strong>Save to Files → On My iPhone → phlo</strong>.';
      }
      if (fsLinkBtn) fsLinkBtn.style.display = 'none';
      if (fsUnlinkBtn) fsUnlinkBtn.style.display = 'none';
    } else {
      if (fsStatusBadge) {
        fsStatusBadge.textContent = 'Unavailable';
        fsStatusBadge.className = 'badge';
      }
      if (fsBtnText) {
        fsBtnText.textContent = 'File Linking Unavailable in Browser';
      }
      if (fsLinkBtn) {
        fsLinkBtn.disabled = true;
        fsLinkBtn.setAttribute('disabled', 'true');
        fsLinkBtn.classList.add('btn-disabled');
      }
      if (fsCardDesc) {
        fsCardDesc.innerHTML = "This browser does not support background file linking. Your logs are saved to your browser's storage. Use <strong>Save Backup</strong> below to export <code>phlo-data.json</code>.";
      }
    }
  }

  initPlatformFileUI();

  function updateFsBadge(filename, state) {
    if (!hasFSA) return;
    if (fsStatusBadge) {
      if (state === 'linked' && filename) {
        fsStatusBadge.textContent = `Linked: ${filename}`;
        fsStatusBadge.className = 'badge badge-success';
      } else if (state === 'needs-permission' && filename) {
        fsStatusBadge.textContent = `Needs Access: ${filename}`;
        fsStatusBadge.className = 'badge badge-warning';
      } else {
        fsStatusBadge.textContent = 'Not Linked';
        fsStatusBadge.className = 'badge badge-accent';
      }
    }

    if (fsBtnText && fsLinkBtn) {
      if (state === 'linked' && filename) {
        fsBtnText.textContent = `Change File (${filename})`;
        fsLinkBtn.className = 'btn btn-outline btn-full';
      } else if (state === 'needs-permission' && filename) {
        fsBtnText.textContent = `Re-authorize ${filename}`;
        fsLinkBtn.className = 'btn btn-primary btn-full';
      } else {
        fsBtnText.textContent = `Link ${BACKUP_FILENAME}`;
        fsLinkBtn.className = 'btn btn-primary btn-full';
      }
    }

    if (fsUnlinkBtn) {
      fsUnlinkBtn.style.display = filename ? 'inline-flex' : 'none';
    }
  }

  async function restoreFileHandle() {
    if (!hasFSA) return;
    try {
      const handle = await idbGet('file_handle');
      if (!handle) {
        activeFileHandle = null;
        pendingFileHandle = null;
        updateFsBadge(null, 'unlinked');
        return;
      }

      const permission = await handle.queryPermission({ mode: 'readwrite' });
      if (permission === 'granted') {
        activeFileHandle = handle;
        pendingFileHandle = null;
        updateFsBadge(handle.name, 'linked');
      } else {
        activeFileHandle = null;
        pendingFileHandle = handle;
        updateFsBadge(handle.name, 'needs-permission');
      }
    } catch (e) {
      console.warn('Could not restore file handle', e);
      activeFileHandle = null;
      pendingFileHandle = null;
      updateFsBadge(null, 'unlinked');
    }
  }

  async function mergePeriodsFromFile(handle) {
    try {
      const file = await handle.getFile();
      if (!file || file.size === 0) return 0;
      const text = await file.text();
      if (!text || !text.trim()) return 0;

      const parsed = JSON.parse(text);
      const rawPeriods = Array.isArray(parsed)
        ? parsed
        : (parsed && Array.isArray(parsed.periods) ? parsed.periods : []);
      const valid = rawPeriods.filter((item) => typeof item === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item));
      if (valid.length === 0) return 0;

      const beforeCount = periods.length;
      periods = sortPeriods([...periods, ...valid]);
      return Math.max(0, periods.length - beforeCount);
    } catch (e) {
      return 0;
    }
  }

  async function writeToFileHandle(handle, data) {
    try {
      const permission = await handle.queryPermission({ mode: 'readwrite' });
      if (permission !== 'granted') {
        const requested = await handle.requestPermission({ mode: 'readwrite' });
        if (requested !== 'granted') {
          return { ok: false, reason: 'permission' };
        }
      }
      const writable = await handle.createWritable();
      const content = JSON.stringify(buildBackupPayload(data), null, 2);
      await writable.write(content);
      await writable.close();
      showToast(`Auto-saved to ${handle.name}`);
      return { ok: true };
    } catch (e) {
      console.warn('Failed to write to file handle', e);
      return { ok: false, reason: 'write-error', error: e };
    }
  }

  async function linkSaveFile() {
    if (!hasFSA) return false;
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: BACKUP_FILENAME,
        types: [{
          description: 'Phlo Save File',
          accept: { 'application/json': ['.json'] }
        }]
      });

      // Merge any existing records before writing so an existing backup is never wiped
      const addedCount = await mergePeriodsFromFile(handle);
      activeFileHandle = handle;
      pendingFileHandle = null;
      await idbSet('file_handle', handle);

      const writeRes = await writeToFileHandle(handle, periods);
      if (!writeRes.ok) {
        showToast('Could not write to selected file.');
        updateFsBadge(handle.name, 'needs-permission');
        return false;
      }

      if (addedCount > 0) {
        await saveState({ skipFileWrite: true });
      }
      updateFsBadge(handle.name, 'linked');
      showToast(addedCount > 0
        ? `Linked ${handle.name} and restored ${addedCount} record${addedCount === 1 ? '' : 's'}!`
        : `Backup linked to ${handle.name}!`);
      return true;
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error(err);
        showToast('Failed to link save file.');
      }
      return false;
    }
  }

  async function linkExistingFile() {
    if (!hasOpenFSA) return false;
    try {
      const [handle] = await window.showOpenFilePicker({
        multiple: false,
        types: [{
          description: 'Phlo Backup JSON',
          accept: { 'application/json': ['.json'] }
        }]
      });
      if (!handle) return false;

      const perm = await handle.requestPermission({ mode: 'readwrite' });
      const addedCount = await mergePeriodsFromFile(handle);

      if (perm === 'granted') {
        activeFileHandle = handle;
        pendingFileHandle = null;
        await idbSet('file_handle', handle);
        await writeToFileHandle(handle, periods);
        updateFsBadge(handle.name, 'linked');
      } else {
        updateFsBadge(null, 'unlinked');
      }

      await saveState({ skipFileWrite: true });
      showToast(addedCount > 0
        ? `Restored ${addedCount} record${addedCount === 1 ? '' : 's'} and linked ${handle.name}!`
        : `Linked existing ${handle.name}!`);
      return perm === 'granted';
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error(err);
        showToast('Could not open backup file.');
      }
      return false;
    }
  }

  async function reauthorizePendingFile() {
    if (!pendingFileHandle) return false;
    try {
      const perm = await pendingFileHandle.requestPermission({ mode: 'readwrite' });
      if (perm !== 'granted') return false;

      activeFileHandle = pendingFileHandle;
      pendingFileHandle = null;
      const writeRes = await writeToFileHandle(activeFileHandle, periods);
      if (!writeRes.ok) {
        activeFileHandle = null;
        updateFsBadge(null, 'unlinked');
        return false;
      }
      updateFsBadge(activeFileHandle.name, 'linked');
      return true;
    } catch (e) {
      console.warn('Re-authorization failed', e);
      return false;
    }
  }

  function openFileLinkPrompt(reason) {
    if (!filePromptModal) return;

    if (reason === 'ios-share-fallback') {
      filePromptTitleEl.textContent = `Save ${BACKUP_FILENAME}`;
      filePromptMsgEl.innerHTML = `Tap below to open the iOS Files menu and save <code>${BACKUP_FILENAME}</code> (recommended folder: <strong>On My iPhone → phlo</strong>).`;
      filePromptPrimaryBtn.textContent = `Save ${BACKUP_FILENAME} to Files`;
      filePromptSecondaryBtn.style.display = 'none';
      filePromptPrimaryBtn.onclick = async () => {
        filePromptModal.classList.remove('active');
        await triggerIOSFileBackup(periods, true);
      };
      filePromptDismissBtn.onclick = () => {
        filePromptModal.classList.remove('active');
      };
      filePromptModal.classList.add('active');
      return;
    }

    if (reason === 'needs-permission' && pendingFileHandle) {
      filePromptTitleEl.textContent = 'Re-authorize Backup File';
      filePromptMsgEl.innerHTML = `Your browser paused write access to <code>${pendingFileHandle.name}</code> after closing. Re-authorize it so this log is saved to disk.`;
      filePromptPrimaryBtn.textContent = `Allow Access to ${pendingFileHandle.name}`;
      filePromptSecondaryBtn.style.display = 'inline-flex';
      filePromptSecondaryBtn.textContent = `Pick a New ${BACKUP_FILENAME}`;
      filePromptPrimaryBtn.onclick = async () => {
        const ok = await reauthorizePendingFile();
        if (ok) {
          filePromptModal.classList.remove('active');
        } else {
          showToast('Permission not granted. Try picking a file instead.');
        }
      };
      filePromptSecondaryBtn.onclick = async () => {
        const ok = await linkSaveFile();
        if (ok) filePromptModal.classList.remove('active');
      };
    } else if (reason === 'broken') {
      filePromptTitleEl.textContent = 'Re-link Backup File';
      filePromptMsgEl.innerHTML = `Phlo couldn't write to your previously linked file (it may have been moved or deleted). Link <code>${BACKUP_FILENAME}</code> again so no log goes missing.`;
      filePromptPrimaryBtn.textContent = `Link ${BACKUP_FILENAME}`;
      if (hasOpenFSA) {
        filePromptSecondaryBtn.style.display = 'inline-flex';
        filePromptSecondaryBtn.textContent = 'Load & Link Existing File';
        filePromptSecondaryBtn.onclick = async () => {
          const ok = await linkExistingFile();
          if (ok) filePromptModal.classList.remove('active');
        };
      } else {
        filePromptSecondaryBtn.style.display = 'none';
      }
      filePromptPrimaryBtn.onclick = async () => {
        const ok = await linkSaveFile();
        if (ok) filePromptModal.classList.remove('active');
      };
    } else {
      filePromptTitleEl.textContent = `Link ${BACKUP_FILENAME}`;
      filePromptMsgEl.innerHTML = `Your log is saved in the browser, but no backup file is linked yet. Link <code>${BACKUP_FILENAME}</code> so every log is auto-saved on your device.`;
      filePromptPrimaryBtn.textContent = `Link ${BACKUP_FILENAME}`;
      if (hasOpenFSA) {
        filePromptSecondaryBtn.style.display = 'inline-flex';
        filePromptSecondaryBtn.textContent = 'Load & Link Existing File';
        filePromptSecondaryBtn.onclick = async () => {
          const ok = await linkExistingFile();
          if (ok) filePromptModal.classList.remove('active');
        };
      } else {
        filePromptSecondaryBtn.style.display = 'none';
      }
      filePromptPrimaryBtn.onclick = async () => {
        const ok = await linkSaveFile();
        if (ok) filePromptModal.classList.remove('active');
      };
    }

    filePromptDismissBtn.onclick = () => {
      filePromptModal.classList.remove('active');
    };
    filePromptModal.classList.add('active');
  }

  async function ensureFileBackupOnLog(data) {
    if (activeFileHandle) {
      const res = await writeToFileHandle(activeFileHandle, data);
      if (res.ok) return true;

      if (res.reason === 'permission') {
        pendingFileHandle = activeFileHandle;
        activeFileHandle = null;
        updateFsBadge(pendingFileHandle.name, 'needs-permission');
        openFileLinkPrompt('needs-permission');
      } else {
        activeFileHandle = null;
        pendingFileHandle = null;
        await idbSet('file_handle', null);
        updateFsBadge(null, 'unlinked');
        openFileLinkPrompt('broken');
      }
      return false;
    }

    if (pendingFileHandle) {
      const ok = await reauthorizePendingFile();
      if (ok) return true;
      openFileLinkPrompt('needs-permission');
      return false;
    }

    openFileLinkPrompt('unlinked');
    return false;
  }

  if (fsLinkBtn && hasFSA) {
    fsLinkBtn.addEventListener('click', async () => {
      if (pendingFileHandle && !activeFileHandle) {
        const ok = await reauthorizePendingFile();
        if (ok) return;
      }
      await linkSaveFile();
    });
  }

  if (fsUnlinkBtn && hasFSA) {
    fsUnlinkBtn.addEventListener('click', async () => {
      const name = (activeFileHandle && activeFileHandle.name) || (pendingFileHandle && pendingFileHandle.name) || BACKUP_FILENAME;
      if (confirm(`Unlink save file (${name})? Your cycle history remains in browser storage, and Phlo will prompt you to re-link on your next period log.`)) {
        activeFileHandle = null;
        pendingFileHandle = null;
        await idbSet('file_handle', null);
        updateFsBadge(null, 'unlinked');
        showToast('Save file unlinked.');
      }
    });
  }

  // --- Shared Export / iOS Files Trigger ---
  function triggerBlobDownload(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function triggerIOSFileBackup(data, fromFallbackModal = false) {
    const jsonStr = JSON.stringify(buildBackupPayload(data), null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const file = new File([blob], BACKUP_FILENAME, { type: 'application/json' });

    if (navigator.canShare) {
      try {
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: BACKUP_FILENAME,
            text: 'Save phlo-data.json to Files (On My iPhone → phlo)'
          });
          showToast(`Saved / shared ${BACKUP_FILENAME}!`);
          return true;
        }
      } catch (err) {
        if (err.name === 'AbortError') return false;
        if (err.name === 'NotAllowedError' && !fromFallbackModal) {
          openFileLinkPrompt('ios-share-fallback');
          return false;
        }
      }
    }

    // Download fallback if Web Share files isn't supported
    triggerBlobDownload(blob, BACKUP_FILENAME);
    showToast(`Downloaded ${BACKUP_FILENAME}!`);
    return true;
  }

  // --- Manual Backup & Restore (JSON File) ---
  exportJsonBtn.addEventListener('click', async () => {
    const jsonStr = JSON.stringify(buildBackupPayload(periods), null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });

    if (navigator.canShare) {
      try {
        const file = new File([blob], BACKUP_FILENAME, { type: 'application/json' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: BACKUP_FILENAME,
            text: 'Phlo cycle tracker backup file'
          });
          showToast(`Saved / shared ${BACKUP_FILENAME}!`);
          return;
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }

    triggerBlobDownload(blob, BACKUP_FILENAME);
    showToast(`${BACKUP_FILENAME} downloaded!`);
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

        const validPeriods = importedPeriods.filter((item) => typeof item === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item));

        if (validPeriods.length === 0) {
          showToast('No valid period dates found in file.');
          return;
        }

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
    if (!hash) return false;

    // 1. Live Bookmark Data (#data=...)
    if (hash.startsWith('#data=')) {
      try {
        const raw = hash.replace('#data=', '');
        const decodedStr = atob(decodeURIComponent(raw));
        const imported = JSON.parse(decodedStr);

        if (Array.isArray(imported) && imported.length > 0) {
          if (periods.length === 0) {
            periods = sortPeriods(imported);
            saveState();
            showToast(`Restored ${periods.length} cycles from the URL!`);
            return true;
          } else {
            const merged = sortPeriods([...periods, ...imported]);
            if (merged.length !== periods.length) {
              periods = merged;
              saveState();
            }
            return true;
          }
        }
      } catch (e) {
        console.warn('Failed to parse #data hash', e);
      }
      return false;
    }

    // 2. Cross-Device Sync Link (#sync=...)
    if (hash.startsWith('#sync=')) {
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
            updateLiveUrlHash();
          }, 300);
          return true;
        }
      } catch (e) {
        console.warn('Failed to parse sync hash', e);
      }
    }
    return false;
  }

  // --- First-Time Walkthrough ---
  async function isWalkthroughDone() {
    try {
      if (localStorage.getItem(WALKTHROUGH_KEY) === '1') return true;
    } catch (e) {}
    const fromIdb = await idbGet(WALKTHROUGH_KEY);
    return fromIdb === true;
  }

  async function markWalkthroughDone() {
    try {
      localStorage.setItem(WALKTHROUGH_KEY, '1');
    } catch (e) {}
    await idbSet(WALKTHROUGH_KEY, true);
  }

  function buildWalkthroughSteps() {
    const steps = [];

    // 1. Prompt to install PWA if on a supported platform and not already installed
    const canOfferInstall = !isAppInstalled && (isIOS || !!deferredInstallPrompt || isChromiumLike);
    if (canOfferInstall) {
      steps.push({ id: 'install' });
    }

    // 2. Prompt to link backup file if supported
    if (hasFSA) {
      steps.push({ id: 'link-file' });
    }

    // 3. Quick usage, storage & cross-device tutorial
    steps.push({ id: 'tutorial' });

    return steps;
  }

  function openWalkthrough() {
    if (!walkthroughModal) return;
    walkthroughSteps = buildWalkthroughSteps();
    walkthroughIndex = 0;
    renderWalkthroughStep();
    walkthroughModal.classList.add('active');
  }

  async function closeWalkthrough() {
    await markWalkthroughDone();
    if (walkthroughModal) walkthroughModal.classList.remove('active');
  }

  function advanceWalkthrough() {
    if (walkthroughIndex < walkthroughSteps.length - 1) {
      walkthroughIndex += 1;
      renderWalkthroughStep();
    } else {
      closeWalkthrough();
    }
  }

  function renderWalkthroughStep() {
    if (!walkthroughModal || walkthroughSteps.length === 0) return;

    const total = walkthroughSteps.length;
    const current = walkthroughSteps[walkthroughIndex];

    wtStepBadge.textContent = `Step ${walkthroughIndex + 1} of ${total}`;

    // Dots
    wtDots.innerHTML = '';
    for (let i = 0; i < total; i++) {
      const dot = document.createElement('span');
      dot.className = 'wt-dot';
      if (i === walkthroughIndex) dot.classList.add('active');
      else if (i < walkthroughIndex) dot.classList.add('done');
      wtDots.appendChild(dot);
    }

    wtBody.innerHTML = '';
    wtFooter.innerHTML = '';

    if (current.id === 'install') {
      const iconHtml = `
        <div class="wt-icon-wrap">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect>
            <line x1="12" y1="18" x2="12.01" y2="18"></line>
          </svg>
        </div>`;

      if (isIOS) {
        wtBody.innerHTML = `
          ${iconHtml}
          <h3 id="wt-title" class="wt-title">Install Phlo as an App</h3>
          <p class="wt-desc">Add Phlo to your Home Screen for full-screen offline access and safer browser storage.</p>
          <div class="wt-list">
            <div class="wt-list-item"><span class="wt-list-num">1</span><div><strong>Tap Share</strong>In Safari, tap the Share icon (square with ↑ arrow).</div></div>
            <div class="wt-list-item"><span class="wt-list-num">2</span><div><strong>Add to Home Screen</strong>Scroll down and tap <em>Add to Home Screen</em>, then tap <em>Add</em>.</div></div>
          </div>`;
      } else if (deferredInstallPrompt) {
        wtBody.innerHTML = `
          ${iconHtml}
          <h3 id="wt-title" class="wt-title">Install Phlo on Your Device</h3>
          <p class="wt-desc">Install Phlo as an app for offline access, one-tap launch, and persistent local storage.</p>`;
      } else {
        wtBody.innerHTML = `
          ${iconHtml}
          <h3 id="wt-title" class="wt-title">Install Phlo as an App</h3>
          <p class="wt-desc">Use your browser's menu (<strong>⋮ → Install app</strong> or <strong>Add to Home screen</strong>) to install Phlo for offline use and safer storage.</p>`;
      }

      if (deferredInstallPrompt) {
        const installBtn = document.createElement('button');
        installBtn.className = 'btn btn-primary btn-full';
        installBtn.textContent = 'Install Phlo App';
        installBtn.addEventListener('click', async () => {
          if (!deferredInstallPrompt) return;
          deferredInstallPrompt.prompt();
          const choice = await deferredInstallPrompt.userChoice;
          deferredInstallPrompt = null;
          if (choice && choice.outcome === 'accepted') {
            isAppInstalled = true;
          }
          advanceWalkthrough();
        });
        wtFooter.appendChild(installBtn);

        const nextBtn = document.createElement('button');
        nextBtn.className = 'btn btn-secondary btn-full';
        nextBtn.textContent = 'Continue in Browser';
        nextBtn.addEventListener('click', advanceWalkthrough);
        wtFooter.appendChild(nextBtn);
      } else {
        const nextBtn = document.createElement('button');
        nextBtn.className = 'btn btn-primary btn-full';
        nextBtn.textContent = walkthroughIndex < total - 1 ? 'Next' : 'Done';
        nextBtn.addEventListener('click', advanceWalkthrough);
        wtFooter.appendChild(nextBtn);
      }
    } else if (current.id === 'link-file') {
      const isLinked = !!activeFileHandle;
      wtBody.innerHTML = `
        <div class="wt-icon-wrap">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
            <polyline points="17 21 17 13 7 13 7 21"></polyline>
            <polyline points="7 3 7 8 15 8"></polyline>
          </svg>
        </div>
        <h3 id="wt-title" class="wt-title">Link Your Backup File</h3>
        <p class="wt-desc">Link <code>${BACKUP_FILENAME}</code> once. Every time you log or remove a period, Phlo updates this file automatically in the background, even if your browser's data is cleared.</p>
        ${isLinked ? `<div class="wt-status-pill">✓ Linked to ${activeFileHandle.name}</div>` : ''}`;

      const linkBtn = document.createElement('button');
      linkBtn.className = 'btn btn-primary btn-full';
      linkBtn.textContent = isLinked ? `Continue (${activeFileHandle.name} linked)` : `Link ${BACKUP_FILENAME}`;
      linkBtn.addEventListener('click', async () => {
        if (activeFileHandle) {
          advanceWalkthrough();
          return;
        }
        const ok = await linkSaveFile();
        if (ok) advanceWalkthrough();
      });
      wtFooter.appendChild(linkBtn);

      if (!isLinked && hasOpenFSA) {
        const loadBtn = document.createElement('button');
        loadBtn.className = 'btn btn-outline btn-full';
        loadBtn.textContent = 'Load & Link Existing File';
        loadBtn.addEventListener('click', async () => {
          const ok = await linkExistingFile();
          if (ok) advanceWalkthrough();
        });
        wtFooter.appendChild(loadBtn);
      }

      if (!isLinked) {
        const laterBtn = document.createElement('button');
        laterBtn.className = 'btn btn-secondary btn-full';
        laterBtn.textContent = 'Continue Without Linking';
        laterBtn.addEventListener('click', advanceWalkthrough);
        wtFooter.appendChild(laterBtn);

        const note = document.createElement('p');
        note.className = 'wt-note';
        note.textContent = 'To guarantee nothing gets lost, Phlo will prompt you to link when you log a period.';
        wtFooter.appendChild(note);
      }
    } else if (current.id === 'tutorial') {
      let storageTip = '';
      if (hasFSA) {
        storageTip = `Saved in your browser's storage and auto-written to your linked <code>${BACKUP_FILENAME}</code> file wherever you placed it.`;
      } else if (isIOS) {
        storageTip = `Saved in your browser's storage, plus the iOS Files menu opens on every log so you can save <code>${BACKUP_FILENAME}</code> (tip: save in <strong>On My iPhone → phlo</strong>, iOS remembers your last folder).`;
      } else {
        storageTip = `Saved in your browser's storage. You can export <code>${BACKUP_FILENAME}</code> anytime from the menu.`;
      }

      wtBody.innerHTML = `
        <div class="wt-icon-wrap">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
          </svg>
        </div>
        <h3 id="wt-title" class="wt-title">How Phlo Works</h3>
        <div class="wt-list">
          <div class="wt-list-item"><span class="wt-list-num">1</span><div><strong>Log a period</strong>Tap the pink <strong>+</strong> button, pick the first day of your period, and confirm. Phlo highlights 5 days automatically.</div></div>
          <div class="wt-list-item"><span class="wt-list-num">2</span><div><strong>Remove a period</strong>Open the calendar, tap the highlighted start date, and choose <strong>Remove</strong>.</div></div>
          <div class="wt-list-item"><span class="wt-list-num">3</span><div><strong>Where your data is stored</strong>${storageTip}</div></div>
          <div class="wt-list-item"><span class="wt-list-num">4</span><div><strong>Move to another device</strong>Open the top-left <strong>☰ Menu</strong> to scan a QR Code, copy a sync link, or load your <code>${BACKUP_FILENAME}</code> file on the new device.</div></div>
        </div>`;

      const startBtn = document.createElement('button');
      startBtn.className = 'btn btn-primary btn-full';
      startBtn.textContent = 'Get Started';
      startBtn.addEventListener('click', closeWalkthrough);
      wtFooter.appendChild(startBtn);
    }
  }

  if (wtSkipBtn) {
    wtSkipBtn.addEventListener('click', closeWalkthrough);
  }

  if (openWalkthroughBtn) {
    openWalkthroughBtn.addEventListener('click', () => {
      drawerBackdrop.classList.remove('active');
      openWalkthrough();
    });
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
    triggerBlobDownload(blob, `phlo-calendar-${getTodayISO()}.ics`);
    showToast('Calendar .ics downloaded!');
  });

  // --- Clear All Data ---
  clearAllDataBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to clear all logged periods? This cannot be undone unless you have a backup file.')) {
      periods = [];
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch (e) {}
      await saveState({ skipFileWrite: true });
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
