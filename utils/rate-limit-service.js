// ─── RateLimitService ─────────────────────────────────────────────────────────
//
// Encapsulates provider API rate-limit state: detection, backoff scheduling,
// and alarm management. State is keyed per provider (and effectively per site
// host via the provider key scope) so a throttled Jira site pauses Jira
// polling only — Zendesk keeps running.
//
// Interface:
//   isLimited(provider?) → boolean (no arg: any provider)
//   record(provider, header) → void  (parse Retry-After, schedule resume)
//                              — legacy: record(header) == record('zendesk', header)
//   clear()        → void  (reset all provider state)
//   rescheduleIfLimited() → void  (recreate the resume alarm if any limited)
//
// Internal:
//   resumeAtByProvider — Map<provider, timestamp when its limit lifts>
//   parseRetryAfter    — Retry-After header parser

import Logger from './logger.js';

const MIN_ALARM_DELAY_MINUTES = 1 / 60; // 1 second in minutes for one-shot resume alarms

/** Map<providerId, number> — absolute resume timestamps per provider */
const resumeAtByProvider = new Map();

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
 * Check if a provider (or any provider) is currently rate-limited.
 * @param {string} [provider] — provider id; omit to check all providers
 * @returns {boolean}
 */
export function isLimited(provider) {
  if (provider) {
    const resumeAt = resumeAtByProvider.get(provider);
    return Boolean(resumeAt && Date.now() < resumeAt);
  }
  for (const resumeAt of resumeAtByProvider.values()) {
    if (resumeAt && Date.now() < resumeAt) return true;
  }
  return false;
}

/**
 * Record a rate-limit response for a provider. Parses the Retry-After
 * header, schedules an alarm to resume, and logs the event.
 * @param {string} providerOrHeader — provider id, or the Retry-After header
 *                                   (legacy call form → zendesk provider)
 * @param {string} [retryAfterHeader] — value of the Retry-After header
 */
export function record(providerOrHeader, retryAfterHeader) {
  const provider = retryAfterHeader !== undefined ? providerOrHeader : 'zendesk';
  const header = retryAfterHeader !== undefined ? retryAfterHeader : providerOrHeader;

  const parsed = parseRetryAfterMs(header);
  if (!parsed || parsed <= Date.now()) return;

  const existing = resumeAtByProvider.get(provider);
  if (existing && existing >= parsed) return; // already waiting at least this long

  resumeAtByProvider.set(provider, parsed);
  createResumeAlarm();
  Logger.info(`${provider} rate limit active, pausing ${provider} monitoring until:`, new Date(parsed));
}

/**
 * Internal: (re)create the rateLimitResume alarm for the soonest resume
 * across all providers, so an earlier limit is not over-paused by a later one.
 */
function createResumeAlarm() {
  let soonest = Infinity;
  for (const resumeAt of resumeAtByProvider.values()) {
    if (resumeAt && resumeAt < soonest) soonest = resumeAt;
  }
  if (!Number.isFinite(soonest)) return;

  chrome.alarms.clear('ticketCheck');
  chrome.alarms.create('rateLimitResume', {
    delayInMinutes: Math.max(MIN_ALARM_DELAY_MINUTES, (soonest - Date.now()) / 60000)
  });
}

/**
 * Clear the rate-limit state for all providers. Called when the
 * rateLimitResume alarm fires. Does NOT restart monitoring — the caller
 * (background alarm handler) does that.
 */
export function clear() {
  resumeAtByProvider.clear();
}

/**
 * If any provider is still rate-limited, recreate the rateLimitResume alarm.
 * Called from startMonitoring() when the SW re-initialises while rate-limited.
 */
export function rescheduleIfLimited() {
  if (!isLimited()) return;
  let soonest = Infinity;
  for (const resumeAt of resumeAtByProvider.values()) {
    if (resumeAt && resumeAt < soonest) soonest = resumeAt;
  }
  chrome.alarms.create('rateLimitResume', {
    delayInMinutes: Math.max(MIN_ALARM_DELAY_MINUTES, (soonest - Date.now()) / 60000)
  });
  Logger.info('Monitoring remains paused for rate-limited provider(s)');
}
