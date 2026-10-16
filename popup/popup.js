/**
 * Multi URL Opener - Popup Script (Milestone 3)
 * Full list management, background tab launching, and progress tracking.
 * by nzrfzr
 */

import { MESSAGE_TYPES, SESSION_STATUS, ROW_STATUS, OPEN_MODE, DEFAULTS } from '../src/constants.js';
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
  progressFraction: document.getElementById('progressFraction'),
  progressBarFill: document.getElementById('progressBarFill'),
  progSuccess: document.getElementById('progSuccess'),
  progFailed: document.getElementById('progFailed'),
  progRemaining: document.getElementById('progRemaining'),
  progLoading: document.getElementById('progLoading'),
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
  stats: {
    total: 0,
    valid: 0,
    duplicate: 0,
    invalid: 0,
    selected: 0,
    selectedValid: 0
  },
  session: {
    id: null,
    status: SESSION_STATUS.READY,
    openedCount: 0,
    successCount: 0,
    failedCount: 0,
    totalCount: 0
  },
  activeNavigationsCount: 0
};

let pollTimer = null;

/**
 * Initialize popup
 */
async function init() {
  bindEvents();
  updateModeVisibility();

  // Test communication with background process and fetch initial state
  try {
    const pingResponse = await browserAdapter.runtime.sendMessage({
      type: MESSAGE_TYPES.PING
    });

    if (pingResponse && pingResponse.success) {
      await refreshState();
    } else {
      setStatus('disconnected');
    }
  } catch (err) {
    console.warn('[MultiURLOpener] Background service connection error:', err);
    setStatus(SESSION_STATUS.READY);
  }

  renderList();
  updateStats();
  updateProgressUI();
}

/**
 * Fetch latest state from background
 */
async function refreshState() {
  try {
    const response = await browserAdapter.runtime.sendMessage({
      type: MESSAGE_TYPES.GET_STATE
    });

    if (response && response.success && response.payload) {
      state = {
        ...state,
        ...response.payload
      };
      applyPreferencesToUI(state.preferences);
      setStatus(state.session?.status || SESSION_STATUS.READY);
      renderList();
      updateStats();
      updateProgressUI();

      // If running, ensure polling timer is active
      if (state.session?.status === SESSION_STATUS.RUNNING) {
        startPolling();
      } else {
        stopPolling();
      }
    }
  } catch (err) {
    console.debug('[MultiURLOpener] Refresh state error:', err);
  }
}

/**
 * Poll background state while a queue/opening is active
 */
function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(refreshState, 600);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
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

  // Add URLs button
  elements.btnAddUrls?.addEventListener('click', () => {
    handleAddUrls(false);
  });

  // Extract from text button
  elements.btnExtract?.addEventListener('click', () => {
    handleAddUrls(true);
  });

  // Select all checkbox
  elements.chkSelectAll?.addEventListener('change', (e) => {
    handleSelectAllToggle(e.target.checked);
  });

  // Delete selected button
  elements.btnDeleteSelected?.addEventListener('click', () => {
    handleDeleteSelected();
  });

  // Clear list button
  elements.btnClearList?.addEventListener('click', () => {
    handleClearList();
  });

  // Primary action button (Open Selected URLs)
  elements.btnOpenSelected?.addEventListener('click', () => {
    handleStartOpening();
  });
}

/**
 * Trigger queue start in background
 */
async function handleStartOpening() {
  if (elements.btnOpenSelected) {
    elements.btnOpenSelected.disabled = true;
  }

  try {
    const response = await browserAdapter.runtime.sendMessage({
      type: MESSAGE_TYPES.START_QUEUE
    });

    if (response && response.success) {
      await refreshState();
      startPolling();
    } else {
      showInputFeedback(response?.error || 'Failed to start opening');
      if (elements.btnOpenSelected) elements.btnOpenSelected.disabled = false;
    }
  } catch (err) {
    console.error('[MultiURLOpener] Start opening error:', err);
    if (elements.btnOpenSelected) elements.btnOpenSelected.disabled = false;
  }
}

/**
 * Handle adding URLs either as newline-separated list or mixed-text extraction
 */
