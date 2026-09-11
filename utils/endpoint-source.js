// ─── Endpoint Source ──────────────────────────────────────────────────────────
//
// The one module that knows how to read a ticket count from an Endpoint.
//
// Everything site-specific about *reading* an Endpoint lives here: the URL shape,
// the authentication-cookie adapter, the request headers, the rate-limit and
// error taxonomy, and the response shape. Callers get a single outcome value
// instead of branching on `response.ok`, `status === 429` and `typeof data.count`
// in two execution contexts.
//
// Interface (4 exports):
//   describeEndpointUrl(url) — pure: { ok: true } | { ok: false, reason }
//   readEndpoint(url)        — outcome object; never rejects
//   REQUEST_TIMEOUT_MS       — per-request timeout, for user-facing messages
//   DEFAULT_DASHBOARD_URL    — where to send the user when no Endpoint URL is known
//
// Outcome (readEndpoint never rejects; check `ok` first):
//   { ok: true,  status: 'ok',              count, hasCount, results }
//   { ok: false, status: 'unauthenticated', domain }
//   { ok: false, status: 'rate-limited',    domain, retryAfter, retryable: false }
//   { ok: false, status: 'timed-out',       domain, retryable: false }
//   { ok: false, status: 'malformed',       domain, retryable: false, message }
//   { ok: false, status: 'http-error',      domain, httpStatus, httpStatusText, retryable }
//   { ok: false, status: 'network-error',   domain, retryable: true, message }
//
// `retryable` is the module's opinion on whether the caller should try again
// (5xx and transport failures, not 4xx or timeouts) — the caller owns the retry
// policy (how many, how long to wait).
//
// URL shape reasons map to user-facing copy in utils/validators.js, so the rule
// "what is a valid Endpoint URL" has one home and the wording another.

import Logger from './logger.js';
import * as cookieService from './cookie-service.js';

export const REQUEST_TIMEOUT_MS = 10000;

/** Zendesk agent dashboard — the fallback target when no Endpoint URL is known. */
export const DEFAULT_DASHBOARD_URL = 'https://cpanel.zendesk.com/agent/dashboard';

const SEARCH_PATH = '/api/v2/search';

// ─── URL Shape (pure) ─────────────────────────────────────────────────────────

/** Internal: extract the site hostname, or '' when the URL cannot be parsed. */
function domainOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/** Internal: is this hostname a Zendesk site (e.g. "cpanel.zendesk.com")? */
function isZendeskSite(hostname) {
  const parts = hostname.split('.');
  return (
    parts.length >= 3 &&
    parts[parts.length - 2] === 'zendesk' &&
    parts[parts.length - 1] === 'com' &&
    parts[0].length > 0
  );
}

/**
 * Describe whether a URL is a monitorable Endpoint.
 * Pure. Reasons are stable codes; user-facing copy lives in validators.js.
 *
 * @param {string} url
 * @returns {{ ok: true } | { ok: false, reason: 'required'|'invalid'|'wrong-site'|'wrong-path'|'missing-query' }}
 */
export function describeEndpointUrl(url) {
  if (!url || typeof url !== 'string') {
    return { ok: false, reason: 'required' };
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'invalid' };
  }

  if (!isZendeskSite(parsed.hostname)) {
    return { ok: false, reason: 'wrong-site' };
  }

  if (!parsed.pathname.includes(SEARCH_PATH)) {
    return { ok: false, reason: 'wrong-path' };
  }

  if (!parsed.searchParams.has('query')) {
    return { ok: false, reason: 'missing-query' };
  }

  return { ok: true };
}

// ─── Reading ──────────────────────────────────────────────────────────────────

/**
 * Read the current ticket count from an Endpoint.
 * Never rejects — failures come back as outcomes.
 *
 * @param {string} url — Endpoint URL
 * @returns {Promise<object>} outcome (see the header comment)
 */
export async function readEndpoint(url) {
  const domain = domainOf(url);

  // Authentication: cookies come from the browser session, never from storage.
  const cookies = await cookieService.getCookies(domain);
  if (!cookies) {
    Logger.error(`No Zendesk auth cookies for ${domain}. Please log in to ${domain} in your browser.`);
    return { ok: false, status: 'unauthenticated', domain };
  }

  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Cookie': cookies
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      Logger.error(`Endpoint timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds: ${url}`);
      return { ok: false, status: 'timed-out', domain };
    }
    Logger.error(`Network error reading ${url}:`, error);
    return { ok: false, status: 'network-error', domain, retryable: true, message: error?.message };
  }

  if (!response.ok) {
    if (response.status === 429) {
      const retryAfter = response.headers?.get?.('Retry-After') ?? null;
      return { ok: false, status: 'rate-limited', domain, retryAfter };
    }
    return {
      ok: false,
      status: 'http-error',
      domain,
      httpStatus: response.status,
      httpStatusText: response.statusText,
      retryable: response.status >= 500
    };
  }

  let data;
  try {
    data = await response.json();
  } catch {
    Logger.error(`Response from ${url} was not valid JSON`);
    return { ok: false, status: 'malformed', domain, message: 'Response was not valid JSON' };
  }

  // A missing count is not an error: the count is the primary signal and a
  // partial response should still re-baseline the Endpoint rather than throw
  // the observation away. Callers that need "the API really told us" (the popup's
  // Test connection) check hasCount.
  return {
    ok: true,
    status: 'ok',
    domain,
    count: Number(data?.count) || 0,
    hasCount: typeof data?.count === 'number',
    results: Array.isArray(data?.results) ? data.results : []
  };
}
