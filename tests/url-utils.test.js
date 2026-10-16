import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateUrl,
  normalizeUrl,
  stripTrailingPunctuation,
  extractUrlsFromText,
  parseLinesToUrls,
  markDuplicateRows
} from '../src/url-utils.js';

describe('url-utils: validateUrl', () => {
  it('accepts valid https URL', () => {
    const res = validateUrl('https://example.com/path?foo=bar#section');
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.protocol, 'https:');
    assert.strictEqual(res.hostname, 'example.com');
    assert.strictEqual(res.normalizedUrl, 'https://example.com/path?foo=bar#section');
    assert.strictEqual(res.error, null);
  });

  it('accepts valid http URL', () => {
    const res = validateUrl('http://example.org:8080/test');
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.protocol, 'http:');
    assert.strictEqual(res.hostname, 'example.org');
    assert.strictEqual(res.normalizedUrl, 'http://example.org:8080/test');
  });

  it('trims leading and trailing whitespace', () => {
    const res = validateUrl('   https://github.com/nzrfzr   \n');
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.originalUrl, 'https://github.com/nzrfzr');
    assert.strictEqual(res.normalizedUrl, 'https://github.com/nzrfzr');
  });

  it('rejects empty or whitespace-only inputs', () => {
    assert.strictEqual(validateUrl('').valid, false);
    assert.strictEqual(validateUrl('   ').valid, false);
    assert.strictEqual(validateUrl(null).valid, false);
  });

  it('rejects unsupported schemes (file:, javascript:, data:, ftp:, custom:)', () => {
    const unsupported = [
      'javascript:alert(1)',
      'data:text/html,<h1>Hi</h1>',
      'file:///C:/Users/test.txt',
      'ftp://ftp.example.com/file.zip',
      'custom-scheme://test'
    ];

    for (const url of unsupported) {
      const res = validateUrl(url);
      assert.strictEqual(res.valid, false, `Should reject ${url}`);
      assert.match(res.error, /Unsupported scheme/);
    }
  });

  it('rejects malformed syntax or missing hostname', () => {
    const malformed = [
      'https://',
      'http://:80',
      'just a plain word',
      'https:///',
      'http://?query',
      'http://   /test'
    ];

    for (const url of malformed) {
      const res = validateUrl(url);
      assert.strictEqual(res.valid, false, `Should reject ${url}`);
    }
  });
});

describe('url-utils: normalizeUrl', () => {
  it('lowercases hostname and scheme', () => {
    const norm = normalizeUrl('HTTPS://EXAMPLE.COM/Page');
    assert.strictEqual(norm, 'https://example.com/Page');
  });

  it('removes default ports (:80 for http, :443 for https)', () => {
    assert.strictEqual(normalizeUrl('http://example.com:80/'), 'http://example.com/');
    assert.strictEqual(normalizeUrl('https://example.com:443/test'), 'https://example.com/test');
    // Non-default port should be preserved
    assert.strictEqual(normalizeUrl('https://example.com:8443/'), 'https://example.com:8443/');
  });

  it('adds root trailing slash when path is omitted by parser', () => {
    assert.strictEqual(normalizeUrl('https://example.com'), 'https://example.com/');
  });

  it('preserves query parameters and fragment by default', () => {
    const norm = normalizeUrl('https://example.com/test?q=hello&page=2#heading');
    assert.strictEqual(norm, 'https://example.com/test?q=hello&page=2#heading');
  });

  it('can strip fragment if explicitly requested in options', () => {
    const norm = normalizeUrl('https://example.com/test#heading', { stripFragment: true });
    assert.strictEqual(norm, 'https://example.com/test');
  });
});

describe('url-utils: stripTrailingPunctuation', () => {
  it('strips common sentence punctuation attached at the end', () => {
    assert.strictEqual(stripTrailingPunctuation('https://example.com.'), 'https://example.com');
    assert.strictEqual(stripTrailingPunctuation('https://example.com,'), 'https://example.com');
    assert.strictEqual(stripTrailingPunctuation('https://example.com!'), 'https://example.com');
    assert.strictEqual(stripTrailingPunctuation('https://example.com?'), 'https://example.com');
    assert.strictEqual(stripTrailingPunctuation('https://example.com;'), 'https://example.com');
    assert.strictEqual(stripTrailingPunctuation('https://example.com...'), 'https://example.com');
  });

  it('preserves balanced parentheses in URLs (e.g. Wikipedia links)', () => {
    assert.strictEqual(
      stripTrailingPunctuation('https://en.wikipedia.org/wiki/Apple_(disambiguation)'),
      'https://en.wikipedia.org/wiki/Apple_(disambiguation)'
    );
  });

  it('strips unbalanced trailing parenthesis from surrounding prose', () => {
    // When text is "(see https://example.com/page)"
    assert.strictEqual(
      stripTrailingPunctuation('https://example.com/page)'),
      'https://example.com/page'
    );
    assert.strictEqual(
      stripTrailingPunctuation('https://example.com/page].'),
      'https://example.com/page'
    );
  });
});

describe('url-utils: extractUrlsFromText', () => {
  it('extracts multiple URLs embedded in prose while preserving order', () => {
    const prose = `
      Check out my GitHub at https://github.com/nzrfzr, and read documentation
      on https://developer.mozilla.org/en-US/docs/Web/API. Also look at
      (https://news.ycombinator.com/)!
    `;

    const extracted = extractUrlsFromText(prose);
    assert.deepStrictEqual(extracted, [
      'https://github.com/nzrfzr',
      'https://developer.mozilla.org/en-US/docs/Web/API',
      'https://news.ycombinator.com/'
    ]);
  });

  it('returns empty array when no HTTP/HTTPS links exist', () => {
    assert.deepStrictEqual(extractUrlsFromText('Hello world, no links here.'), []);
    assert.deepStrictEqual(extractUrlsFromText('example.com without scheme'), []);
    assert.deepStrictEqual(extractUrlsFromText(''), []);
  });
});

describe('url-utils: parseLinesToUrls', () => {
  it('parses newline-separated list, trims lines, and filters empty lines', () => {
    const multiline = `
      https://site1.com
      
      http://site2.org/page   
      https://site3.net
    `;
    const lines = parseLinesToUrls(multiline);
    assert.deepStrictEqual(lines, [
      'https://site1.com',
      'http://site2.org/page',
      'https://site3.net'
    ]);
  });
});

describe('url-utils: markDuplicateRows', () => {
  it('marks duplicate valid URLs while leaving them visible and selectable', () => {
    const rows = [
      { id: '1', valid: true, normalizedUrl: 'https://example.com/' },
      { id: '2', valid: true, normalizedUrl: 'https://other.com/' },
      { id: '3', valid: true, normalizedUrl: 'https://example.com/' }, // duplicate of 1
      { id: '4', valid: false, normalizedUrl: null },
      { id: '5', valid: false, normalizedUrl: null }
    ];

    const result = markDuplicateRows(rows);
    assert.strictEqual(result[0].duplicateOf, null);
    assert.strictEqual(result[1].duplicateOf, null);
    assert.strictEqual(result[2].duplicateOf, '1'); // identified as duplicate of row 1
    assert.strictEqual(result[3].duplicateOf, null); // invalid rows not marked duplicate
    assert.strictEqual(result[4].duplicateOf, null);
  });
});
