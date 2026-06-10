// ─── RateLimitService ─────────────────────────────────────────────────────────
//
// Encapsulates Zendesk API rate-limit state: detection, backoff scheduling,
// and alarm management.
//
// Interface (3 methods):
//   isLimited()    → boolean
//   record(header) → void  (parse Retry-After, schedule resume)
//   clear()        → void  (reset state)
//
// Internal:
//   resumeAtMs        — timestamp when rate limit lifts
//   parseRetryAfter   — Retry-After header parser

import Logger from './logger.js';

const MIN_ALARM_DELAY_MINUTES = 1 / 60; // 1 second in minutes for one-shot resume alarms

let resumeAtMs = null;

/**
 * Internal: parse a Retry-After HTTP header value.
 * Accepts either a number of seconds or an HTTP-date.
 * @param {string|null|undefined} retryAfterHeader
 * @returns {number|null} — absolute timestamp (ms) or null if unparseable
 */
function parseRetryAfterMs(retryAfterHeader) {
  if (!retryAfterHeader) return null;
  const seconds = Number(retryAfterHeader);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Date.now() + (seconds * 1000);
  }
  const dateMs = Date.parse(retryAfterHeader);
  if (!Number.isNaN(dateMs)) {
    return dateMs;
  }
  return null;
}

// ─── Exported API ──────────────────────────────────────────────────────────────

/**
 * Check if the service is currently rate-limited.
 * @returns {boolean}
 */
export function isLimited() {
  return Boolean(resumeAtMs && Date.now() < resumeAtMs);
}

/**
 * Record a rate-limit response. Parses the Retry-After header, schedules
 * an alarm to resume, and logs the event.
 * @param {string} retryAfterHeader — value of the Retry-After response header
 */
export function record(retryAfterHeader) {
  const parsed = parseRetryAfterMs(retryAfterHeader);
  if (!parsed || parsed <= Date.now()) return;

  if (resumeAtMs && resumeAtMs >= parsed) return; // already waiting at least this long

  resumeAtMs = parsed;

  chrome.alarms.clear('ticketCheck');
  chrome.alarms.create('rateLimitResume', {
    delayInMinutes: Math.max(MIN_ALARM_DELAY_MINUTES, (resumeAtMs - Date.now()) / 60000)
  });
  Logger.info('Zendesk rate limit active, pausing monitoring until:', new Date(resumeAtMs));
}

/**
 * Clear the rate-limit state. Called when the rateLimitResume alarm fires.
 * Does NOT restart monitoring — the caller (background alarm handler) does that.
 */
export function clear() {
  resumeAtMs = null;
}

/**
 * If still rate-limited, recreate the rateLimitResume alarm.
 * Called from startMonitoring() when the SW re-initialises while rate-limited.
 */
export function rescheduleIfLimited() {
  if (!isLimited()) return;
  chrome.alarms.create('rateLimitResume', {
    delayInMinutes: Math.max(MIN_ALARM_DELAY_MINUTES, (resumeAtMs - Date.now()) / 60000)
  });
  Logger.info('Monitoring remains paused due to active Zendesk rate limiting');
}
