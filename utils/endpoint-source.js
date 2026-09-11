// ─── Endpoint Source ──────────────────────────────────────────────────────────
//
// The one module that reads a ticket count for a Monitor. It owns the parts that
// are identical whichever provider is being polled — resolving authentication,
// issuing the request, the timeout, and classifying the failure — while the
// provider adapter supplies the policy: the polling URL, the fetch options
// (cookies vs Basic auth), and how to parse the count.
//
// Interface (2 exports):
//   REQUEST_TIMEOUT_MS   — per-request timeout, for user-facing messages
//   readMonitor(monitor, provider) → outcome object; never rejects
//
// Outcome (check `ok` first):
//   { ok: true,  count, hasCount }
//   { ok: false, status, errorType, message, retryable, retryAfter?, httpStatus? }
//
// `status` is the semantic failure:
//   unauthenticated | rate-limited | timed-out | malformed | http-error | network-error
// `errorType` is the category the popup displays, matching the poller's
// session-persisted monitor error state:
//   auth | missingCredentials | rateLimit | http | network
// `retryable` is this module's opinion on whether another attempt could help
// (5xx and transport failures, not 4xx or timeouts) — the caller owns the retry
// policy: how many attempts, and how long to wait.

import Logger from './logger.js';
import * as cookieService from './cookie-service.js';
import { getLocal } from './storage-service.js';

export const REQUEST_TIMEOUT_MS = 10000;

/**
 * Resolve provider credentials for a site.
 * Internal — the two built-in providers differ in how they authenticate, and
 * that difference is exactly what a provider adapter abstracts.
 *
 * @returns {Promise<{deps?: object, error?: object}>}
 */
async function resolveAuth(provider, domain) {
  if (provider.id === 'zendesk') {
    const cookies = await cookieService.getCookies(domain);
    if (!cookies) {
      return {
        error: {
          ok: false,
          status: 'unauthenticated',
          errorType: 'auth',
          message: `No Zendesk auth cookies for ${domain}. Please log in to ${domain} in your browser.`
        }
      };
    }
    return { deps: { cookies } };
  }

  if (provider.id === 'jira') {
    const { jiraCredentials } = await getLocal(['jiraCredentials']);
    const credentials = (jiraCredentials || {})[domain];
    if (!credentials || !credentials.email || !credentials.token) {
      return {
        error: {
          ok: false,
          status: 'unauthenticated',
          errorType: 'missingCredentials',
          message: `No Jira credentials configured for ${domain}. Add them in Settings → Jira credentials.`
        }
      };
    }
    return { deps: { credentials } };
  }

  return { deps: {} };
}

/**
 * Whether the provider's response actually carried a count.
 * `parseCount` coerces a missing count to 0, so it cannot distinguish "the API
 * sent zero" from "the API sent no count field" — this can.
 * Internal: the count fields differ per provider, so this is provider policy.
 */
function hasExplicitCount(provider, data) {
  if (provider.id === 'jira') {
    return typeof data?.count !== 'undefined' || typeof data?.total !== 'undefined';
  }
  return typeof data?.count !== 'undefined';
}

/**
 * Read the current ticket count for a Monitor.
 * Never rejects — failures come back as outcomes.
 *
 * @param {{id: number|string, name: string, url: string, provider?: string}} monitor
 * @param {object} provider — the adapter from the provider registry
 * @returns {Promise<object>} outcome (see the header comment)
 */
export async function readMonitor(monitor, provider) {
  let domain;
  let apiUrl;
  try {
    domain = new URL(monitor.url).hostname;
    apiUrl = provider.buildApiUrl(monitor.url);
  } catch {
    Logger.error(`Monitor URL could not be parsed: ${monitor.url}`);
    return {
      ok: false,
      status: 'malformed',
      errorType: 'http',
      retryable: false,
      message: 'Invalid monitor URL — check the URL in Settings'
    };
  }

  const { deps, error } = await resolveAuth(provider, domain);
  if (error) {
    Logger.error(error.message);
    return error;
  }

  let response;
  try {
    response = await fetch(apiUrl, {
      ...provider.buildFetchOptions(deps),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (fetchError) {
    if (fetchError?.name === 'TimeoutError' || fetchError?.name === 'AbortError') {
      Logger.error(`Monitor ${monitor.name} timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds`);
      return {
        ok: false,
        status: 'timed-out',
        errorType: 'network',
        retryable: false,
        message: 'Timed out after 10 seconds — will retry on the next check'
      };
    }
    Logger.error(`Network error reading ${monitor.name}:`, fetchError);
    return {
      ok: false,
      status: 'network-error',
      errorType: 'network',
      retryable: true,
      message: 'Network error — will retry on the next check'
    };
  }

  if (!response.ok) {
    if (response.status === 429) {
      const retryAfter = response.headers?.get?.('Retry-After') ?? null;
      return {
        ok: false,
        status: 'rate-limited',
        errorType: 'rateLimit',
        retryAfter,
        retryable: false,
        message: `Rate limited by ${provider.label} — will resume automatically`
      };
    }

    // A provider may treat a status as an authentication failure: Jira answers
    // a bad API token with 401.
    if (response.status === 401 && provider.id === 'jira') {
      const message = `Jira rejected the credentials for ${domain} — check Settings → Jira credentials`;
      Logger.error(message);
      return { ok: false, status: 'unauthenticated', errorType: 'auth', retryable: false, message };
    }

    return {
      ok: false,
      status: 'http-error',
      errorType: 'http',
      httpStatus: response.status,
      retryable: response.status >= 500,
      message: `HTTP ${response.status} — will retry on the next check`
    };
  }

  let data;
  try {
    data = await response.json();
  } catch (parseError) {
    Logger.error(`Invalid JSON response for ${monitor.name}:`, parseError);
    return {
      ok: false,
      status: 'malformed',
      errorType: 'http',
      retryable: false,
      message: 'Invalid response format — will retry on the next check'
    };
  }

  // `count` is always a number so callers can compare and sum it; `hasCount`
  // reports whether the provider really sent one, which the popup's
  // Test connection distinguishes from a partial response.
  return {
    ok: true,
    count: Number(provider.parseCount(data)) || 0,
    hasCount: hasExplicitCount(provider, data)
  };
}
