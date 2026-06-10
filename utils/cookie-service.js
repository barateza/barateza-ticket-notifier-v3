// ─── CookieService ─────────────────────────────────────────────────────────────
//
// Encapsulates Zendesk authentication cookie retrieval with an in-memory
// cache that deduplicates concurrent requests and caches results per domain.
//
// Interface (1 public method):
//   getCookies(domain) → string (cookie header, empty on failure)
//
// Internal:
//   domainCache        — Map<domain, string> caches the cookie string
//   inFlightCache      — Map<domain, Promise> deduplicates concurrent fetches

import Logger from './logger.js';

/** Map<domain, string> — caches cookie string after first fetch */
const domainCache = new Map();

/** Map<domain, Promise<string>> — deduplicates in-flight requests */
const inFlightCache = new Map();

/**
 * Internal: fetch cookies from chrome.cookies and filter for Zendesk auth cookies.
 * @param {string} domain
 * @returns {Promise<string>}
 */
async function fetchZendeskCookies(domain) {
  const cookies = await chrome.cookies.getAll({ domain });

  const authCookies = cookies.filter(cookie =>
    cookie.name.includes('session') ||
    cookie.name.includes('auth') ||
    cookie.name.includes('_zendesk') ||
    cookie.name.includes('csrf') ||
    cookie.name === '_help_center_session'
  );

  const cookieString = authCookies
    .map(cookie => `${cookie.name}=${cookie.value}`)
    .join('; ');

  Logger.info(`Found ${authCookies.length} authentication cookies for ${domain}`);
  return cookieString;
}

// ─── Exported API ──────────────────────────────────────────────────────────────

/**
 * Get Zendesk authentication cookies for a domain.
 * Uses an in-memory cache to avoid redundant chrome.cookies.getAll calls.
 *
 * First call for a domain triggers a real fetch.
 * Concurrent calls for the same domain share the in-flight promise.
 * Subsequent calls return the cached result.
 *
 * Returns empty string on failure.
 *
 * @param {string} domain — e.g. "cpanel.zendesk.com"
 * @returns {Promise<string>} — cookie header string, e.g. "session=abc; _zendesk=xyz"
 */
export async function getCookies(domain) {
  // Return cached value if available
  if (domainCache.has(domain)) {
    return domainCache.get(domain);
  }

  // Deduplicate concurrent requests for the same domain
  if (inFlightCache.has(domain)) {
    return inFlightCache.get(domain);
  }

  const promise = (async () => {
    try {
      const cookieString = await fetchZendeskCookies(domain);
      domainCache.set(domain, cookieString);
      return cookieString;
    } catch (error) {
      Logger.error('Error getting cookies:', error);
      return '';
    } finally {
      inFlightCache.delete(domain);
    }
  })();

  inFlightCache.set(domain, promise);
  return promise;
}

/**
 * Clear the in-memory cache.
 * Useful for testing or when cookies are known to be stale.
 */
export function clearCache() {
  domainCache.clear();
  inFlightCache.clear();
}
