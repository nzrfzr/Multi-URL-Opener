/**
 * Multi URL Opener - Local Storage Manager
 * Handles local persistence of rows, preferences, and session state.
 * by nzrfzr
 */

import { STORAGE_KEYS, SESSION_STATUS, DEFAULTS } from './constants.js';
import { browserAdapter as defaultAdapter } from './browser-adapter.js';

export const CURRENT_SCHEMA_VERSION = 1;

/**
 * Returns default blank state skeleton
 * @returns {object}
 */
export function getDefaultState() {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
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
      openedCount: 0,
      successCount: 0,
      failedCount: 0,
      totalCount: 0,
      startedAt: null,
      updatedAt: null,
      interrupted: false
    }
  };
}

export class StorageManager {
  /**
   * @param {object} [adapter] WebExtensions adapter (defaults to browserAdapter)
   */
  constructor(adapter = defaultAdapter) {
    this.adapter = adapter;
  }

  /**
   * Loads persisted state from local storage.
   * Gracefully falls back to default state if data is missing or corrupted.
   * @returns {Promise<object>}
   */
  async loadState() {
    try {
      if (!this.adapter?.storage?.local) {
        return getDefaultState();
      }

      const result = await this.adapter.storage.local.get(STORAGE_KEYS.STATE);
      const raw = result ? result[STORAGE_KEYS.STATE] : null;

      if (!raw || typeof raw !== 'object') {
        return getDefaultState();
      }

      // Validate or migrate schema if necessary
      return this._migrateOrValidate(raw);
    } catch (err) {
      console.warn('[MultiURLOpener] Storage read error, falling back to default state:', err);
      return getDefaultState();
    }
  }

  /**
   * Persists state to local storage.
   * @param {object} state 
   * @returns {Promise<boolean>}
   */
  async saveState(state) {
    try {
      if (!this.adapter?.storage?.local) {
        return false;
      }

      const toSave = {
        ...state,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        savedAt: Date.now()
      };

      await this.adapter.storage.local.set({
        [STORAGE_KEYS.STATE]: toSave
      });

      return true;
    } catch (err) {
      console.error('[MultiURLOpener] Storage write error:', err);
      return false;
    }
  }

  /**
   * Clears persisted state from local storage.
   * @returns {Promise<boolean>}
   */
  async clearState() {
    try {
      if (!this.adapter?.storage?.local) return false;
      await this.adapter.storage.local.remove(STORAGE_KEYS.STATE);
      return true;
    } catch (err) {
      console.error('[MultiURLOpener] Storage clear error:', err);
      return false;
    }
  }

  /**
   * Internal validation and migration helper
   * @private
   */
  _migrateOrValidate(raw) {
    const defaults = getDefaultState();

    // Ensure all critical top-level structures exist
    const state = {
      schemaVersion: raw.schemaVersion || CURRENT_SCHEMA_VERSION,
      preferences: {
        ...defaults.preferences,
        ...(raw.preferences || {})
      },
      rows: Array.isArray(raw.rows) ? raw.rows : [],
      session: {
        ...defaults.session,
        ...(raw.session || {})
      }
    };

    return state;
  }
}

export const storageManager = new StorageManager();
