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
