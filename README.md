# Phlo 🌸

A fully AI-coded, minimalist, privacy-first, offline-ready menstrual cycle tracker inspired by Flo, designed to be deployed effortlessly on **GitHub Pages**.

---

## ✨ Features

- **Cycle Day At A Glance**: The main screen prominently displays the current cycle day number inside an animated soft orb, along with a **Recent Cycles** history list of your last 10 periods.
- **100% Offline & PWA Ready**: Installable on iOS (Safari "Add to Home Screen") and Android/Desktop (Chrome/Edge "Install App"). Includes full Service Worker caching and PNG fallback icons for Safari.
- **Mobile-First & Clean Aesthetic**: Flo-inspired soft pastel styling (`#FFF9F8` background, gentle coral/rose accents).
- **5-Day Pastel Highlighting**: Logging any period start date automatically highlights the 5 consecutive days (start date + 4 days) in soft pastel red with smooth rounded capsules.
- **Interactive & History Calendars**: Tap the bottom-right `+` button to log or remove a period start on the month calendar, or tap the bottom-left calendar button to scroll through your full logged history.
- **Guided First-Time Setup**: On your first visit with no stored data, a quick walkthrough helps you install the app (on supported platforms), link `phlo-data.json` (where supported), and learn how logging, removal, storage, and cross-device sync work (with a **Skip tutorial** option).
- **Zero Third-Party Accounts or Trackers**: No database, no accounts, no subscriptions, zero data leaves your device.

---

## 💾 How Data Persistence & Cross-Device Sync Works

Since Phlo does not use a centralized backend or user accounts, all your cycle data is stored privately on your device across **LocalStorage**, **IndexedDB**, and the **Cache API** (with `navigator.storage.persist()` requested). We also provide file backup and cross-device layers so no log goes missing:

### 1. Direct Local Save File (Non-iOS File System Access API)
- On supported non-iOS browsers (such as Chrome and Edge), linking `phlo-data.json` is the default backup option.
- Inside the menu (top-left hamburger button) or during the first-time walkthrough, tap **"Link phlo-data.json"** (or load & link an existing `phlo-data.json`).
- **Every time you log or remove a period, Phlo updates this local file automatically in the background.** Even if you clear your browser history, your `phlo-data.json` file remains safe on your device.
- If no file is linked yet, or if browser permission resets after closing and reopening the website/PWA, Phlo prompts you on your next period log to link or re-authorize `phlo-data.json`.

### 2. iOS Files Menu Auto-Prompt
- Because Apple restricts background filesystem access in iOS browsers, Phlo automatically opens the iOS Share / Files menu with `phlo-data.json` on every period log/change so you can tap **Save to Files** (e.g., `On My iPhone → phlo`).

### 3. Manual Backup & Restore (Universal)
- **Save Backup**: Export or share your `phlo-data.json` file anytime in one tap.
- **Load File**: Restore your period history on any browser or device by uploading your `phlo-data.json` backup.

### 4. Cross-Device Sync without Accounts (QR Code & Instant URL)
- Since menstrual cycle data is compact (just an array of start dates), Phlo can encode your entire history into a secure URL hash.
- **QR Code Sync**: Tap **"QR Code Sync"** in the menu to display a scannable QR code. Open the camera on your other device (e.g., phone or tablet) to open the page and instantly import your data.
- **Copy Sync Link**: Copy a shareable link to send to yourself via email or message. Opening the link prompts you to import your history.

### 5. Native Calendar Export (.ics)
- Tap **"Export .ics Calendar"** to generate a standard iCalendar file.
- Imports all your 5-day period blocks into **Apple Calendar**, **Google Calendar**, or **Outlook**, giving you system-level reminders and backups.

---

## 📱 Adding to Home Screen (Mobile App Feel)

### On iOS (iPhone / iPad):
1. Open your GitHub Pages link in **Safari**.
2. Tap the **Share** button (box with an arrow pointing up).
3. Scroll down and tap **Add to Home Screen**.
4. Phlo will now launch full-screen like a native app with its custom pastel icon.

### On Android:
1. Open your GitHub Pages link in **Chrome**.
2. Tap the three-dot menu in the upper-right corner.
3. Tap **Add to Home screen** (or **Install app**).

---

## 🛠️ Tech Stack & Architecture

- **Vanilla HTML5, CSS3, & Modern ES6+ JavaScript**: No Node.js build steps required, no dependencies, no external CDN tracking.
- **LocalStorage, IndexedDB & Cache API**: Resilient multi-store client-side persistence with `navigator.storage.persist()` and automatic cross-store recovery.
- **File System Access API & Web Share API**: Real-time background writing to `phlo-data.json` on supported desktop/non-iOS browsers, and native **Save to Files** sharing on iOS.
- **Custom Lightweight SVG QR Code Engine**: Generates QR codes offline without external network calls.
- **Service Worker (`sw.js`)**: Caches assets for offline execution.
