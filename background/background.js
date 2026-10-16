/**
 * Multi URL Opener - Background Service Worker / Event Script
 * Handles state coordination, URL management, and tab lifecycle events.
 * by nzrfzr
 */

import { SESSION_STATUS, ROW_STATUS, DEFAULTS, MESSAGE_TYPES } from '../src/constants.js';
import { browserAdapter } from '../src/browser-adapter.js';
import { UrlListManager } from '../src/url-list.js';
import { TabManager } from '../src/tab-manager.js';

console.log('[MultiURLOpener] Background service initialized.');

const urlListManager = new UrlListManager();

// Tab manager instance with lifecycle event listener
const tabManager = new TabManager({
  onTabStatusChange: handleTabLifecycleEvent
});

// Authoritative state
let currentState = {
  schemaVersion: 1,
  preferences: {
    mode: DEFAULTS.MODE,
    intervalSeconds: DEFAULTS.INTERVAL_SECONDS,
    concurrencyLimit: DEFAULTS.CONCURRENCY_LIMIT,
    timeoutSeconds: DEFAULTS.TIMEOUT_SECONDS,
    openInBackground: DEFAULTS.OPEN_IN_BACKGROUND,
    deferUntilSelected: DEFAULTS.DEFER_UNTIL_SELECTED
  },
  rows: urlListManager.getRows(),
  session: {
    id: null,
    status: SESSION_STATUS.READY,
    selectedRowIds: [],
    queueRowIds: [],
    startedRowIds: [],
    processedRowIds: [],
    successRowIds: [],
    failedRowIds: [],
    createdTabIds: [],
    openedCount: 0,
    successCount: 0,
    failedCount: 0,
    totalCount: 0,
    startedAt: null,
    updatedAt: null,
    interrupted: false
  }
};

function syncRows() {
  currentState.rows = urlListManager.getRows();
}

/**
 * Handle tab events from TabManager
 * @param {{ type: string, rowId: string, tabId: number | null, status: string, error?: string }} event 
 */
function handleTabLifecycleEvent(event) {
  const { type, rowId, tabId, status, error } = event;
  const row = currentState.rows.find(r => r.id === rowId);

  if (row) {
    row.status = status;
    if (tabId != null) row.tabId = tabId;
    if (error) row.error = error;
  }

  const s = currentState.session;

  if (type === 'tab_created') {
    s.openedCount += 1;
    if (tabId != null && !s.createdTabIds.includes(tabId)) {
      s.createdTabIds.push(tabId);
    }
    if (!s.startedRowIds.includes(rowId)) {
      s.startedRowIds.push(rowId);
    }
  } else if (type === 'tab_loaded') {
    s.successCount += 1;
    if (!s.successRowIds.includes(rowId)) {
      s.successRowIds.push(rowId);
    }
    if (!s.processedRowIds.includes(rowId)) {
      s.processedRowIds.push(rowId);
    }
  } else if (type === 'tab_closed_early' || type === 'tab_timeout' || type === 'tab_create_failed') {
    s.failedCount += 1;
    if (!s.failedRowIds.includes(rowId)) {
      s.failedRowIds.push(rowId);
    }
    if (!s.processedRowIds.includes(rowId)) {
      s.processedRowIds.push(rowId);
    }
  }

  // Check if all queued items reached terminal state
  if (s.status === SESSION_STATUS.RUNNING && s.totalCount > 0) {
    const totalProcessed = s.successCount + s.failedCount;
    if (totalProcessed >= s.totalCount) {
      s.status = s.failedCount > 0 
        ? SESSION_STATUS.COMPLETED_WITH_ERRORS 
        : SESSION_STATUS.COMPLETED;
      s.updatedAt = Date.now();
    }
  }
}

/**
 * Start opening selected valid tabs (Milestone 3 basic opening)
 */
async function startBasicOpening() {
  const eligible = currentState.rows.filter(r => r.selected && r.valid);
  if (!eligible.length) {
    return { success: false, error: 'No selected valid URLs to open' };
  }

  const s = currentState.session;
  s.id = `session_${Date.now()}`;
  s.status = SESSION_STATUS.RUNNING;
  s.selectedRowIds = eligible.map(r => r.id);
  s.queueRowIds = eligible.map(r => r.id);
  s.startedRowIds = [];
  s.processedRowIds = [];
  s.successRowIds = [];
  s.failedRowIds = [];
  s.createdTabIds = [];
  s.openedCount = 0;
  s.successCount = 0;
  s.failedCount = 0;
  s.totalCount = eligible.length;
  s.startedAt = Date.now();
  s.updatedAt = Date.now();

  const openInBackground = currentState.preferences.openInBackground;
  const timeoutSeconds = currentState.preferences.timeoutSeconds;

  // Open eligible tabs
  for (const row of eligible) {
    row.status = ROW_STATUS.QUEUED;
  }

  // Launch tab creations
  for (const row of eligible) {
    // If session stopped in the middle
    if (s.status === SESSION_STATUS.STOPPED) break;
    tabManager.openTab(row.id, row.url, { openInBackground, timeoutSeconds }).catch(err => {
      console.warn('[MultiURLOpener] Tab open error:', err);
    });
  }

  return { success: true, session: s };
}

