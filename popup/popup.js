/**
 * Multi URL Opener - Popup Script (Milestone 1 Shell)
 * by nzrfzr
 */

import { MESSAGE_TYPES, SESSION_STATUS, OPEN_MODE, DEFAULTS } from '../src/constants.js';
import { browserAdapter } from '../src/browser-adapter.js';

// DOM Elements
const elements = {
  sessionStatusPill: document.getElementById('sessionStatusPill'),
  sessionStatusText: document.getElementById('sessionStatusText'),
  urlInput: document.getElementById('urlInput'),
  btnExtract: document.getElementById('btnExtract'),
  btnAddUrls: document.getElementById('btnAddUrls'),
  chkSelectAll: document.getElementById('chkSelectAll'),
  btnDeleteSelected: document.getElementById('btnDeleteSelected'),
  btnClearList: document.getElementById('btnClearList'),
  tableContainer: document.getElementById('tableContainer'),
  urlTableBody: document.getElementById('urlTableBody'),
  emptyState: document.getElementById('emptyState'),
  statTotal: document.getElementById('statTotal'),
  statValid: document.getElementById('statValid'),
  statDuplicate: document.getElementById('statDuplicate'),
  statInvalid: document.getElementById('statInvalid'),
  selectMode: document.getElementById('selectMode'),
  intervalGroup: document.getElementById('intervalGroup'),
  inputInterval: document.getElementById('inputInterval'),
  inputConcurrency: document.getElementById('inputConcurrency'),
  inputTimeout: document.getElementById('inputTimeout'),
  chkBackground: document.getElementById('chkBackground'),
  chkDeferUntilSelected: document.getElementById('chkDeferUntilSelected'),
  btnOpenSelected: document.getElementById('btnOpenSelected'),
  progressSection: document.getElementById('progressSection'),
  readyActions: document.getElementById('readyActions'),
  runningActions: document.getElementById('runningActions')
};

// Local UI state
let state = {
  preferences: {
    mode: DEFAULTS.MODE,
    intervalSeconds: DEFAULTS.INTERVAL_SECONDS,
    concurrencyLimit: DEFAULTS.CONCURRENCY_LIMIT,
    timeoutSeconds: DEFAULTS.TIMEOUT_SECONDS,
    openInBackground: DEFAULTS.OPEN_IN_BACKGROUND,
    deferUntilSelected: DEFAULTS.DEFER_UNTIL_SELECTED
  },
  rows: [],
  session: {
    status: SESSION_STATUS.READY
  }
};

/**
 * Initialize popup
 */
async function init() {
  bindEvents();
  updateModeVisibility();

  // Test communication with background process
  try {
    const pingResponse = await browserAdapter.runtime.sendMessage({
      type: MESSAGE_TYPES.PING
    });

    if (pingResponse && pingResponse.success) {
      console.log('[MultiURLOpener] Background service connected:', pingResponse);
      setStatus(SESSION_STATUS.READY);

      // Fetch existing state
      const stateResponse = await browserAdapter.runtime.sendMessage({
        type: MESSAGE_TYPES.GET_STATE
      });

      if (stateResponse && stateResponse.success && stateResponse.payload) {
        state = stateResponse.payload;
        applyPreferencesToUI(state.preferences);
      }
    } else {
      console.warn('[MultiURLOpener] Background service ping failed.');
      setStatus('disconnected');
    }
  } catch (err) {
    console.error('[MultiURLOpener] Failed to communicate with background service:', err);
    // Even if background is waking up or not responding, show ready state for UI testing
    setStatus(SESSION_STATUS.READY);
  }

  renderList();
  updateStats();
}

/**
 * Bind UI Events
 */
function bindEvents() {
  // Mode change
  elements.selectMode?.addEventListener('change', (e) => {
    state.preferences.mode = e.target.value;
    updateModeVisibility();
    savePreferences();
  });

  // Settings inputs
  elements.inputInterval?.addEventListener('change', (e) => {
    state.preferences.intervalSeconds = parseFloat(e.target.value) || DEFAULTS.INTERVAL_SECONDS;
    savePreferences();
  });

  elements.inputConcurrency?.addEventListener('change', (e) => {
    state.preferences.concurrencyLimit = parseInt(e.target.value, 10) || DEFAULTS.CONCURRENCY_LIMIT;
    savePreferences();
  });

  elements.inputTimeout?.addEventListener('change', (e) => {
    state.preferences.timeoutSeconds = parseInt(e.target.value, 10) || DEFAULTS.TIMEOUT_SECONDS;
    savePreferences();
  });

  elements.chkBackground?.addEventListener('change', (e) => {
    state.preferences.openInBackground = e.target.checked;
    savePreferences();
  });

  elements.chkDeferUntilSelected?.addEventListener('change', (e) => {
    state.preferences.deferUntilSelected = e.target.checked;
    savePreferences();
  });

  // Action stubs for Milestone 1 shell
  elements.btnAddUrls?.addEventListener('click', () => {
    const text = elements.urlInput.value.trim();
    if (!text) return;
    console.log('[MultiURLOpener] Added URLs input (stub for Milestone 2):', text);
    // Visual feedback for shell
    elements.urlInput.placeholder = 'Parsing and list management will be enabled in Milestone 2!';
    setTimeout(() => {
      elements.urlInput.placeholder = 'Paste URLs here, one per line...';
    }, 2000);
  });

  elements.btnExtract?.addEventListener('click', () => {
    console.log('[MultiURLOpener] Extract clicked (stub for Milestone 2)');
  });
}

