/**
 * Multi URL Opener - Background Service Worker / Event Script
 * Handles state coordination, URL management, queue scheduling, local persistence,
 * and service-worker / browser lifecycle recovery.
 * by nzrfzr
 */

import { SESSION_STATUS, ROW_STATUS, DEFAULTS, MESSAGE_TYPES } from '../src/constants.js';
import { browserAdapter } from '../src/browser-adapter.js';
import { UrlListManager } from '../src/url-list.js';
import { TabManager } from '../src/tab-manager.js';
import { QueueController } from '../src/queue-controller.js';
import { storageManager } from '../src/storage.js';

console.log('[MultiURLOpener] Background service initialized.');

let isInitialized = false;
let browserJustStarted = false;

// Register onStartup early to detect browser restarts
if (typeof browserAdapter.runtime?.onStartup?.addListener === 'function') {
  browserAdapter.runtime.onStartup.addListener(() => {
    browserJustStarted = true;
    handleBrowserStartup();
  });
}

const urlListManager = new UrlListManager();

// Tab manager instance
const tabManager = new TabManager({
  onTabStatusChange: (event) => {
    queueController.handleTabLifecycleEvent(event);
  }
});

// Queue controller instance
const queueController = new QueueController({
  tabManager,
  onSessionChange: (session) => {
    currentState.session = session;
    persistState();
  },
  onRowChange: ({ rowId, status, tabId, error }) => {
    const row = currentState.rows.find(r => r.id === rowId);
    if (row) {
      row.status = status;
      if (tabId != null) row.tabId = tabId;
      if (error) row.error = error;
    }
    persistState();
  }
});

// Authoritative in-memory state
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
  session: queueController.session
};

function syncRows() {
  currentState.rows = urlListManager.getRows();
}

/**
 * Persists current state to local extension storage
 */
async function persistState() {
  syncRows();
  await storageManager.saveState(currentState);
}

/**
 * Initialize and restore state from storage
 */
async function ensureInitialized() {
  if (isInitialized) return;

  try {
    const loaded = await storageManager.loadState();
    if (loaded) {
      currentState.preferences = QueueController.sanitizePreferences(loaded.preferences);
      
      // Restore rows into urlListManager
      if (Array.isArray(loaded.rows) && loaded.rows.length > 0) {
        urlListManager.rows = loaded.rows;
        syncRows();
      }

      // Restore session
      if (loaded.session) {
        currentState.session = {
          ...queueController.session,
          ...loaded.session
        };
      }

      // If browser was restarted while queue was running, mark interrupted and do not resume
      if (browserJustStarted && currentState.session.status === SESSION_STATUS.RUNNING) {
        currentState.session.status = SESSION_STATUS.STOPPED;
        currentState.session.interrupted = true;
        currentState.session.updatedAt = Date.now();
        // Mark pending queued rows as stopped
        for (const row of currentState.rows) {
          if (row.status === ROW_STATUS.QUEUED || row.status === ROW_STATUS.CREATING_TAB) {
            row.status = ROW_STATUS.STOPPED;
          }
        }
        await persistState();
      }
    }
  } catch (err) {
    console.warn('[MultiURLOpener] Failed to restore state:', err);
  } finally {
    isInitialized = true;
  }
}

/**
 * Handle browser restart event
 */
async function handleBrowserStartup() {
  await ensureInitialized();
  if (currentState.session.status === SESSION_STATUS.RUNNING) {
    currentState.session.status = SESSION_STATUS.STOPPED;
    currentState.session.interrupted = true;
    currentState.session.updatedAt = Date.now();
    await persistState();
  }
}

// Kick off initialization
ensureInitialized();

/**
 * Handle incoming messages from popup or manager
 */
