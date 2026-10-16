import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StorageManager, getDefaultState, CURRENT_SCHEMA_VERSION } from '../src/storage.js';
import { STORAGE_KEYS, SESSION_STATUS } from '../src/constants.js';

function createMockStorageAdapter(initialData = {}) {
  const store = new Map(Object.entries(initialData));

  return {
    storage: {
      local: {
        get: async (key) => ({ [key]: store.get(key) }),
        set: async (obj) => {
          for (const [k, v] of Object.entries(obj)) {
            store.set(k, v);
          }
        },
        remove: async (key) => store.delete(key),
        clear: async () => store.clear()
      }
    }
  };
}

describe('StorageManager: persistence and schema validation', () => {
  it('loads default state when storage is empty', async () => {
    const mock = createMockStorageAdapter();
    const storage = new StorageManager(mock);

    const state = await storage.loadState();
    assert.strictEqual(state.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.deepStrictEqual(state.rows, []);
    assert.strictEqual(state.session.status, SESSION_STATUS.READY);
    assert.strictEqual(state.preferences.concurrencyLimit, 3);
  });

  it('saves and reloads state accurately', async () => {
    const mock = createMockStorageAdapter();
    const storage = new StorageManager(mock);

    const sample = {
      preferences: {
        mode: 'open_all',
        concurrencyLimit: 5
      },
      rows: [
        { id: 'row_1', url: 'https://example.com', valid: true, selected: true }
      ],
      session: {
        id: 'session_123',
        status: SESSION_STATUS.COMPLETED
      }
    };

    const saved = await storage.saveState(sample);
    assert.strictEqual(saved, true);

    const loaded = await storage.loadState();
    assert.strictEqual(loaded.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.strictEqual(loaded.preferences.mode, 'open_all');
    assert.strictEqual(loaded.preferences.concurrencyLimit, 5);
    assert.strictEqual(loaded.rows.length, 1);
    assert.strictEqual(loaded.rows[0].url, 'https://example.com');
    assert.strictEqual(loaded.session.id, 'session_123');
    assert.strictEqual(loaded.session.status, SESSION_STATUS.COMPLETED);
  });

  it('safely recovers and applies defaults when storage contains partial or corrupted data', async () => {
    const corruptedData = {
      [STORAGE_KEYS.STATE]: {
        schemaVersion: 1,
        // missing preferences, rows, session
      }
    };

    const mock = createMockStorageAdapter(corruptedData);
    const storage = new StorageManager(mock);

    const loaded = await storage.loadState();
    assert.ok(loaded.preferences);
    assert.strictEqual(loaded.preferences.concurrencyLimit, 3);
    assert.deepStrictEqual(loaded.rows, []);
    assert.strictEqual(loaded.session.status, SESSION_STATUS.READY);
  });

  it('clears persisted state from storage', async () => {
    const mock = createMockStorageAdapter({
      [STORAGE_KEYS.STATE]: { schemaVersion: 1 }
    });
    const storage = new StorageManager(mock);

    await storage.clearState();
    const loaded = await storage.loadState();
    assert.deepStrictEqual(loaded.rows, []);
  });
});
