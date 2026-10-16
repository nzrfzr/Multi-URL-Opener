/**
 * Multi URL Opener - Queue Controller
 * Owns scheduling policies (Open All, At Interval, After Load),
 * concurrency management, timeout handling, and pause/resume/stop transitions.
 * by nzrfzr
 */

import { SESSION_STATUS, ROW_STATUS, OPEN_MODE, DEFAULTS, LIMITS } from './constants.js';

export class QueueController {
  /**
   * @param {object} options
   * @param {object} options.tabManager An instance of TabManager to open tabs
   * @param {Function} [options.onSessionChange] Callback for session status & counter changes
   * @param {Function} [options.onRowChange] Callback for row status updates
   */
  constructor(options = {}) {
    if (!options.tabManager) {
      throw new Error('QueueController requires a tabManager instance');
    }

    this.tabManager = options.tabManager;
    this.onSessionChange = options.onSessionChange || (() => {});
    this.onRowChange = options.onRowChange || (() => {});

    this.queue = [];                  // Array of row IDs waiting to be started
    this.activeNavigations = new Set(); // Set of row IDs currently loading
    this.rowsMap = new Map();         // rowId -> row object reference

    this.preferences = {
      mode: DEFAULTS.MODE,
      intervalSeconds: DEFAULTS.INTERVAL_SECONDS,
      concurrencyLimit: DEFAULTS.CONCURRENCY_LIMIT,
      timeoutSeconds: DEFAULTS.TIMEOUT_SECONDS,
      openInBackground: DEFAULTS.OPEN_IN_BACKGROUND,
      deferUntilSelected: DEFAULTS.DEFER_UNTIL_SELECTED
    };

    this.session = {
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
    };

    this.intervalTimer = null;
    this.isProcessing = false;
  }

  /**
   * Sanitize and clamp preferences
   * @param {object} prefs 
   * @returns {object}
   */
  static sanitizePreferences(prefs = {}) {
    const mode = Object.values(OPEN_MODE).includes(prefs.mode) 
      ? prefs.mode 
      : DEFAULTS.MODE;

    let concurrency = parseInt(prefs.concurrencyLimit, 10);
    if (isNaN(concurrency)) concurrency = DEFAULTS.CONCURRENCY_LIMIT;
    concurrency = Math.max(LIMITS.MIN_CONCURRENCY, Math.min(LIMITS.MAX_CONCURRENCY, concurrency));

    let interval = parseFloat(prefs.intervalSeconds);
    if (isNaN(interval)) interval = DEFAULTS.INTERVAL_SECONDS;
    interval = Math.max(LIMITS.MIN_INTERVAL, Math.min(LIMITS.MAX_INTERVAL, interval));

    let timeout = parseInt(prefs.timeoutSeconds, 10);
    if (isNaN(timeout)) timeout = DEFAULTS.TIMEOUT_SECONDS;
    timeout = Math.max(LIMITS.MIN_TIMEOUT, Math.min(LIMITS.MAX_TIMEOUT, timeout));

    return {
      mode,
      concurrencyLimit: concurrency,
      intervalSeconds: interval,
      timeoutSeconds: timeout,
      openInBackground: prefs.openInBackground !== false,
      deferUntilSelected: Boolean(prefs.deferUntilSelected)
    };
  }

  /**
   * Starts a new queue session with the given rows and preferences
   * @param {Array<object>} rows 
   * @param {object} preferences 
   * @returns {{ success: boolean, error?: string }}
   */
  start(rows, preferences = {}) {
    this.preferences = QueueController.sanitizePreferences(preferences);

    const eligible = rows.filter(r => r.selected && r.valid);
    if (!eligible.length) {
      return { success: false, error: 'No selected valid URLs to open' };
    }

    // Clean up any lingering timers
    this._clearIntervalTimer();
    this.activeNavigations.clear();

    // Map rows for rapid lookup
    this.rowsMap.clear();
    for (const r of rows) {
      this.rowsMap.set(r.id, r);
    }

    // Initialize session state
    const now = Date.now();
    this.session = {
      id: `session_${now}`,
      status: SESSION_STATUS.RUNNING,
      selectedRowIds: eligible.map(r => r.id),
      queueRowIds: eligible.map(r => r.id),
      startedRowIds: [],
      processedRowIds: [],
      successRowIds: [],
      failedRowIds: [],
      createdTabIds: [],
      openedCount: 0,
      successCount: 0,
      failedCount: 0,
      totalCount: eligible.length,
      startedAt: now,
      updatedAt: now,
      interrupted: false
    };

    // Mark eligible rows as queued
    this.queue = eligible.map(r => r.id);
    for (const id of this.queue) {
      this._updateRowStatus(id, ROW_STATUS.QUEUED);
    }

    this._notifySessionChange();
    this._processQueue();

    return { success: true, session: this.session };
  }