async function handleAddUrls(isExtractMode) {
  const text = elements.urlInput.value.trim();
  if (!text) {
    showInputFeedback('Please enter or paste text above first.');
    return;
  }

  try {
    const response = await browserAdapter.runtime.sendMessage({
      type: MESSAGE_TYPES.ADD_URL_TEXT,
      payload: { text, isExtractMode }
    });

    if (response && response.success) {
      const { added, rows, stats } = response.payload;
      state.rows = rows;
      if (stats) state.stats = stats;

      if (added > 0) {
        elements.urlInput.value = '';
        showInputFeedback(`Added ${added} ${added === 1 ? 'URL' : 'URLs'} to list.`);
      } else {
        showInputFeedback(isExtractMode ? 'No HTTP/HTTPS URLs found in text.' : 'No valid lines found.');
      }

      renderList();
      updateStats();
    }
  } catch (err) {
    console.error('[MultiURLOpener] Add URLs error:', err);
  }
}

/**
 * Handle select/deselect all rows
 */
async function handleSelectAllToggle(isChecked) {
  try {
    const response = await browserAdapter.runtime.sendMessage({
      type: isChecked ? MESSAGE_TYPES.SELECT_ALL : MESSAGE_TYPES.SELECT_NONE
    });

    if (response && response.success) {
      state.rows = response.payload.rows;
      if (response.payload.stats) state.stats = response.payload.stats;
      renderList();
      updateStats();
    }
  } catch (err) {
    console.error('[MultiURLOpener] Select all toggle error:', err);
  }
}

/**
 * Handle deleting all selected rows
 */
async function handleDeleteSelected() {
  if (state.stats.selected === 0) return;

  try {
    const response = await browserAdapter.runtime.sendMessage({
      type: MESSAGE_TYPES.DELETE_SELECTED
    });

    if (response && response.success) {
      state.rows = response.payload.rows;
      if (response.payload.stats) state.stats = response.payload.stats;
      renderList();
      updateStats();
    }
  } catch (err) {
    console.error('[MultiURLOpener] Delete selected error:', err);
  }
}

/**
 * Handle clearing the entire list
 */
async function handleClearList() {
  if (state.rows.length === 0) return;

  try {
    const response = await browserAdapter.runtime.sendMessage({
      type: MESSAGE_TYPES.CLEAR_LIST
    });

    if (response && response.success) {
      state.rows = response.payload.rows;
      if (response.payload.stats) state.stats = response.payload.stats;
      renderList();
      updateStats();
    }
  } catch (err) {
    console.error('[MultiURLOpener] Clear list error:', err);
  }
}

/**
 * Handle deleting a single row by ID
 */
async function handleDeleteRow(id) {
  try {
    const response = await browserAdapter.runtime.sendMessage({
      type: MESSAGE_TYPES.DELETE_ROW,
      payload: { id }
    });

    if (response && response.success) {
      state.rows = response.payload.rows;
      if (response.payload.stats) state.stats = response.payload.stats;
      renderList();
      updateStats();
    }
  } catch (err) {
    console.error('[MultiURLOpener] Delete row error:', err);
  }
}

/**
 * Handle changing selection of a single row
 */
async function handleToggleRowSelection(id, selected) {
  try {
    const response = await browserAdapter.runtime.sendMessage({
      type: MESSAGE_TYPES.SET_ROW_SELECTION,
      payload: { id, selected }
    });

    if (response && response.success) {
      state.rows = response.payload.rows;
      if (response.payload.stats) state.stats = response.payload.stats;
      updateStats();
    }
  } catch (err) {
    console.error('[MultiURLOpener] Toggle selection error:', err);
  }
}

/**
 * Safe DOM rendering of URL rows using textContent to prevent XSS.
 */
