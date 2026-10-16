import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { QueueController } from '../src/queue-controller.js';
import { OPEN_MODE, SESSION_STATUS, ROW_STATUS } from '../src/constants.js';

/**
 * Creates a controllable mock TabManager
 */
function createMockTabManager() {
  const listeners = [];
  const activeTabs = new Map();
  let nextTabId = 1000;

  return {
    openTab: async (rowId, url) => {
      const tabId = ++nextTabId;
      activeTabs.set(rowId, tabId);
      // Notify tab_created
      for (const fn of listeners) {
        fn({ type: 'tab_created', rowId, tabId, status: ROW_STATUS.LOADING });
      }
      return { success: true, tabId };
    },
    // Test helper to simulate page loaded
    simulateLoad: (rowId) => {
      const tabId = activeTabs.get(rowId);
      for (const fn of listeners) {
        fn({ type: 'tab_loaded', rowId, tabId, status: ROW_STATUS.SUCCESS });
      }
    },
    // Test helper to simulate failure/timeout
    simulateFail: (rowId, error = 'Error') => {
      const tabId = activeTabs.get(rowId);
      for (const fn of listeners) {
        fn({ type: 'tab_closed_early', rowId, tabId, status: ROW_STATUS.FAILED, error });
      }
    },
    addListener: (fn) => listeners.push(fn)
  };
}

describe('QueueController: preferences sanitization', () => {
  it('clamps concurrency, interval, and timeout to valid ranges', () => {
    const raw = {
      mode: 'invalid_mode',
      concurrencyLimit: 99,
      intervalSeconds: -5,
      timeoutSeconds: 1000
    };

    const sanitized = QueueController.sanitizePreferences(raw);
    assert.strictEqual(sanitized.mode, OPEN_MODE.AT_INTERVAL);
    assert.strictEqual(sanitized.concurrencyLimit, 10); // clamped to max 10
    assert.strictEqual(sanitized.intervalSeconds, 0.5); // clamped to min 0.5
    assert.strictEqual(sanitized.timeoutSeconds, 300);  // clamped to max 300
  });

  it('handles negative or NaN values safely', () => {
    const raw = {
      concurrencyLimit: -3,
      intervalSeconds: 'abc',
      timeoutSeconds: NaN
    };

    const sanitized = QueueController.sanitizePreferences(raw);
    assert.strictEqual(sanitized.concurrencyLimit, 1);
    assert.strictEqual(sanitized.intervalSeconds, 2);
    assert.strictEqual(sanitized.timeoutSeconds, 30);
  });
});

describe('QueueController: OPEN_ALL mode with concurrency limit', () => {
  it('strictly respects concurrency limit and launches next item when a slot frees', async () => {
    const mock = createMockTabManager();
    const controller = new QueueController({ tabManager: mock });
    mock.addListener((evt) => controller.handleTabLifecycleEvent(evt));

    const rows = [
      { id: 'r1', url: 'https://site1.com', selected: true, valid: true },
      { id: 'r2', url: 'https://site2.com', selected: true, valid: true },
      { id: 'r3', url: 'https://site3.com', selected: true, valid: true },
      { id: 'r4', url: 'https://site4.com', selected: true, valid: true }
    ];

    controller.start(rows, {
      mode: OPEN_MODE.OPEN_ALL,
      concurrencyLimit: 2
    });

    // Exactly 2 items should start initially
    assert.strictEqual(controller.activeCount, 2);
    assert.strictEqual(controller.session.startedRowIds.length, 2);
    assert.deepStrictEqual(controller.session.startedRowIds, ['r1', 'r2']);

    // Complete r1 -> frees 1 slot -> r3 should start
    mock.simulateLoad('r1');
    assert.strictEqual(controller.session.successCount, 1);
    assert.strictEqual(controller.session.startedRowIds.length, 3);
    assert.ok(controller.session.startedRowIds.includes('r3'));
    assert.strictEqual(controller.activeCount, 2);

    // Fail r2 -> frees 1 slot -> r4 should start
    mock.simulateFail('r2');
    assert.strictEqual(controller.session.failedCount, 1);
    assert.strictEqual(controller.session.startedRowIds.length, 4);
    assert.ok(controller.session.startedRowIds.includes('r4'));

    // Complete remaining
    mock.simulateLoad('r3');
    mock.simulateLoad('r4');

    assert.strictEqual(controller.activeCount, 0);
    assert.strictEqual(controller.session.status, SESSION_STATUS.COMPLETED_WITH_ERRORS);
  });
});

describe('QueueController: AFTER_LOAD mode', () => {
  it('executes sequentially when concurrency is 1', async () => {
    const mock = createMockTabManager();
    const controller = new QueueController({ tabManager: mock });
    mock.addListener((evt) => controller.handleTabLifecycleEvent(evt));

    const rows = [
      { id: 'r1', url: 'https://site1.com', selected: true, valid: true },
      { id: 'r2', url: 'https://site2.com', selected: true, valid: true }
    ];

    controller.start(rows, {
      mode: OPEN_MODE.AFTER_LOAD,
      concurrencyLimit: 1
    });

    // Only r1 started
    assert.strictEqual(controller.activeCount, 1);
    assert.deepStrictEqual(controller.session.startedRowIds, ['r1']);

    // r2 does not start yet
    assert.strictEqual(controller.session.startedRowIds.includes('r2'), false);

    // When r1 finishes, r2 starts
    mock.simulateLoad('r1');
    assert.strictEqual(controller.session.startedRowIds.includes('r2'), true);

    mock.simulateLoad('r2');
    assert.strictEqual(controller.session.status, SESSION_STATUS.COMPLETED);
  });
});

describe('QueueController: Pause, Resume, and Stop', () => {
  it('pauses new starts and resumes without duplicating', async () => {
    const mock = createMockTabManager();
    const controller = new QueueController({ tabManager: mock });
    mock.addListener((evt) => controller.handleTabLifecycleEvent(evt));

    const rows = [
      { id: 'r1', url: 'https://site1.com', selected: true, valid: true },
      { id: 'r2', url: 'https://site2.com', selected: true, valid: true },
      { id: 'r3', url: 'https://site3.com', selected: true, valid: true }
    ];

    controller.start(rows, {
      mode: OPEN_MODE.OPEN_ALL,
      concurrencyLimit: 1
    });

    assert.strictEqual(controller.session.startedRowIds.length, 1);

    // Pause while r1 is running
    controller.pause();
    assert.strictEqual(controller.session.status, SESSION_STATUS.PAUSED);

    // When r1 finishes while paused, r2 should NOT start
    mock.simulateLoad('r1');
    assert.strictEqual(controller.activeCount, 0);
    assert.strictEqual(controller.session.startedRowIds.length, 1);

    // Resume queue
    controller.resume();
    assert.strictEqual(controller.session.status, SESSION_STATUS.RUNNING);
    assert.strictEqual(controller.session.startedRowIds.length, 2);
    assert.strictEqual(controller.session.startedRowIds[1], 'r2');

    // Stop queue
    controller.stop();
    assert.strictEqual(controller.session.status, SESSION_STATUS.STOPPED);
    assert.strictEqual(rows.find(r => r.id === 'r3').status, ROW_STATUS.STOPPED);
  });
});
