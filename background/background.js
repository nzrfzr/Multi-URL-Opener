/**
 * Multi URL Opener - Background Service Worker / Event Script
 * by nzrfzr
 */

import { SESSION_STATUS, DEFAULTS, MESSAGE_TYPES } from '../src/constants.js';
import { browserAdapter } from '../src/browser-adapter.js';
import { UrlListManager } from '../src/url-list.js';

console.log('[MultiURLOpener] Background service initialized.');

const urlListManager = new UrlListManager();

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
    activeNavigations: {},
    startedAt: null,
    updatedAt: null,
    interrupted: false
  }
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
          stats: urlListManager.getStats()
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

    default:
      console.warn('[MultiURLOpener] Unhandled message type:', type);
      sendResponse({
        success: false,
        error: `Unknown message type: ${type}`
      });
      return false;
  }
});
