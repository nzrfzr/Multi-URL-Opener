# Multi URL Opener

**Developer:** `nzrfzr`  
**Target browsers:** Google Chrome & Mozilla Firefox  
**License / Type:** Personal, local-first browser extension  
**Status:** Milestone 3 (Basic Tab Creation) completed  

---

## Overview

**Multi URL Opener** allows you to collect, validate, organize, and open multiple HTTP/HTTPS URLs with controlled concurrency, timed intervals, progress tracking, and pause/resume/stop controls.

The extension is designed to be minimal, compact, and predominantly white (85–90% white surfaces with a clean `#00AEEF` primary accent). It operates strictly locally on your machine and never transmits URLs, browsing history, or telemetry to any external server.

---

## Product Principles

1. **Local-first and Private:** Zero backend, zero analytics, zero external network requests, zero remote CDN assets.
2. **Compact UI:** A clean ~390px browser popup focused on primary actions without horizontal overflow or clutter.
3. **Predictable Behavior:** Distinguishes between tab creation and actual page load completion.
4. **Resilient Session State:** Persists queue state locally so closing the popup does not interrupt active background tasks.
5. **Cross-Browser Compatibility:** Designed to run seamlessly on modern Google Chrome and Mozilla Firefox using standard WebExtensions APIs.
6. **Safe Defaults:** Tabs open in the background by default; caps concurrent navigations; never auto-resumes queues after browser restart.

---

## Permissions Justification

This extension requests only the minimum required permissions:

- **`storage`**: Used to save your URL list, settings/preferences, and active queue session state locally in your browser so that work is preserved when the popup closes or background service workers are suspended.
- **`tabs`**: Used to open new background tabs for URLs (`chrome.tabs.create`), monitor their loading state (`chrome.tabs.onUpdated`), and detect tab closure (`chrome.tabs.onRemoved`).

> [!NOTE]
> The extension does **NOT** request broad host permissions (such as `<all_urls>`). It does not read, modify, or inject scripts into the content of websites you open.

---

## Installation & Testing

### Google Chrome (and Chromium browsers)
1. Open Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** using the toggle switch in the top-right corner.
3. Click the **Load unpacked** button.
4. Select the root folder of this project (`d:\Workspace\Programming\Multi URL Opener`).
5. Multi URL Opener will appear in your extension list and toolbar.

### Mozilla Firefox
1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...**.
3. Select the `manifest.json` file inside the root folder (`d:\Workspace\Programming\Multi URL Opener\manifest.json`).
4. Multi URL Opener will appear in your temporary extensions list and toolbar.

---

## Roadmap & Milestones

- [x] **Milestone 1 — Extension Shell:** Manifest V3 cross-browser setup, compact white UI, header, status pill, background messaging handshake, and icons.
- [x] **Milestone 2 — URL Parsing & List Management:** Mixed-text extraction, HTTP/HTTPS validation, duplicate detection, row selection, metrics.
- [x] **Milestone 3 — Basic Tab Creation:** Background tab opening, tab ID mapping, load vs. creation tracking.
- [ ] **Milestone 4 — Queue Modes & Concurrency:** Open All, At Interval, After Load with concurrency limit (1–10) and timeout.
- [ ] **Milestone 5 — Queue Controls & Progress:** Pause, resume, stop, and real-time progress indicators.
- [ ] **Milestone 6 — Local Persistence & Worker Recovery:** Background persistence across popup close and worker suspension.
- [ ] **Milestone 7 — Deferred Navigation:** Optional "Don't load until selected" managed tabs.
- [ ] **Milestone 8 — Final Polish & Accessibility:** Keyboard navigation, full manual cross-browser testing.
