/**
 * Multi URL Opener - Background Service Worker / Event Script
 * Handles state coordination, URL management, queue scheduling, and tab lifecycle.
 * by nzrfzr
 */

import { SESSION_STATUS, DEFAULTS, MESSAGE_TYPES } from '../src/constants.js';
import { browserAdapter } from '../src/browser-adapter.js';
import { UrlListManager } from '../src/url-list.js';
import { TabManager } from '../src/tab-manager.js';
import { QueueController } from '../src/queue-controller.js';

console.log('[MultiURLOpener] Background service initialized.');

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
  },
  onRowChange: ({ rowId, status, tabId, error }) => {
    const row = currentState.rows.find(r => r.id === rowId);
    if (row) {
      row.status = status;
      if (tabId != null) row.tabId = tabId;
      if (error) row.error = error;
    }
  }
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
  session: queueController.session
};

function syncRows() {
  currentState.rows = urlListManager.getRows();
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
          activeNavigationsCount: queueController.activeCount
        }
      });
      return false;

    case MESSAGE_TYPES.UPDATE_PREFERENCES:
      if (payload && typeof payload === 'object') {
        currentState.preferences = QueueController.sanitizePreferences({
          ...currentState.preferences,
          ...payload
        });
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
      // Disallow clearing while a queue is active
      if (currentState.session?.status === SESSION_STATUS.RUNNING) {
        sendResponse({
          success: false,
          error: 'Cannot clear list while queue is running. Stop queue first.'
        });
        return false;
      }
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
      syncRows();
      const result = queueController.start(currentState.rows, currentState.preferences);
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
      return false;
    }

    case MESSAGE_TYPES.PAUSE_QUEUE: {
      queueController.pause();
      sendResponse({
        success: true,
        type: MESSAGE_TYPES.PAUSE_QUEUE,
        payload: {
          ...currentState,
          stats: urlListManager.getStats(),
          activeNavigationsCount: queueController.activeCount
        }
      });
      return false;
    }

    case MESSAGE_TYPES.RESUME_QUEUE: {
      queueController.resume();
      sendResponse({
        success: true,
        type: MESSAGE_TYPES.RESUME_QUEUE,
        payload: {
          ...currentState,
          stats: urlListManager.getStats(),
          activeNavigationsCount: queueController.activeCount
        }
      });
      return false;
    }

    case MESSAGE_TYPES.STOP_QUEUE: {
      queueController.stop();
      sendResponse({
        success: true,
        type: MESSAGE_TYPES.STOP_QUEUE,
        payload: {
          ...currentState,
          stats: urlListManager.getStats(),
          activeNavigationsCount: queueController.activeCount
        }
      });
      return false;
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
