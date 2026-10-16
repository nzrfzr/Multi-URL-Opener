/**
 * Multi URL Opener - URL List Manager
 * Manages rows, selection state, unique stable IDs, and derived statistics.
 * by nzrfzr
 */

import { ROW_STATUS } from './constants.js';
import { validateUrl, extractUrlsFromText, parseLinesToUrls, markDuplicateRows } from './url-utils.js';

let idCounter = 0;

/**
 * Generates a stable unique ID for a URL row.
 * @returns {string}
 */
export function generateRowId() {
  idCounter += 1;
  const rand = Math.random().toString(36).substring(2, 9);
  return `row_${Date.now()}_${idCounter}_${rand}`;
}

export class UrlListManager {
  /**
   * @param {Array<object>} [initialRows=[]]
   */
  constructor(initialRows = []) {
    this.rows = Array.isArray(initialRows) ? markDuplicateRows(initialRows) : [];
  }

  /**
   * Adds URLs from raw multiline or mixed text.
   * @param {string} text 
   * @param {boolean} [isExtractMode=false] 
   * @returns {number} Number of rows added
   */
  addFromText(text, isExtractMode = false) {
    const rawList = isExtractMode 
      ? extractUrlsFromText(text) 
      : parseLinesToUrls(text);

    if (!rawList.length) {
      return 0;
    }

    const newRows = rawList.map(rawUrl => {
      const val = validateUrl(rawUrl);
      return {
        id: generateRowId(),
        url: val.originalUrl,
        normalizedUrl: val.normalizedUrl,
        valid: val.valid,
        error: val.error,
        duplicateOf: null,
        selected: val.valid, // default selected if valid
        status: ROW_STATUS.READY,
        tabId: null
      };
    });

    this.rows = markDuplicateRows([...this.rows, ...newRows]);
    return newRows.length;
  }

  /**
   * Set selection status of an individual row.
   * @param {string} id 
   * @param {boolean} selected 
   * @returns {boolean} Whether row was found and updated
   */
  setRowSelection(id, selected) {
    const row = this.rows.find(r => r.id === id);
    if (row) {
      row.selected = Boolean(selected);
      return true;
    }
    return false;
  }

  /**
   * Selects all rows (or optionally only valid rows).
   * @param {boolean} [onlyValid=false]
   */
  selectAll(onlyValid = false) {
    for (const row of this.rows) {
      row.selected = onlyValid ? row.valid : true;
    }
  }

  /**
   * Deselects all rows.
   */
  selectNone() {
    for (const row of this.rows) {
      row.selected = false;
    }
  }

  /**
   * Deletes a single row by ID and recomputes duplicate flags.
   * @param {string} id 
   * @returns {boolean} Whether row was found and removed
   */
  deleteRow(id) {
    const initialLen = this.rows.length;
    this.rows = markDuplicateRows(this.rows.filter(r => r.id !== id));
    return this.rows.length < initialLen;
  }

  /**
   * Deletes all currently selected rows.
   * @returns {number} Number of rows deleted
   */
  deleteSelected() {
    const initialLen = this.rows.length;
    this.rows = markDuplicateRows(this.rows.filter(r => !r.selected));
    return initialLen - this.rows.length;
  }

  /**
   * Clears the entire list of rows.
   */
  clearList() {
    this.rows = [];
  }

  /**
   * Returns current statistics for the list.
   * Counts are independent: valid count includes duplicates if syntactically valid.
   * @returns {{ total: number, valid: number, duplicate: number, invalid: number, selected: number, selectedValid: number }}
   */
  getStats() {
    let valid = 0;
    let duplicate = 0;
    let invalid = 0;
    let selected = 0;
    let selectedValid = 0;

    for (const row of this.rows) {
      if (row.valid) {
        valid += 1;
        if (row.selected) {
          selectedValid += 1;
        }
      } else {
        invalid += 1;
      }

      if (row.duplicateOf !== null) {
        duplicate += 1;
      }

      if (row.selected) {
        selected += 1;
      }
    }

    return {
      total: this.rows.length,
      valid,
      duplicate,
      invalid,
      selected,
      selectedValid
    };
  }

  /**
   * Returns a clone of current rows.
   * @returns {Array<object>}
   */
  getRows() {
    return [...this.rows];
  }
}
