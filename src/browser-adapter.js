/**
 * Multi URL Opener - Browser API Adapter
 * Normalizes differences between Firefox (browser.*) and Chrome (chrome.*)
 * by nzrfzr
 */

const rawApi = typeof globalThis.browser !== 'undefined'
  ? globalThis.browser
  : typeof globalThis.chrome !== 'undefined'
    ? globalThis.chrome
    : null;

if (!rawApi) {
  console.warn('[MultiURLOpener] No WebExtensions API found in global scope.');
}

/**
 * Helper to wrap callback-based or promise-based extension APIs
 */
function promisify(target, fnName, ...args) {
  if (!target || typeof target[fnName] !== 'function') {
    return Promise.reject(new Error(`API method ${fnName} is not available.`));
  }
  
  try {
    const result = target[fnName](...args);
    // If the method returns a native Promise (e.g., Firefox browser.* or modern Chrome)
    if (result && typeof result.then === 'function') {
      return result;
    }
  } catch (err) {
    return Promise.reject(err);
  }

  // Fallback for callback-style chrome.* APIs
  return new Promise((resolve, reject) => {
    try {
      target[fnName](...args, (res) => {
        const lastErr = rawApi?.runtime?.lastError;
        if (lastErr) {
          reject(new Error(lastErr.message || String(lastErr)));
        } else {
          resolve(res);
        }
      });
    } catch (e) {
      reject(e);
    }
  });
}

export const browserAdapter = {
  get isAvailable() {
    return rawApi !== null;
  },

  get isFirefox() {
    return typeof globalThis.browser !== 'undefined' && typeof globalThis.browser.runtime?.getBrowserInfo === 'function';
  },

  runtime: {
    sendMessage(message) {
      return promisify(rawApi?.runtime, 'sendMessage', message);
    },
    onMessage: {
      addListener(listener) {
        rawApi?.runtime?.onMessage?.addListener(listener);
      },
      removeListener(listener) {
        rawApi?.runtime?.onMessage?.removeListener(listener);
      }
    },
    getURL(path) {
      return rawApi?.runtime?.getURL(path) || path;
    }
  },

  storage: {
    local: {
      get(keys) {
        return promisify(rawApi?.storage?.local, 'get', keys);
      },
      set(items) {
        return promisify(rawApi?.storage?.local, 'set', items);
      },
      remove(keys) {
        return promisify(rawApi?.storage?.local, 'remove', keys);
      },
      clear() {
        return promisify(rawApi?.storage?.local, 'clear');
      }
    }
  },

  tabs: {
    create(createProperties) {
      return promisify(rawApi?.tabs, 'create', createProperties);
    },
    update(tabId, updateProperties) {
      return promisify(rawApi?.tabs, 'update', tabId, updateProperties);
    },
    get(tabId) {
      return promisify(rawApi?.tabs, 'get', tabId);
    },
    remove(tabIds) {
      return promisify(rawApi?.tabs, 'remove', tabIds);
    },
    query(queryInfo) {
      return promisify(rawApi?.tabs, 'query', queryInfo);
    },
    onUpdated: {
      addListener(listener) {
        rawApi?.tabs?.onUpdated?.addListener(listener);
      },
      removeListener(listener) {
        rawApi?.tabs?.onUpdated?.removeListener(listener);
      }
    },
    onRemoved: {
      addListener(listener) {
        rawApi?.tabs?.onRemoved?.addListener(listener);
      },
      removeListener(listener) {
        rawApi?.tabs?.onRemoved?.removeListener(listener);
      }
    },
    onActivated: {
      addListener(listener) {
        rawApi?.tabs?.onActivated?.addListener(listener);
      },
      removeListener(listener) {
        rawApi?.tabs?.onActivated?.removeListener(listener);
      }
    }
  }
};

export default browserAdapter;