function renderList() {
  if (!elements.urlTableBody || !elements.emptyState) return;

  if (state.rows.length === 0) {
    elements.emptyState.classList.remove('hidden');
    elements.urlTableBody.innerHTML = '';
    if (elements.chkSelectAll) {
      elements.chkSelectAll.checked = false;
      elements.chkSelectAll.indeterminate = false;
      elements.chkSelectAll.disabled = true;
    }
    return;
  }

  elements.emptyState.classList.add('hidden');
  if (elements.chkSelectAll) {
    elements.chkSelectAll.disabled = state.session?.status === SESSION_STATUS.RUNNING;
  }

  // Clear existing rows safely
  while (elements.urlTableBody.firstChild) {
    elements.urlTableBody.removeChild(elements.urlTableBody.firstChild);
  }

  const isRunning = state.session?.status === SESSION_STATUS.RUNNING;

  // Build rows using safe DOM APIs
  state.rows.forEach((row, index) => {
    const tr = document.createElement('tr');
    tr.dataset.id = row.id;
    if (row.selected) tr.classList.add('row-selected');

    // 1. Checkbox column
    const tdCheck = document.createElement('td');
    tdCheck.className = 'col-check';
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = Boolean(row.selected);
    chk.disabled = isRunning;
    chk.setAttribute('aria-label', `Select URL ${index + 1}`);
    chk.addEventListener('change', (e) => {
      tr.classList.toggle('row-selected', e.target.checked);
      handleToggleRowSelection(row.id, e.target.checked);
    });
    tdCheck.appendChild(chk);

    // 2. Number column
    const tdNum = document.createElement('td');
    tdNum.className = 'col-num';
    tdNum.textContent = String(index + 1);

    // 3. URL text column (strictly textContent, never innerHTML)
    const tdUrl = document.createElement('td');
    tdUrl.className = 'col-url';
    const spanUrl = document.createElement('span');
    spanUrl.textContent = row.url;
    spanUrl.title = row.error ? `${row.url} (${row.error})` : row.url;
    tdUrl.appendChild(spanUrl);

    // 4. Status column
    const tdStatus = document.createElement('td');
    tdStatus.className = 'col-status';
    const badge = document.createElement('span');
    badge.className = 'badge';

    switch (row.status) {
      case ROW_STATUS.CREATING_TAB:
        badge.classList.add('badge-creating');
        badge.textContent = 'Opening';
        badge.title = 'Tab is being created...';
        break;
      case ROW_STATUS.LOADING:
        badge.classList.add('badge-loading');
        badge.textContent = 'Loading';
        badge.title = 'Page is loading in background tab...';
        break;
      case ROW_STATUS.SUCCESS:
        badge.classList.add('badge-success');
        badge.textContent = 'Loaded';
        badge.title = 'Page navigation completed successfully.';
        break;
      case ROW_STATUS.FAILED:
        badge.classList.add('badge-failed');
        badge.textContent = 'Failed';
        badge.title = row.error || 'Navigation failed or tab was closed prematurely.';
        break;
      case ROW_STATUS.TIMED_OUT:
        badge.classList.add('badge-timed-out');
        badge.textContent = 'Timeout';
        badge.title = 'Navigation timed out.';
        break;
      case ROW_STATUS.QUEUED:
        badge.classList.add('badge-ready');
        badge.textContent = 'Queued';
        badge.title = 'Waiting in queue...';
        break;
      default:
        if (!row.valid) {
          badge.classList.add('badge-invalid');
          badge.textContent = 'Invalid';
          badge.title = row.error || 'Invalid URL syntax';
        } else if (row.duplicateOf) {
          badge.classList.add('badge-duplicate');
          badge.textContent = 'Duplicate';
          badge.title = 'Duplicate of an earlier URL';
        } else {
          badge.classList.add('badge-ready');
          badge.textContent = 'Ready';
        }
        break;
    }
    tdStatus.appendChild(badge);

    // 5. Delete button column
    const tdAction = document.createElement('td');
    tdAction.className = 'col-action';
    const btnDel = document.createElement('button');
    btnDel.type = 'button';
    btnDel.className = 'btn-icon-delete';
    btnDel.setAttribute('aria-label', `Remove URL ${index + 1}`);
    btnDel.title = 'Remove';
    btnDel.textContent = '×';
    btnDel.disabled = isRunning;
    btnDel.addEventListener('click', (e) => {
      e.stopPropagation();
      handleDeleteRow(row.id);
    });
    tdAction.appendChild(btnDel);

    tr.appendChild(tdCheck);
    tr.appendChild(tdNum);
    tr.appendChild(tdUrl);
    tr.appendChild(tdStatus);
    tr.appendChild(tdAction);

    elements.urlTableBody.appendChild(tr);
  });
}

