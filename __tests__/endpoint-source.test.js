/**
 * endpoint-source.test.js
 * Unit tests for utils/endpoint-source.js — the module that reads a ticket count
 * for a Monitor, using the monitor's provider adapter for policy (polling URL,
 * fetch options, count parsing) and owning the auth/error taxonomy itself.
 *
 * These assert the outcome taxonomy directly, so the poller's own tests only have
 * to care about what an observed count means.
 */

import { readMonitor, REQUEST_TIMEOUT_MS } from '../utils/endpoint-source.js';
import { getProvider } from '../utils/providers/provider-registry.js';
import * as cookieService from '../utils/cookie-service.js';

jest.mock('../utils/logger.js', () => ({
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    setDebugMode: jest.fn()
}));

const ZENDESK = getProvider('zendesk');
const JIRA = getProvider('jira');

const ZENDESK_MONITOR = {
    id: 1,
    name: 'Zendesk Queue',
    provider: 'zendesk',
    url: 'https://cpanel.zendesk.com/api/v2/search.json?query=type:ticket+status:new'
};
const JIRA_MONITOR = {
    id: 2,
    name: 'Jira Queue',
    provider: 'jira',
    url: 'https://myco.atlassian.net/issues/?jql=project%20%3D%20SUPPORT'
};

function mockLocal(data) {
    chrome.storage.local.get.mockImplementation((keys, callback) => {
        const result = {};
        const list = typeof keys === 'string' ? [keys] : keys;
        list.forEach(k => { if (data[k] !== undefined) result[k] = data[k]; });
        callback(result);
    });
}

function mockFetchOk(payload) {
    global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => payload
    });
}

