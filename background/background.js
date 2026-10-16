/**
 * Multi URL Opener - Background Service Worker / Event Script
 * by nzrfzr
 */

import { SESSION_STATUS, DEFAULTS, MESSAGE_TYPES } from '../src/constants.js';
import { browserAdapter } from '../src/browser-adapter.js';

console.log('[MultiURLOpener] Background service initialized.');

// Initial state skeleton for Milestone 1
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
  rows: [],
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
      return false; // Synchronous response

    case MESSAGE_TYPES.GET_STATE:
      sendResponse({
        success: true,
        type: MESSAGE_TYPES.GET_STATE,
        payload: currentState
      });
      return false; // Synchronous response

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

    default:
      console.warn('[MultiURLOpener] Unhandled message type:', type);
      sendResponse({
        success: false,
        error: `Unknown message type: ${type}`
      });
      return false;
  }
});