browserAdapter.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') {
    return false;
  }

  const { type, payload } = message;

  // Ensure state is ready before responding
  ensureInitialized().then(async () => {
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
        break;

      case MESSAGE_TYPES.GET_STATE:
        syncRows();
        sendResponse({
          success: true,
          type: MESSAGE_TYPES.GET_STATE,
          payload: {
            ...currentState,
            stats: urlListManager.getStats(),
            activeNavigationsCount: queueController.activeCount
          }
        });
        break;

      case MESSAGE_TYPES.UPDATE_PREFERENCES:
        if (payload && typeof payload === 'object') {
          currentState.preferences = QueueController.sanitizePreferences({
            ...currentState.preferences,
            ...payload
          });
          await persistState();
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
        break;

      case MESSAGE_TYPES.ADD_URL_TEXT: {
        const text = payload?.text || '';
        const isExtractMode = Boolean(payload?.isExtractMode);
        const added = urlListManager.addFromText(text, isExtractMode);
        await persistState();
        sendResponse({
          success: true,
          type: MESSAGE_TYPES.ADD_URL_TEXT,
          payload: {
            added,
            rows: currentState.rows,
            stats: urlListManager.getStats()
          }
        });
        break;
      }

      case MESSAGE_TYPES.SET_ROW_SELECTION: {
        const { id, selected } = payload || {};
        const updated = urlListManager.setRowSelection(id, selected);
        await persistState();
        sendResponse({
          success: updated,
          type: MESSAGE_TYPES.SET_ROW_SELECTION,
          payload: {
            rows: currentState.rows,
            stats: urlListManager.getStats()
          }
        });
        break;
      }

      case MESSAGE_TYPES.SELECT_ALL: {
        const onlyValid = Boolean(payload?.onlyValid);
        urlListManager.selectAll(onlyValid);
        await persistState();
        sendResponse({
          success: true,
          type: MESSAGE_TYPES.SELECT_ALL,
          payload: {
            rows: currentState.rows,
            stats: urlListManager.getStats()
          }
        });
        break;
      }

      case MESSAGE_TYPES.SELECT_NONE: {
        urlListManager.selectNone();
        await persistState();
        sendResponse({
          success: true,
          type: MESSAGE_TYPES.SELECT_NONE,
          payload: {
            rows: currentState.rows,
            stats: urlListManager.getStats()
          }
        });
        break;
      }

      case MESSAGE_TYPES.DELETE_ROW: {
        const { id } = payload || {};
        const deleted = urlListManager.deleteRow(id);
        await persistState();
        sendResponse({
          success: deleted,
          type: MESSAGE_TYPES.DELETE_ROW,
          payload: {
            rows: currentState.rows,
            stats: urlListManager.getStats()
          }
        });
        break;
      }

      case MESSAGE_TYPES.DELETE_SELECTED: {
        const deletedCount = urlListManager.deleteSelected();
        await persistState();
        sendResponse({
          success: true,
          type: MESSAGE_TYPES.DELETE_SELECTED,
          payload: {
            deletedCount,
            rows: currentState.rows,
            stats: urlListManager.getStats()
          }
        });
        break;
      }

      case MESSAGE_TYPES.CLEAR_LIST: {
        if (currentState.session?.status === SESSION_STATUS.RUNNING) {
          sendResponse({
            success: false,
            error: 'Cannot clear list while queue is running. Stop queue first.'
          });
          break;
        }
        urlListManager.clearList();
        await persistState();
        sendResponse({
          success: true,
          type: MESSAGE_TYPES.CLEAR_LIST,
          payload: {
            rows: currentState.rows,
            stats: urlListManager.getStats()
          }
        });
        break;
      }

      case MESSAGE_TYPES.START_QUEUE: {
        syncRows();
        const result = queueController.start(currentState.rows, currentState.preferences);
        await persistState();
        sendResponse({
          success: result.success,
          type: MESSAGE_TYPES.START_QUEUE,
          payload: {
            ...currentState,
            stats: urlListManager.getStats(),
            activeNavigationsCount: queueController.activeCount
          },
          error: result.error
        });
        break;
      }

      case MESSAGE_TYPES.PAUSE_QUEUE: {
        queueController.pause();
        await persistState();
        sendResponse({
          success: true,
          type: MESSAGE_TYPES.PAUSE_QUEUE,
          payload: {
            ...currentState,
            stats: urlListManager.getStats(),
            activeNavigationsCount: queueController.activeCount
          }
        });
        break;
      }

      case MESSAGE_TYPES.RESUME_QUEUE: {
        queueController.resume();
        await persistState();
        sendResponse({
          success: true,
          type: MESSAGE_TYPES.RESUME_QUEUE,
          payload: {
            ...currentState,
            stats: urlListManager.getStats(),
            activeNavigationsCount: queueController.activeCount
          }
        });
        break;
      }

      case MESSAGE_TYPES.STOP_QUEUE: {
        queueController.stop();
        await persistState();
        sendResponse({
          success: true,
          type: MESSAGE_TYPES.STOP_QUEUE,
          payload: {
            ...currentState,
            stats: urlListManager.getStats(),
            activeNavigationsCount: queueController.activeCount
          }
        });
        break;
      }

      default:
        console.warn('[MultiURLOpener] Unhandled message type:', type);
        sendResponse({
          success: false,
          error: `Unknown message type: ${type}`
        });
        break;
    }
  });

  return true; // Keep message channel open for asynchronous response
});