describe('endpoint-source', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // cookie-service caches per domain for 5 minutes, so each test must
        // start from a cold cache for its chrome.cookies mock to take effect.
        cookieService.clearCache();
        mockLocal({});
        chrome.cookies.getAll.mockResolvedValue([
            { name: '_zendesk_shared_session', value: 'abc' }
        ]);
        mockFetchOk({ count: 7, results: [] });
    });

    // ─── Zendesk (cookie auth) ────────────────────────────────────────────────

    describe('zendesk monitors', () => {
        test('reads the count and reports that the API really sent one', async () => {
            const outcome = await readMonitor(ZENDESK_MONITOR, ZENDESK);

            expect(outcome).toEqual({ ok: true, count: 7, hasCount: true });
        });

        test('sends the site cookies without an Authorization header', async () => {
            await readMonitor(ZENDESK_MONITOR, ZENDESK);

            const [url, options] = global.fetch.mock.calls[0];
            expect(url).toBe(ZENDESK_MONITOR.url);
            expect(options.headers.Cookie).toContain('_zendesk_shared_session=abc');
            expect(options.headers.Authorization).toBeUndefined();
        });

        test('reports a missing count without failing the read', async () => {
            mockFetchOk({ results: [] });

            const outcome = await readMonitor(ZENDESK_MONITOR, ZENDESK);

            expect(outcome.ok).toBe(true);
            expect(outcome.count).toBe(0);
            expect(outcome.hasCount).toBe(false);
        });

        test('reports unauthenticated and never fetches when there are no cookies', async () => {
            chrome.cookies.getAll.mockResolvedValue([]);
            global.fetch = jest.fn();

            const outcome = await readMonitor(ZENDESK_MONITOR, ZENDESK);

            expect(outcome).toMatchObject({
                ok: false,
                status: 'unauthenticated',
                errorType: 'auth'
            });
            expect(global.fetch).not.toHaveBeenCalled();
        });
    });

    // ─── Jira (API-token auth) ────────────────────────────────────────────────

    describe('jira monitors', () => {
        beforeEach(() => {
            mockLocal({
                jiraCredentials: { 'myco.atlassian.net': { email: 'me@corp.com', token: 'tok' } }
            });
        });

        test('polls the derived API URL with Basic auth and no cookies', async () => {
            mockFetchOk({ count: 4, exact: true });

            const outcome = await readMonitor(JIRA_MONITOR, JIRA);

            const [url, options] = global.fetch.mock.calls[0];
            expect(url).toContain('https://myco.atlassian.net/rest/api/3/search/approximate-count?jql=');
            expect(options.headers.Authorization).toBe('Basic ' + btoa('me@corp.com:tok'));
            expect(options.headers.Cookie).toBeUndefined();
            expect(chrome.cookies.getAll).not.toHaveBeenCalled();
            expect(outcome).toEqual({ ok: true, count: 4, hasCount: true });
        });

        test('falls back to `total` when the response has no `count`', async () => {
            mockFetchOk({ total: 9 });

            const outcome = await readMonitor(JIRA_MONITOR, JIRA);

            expect(outcome).toEqual({ ok: true, count: 9, hasCount: true });
        });

        test('reports missingCredentials and never fetches without credentials', async () => {
            mockLocal({});
            global.fetch = jest.fn();

            const outcome = await readMonitor(JIRA_MONITOR, JIRA);

            expect(outcome).toMatchObject({
                ok: false,
                status: 'unauthenticated',
                errorType: 'missingCredentials'
            });
            expect(outcome.message).toContain('No Jira credentials configured for myco.atlassian.net');
            expect(global.fetch).not.toHaveBeenCalled();
        });

        test('treats a 401 as an authentication failure', async () => {
            global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 });

            const outcome = await readMonitor(JIRA_MONITOR, JIRA);

            expect(outcome).toMatchObject({
                ok: false,
                status: 'unauthenticated',
                errorType: 'auth',
                retryable: false
            });
        });
    });

    // ─── Shared failure taxonomy ──────────────────────────────────────────────

    describe('failure taxonomy', () => {
        test('reports rate-limited with the Retry-After header verbatim', async () => {
            global.fetch = jest.fn().mockResolvedValue({
                ok: false,
                status: 429,
                headers: { get: (key) => (key === 'Retry-After' ? '60' : null) }
            });

            const outcome = await readMonitor(ZENDESK_MONITOR, ZENDESK);

            expect(outcome).toMatchObject({ status: 'rate-limited', errorType: 'rateLimit', retryAfter: '60' });
        });

        test('reports a null retryAfter when the header is absent', async () => {
            global.fetch = jest.fn().mockResolvedValue({
                ok: false, status: 429, headers: { get: () => null }
            });

            expect((await readMonitor(ZENDESK_MONITOR, ZENDESK)).retryAfter).toBeNull();
        });

        test('marks 5xx as retryable and 4xx as not', async () => {
            global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });
            const server = await readMonitor(ZENDESK_MONITOR, ZENDESK);

            global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 });
            const client = await readMonitor(ZENDESK_MONITOR, ZENDESK);

            expect(server).toMatchObject({ status: 'http-error', errorType: 'http', httpStatus: 503, retryable: true });
            expect(client).toMatchObject({ status: 'http-error', errorType: 'http', httpStatus: 404, retryable: false });
        });

        test('reports timed-out for a TimeoutError and does not retry it', async () => {
            const timeoutError = new Error('signal timed out');
            timeoutError.name = 'TimeoutError';
            global.fetch = jest.fn().mockRejectedValue(timeoutError);

            const outcome = await readMonitor(ZENDESK_MONITOR, ZENDESK);

            expect(outcome).toMatchObject({ status: 'timed-out', errorType: 'network', retryable: false });
        });

        test('reports timed-out for an AbortError too', async () => {
            const abortError = new Error('aborted');
            abortError.name = 'AbortError';
            global.fetch = jest.fn().mockRejectedValue(abortError);

            expect((await readMonitor(ZENDESK_MONITOR, ZENDESK)).status).toBe('timed-out');
        });

        test('reports network-error as retryable', async () => {
            global.fetch = jest.fn().mockRejectedValue(new Error('Failed to fetch'));

            const outcome = await readMonitor(ZENDESK_MONITOR, ZENDESK);

            expect(outcome).toMatchObject({ status: 'network-error', errorType: 'network', retryable: true });
        });

        test('reports malformed when the body is not JSON', async () => {
            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => { throw new SyntaxError('Unexpected token < in JSON'); }
            });

            const outcome = await readMonitor(ZENDESK_MONITOR, ZENDESK);

            expect(outcome).toMatchObject({ status: 'malformed', errorType: 'http', retryable: false });
        });

        test('reports malformed without fetching when the monitor URL cannot be parsed', async () => {
            global.fetch = jest.fn();

            const outcome = await readMonitor({ name: 'Broken', url: 'not-a-url' }, ZENDESK);

            expect(outcome).toMatchObject({ status: 'malformed', retryable: false });
            expect(global.fetch).not.toHaveBeenCalled();
        });
    });

    describe('constants', () => {
        test('exposes the request timeout used for user-facing messages', () => {
            expect(REQUEST_TIMEOUT_MS).toBe(10000);
        });
    });
});