/**
 * Update summary badge counts and primary action button state
 */
function updateStats() {
  const stats = state.stats || {
    total: state.rows.length,
    valid: state.rows.filter(r => r.valid).length,
    duplicate: state.rows.filter(r => r.duplicateOf !== null).length,
    invalid: state.rows.filter(r => !r.valid).length,
    selected: state.rows.filter(r => r.selected).length,
    selectedValid: state.rows.filter(r => r.selected && r.valid).length
  };

  if (elements.statTotal) elements.statTotal.textContent = stats.total;
  if (elements.statValid) elements.statValid.textContent = stats.valid;
  if (elements.statDuplicate) elements.statDuplicate.textContent = stats.duplicate;
  if (elements.statInvalid) elements.statInvalid.textContent = stats.invalid;

  const isRunning = state.session?.status === SESSION_STATUS.RUNNING;

  // Update Select All checkbox tri-state
  if (elements.chkSelectAll && stats.total > 0) {
    if (stats.selected === stats.total) {
      elements.chkSelectAll.checked = true;
      elements.chkSelectAll.indeterminate = false;
    } else if (stats.selected === 0) {
      elements.chkSelectAll.checked = false;
      elements.chkSelectAll.indeterminate = false;
    } else {
      elements.chkSelectAll.checked = false;
      elements.chkSelectAll.indeterminate = true;
    }
  }

  // Enable/disable Open Selected URLs button
  if (elements.btnOpenSelected) {
    const hasSelectedValid = stats.selectedValid > 0;
    elements.btnOpenSelected.disabled = !hasSelectedValid || isRunning;
    if (isRunning) {
      elements.btnOpenSelected.textContent = 'Opening in progress...';
    } else {
      elements.btnOpenSelected.textContent = 'Open Selected URLs';
    }

    if (!hasSelectedValid) {
      elements.btnOpenSelected.title = stats.total === 0 
        ? 'Add URLs to open' 
        : 'Select at least one valid URL to open';
    } else {
      elements.btnOpenSelected.title = `Open ${stats.selectedValid} selected valid ${stats.selectedValid === 1 ? 'URL' : 'URLs'}`;
    }
  }
}

/**
 * Update the queue progress area
 */
function updateProgressUI() {
  const s = state.session;
  if (!elements.progressSection) return;

  if (s && s.totalCount > 0 && (s.status === SESSION_STATUS.RUNNING || s.status === SESSION_STATUS.COMPLETED || s.status === SESSION_STATUS.COMPLETED_WITH_ERRORS)) {
    elements.progressSection.classList.remove('hidden');

    const processed = (s.successCount || 0) + (s.failedCount || 0);
    const total = s.totalCount || 1;
    const percent = Math.min(100, Math.round((processed / total) * 100));

    if (elements.progressFraction) {
      elements.progressFraction.textContent = `${processed} / ${total} (Opened: ${s.openedCount || 0})`;
    }

    if (elements.progressBarFill) {
      elements.progressBarFill.style.width = `${percent}%`;
    }

    if (elements.progSuccess) elements.progSuccess.textContent = s.successCount || 0;
    if (elements.progFailed) elements.progFailed.textContent = s.failedCount || 0;
    if (elements.progRemaining) elements.progRemaining.textContent = Math.max(0, total - processed);
    if (elements.progLoading) elements.progLoading.textContent = state.activeNavigationsCount || 0;
  } else {
    elements.progressSection.classList.add('hidden');
  }
}

/**
 * Show temporary feedback in the URL input area
 */
function showInputFeedback(msg) {
  const orig = elements.urlInput.placeholder;
  elements.urlInput.placeholder = msg;
  setTimeout(() => {
    elements.urlInput.placeholder = orig;
  }, 2500);
}

/**
 * Update visibility of conditional controls
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

// Bootstrap on DOM ready
document.addEventListener('DOMContentLoaded', init);
