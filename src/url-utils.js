/**
 * Multi URL Opener - URL Utilities
 * Pure functions for parsing, validating, extracting, and normalizing URLs.
 * by nzrfzr
 */

const TRAILING_PUNCTUATION_REGEX = /[)\]}.,;!?]+$/;
const URL_EXTRACTION_REGEX = /https?:\/\/[^\s<>"'{}|\\^`[\]]+/gi;

/**
 * Validates a URL string for HTTP/HTTPS protocol and valid hostname.
 * @param {string} rawString 
 * @returns {{ valid: boolean, originalUrl: string, normalizedUrl: string | null, error: string | null, protocol?: string, hostname?: string }}
 */
export function validateUrl(rawString) {
  if (typeof rawString !== 'string') {
    return {
      valid: false,
      originalUrl: String(rawString ?? ''),
      normalizedUrl: null,
      error: 'Input is not a string'
    };
  }

  const trimmed = rawString.trim();
  if (!trimmed) {
    return {
      valid: false,
      originalUrl: trimmed,
      normalizedUrl: null,
      error: 'URL cannot be empty'
    };
  }

  try {
    const parsed = new URL(trimmed);

    // Require HTTP or HTTPS only
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        valid: false,
        originalUrl: trimmed,
        normalizedUrl: null,
        error: `Unsupported scheme "${parsed.protocol}". Only http: and https: are allowed.`
      };
    }

    // Require a non-empty hostname
    if (!parsed.hostname || parsed.hostname.trim() === '') {
      return {
        valid: false,
        originalUrl: trimmed,
        normalizedUrl: null,
        error: 'URL is missing a valid hostname.'
      };
    }

    return {
      valid: true,
      originalUrl: trimmed,
      normalizedUrl: parsed.href,
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      error: null
    };
  } catch (err) {
    return {
      valid: false,
      originalUrl: trimmed,
      normalizedUrl: null,
      error: 'Malformed URL syntax'
    };
  }
}

/**
 * Normalizes a URL using the standard WHATWG URL parser.
 * Preserves query and fragment, lowercases scheme/host, removes default ports.
 * @param {string} rawString 
 * @param {{ stripFragment?: boolean }} [options]
 * @returns {string | null}
 */
export function normalizeUrl(rawString, options = {}) {
  const result = validateUrl(rawString);
  if (!result.valid) {
    return null;
  }

  try {
    const parsed = new URL(result.normalizedUrl);
    if (options.stripFragment) {
      parsed.hash = '';
    }
    return parsed.href;
  } catch {
    return result.normalizedUrl;
  }
}

/**
 * Strips common trailing punctuation from a URL match,
 * accounting for balanced closing parentheses.
 * @param {string} urlStr 
 * @returns {string}
 */
export function stripTrailingPunctuation(urlStr) {
  let cleaned = urlStr;

  while (TRAILING_PUNCTUATION_REGEX.test(cleaned)) {
    // If it ends with ')', check if the URL contains an opening '(' that isn't matched
    if (cleaned.endsWith(')')) {
      const openCount = (cleaned.match(/\(/g) || []).length;
      const closeCount = (cleaned.match(/\)/g) || []).length;
      if (closeCount <= openCount) {
        // Balanced parenthesis (like in Wikipedia URLs: .../Wiki_(disambiguation)), keep it
        break;
      }
    }

    // If it ends with ']', check for matched '['
    if (cleaned.endsWith(']')) {
      const openCount = (cleaned.match(/\[/g) || []).length;
      const closeCount = (cleaned.match(/\]/g) || []).length;
      if (closeCount <= openCount) {
        break;
      }
    }

    // Strip the last punctuation character
    cleaned = cleaned.slice(0, -1);
  }

  return cleaned;
}

/**
 * Extracts HTTP and HTTPS URLs from mixed text in original order.
 * @param {string} text 
 * @returns {string[]} Array of extracted URL strings
 */
export function extractUrlsFromText(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return [];
  }

  const matches = text.match(URL_EXTRACTION_REGEX);
  if (!matches) {
    return [];
  }

  const results = [];
  for (const rawMatch of matches) {
    const cleaned = stripTrailingPunctuation(rawMatch);
    if (cleaned) {
      const validation = validateUrl(cleaned);
      if (validation.valid) {
        results.push(cleaned);
      }
    }
  }

  return results;
}

/**
 * Splits multiline input into individual trimmed URL lines.
 * Filters out completely empty lines.
 * @param {string} text 
 * @returns {string[]}
 */
export function parseLinesToUrls(text) {
  if (typeof text !== 'string') {
    return [];
  }

  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0);
}

/**
 * Marks duplicate rows in an array of row objects.
 * Duplicates are determined by comparing normalizedUrl of valid entries.
 * Returns an array of updated row objects with `duplicateOf` set to the id of the earlier row.
 * @template T
 * @param {Array<T & { id: string, valid: boolean, normalizedUrl: string | null }>} rows 
 * @returns {Array<T & { duplicateOf: string | null }>}
 */
export function markDuplicateRows(rows) {
  const seenMap = new Map(); // normalizedUrl -> first row.id

  return rows.map(row => {
    if (!row.valid || !row.normalizedUrl) {
      return {
        ...row,
        duplicateOf: null
      };
    }

    if (seenMap.has(row.normalizedUrl)) {
      return {
        ...row,
        duplicateOf: seenMap.get(row.normalizedUrl)
      };
    }

    seenMap.set(row.normalizedUrl, row.id);
    return {
      ...row,
      duplicateOf: null
    };
  });
}
