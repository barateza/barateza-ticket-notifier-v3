// ─── SnoozeService ─────────────────────────────────────────────────────────────
//
// Encapsulates snooze state: in-memory cache, local storage persistence,
// alarm management, and cross-context storage sync.
//
// Interface (4 methods):
//   setSnooze(minutes)  → {success, endTime}
//   clearSnooze()        → {success}
//   isSnoozed()          → boolean
//   getRemainingTime()   → number (minutes, 0 if not snoozed or indefinite)
//
// Internal:
//   rehydrateSnoozeEndTime() — reads storage, warms cache
//   storage.onChanged          — keeps cache in sync across contexts

import Logger from './logger.js';
import { getLocal, setLocal } from './storage-service.js';

const SNOOZE_INDEFINITE = -1;
const NO_SNOOZE = 0;

let cachedSnoozeEndTime = null; // null = not hydrated yet

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Re-hydrate snoozeEndTime from chrome.storage.local.
 * Returns the snoozeEndTime (ms) or null if not snoozed / expired.
 */
async function rehydrateSnoozeEndTime() {
  const { snoozeState } = await getLocal(['snoozeState']);
  if (snoozeState?.endTime === SNOOZE_INDEFINITE) {
    cachedSnoozeEndTime = SNOOZE_INDEFINITE;
    return cachedSnoozeEndTime;
  }
  if (snoozeState && snoozeState.endTime && snoozeState.endTime > Date.now()) {
    cachedSnoozeEndTime = snoozeState.endTime;
    return snoozeState.endTime;
  }
  // Expired — clean up
  if (snoozeState) {
    await chrome.storage.local.remove('snoozeState');
  }
  cachedSnoozeEndTime = NO_SNOOZE;
  return cachedSnoozeEndTime;
}

// ─── Exported API ──────────────────────────────────────────────────────────────

/**
 * Called once on background startup to restore snooze state
 * and re-create the snoozeEnd alarm if a finite snooze was active.
 */
export async function restoreSnooze() {
  if (cachedSnoozeEndTime !== null) return; // already hydrated
  await rehydrateSnoozeEndTime();
  if (cachedSnoozeEndTime > NO_SNOOZE && cachedSnoozeEndTime !== SNOOZE_INDEFINITE) {
    const delayMs = cachedSnoozeEndTime - Date.now();
    if (delayMs > 0) {
      chrome.alarms.create('snoozeEnd', { delayInMinutes: delayMs / 60000 });
      Logger.info('Restored snooze state from storage, ending at:', new Date(cachedSnoozeEndTime));
    }
  }
}

/**
 * Snooze notifications for a specific duration.
 * @param {number} durationMinutes — 0 means indefinite.
 * @returns {{ success: boolean, endTime: number }}
 */
export async function setSnooze(durationMinutes) {
  const now = Date.now();
  let snoozeEndTime;

  if (durationMinutes === 0) {
    snoozeEndTime = SNOOZE_INDEFINITE;
  } else {
    snoozeEndTime = now + (1000 * 60 * durationMinutes);
  }

  cachedSnoozeEndTime = snoozeEndTime;

  await setLocal({
    snoozeState: { endTime: snoozeEndTime, duration: durationMinutes }
  });

  if (durationMinutes > 0) {
    chrome.alarms.create('snoozeEnd', { delayInMinutes: durationMinutes });
  }

  Logger.info(`Notifications snoozed ${durationMinutes === 0 ? 'indefinitely' : `for ${durationMinutes} minutes`}`);
  return { success: true, endTime: snoozeEndTime };
}

/**
 * Clear snooze state.
 * @returns {{ success: boolean }}
 */
export async function clearSnooze() {
  await chrome.storage.local.remove('snoozeState');
  await chrome.alarms.clear('snoozeEnd');
  cachedSnoozeEndTime = NO_SNOOZE;
  Logger.info('Notifications no longer snoozed');
  return { success: true };
}

/**
 * Check if notifications are currently snoozed.
 * NOTE: This is intentionally async to support re-hydration after SW restarts.
 * @returns {boolean}
 */
export async function isSnoozed() {
  if (cachedSnoozeEndTime === null) {
    await rehydrateSnoozeEndTime();
  }
  if (cachedSnoozeEndTime === SNOOZE_INDEFINITE) {
    return true;
  }
  return Boolean(cachedSnoozeEndTime > NO_SNOOZE && cachedSnoozeEndTime > Date.now());
}

/**
 * Get remaining snooze time in minutes.
 * Returns 0 when not snoozed or when snooze is indefinite.
 * @returns {number}
 */
export async function getRemainingTime() {
  if (cachedSnoozeEndTime === null) {
    await rehydrateSnoozeEndTime();
  }
  const endTime = cachedSnoozeEndTime;
  if (!endTime || endTime === NO_SNOOZE) return 0;
  if (endTime === SNOOZE_INDEFINITE) return 0;
  return Math.ceil((endTime - Date.now()) / 60000);
}

/**
 * Handle storage changes to keep the in-memory cache in sync
 * when the popup modifies snoozeState directly.
 */
export function handleStorageChange(changes, area) {
  if (area === 'local' && changes.snoozeState) {
    const next = changes.snoozeState.newValue;
    if (next?.endTime === SNOOZE_INDEFINITE) {
      cachedSnoozeEndTime = SNOOZE_INDEFINITE;
    } else if (next?.endTime && next.endTime > Date.now()) {
      cachedSnoozeEndTime = next.endTime;
    } else {
      cachedSnoozeEndTime = NO_SNOOZE;
    }
  }
}
