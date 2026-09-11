// ─── Storage Service ──────────────────────────────────────────────────────────
//
// Centralised wrappers around chrome.storage.session and chrome.storage.local.
// Replaces duplicated Promise-wrapper patterns in background.js,
// notification-manager.js, and snooze-service.js.
//
// Getter functions (getSession, getLocal):
//   - Accept the same parameter types as the underlying chrome API (string,
//     array of strings, or object literal).
//   - Never reject. On error they log via Logger and return {}.
//
// Setter functions (setSession, setLocal):
//   - Accept a plain object.
//   - Log via Logger and reject on error.
// ───────────────────────────────────────────────────────────────────────────────

import Logger from './logger.js';

const VALID_PROVIDERS = ['zendesk', 'jira'];

// ─── Monitors (multi-provider) ───────────────────────────────────────────────

/**
 * Coerce a raw stored monitor into the canonical shape. `provider` defaults
 * to 'zendesk' and is sanitised to a known provider id.
 * @param {object} raw
 * @returns {{id: *, name: string, url: string, enabled: boolean, provider: string}}
 */
export function sanitiseMonitor(raw) {
    if (!raw || typeof raw !== 'object') {
        return { id: undefined, name: '', url: '', enabled: true, provider: 'zendesk' };
    }
    return {
        id: raw.id,
        name: typeof raw.name === 'string' ? raw.name : '',
        url: typeof raw.url === 'string' ? raw.url : '',
        enabled: raw.enabled !== false,
        provider: VALID_PROVIDERS.includes(raw.provider) ? raw.provider : 'zendesk'
    };
}

/**
 * Read the monitors list. Migrates the legacy `endpoints` key on first read
 * (entries default to provider 'zendesk') and persists the migration.
 * @returns {Promise<Array>} — sanitised monitors
 */
export async function getMonitors() {
    const { endpoints, monitors } = await getLocal(['endpoints', 'monitors']);
    let list = Array.isArray(monitors) ? monitors : null;

    if (list === null && Array.isArray(endpoints)) {
        list = endpoints.map(endpoint => sanitiseMonitor({ ...endpoint, provider: 'zendesk' }));
        try {
            await setLocal({ monitors: list });
            await removeLocal(['endpoints']);
        } catch (error) {
            Logger.error('Failed to persist endpoints→monitors migration:', error);
        }
    }

    return (Array.isArray(list) ? list : []).map(sanitiseMonitor);
}

/**
 * Write the monitors list.
 * @param {Array} monitors
 * @returns {Promise<void>}
 */
export function saveMonitors(monitors) {
    return setLocal({ monitors });
}

/**
 * Remove keys from chrome.storage.local.
 * @param {string[]} keys
 * @returns {Promise<void>}
 */
export function removeLocal(keys) {
    return new Promise((resolve, reject) => {
        try {
            chrome.storage.local.remove(keys, () => {
                if (chrome.runtime.lastError) {
                    const err = new Error(chrome.runtime.lastError.message || 'Failed to remove local storage keys');
                    Logger.error(err.message);
                    reject(err);
                    return;
                }
                resolve();
            });
        } catch (error) {
            Logger.error('Error removing local storage keys:', error);
            reject(error);
        }
    });
}

// ─── chrome.storage.session ──────────────────────────────────────────────────

/**
 * Read keys from chrome.storage.session.
 * Never rejects — logs and returns {} on error.
 *
 * @param {string|string[]|object} keys
 * @returns {Promise<object>}
 */
export function getSession(keys) {
  return new Promise((resolve) => {
    try {
      chrome.storage.session.get(keys, (data) => {
        if (chrome.runtime.lastError) {
          Logger.error('Error reading session storage:', chrome.runtime.lastError.message);
          resolve({});
          return;
        }
        resolve(data || {});
      });
    } catch (error) {
      Logger.error('Error reading session storage:', error);
      resolve({});
    }
  });
}

/**
 * Write data to chrome.storage.session.
 * Rejects on error.
 *
 * @param {object} data
 * @returns {Promise<void>}
 */
export function setSession(data) {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.session.set(data, () => {
        if (chrome.runtime.lastError) {
          const err = new Error(chrome.runtime.lastError.message || 'Failed to write session storage');
          Logger.error(err.message);
          reject(err);
          return;
        }
        resolve();
      });
    } catch (error) {
      Logger.error('Error writing session storage:', error);
      reject(error);
    }
  });
}

// ─── chrome.storage.local ────────────────────────────────────────────────────

/**
 * Read keys from chrome.storage.local.
 * Never rejects — logs and returns {} on error.
 *
 * @param {string|string[]|object} keys
 * @returns {Promise<object>}
 */
export function getLocal(keys) {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(keys, (data) => {
        if (chrome.runtime.lastError) {
          Logger.error('Error reading local storage:', chrome.runtime.lastError.message);
          resolve({});
          return;
        }
        resolve(data || {});
      });
    } catch (error) {
      Logger.error('Error reading local storage:', error);
      resolve({});
    }
  });
}

/**
 * Write data to chrome.storage.local.
 * Rejects on error.
 *
 * @param {object} data
 * @returns {Promise<void>}
 */
export function setLocal(data) {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.set(data, () => {
        if (chrome.runtime.lastError) {
          const err = new Error(chrome.runtime.lastError.message || 'Failed to write local storage');
          Logger.error(err.message);
          reject(err);
          return;
        }
        resolve();
      });
    } catch (error) {
      Logger.error('Error writing local storage:', error);
      reject(error);
    }
  });
}