/**
 * Update visibility of conditional controls (e.g., Interval input)
 */
function updateModeVisibility() {
  const currentMode = elements.selectMode?.value;
  if (elements.intervalGroup) {
    if (currentMode === OPEN_MODE.AT_INTERVAL) {
      elements.intervalGroup.classList.remove('hidden');
    } else {
      elements.intervalGroup.classList.add('hidden');
    }
  }
}

/**
 * Update status pill in header
 */
function setStatus(statusKey) {
  if (!elements.sessionStatusPill || !elements.sessionStatusText) return;

  // Clear previous status classes
  elements.sessionStatusPill.className = 'status-pill';

  switch (statusKey) {
    case SESSION_STATUS.RUNNING:
      elements.sessionStatusPill.classList.add('status-running');
      elements.sessionStatusText.textContent = 'Running';
      break;
    case SESSION_STATUS.PAUSED:
      elements.sessionStatusPill.classList.add('status-paused');
      elements.sessionStatusText.textContent = 'Paused';
      break;
    case SESSION_STATUS.COMPLETED:
      elements.sessionStatusPill.classList.add('status-completed');
      elements.sessionStatusText.textContent = 'Completed';
      break;
    case SESSION_STATUS.COMPLETED_WITH_ERRORS:
      elements.sessionStatusPill.classList.add('status-error');
      elements.sessionStatusText.textContent = 'Completed (errors)';
      break;
    case 'disconnected':
      elements.sessionStatusPill.classList.add('status-error');
      elements.sessionStatusText.textContent = 'Offline';
      break;
    case SESSION_STATUS.READY:
    default:
      elements.sessionStatusPill.classList.add('status-ready');
      elements.sessionStatusText.textContent = 'Ready';
      break;
  }
}

/**
 * Apply loaded preferences to form inputs
 */
function applyPreferencesToUI(prefs) {
  if (!prefs) return;
  if (elements.selectMode && prefs.mode) elements.selectMode.value = prefs.mode;
  if (elements.inputInterval && prefs.intervalSeconds != null) elements.inputInterval.value = prefs.intervalSeconds;
  if (elements.inputConcurrency && prefs.concurrencyLimit != null) elements.inputConcurrency.value = prefs.concurrencyLimit;
  if (elements.inputTimeout && prefs.timeoutSeconds != null) elements.inputTimeout.value = prefs.timeoutSeconds;
  if (elements.chkBackground && prefs.openInBackground != null) elements.chkBackground.checked = prefs.openInBackground;
  if (elements.chkDeferUntilSelected && prefs.deferUntilSelected != null) elements.chkDeferUntilSelected.checked = prefs.deferUntilSelected;
  updateModeVisibility();
}

/**
 * Persist preferences to background
 */
async function savePreferences() {
  try {
    await browserAdapter.runtime.sendMessage({
      type: MESSAGE_TYPES.UPDATE_PREFERENCES,
      payload: state.preferences
    });
  } catch (err) {
    console.debug('[MultiURLOpener] Failed to save preferences to background:', err);
  }
}

/**
 * Render empty state or list rows
 */
function renderList() {
  if (!elements.urlTableBody || !elements.emptyState) return;

  if (state.rows.length === 0) {
    elements.emptyState.classList.remove('hidden');
    elements.urlTableBody.innerHTML = '';
    if (elements.btnOpenSelected) {
      elements.btnOpenSelected.disabled = true;
    }
  } else {
    elements.emptyState.classList.add('hidden');
    // Rows rendering will be completed in Milestone 2
  }
}

/**
 * Update summary badge counts
 */
function updateStats() {
  if (elements.statTotal) elements.statTotal.textContent = state.rows.length;
  if (elements.statValid) elements.statValid.textContent = '0';
  if (elements.statDuplicate) elements.statDuplicate.textContent = '0';
  if (elements.statInvalid) elements.statInvalid.textContent = '0';
}

// Bootstrap on DOM ready
document.addEventListener('DOMContentLoaded', init);
