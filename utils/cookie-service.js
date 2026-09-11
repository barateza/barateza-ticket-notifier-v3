// ─── CookieService ─────────────────────────────────────────────────────────────
//
// Encapsulates Zendesk authentication cookie retrieval with an in-memory
// cache that deduplicates concurrent requests and caches results per domain.
// Cache entries expire after CACHE_TTL_MS to prevent stale session cookies.
//
// Interface (1 public method):
//   getCookies(domain) → string (cookie header, empty on failure)
//
// Internal:
//   domainCache        — Map<domain, string> caches the cookie string
//   inFlightCache      — Map<domain, Promise> deduplicates concurrent fetches
//   cacheTimestamps    — Map<domain, number> tracks when each domain was cached

import Logger from './logger.js';
import { getZendeskProvider } from './providers/provider-registry.js';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Map<domain, string> — caches cookie string after first fetch */
const domainCache = new Map();

/** Map<domain, Promise<string>> — deduplicates in-flight requests */
const inFlightCache = new Map();

/** Map<domain, number> — timestamp when each domain's cache was set */
const cacheTimestamps = new Map();

/**
 * Internal: fetch cookies from chrome.cookies and filter for provider auth
 * cookies (Zendesk today — Jira uses token auth and never reads cookies).
 * @param {string} domain
 * @returns {Promise<string>}
 */
async function fetchProviderCookies(domain) {
  const cookies = await chrome.cookies.getAll({ domain });

  const isAuthCookie = getZendeskProvider().isAuthCookie;
  const authCookies = cookies.filter(cookie => isAuthCookie(cookie.name));

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
 * Cache entries expire after CACHE_TTL_MS (5 minutes).
 *
 * First call for a domain triggers a real fetch.
 * Concurrent calls for the same domain share the in-flight promise.
 * Subsequent calls return the cached result (if still within TTL).
 *
 * Returns empty string on failure.
 *
 * @param {string} domain — e.g. "cpanel.zendesk.com"
 * @returns {Promise<string>} — cookie header string, e.g. "session=abc; _zendesk=xyz"
 */
export async function getCookies(domain) {
  // Return cached value if available and not expired
  if (domainCache.has(domain)) {
    const cachedAt = cacheTimestamps.get(domain) || 0;
    if (Date.now() - cachedAt < CACHE_TTL_MS) {
      return domainCache.get(domain);
    }
    // Cache expired — fall through to re-fetch
    domainCache.delete(domain);
    cacheTimestamps.delete(domain);
  }

  // Deduplicate concurrent requests for the same domain
  if (inFlightCache.has(domain)) {
    return inFlightCache.get(domain);
  }

  const promise = (async () => {
    try {
      const cookieString = await fetchProviderCookies(domain);
      domainCache.set(domain, cookieString);
      cacheTimestamps.set(domain, Date.now());
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
  cacheTimestamps.clear();
}