  /**
   * Main scheduler loop
   * @private
   */
  async _processQueue() {
    if (this.session.status !== SESSION_STATUS.RUNNING) {
      return;
    }

    if (this.isProcessing) {
      return;
    }
    this.isProcessing = true;

    try {
      // Check if session reached completion
      if (this.queue.length === 0 && this.activeNavigations.size === 0) {
        this._finishSession();
        return;
      }

      const limit = this.preferences.concurrencyLimit;
      const active = this.activeNavigations.size;
      let availableSlots = Math.max(0, limit - active);

      if (availableSlots <= 0 || this.queue.length === 0) {
        return;
      }

      switch (this.preferences.mode) {
        case OPEN_MODE.OPEN_ALL: {
          // Open as many as concurrency slots allow
          while (availableSlots > 0 && this.queue.length > 0) {
            const nextRowId = this.queue.shift();
            availableSlots--;
            this._startRowNavigation(nextRowId);
          }
          break;
        }

        case OPEN_MODE.AFTER_LOAD: {
          // Launch URLs to fill up to concurrency slots
          // Next ones will launch strictly when an active slot completes
          while (availableSlots > 0 && this.queue.length > 0) {
            const nextRowId = this.queue.shift();
            availableSlots--;
            this._startRowNavigation(nextRowId);
          }
          break;
        }

        case OPEN_MODE.AT_INTERVAL: {
          // Start next URL if not waiting on interval timer
          if (!this.intervalTimer && this.queue.length > 0) {
            const nextRowId = this.queue.shift();
            this._startRowNavigation(nextRowId);

            // Schedule the next interval tick if there are remaining items in queue
            if (this.queue.length > 0) {
              this.intervalTimer = setTimeout(() => {
                this.intervalTimer = null;
                this._processQueue();
              }, this.preferences.intervalSeconds * 1000);
            }
          }
          break;
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Starts navigation for a single row ID
   * @private
   * @param {string} rowId 
   */
  async _startRowNavigation(rowId) {
    const row = this.rowsMap.get(rowId);
    if (!row) return;

    this.activeNavigations.add(rowId);
    if (!this.session.startedRowIds.includes(rowId)) {
      this.session.startedRowIds.push(rowId);
    }

    this._updateRowStatus(rowId, ROW_STATUS.CREATING_TAB);

    const openInBackground = this.preferences.openInBackground;
    const timeoutSeconds = this.preferences.timeoutSeconds;
    const deferUntilSelected = this.preferences.deferUntilSelected;

    try {
      const res = await this.tabManager.openTab(rowId, row.url, {
        openInBackground,
        timeoutSeconds,
        deferUntilSelected
      });

      if (res.success && res.tabId != null) {
        if (!this.session.createdTabIds.includes(res.tabId)) {
          this.session.createdTabIds.push(res.tabId);
          this.session.openedCount += 1;
        }
        row.tabId = res.tabId;
        if (res.deferred) {
          this.activeNavigations.delete(rowId);
          this._updateRowStatus(rowId, ROW_STATUS.WAITING_FOR_SELECTION, { tabId: res.tabId });
          this._onSlotFreed();
        } else {
          this._updateRowStatus(rowId, ROW_STATUS.LOADING, { tabId: res.tabId });
        }
      }
    } catch (err) {
      console.warn(`[QueueController] Error opening row ${rowId}:`, err);
    }
  }

  /**
   * Called when TabManager reports a tab lifecycle change
   * @param {{ type: string, rowId: string, tabId: number | null, status: string, error?: string }} event 
   */
  handleTabLifecycleEvent(event) {
    const { type, rowId, tabId, status, error } = event;
    const row = this.rowsMap.get(rowId);

    if (row) {
      if (tabId != null) row.tabId = tabId;
      if (error) row.error = error;
    }

    if (type === 'tab_waiting') {
      if (tabId != null && !this.session.createdTabIds.includes(tabId)) {
        this.session.createdTabIds.push(tabId);
        this.session.openedCount += 1;
      }
      this.activeNavigations.delete(rowId);
      this._updateRowStatus(rowId, ROW_STATUS.WAITING_FOR_SELECTION, { tabId });
      this._onSlotFreed();
    } else if (type === 'tab_activated_loading') {
      this.activeNavigations.add(rowId);
      this._updateRowStatus(rowId, ROW_STATUS.LOADING, { tabId });
    } else if (type === 'tab_created') {
      if (tabId != null && !this.session.createdTabIds.includes(tabId)) {
        this.session.createdTabIds.push(tabId);
        this.session.openedCount += 1;
      }
      this._updateRowStatus(rowId, ROW_STATUS.LOADING, { tabId });
    } else if (type === 'tab_loaded') {
      this.activeNavigations.delete(rowId);
      if (!this.session.successRowIds.includes(rowId)) {
        this.session.successRowIds.push(rowId);
        this.session.successCount += 1;
      }
      if (!this.session.processedRowIds.includes(rowId)) {
        this.session.processedRowIds.push(rowId);
      }
      this._updateRowStatus(rowId, ROW_STATUS.SUCCESS, { tabId });
      this._onSlotFreed();
    } else if (type === 'tab_closed_early' || type === 'tab_timeout' || type === 'tab_create_failed') {
      this.activeNavigations.delete(rowId);
      if (!this.session.failedRowIds.includes(rowId)) {
        this.session.failedRowIds.push(rowId);
        this.session.failedCount += 1;
      }
      if (!this.session.processedRowIds.includes(rowId)) {
        this.session.processedRowIds.push(rowId);
      }
      this._updateRowStatus(rowId, status, { error });
      this._onSlotFreed();
    }

    this._notifySessionChange();
  }

  /**
   * Internal trigger when a concurrency slot is freed by completion, failure, or timeout
   * @private
   */
  _onSlotFreed() {
    if (this.session.status === SESSION_STATUS.RUNNING) {
      this._processQueue();
    }
  }

  /**
   * Mark session as complete
   * @private
   */
  _finishSession() {
    this._clearIntervalTimer();
    this.session.status = this.session.failedCount > 0 
      ? SESSION_STATUS.COMPLETED_WITH_ERRORS 
      : SESSION_STATUS.COMPLETED;
    this.session.updatedAt = Date.now();
    this._notifySessionChange();
  }

  /**
   * Pauses the queue
   */
  pause() {
    if (this.session.status !== SESSION_STATUS.RUNNING) return;

    this.session.status = SESSION_STATUS.PAUSED;
    this._clearIntervalTimer();
    this.session.updatedAt = Date.now();
    this._notifySessionChange();
  }

  /**
   * Resumes a paused queue
   */
  resume() {
    if (this.session.status !== SESSION_STATUS.PAUSED) return;

    this.session.status = SESSION_STATUS.RUNNING;
    this.session.updatedAt = Date.now();
    this._notifySessionChange();
    this._processQueue();
  }

  /**
   * Stops the queue permanently
   */
  stop() {
    this.session.status = SESSION_STATUS.STOPPED;
    this._clearIntervalTimer();

    // Mark remaining items in queue as stopped
    for (const id of this.queue) {
      this._updateRowStatus(id, ROW_STATUS.STOPPED);
    }
    this.queue = [];

    this.session.updatedAt = Date.now();
    this._notifySessionChange();
  }

  /**
   * Update row status in map and notify callback
   * @private
   */
  _updateRowStatus(rowId, status, extra = {}) {
    const row = this.rowsMap.get(rowId);
    if (row) {
      row.status = status;
      if (extra.tabId != null) row.tabId = extra.tabId;
      if (extra.error) row.error = extra.error;
    }
    this.onRowChange({ rowId, status, ...extra });
  }

  /**
   * Notify listener of session change
   * @private
   */
  _notifySessionChange() {
    this.session.updatedAt = Date.now();
    this.onSessionChange({ ...this.session });
  }

  /**
   * Clear active interval timer
   * @private
   */
  _clearIntervalTimer() {
    if (this.intervalTimer) {
      clearTimeout(this.intervalTimer);
      this.intervalTimer = null;
    }
  }

  /**
   * Number of currently active navigations in progress
   */
  get activeCount() {
    return this.activeNavigations.size;
  }
}
