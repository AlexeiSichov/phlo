# Phlo 🌸

A fully AI-coded, minimalist, privacy-first, offline-ready menstrual cycle tracker inspired by Flo, designed to be deployed effortlessly on **GitHub Pages**.

---

## ✨ Features

- **Cycle Day At A Glance**: The main screen prominently displays the current cycle day number inside an animated soft orb.
- **100% Offline & PWA Ready**: Installable on iOS (Safari "Add to Home Screen") and Android (Chrome "Install App"). Includes full Service Worker caching and offline support.
- **Mobile-First & Clean Aesthetic**: Flo-inspired soft pastel styling (`#FFF9F8` background, gentle coral/rose accents).
- **5-Day Pastel Highlighting**: Logging any period start date automatically highlights the 5 consecutive days (start date + 4 days) in soft pastel red with smooth rounded capsules.
- **Interactive Calendar**: Tapping the bottom-right circular `+` button opens the calendar sheet where you can select any day to confirm and log a period start (or remove one).
- **Zero Third-Party Accounts or Trackers**: No database, no accounts, no subscriptions, zero data leaves your device.

---

## 💾 How Data Persistence & Cross-Device Sync Works

Since Phlo does not use a centralized backend or user accounts, all your cycle data is stored privately on your device. We provide multiple layers to ensure your data is never lost:

### 1. Direct Local Save File (File System Access API)
- Inside the menu (top-left hamburger button), tap **"Choose / Create Save File"**.
- Select or create a file on your device (e.g. `phlo-data.json`).
- **Every time you log or delete a period, Phlo updates this local file automatically.** Even if you clear your browser history, your save file remains safe on your device!
*(Note: Supported on Chromium-based browsers like Chrome, Edge, and Opera).*

### 2. Manual Backup & Restore (Universal)
- **Save Backup**: Download a timestamped `phlo-backup-YYYY-MM-DD.json` file anytime in one tap.
- **Load File**: Restore your period history on any browser or device by uploading your JSON backup.

### 3. Cross-Device Sync without Accounts (QR Code & Instant URL)
- Since menstrual cycle data is compact (just an array of start dates), Phlo can encode your entire history into a secure URL hash.
- **QR Code Sync**: Tap **"QR Code Sync"** in the menu to display a scannable QR code. Open the camera on your other device (e.g., phone or tablet) to open the page and instantly import your data.
- **Copy Sync Link**: Copy a shareable link to send to yourself via email or message. Opening the link prompts you to import your history.

### 4. Native Calendar Export (.ics)
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
- **IndexedDB & LocalStorage**: Resilient client-side storage with `navigator.storage.persist()`.
- **File System Access API**: Real-time writing to disk files on supported devices.
- **Custom Lightweight SVG QR Code Engine**: Generates QR codes offline without external network calls.
- **Service Worker (`sw.js`)**: Caches assets for offline execution.
