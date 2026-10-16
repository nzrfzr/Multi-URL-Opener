# Changelog

All notable changes to the **Multi URL Opener** extension will be documented in this file.

## [0.1.0] - 2026-10-16

### Added
- **Cross-Browser WebExtensions Manifest V3**: Fully compatible with both Google Chrome (Service Worker) and Mozilla Firefox (Background Scripts).
- **Security & Privacy Focus**: Strictly local-first, zero analytics, zero external network requests, zero CDN dependencies. Only requests minimum permissions (`storage`, `tabs`).
- **Compact & Minimal UI**: Dominantly white (85–90%) palette with `#00AEEF` primary accent, designed specifically for a ~400px popup window without horizontal overflow.
- **URL Parsing & Validation**: Supports `http://` and `https://`, validates syntax using WHATWG URL parser, removes trailing sentence punctuation, and prevents injection/XSS through strict `textContent` DOM usage.
- **Mixed-Text Extraction**: Automatically discovers and parses URLs embedded in prose while preserving original order.
- **Duplicate Detection**: Identifies duplicate entries based on normalized URLs while keeping them visible and selectable.
- **Queue Modes**:
  - `Open All`: Launches tabs as rapidly as concurrency allows.
  - `At Interval`: Spaced launch cadence (0.5–60 seconds) with concurrency capping.
  - `After Load`: Launches subsequent URLs only when active tabs complete loading (sequential when limit is 1).
- **Concurrency Management**: Configurable limit of 1–10 simultaneous navigations with navigation timeout defaults (30s) to prevent queue deadlocks.
- **Queue Controls**: Pause, Resume, and Stop controls that maintain opened tabs safely.
- **Local Persistence**: State automatically persists across popup closures and recovers during service worker suspension.
- **Deferred Navigation**: Optional *"Don't load until selected"* mode that opens an extension-owned placeholder tab until the user activates it.
- **Automated Test Suite**: 38 native unit tests passing 100% via `node:test` without external runtime dependencies.
