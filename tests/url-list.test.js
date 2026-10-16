import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { UrlListManager } from '../src/url-list.js';

describe('UrlListManager: basic operations and stats', () => {
  it('initializes with empty rows and zero stats', () => {
    const manager = new UrlListManager();
    assert.strictEqual(manager.rows.length, 0);
    const stats = manager.getStats();
    assert.deepStrictEqual(stats, {
      total: 0,
      valid: 0,
      duplicate: 0,
      invalid: 0,
      selected: 0,
      selectedValid: 0
    });
  });

  it('adds newline-separated URLs with valid and invalid entries', () => {
    const manager = new UrlListManager();
    const input = `
      https://example.com/one
      not-a-url
      https://example.com/two
      ftp://unsupported.org
      https://example.com/one
    `;

    const added = manager.addFromText(input);
    assert.strictEqual(added, 5);

    const stats = manager.getStats();
    assert.strictEqual(stats.total, 5);
    assert.strictEqual(stats.valid, 3); // 2 valid unique + 1 valid duplicate
    assert.strictEqual(stats.duplicate, 1);
    assert.strictEqual(stats.invalid, 2); // 'not-a-url' and 'ftp://unsupported.org'
    assert.strictEqual(stats.selected, 3); // by default valid URLs are selected
    assert.strictEqual(stats.selectedValid, 3);
  });

  it('adds URLs using mixed-text extraction mode', () => {
    const manager = new UrlListManager();
    const prose = 'Visit https://site-a.com and also check out https://site-b.org/docs.';
    const added = manager.addFromText(prose, true);

    assert.strictEqual(added, 2);
    const rows = manager.getRows();
    assert.strictEqual(rows[0].url, 'https://site-a.com');
    assert.strictEqual(rows[1].url, 'https://site-b.org/docs');
    assert.strictEqual(manager.getStats().valid, 2);
  });

  it('handles row selection toggles, select all, and select none', () => {
    const manager = new UrlListManager();
    manager.addFromText('https://a.com\nhttps://b.com\ninvalid-url');

    // Deselect all
    manager.selectNone();
    assert.strictEqual(manager.getStats().selected, 0);

    // Select single row
    const firstId = manager.rows[0].id;
    manager.setRowSelection(firstId, true);
    assert.strictEqual(manager.rows[0].selected, true);
    assert.strictEqual(manager.getStats().selected, 1);

    // Select all
    manager.selectAll();
    assert.strictEqual(manager.getStats().selected, 3);

    // Select only valid
    manager.selectAll(true);
    assert.strictEqual(manager.getStats().selected, 2);
    assert.strictEqual(manager.getStats().selectedValid, 2);
  });

  it('deletes a single row and recalculates duplicates', () => {
    const manager = new UrlListManager();
    manager.addFromText('https://a.com\nhttps://a.com\nhttps://b.com');

    // Currently row 1 is duplicate of row 0
    assert.strictEqual(manager.rows[1].duplicateOf, manager.rows[0].id);

    // Delete first row
    const firstId = manager.rows[0].id;
    const deleted = manager.deleteRow(firstId);
    assert.strictEqual(deleted, true);
    assert.strictEqual(manager.rows.length, 2);

    // Former duplicate should now be the primary row (not duplicate)
    assert.strictEqual(manager.rows[0].duplicateOf, null);
    assert.strictEqual(manager.getStats().duplicate, 0);
  });

  it('deletes selected rows and preserves unselected ones', () => {
    const manager = new UrlListManager();
    manager.addFromText('https://keep.com\nhttps://delete1.com\nhttps://delete2.com');

    manager.setRowSelection(manager.rows[0].id, false); // unselect keep
    manager.setRowSelection(manager.rows[1].id, true);  // select delete1
    manager.setRowSelection(manager.rows[2].id, true);  // select delete2

    const count = manager.deleteSelected();
    assert.strictEqual(count, 2);
    assert.strictEqual(manager.rows.length, 1);
    assert.strictEqual(manager.rows[0].url, 'https://keep.com');
  });

  it('clears entire list', () => {
    const manager = new UrlListManager();
    manager.addFromText('https://a.com\nhttps://b.com');
    assert.strictEqual(manager.rows.length, 2);

    manager.clearList();
    assert.strictEqual(manager.rows.length, 0);
    assert.strictEqual(manager.getStats().total, 0);
  });
});
