/**
 * Multi URL Opener - Tab Manager
 * Handles tab creation, mapping between tab IDs and row IDs, and tab lifecycle events.
 * by nzrfzr
 */

import { ROW_STATUS } from './constants.js';
import { browserAdapter as defaultAdapter } from './browser-adapter.js';

export class TabManager {
  /**
   * @param {object} [options]
   * @param {object} [options.adapter] Optional WebExtensions adapter (defaults to browserAdapter)
   * @param {(event: { type: string, rowId: string, tabId: number | null, status: string, error?: string }) => void} [options.onTabStatusChange]
   */
  constructor(options = {}) {
    this.adapter = options.adapter || defaultAdapter;
    this.onTabStatusChange = options.onTabStatusChange || (() => {});
    
    // Maps:
    // tabId -> { rowId, url, status, startedAt, timerId }
    this.activeTabs = new Map();
    // rowId -> tabId
    this.rowToTab = new Map();

    this._setupListeners();
  }

  /**
   * Register WebExtension tab event listeners
   * @private
   */
  _setupListeners() {
    if (!this.adapter?.tabs) return;

    // Listen for tab status updates (loading -> complete)
    if (typeof this.adapter.tabs.onUpdated?.addListener === 'function') {
      this.adapter.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        const tracked = this.activeTabs.get(tabId);
        if (!tracked) return;

        if (changeInfo.status === 'complete') {
          this._handleTabComplete(tabId, tracked);
        } else if (changeInfo.status === 'loading' && tracked.status !== ROW_STATUS.LOADING) {
          tracked.status = ROW_STATUS.LOADING;
          this.onTabStatusChange({
            type: 'status_change',
            rowId: tracked.rowId,
            tabId,
            status: ROW_STATUS.LOADING
          });
        }
      });
    }

    // Listen for tab closure
    if (typeof this.adapter.tabs.onRemoved?.addListener === 'function') {
      this.adapter.tabs.onRemoved.addListener((tabId) => {
        const tracked = this.activeTabs.get(tabId);
        if (!tracked) return;

        this._clearTimeout(tracked);

        // If the tab was closed before completing
        if (tracked.status === ROW_STATUS.LOADING || tracked.status === ROW_STATUS.CREATING_TAB) {
          this.onTabStatusChange({
            type: 'tab_closed_early',
            rowId: tracked.rowId,
            tabId,
            status: ROW_STATUS.FAILED,
            error: 'Tab closed while loading'
          });
        }

        this.activeTabs.delete(tabId);
        this.rowToTab.delete(tracked.rowId);
      });
    }
  }

  /**
   * Opens a URL in a new background tab and tracks its lifecycle.
   * @param {string} rowId 
   * @param {string} url 
   * @param {{ openInBackground?: boolean, timeoutSeconds?: number }} [options={}]
   * @returns {Promise<{ success: boolean, tabId?: number, error?: string }>}
   */
  async openTab(rowId, url, options = {}) {
    const openInBackground = options.openInBackground !== false; // default true
    const timeoutSeconds = options.timeoutSeconds || 30;

    try {
      // 1. Notify that tab creation has started
      this.onTabStatusChange({
        type: 'status_change',
        rowId,
        tabId: null,
        status: ROW_STATUS.CREATING_TAB
      });

      // 2. Create the tab via adapter
      const tab = await this.adapter.tabs.create({
        url,
        active: !openInBackground
      });

      if (!tab || tab.id == null) {
        throw new Error('Browser returned invalid tab object');
      }

      const tabId = tab.id;

      // 3. Track the active tab
      const tracked = {
        rowId,
        url,
        status: ROW_STATUS.LOADING,
        startedAt: Date.now(),
        timerId: null
      };

      // Set timeout fallback
      tracked.timerId = setTimeout(() => {
        this._handleTabTimeout(tabId, tracked);
      }, timeoutSeconds * 1000);

      this.activeTabs.set(tabId, tracked);
      this.rowToTab.set(rowId, tabId);

      // 4. Notify that tab was opened and is now loading
      this.onTabStatusChange({
        type: 'tab_created',
        rowId,
        tabId,
        status: ROW_STATUS.LOADING
      });

      // If browser already marked it complete immediately
      if (tab.status === 'complete') {
        this._handleTabComplete(tabId, tracked);
      }

      return { success: true, tabId };
    } catch (err) {
      const errorMsg = err.message || 'Failed to create tab';
      this.onTabStatusChange({
        type: 'tab_create_failed',
        rowId,
        tabId: null,
        status: ROW_STATUS.FAILED,
        error: errorMsg
      });

      return { success: false, error: errorMsg };
    }
  }

  /**
   * Handle tab reaching complete state
   * @private
   */
  _handleTabComplete(tabId, tracked) {
    this._clearTimeout(tracked);
    tracked.status = ROW_STATUS.SUCCESS;

    this.onTabStatusChange({
      type: 'tab_loaded',
      rowId: tracked.rowId,
      tabId,
      status: ROW_STATUS.SUCCESS
    });

    this.activeTabs.delete(tabId);
    this.rowToTab.delete(tracked.rowId);
  }

  /**
   * Handle navigation timeout
   * @private
   */
  _handleTabTimeout(tabId, tracked) {
    tracked.status = ROW_STATUS.TIMED_OUT;

    this.onTabStatusChange({
      type: 'tab_timeout',
      rowId: tracked.rowId,
      tabId,
      status: ROW_STATUS.TIMED_OUT,
      error: 'Navigation timed out'
    });

    this.activeTabs.delete(tabId);
    this.rowToTab.delete(tracked.rowId);
  }

  /**
   * Clear timeout timer if active
   * @private
   */
  _clearTimeout(tracked) {
    if (tracked.timerId) {
      clearTimeout(tracked.timerId);
      tracked.timerId = null;
    }
  }

  /**
   * Number of currently active navigations in progress
   * @returns {number}
   */
  get activeCount() {
    return this.activeTabs.size;
  }

  /**
   * Resets and clears all tracked tabs and timers
   */
  reset() {
    for (const tracked of this.activeTabs.values()) {
      this._clearTimeout(tracked);
    }
    this.activeTabs.clear();
    this.rowToTab.clear();
  }
}