/**
 * Handle incoming messages from popup or manager
 */
browserAdapter.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') {
    return false;
  }

  const { type, payload } = message;

  switch (type) {
    case MESSAGE_TYPES.PING:
      sendResponse({
        success: true,
        type: MESSAGE_TYPES.PING,
        payload: {
          timestamp: Date.now(),
          status: 'pong',
          serviceReady: true
        }
      });
      return false;

    case MESSAGE_TYPES.GET_STATE:
      syncRows();
      sendResponse({
        success: true,
        type: MESSAGE_TYPES.GET_STATE,
        payload: {
          ...currentState,
          stats: urlListManager.getStats(),
          activeNavigationsCount: tabManager.activeCount
        }
      });
      return false;

    case MESSAGE_TYPES.UPDATE_PREFERENCES:
      if (payload && typeof payload === 'object') {
        currentState.preferences = {
          ...currentState.preferences,
          ...payload
        };
        sendResponse({
          success: true,
          type: MESSAGE_TYPES.UPDATE_PREFERENCES,
          payload: currentState.preferences
        });
      } else {
        sendResponse({
          success: false,
          error: 'Invalid preferences payload'
        });
      }
      return false;

    case MESSAGE_TYPES.ADD_URL_TEXT: {
      const text = payload?.text || '';
      const isExtractMode = Boolean(payload?.isExtractMode);
      const added = urlListManager.addFromText(text, isExtractMode);
      syncRows();
      sendResponse({
        success: true,
        type: MESSAGE_TYPES.ADD_URL_TEXT,
        payload: {
          added,
          rows: currentState.rows,
          stats: urlListManager.getStats()
        }
      });
      return false;
    }

    case MESSAGE_TYPES.SET_ROW_SELECTION: {
      const { id, selected } = payload || {};
      const updated = urlListManager.setRowSelection(id, selected);
      syncRows();
      sendResponse({
        success: updated,
        type: MESSAGE_TYPES.SET_ROW_SELECTION,
        payload: {
          rows: currentState.rows,
          stats: urlListManager.getStats()
        }
      });
      return false;
    }

    case MESSAGE_TYPES.SELECT_ALL: {
      const onlyValid = Boolean(payload?.onlyValid);
      urlListManager.selectAll(onlyValid);
      syncRows();
      sendResponse({
        success: true,
        type: MESSAGE_TYPES.SELECT_ALL,
        payload: {
          rows: currentState.rows,
          stats: urlListManager.getStats()
        }
      });
      return false;
    }

    case MESSAGE_TYPES.SELECT_NONE: {
      urlListManager.selectNone();
      syncRows();
      sendResponse({
        success: true,
        type: MESSAGE_TYPES.SELECT_NONE,
        payload: {
          rows: currentState.rows,
          stats: urlListManager.getStats()
        }
      });
      return false;
    }

    case MESSAGE_TYPES.DELETE_ROW: {
      const { id } = payload || {};
      const deleted = urlListManager.deleteRow(id);
      syncRows();
      sendResponse({
        success: deleted,
        type: MESSAGE_TYPES.DELETE_ROW,
        payload: {
          rows: currentState.rows,
          stats: urlListManager.getStats()
        }
      });
      return false;
    }

    case MESSAGE_TYPES.DELETE_SELECTED: {
      const deletedCount = urlListManager.deleteSelected();
      syncRows();
      sendResponse({
        success: true,
        type: MESSAGE_TYPES.DELETE_SELECTED,
        payload: {
          deletedCount,
          rows: currentState.rows,
          stats: urlListManager.getStats()
        }
      });
      return false;
    }

    case MESSAGE_TYPES.CLEAR_LIST: {
      urlListManager.clearList();
      syncRows();
      sendResponse({
        success: true,
        type: MESSAGE_TYPES.CLEAR_LIST,
        payload: {
          rows: currentState.rows,
          stats: urlListManager.getStats()
        }
      });
      return false;
    }

    case MESSAGE_TYPES.START_QUEUE: {
      startBasicOpening().then(result => {
        sendResponse({
          success: result.success,
          type: MESSAGE_TYPES.START_QUEUE,
          payload: {
            ...currentState,
            stats: urlListManager.getStats()
          },
          error: result.error
        });
      });
      return true; // Asynchronous response
    }

    default:
      console.warn('[MultiURLOpener] Unhandled message type:', type);
      sendResponse({
        success: false,
        error: `Unknown message type: ${type}`
      });
      return false;
  }
});
