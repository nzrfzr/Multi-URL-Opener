import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ROW_STATUS } from '../src/constants.js';
import { TabManager } from '../src/tab-manager.js';

describe('TabManager: tab creation and lifecycle', () => {
  it('opens a tab in background and separates tab creation from completion', async () => {
    const events = [];
    let updatedListener = null;

    const mockAdapter = {
      tabs: {
        create: async ({ url, active }) => {
          assert.strictEqual(active, false, 'Should create tab in background');
          return { id: 101, url, status: 'loading' };
        },
        onUpdated: {
          addListener: (fn) => { updatedListener = fn; },
          removeListener: () => {}
        },
        onRemoved: {
          addListener: () => {},
          removeListener: () => {}
        }
      }
    };

    const manager = new TabManager({
      adapter: mockAdapter,
      onTabStatusChange: (evt) => events.push(evt)
    });

    const res = await manager.openTab('row_1', 'https://example.com/one');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.tabId, 101);

    // Initial events: creating_tab, then tab_created with status LOADING
    assert.strictEqual(events[0].status, ROW_STATUS.CREATING_TAB);
    assert.strictEqual(events[1].status, ROW_STATUS.LOADING);
    assert.strictEqual(events[1].tabId, 101);
    assert.strictEqual(manager.activeCount, 1);

    // Simulate page load completion via onUpdated
    updatedListener(101, { status: 'complete' });

    assert.strictEqual(events[2].type, 'tab_loaded');
    assert.strictEqual(events[2].status, ROW_STATUS.SUCCESS);
    assert.strictEqual(manager.activeCount, 0);
  });

  it('handles early tab closure while still loading', async () => {
    const events = [];
    let removedListener = null;

    const mockAdapter = {
      tabs: {
        create: async () => ({ id: 202, status: 'loading' }),
        onUpdated: { addListener: () => {}, removeListener: () => {} },
        onRemoved: {
          addListener: (fn) => { removedListener = fn; },
          removeListener: () => {}
        }
      }
    };

    const manager = new TabManager({
      adapter: mockAdapter,
      onTabStatusChange: (evt) => events.push(evt)
    });

    await manager.openTab('row_2', 'https://example.com/two');
    assert.strictEqual(manager.activeCount, 1);

    // User closes the tab before it finishes loading
    removedListener(202);

    const closedEvent = events.find(e => e.type === 'tab_closed_early');
    assert.ok(closedEvent);
    assert.strictEqual(closedEvent.status, ROW_STATUS.FAILED);
    assert.strictEqual(manager.activeCount, 0);
  });

  it('handles navigation timeout', async () => {
    const events = [];
    const mockAdapter = {
      tabs: {
        create: async () => ({ id: 303, status: 'loading' }),
        onUpdated: { addListener: () => {}, removeListener: () => {} },
        onRemoved: { addListener: () => {}, removeListener: () => {} }
      }
    };

    const manager = new TabManager({
      adapter: mockAdapter,
      onTabStatusChange: (evt) => events.push(evt)
    });

    // Set timeout to 0.05 seconds for fast test
    await manager.openTab('row_3', 'https://example.com/slow', { timeoutSeconds: 0.05 });

    // Wait 70ms for timeout to trigger
    await new Promise(r => setTimeout(r, 70));

    const timeoutEvent = events.find(e => e.type === 'tab_timeout');
    assert.ok(timeoutEvent);
    assert.strictEqual(timeoutEvent.status, ROW_STATUS.TIMED_OUT);
    assert.strictEqual(manager.activeCount, 0);
  });
});
