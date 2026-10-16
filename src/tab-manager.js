/**
 * Multi URL Opener - Tab Manager
 * Handles tab creation, mapping between tab IDs and row IDs, tab lifecycle events,
 * and deferred navigation ("Don't load until selected").
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
    // tabId -> { rowId, targetUrl, timeoutSeconds } (deferred tabs waiting for selection)
    this.waitingTabs = new Map();
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
        // 1. Check if it was a waiting tab
        if (this.waitingTabs.has(tabId)) {
          const waiting = this.waitingTabs.get(tabId);
          this.waitingTabs.delete(tabId);
          this.rowToTab.delete(waiting.rowId);
          this.onTabStatusChange({
            type: 'tab_closed_early',
            rowId: waiting.rowId,
            tabId,
            status: ROW_STATUS.STOPPED,
            error: 'Waiting tab closed before selection'
          });
          return;
        }

        // 2. Check if it was an active loading tab
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

    // Listen for tab activation (for deferred navigation "Don't load until selected")
    if (typeof this.adapter.tabs.onActivated?.addListener === 'function') {
      this.adapter.tabs.onActivated.addListener(({ tabId }) => {
        this.handleTabActivation(tabId);
      });
    }
  }

  /**
   * Handle user activating a tab (triggers deferred navigation if waiting)
   * @param {number} tabId 
   */
  async handleTabActivation(tabId) {
    if (!this.waitingTabs.has(tabId)) return;

    const waiting = this.waitingTabs.get(tabId);
    this.waitingTabs.delete(tabId);

    const { rowId, targetUrl, timeoutSeconds } = waiting;

    // Track as actively loading now that user activated it
    const tracked = {
      rowId,
      url: targetUrl,
      status: ROW_STATUS.LOADING,
      startedAt: Date.now(),
      timerId: null
    };

    tracked.timerId = setTimeout(() => {
      this._handleTabTimeout(tabId, tracked);
    }, (timeoutSeconds || 30) * 1000);

    this.activeTabs.set(tabId, tracked);

    this.onTabStatusChange({
      type: 'tab_activated_loading',
      rowId,
      tabId,
      status: ROW_STATUS.LOADING
    });

    try {
      await this.adapter.tabs.update(tabId, { url: targetUrl });
    } catch (err) {
      console.warn(`[TabManager] Error navigating deferred tab ${tabId}:`, err);
      this._clearTimeout(tracked);
      this.activeTabs.delete(tabId);
      this.rowToTab.delete(rowId);
      this.onTabStatusChange({
        type: 'tab_create_failed',
        rowId,
        tabId,
        status: ROW_STATUS.FAILED,
        error: err.message || 'Deferred navigation failed'
      });
    }
  }

  /**
   * Opens a URL in a new background tab and tracks its lifecycle.
   * If deferUntilSelected is true, opens placeholder and waits for activation.
   * @param {string} rowId 
   * @param {string} url 
   * @param {{ openInBackground?: boolean, timeoutSeconds?: number, deferUntilSelected?: boolean }} [options={}]
   * @returns {Promise<{ success: boolean, tabId?: number, deferred?: boolean, error?: string }>}
   */
  async openTab(rowId, url, options = {}) {
    const openInBackground = options.openInBackground !== false; // default true
    const timeoutSeconds = options.timeoutSeconds || 30;
    const deferUntilSelected = Boolean(options.deferUntilSelected);

    try {
      // 1. Notify that tab creation has started
      this.onTabStatusChange({
        type: 'status_change',
        rowId,
        tabId: null,
        status: ROW_STATUS.CREATING_TAB
      });

      // 2. Determine initial URL (placeholder if deferred)
      let initialUrl = url;
      if (deferUntilSelected) {
        initialUrl = typeof this.adapter?.runtime?.getURL === 'function'
          ? this.adapter.runtime.getURL(`placeholder/placeholder.html?target=${encodeURIComponent(url)}`)
          : 'about:blank';
      }

      // 3. Create tab
      const tab = await this.adapter.tabs.create({
        url: initialUrl,
        active: !openInBackground
      });

      if (!tab || tab.id == null) {
        throw new Error('Browser returned invalid tab object');
      }

      const tabId = tab.id;
      this.rowToTab.set(rowId, tabId);

      // 4. Handle deferred vs direct
      if (deferUntilSelected) {
        this.waitingTabs.set(tabId, { rowId, targetUrl: url, timeoutSeconds });
        this.onTabStatusChange({
          type: 'tab_waiting',
          rowId,
          tabId,
          status: ROW_STATUS.WAITING_FOR_SELECTION
        });
        return { success: true, tabId, deferred: true };
      }

      // Direct navigation tracking
      const tracked = {
        rowId,
        url,
        status: ROW_STATUS.LOADING,
        startedAt: Date.now(),
        timerId: null
      };

      tracked.timerId = setTimeout(() => {
        this._handleTabTimeout(tabId, tracked);
      }, timeoutSeconds * 1000);

      this.activeTabs.set(tabId, tracked);

      this.onTabStatusChange({
        type: 'tab_created',
        rowId,
        tabId,
        status: ROW_STATUS.LOADING
      });

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
   * Waiting tabs do not count towards active navigation count.
   * @returns {number}
   */
  get activeCount() {
    return this.activeTabs.size;
  }

  /**
   * Number of tabs currently waiting for user selection
   * @returns {number}
   */
  get waitingCount() {
    return this.waitingTabs.size;
  }

  /**
   * Resets and clears all tracked tabs and timers
   */
  reset() {
    for (const tracked of this.activeTabs.values()) {
      this._clearTimeout(tracked);
    }
    this.activeTabs.clear();
    this.waitingTabs.clear();
    this.rowToTab.clear();
  }
}
