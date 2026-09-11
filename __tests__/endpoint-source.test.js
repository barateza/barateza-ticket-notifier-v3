/**
 * endpoint-source.test.js
 * Unit tests for utils/endpoint-source.js — the module that owns reading a
 * ticket count from an Endpoint.
 *
 * These tests are the payoff of the deepening: the outcome taxonomy is asserted
 * directly against a stubbed fetch, with no chrome messaging, no poller and no
 * storage involved. The poller's own tests only have to care about polling.
 */

import { describeEndpointUrl, readEndpoint, REQUEST_TIMEOUT_MS, DEFAULT_DASHBOARD_URL } from '../utils/endpoint-source.js';
import * as cookieService from '../utils/cookie-service.js';

jest.mock('../utils/logger.js', () => ({
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    setDebugMode: jest.fn()
}));

const ENDPOINT_URL = 'https://cpanel.zendesk.com/api/v2/search.json?query=type:ticket+status:new';

describe('endpoint-source', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        cookieService.clearCache();
        chrome.cookies.getAll.mockResolvedValue([{ name: 'session-id', value: 'abc123' }]);
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ count: 7, results: [{ id: 1 }] })
        });
    });

    // ─── describeEndpointUrl ──────────────────────────────────────────────────

    describe('describeEndpointUrl()', () => {
        test('accepts a Zendesk search Endpoint URL', () => {
            expect(describeEndpointUrl(ENDPOINT_URL)).toEqual({ ok: true });
        });

        test.each([
            ['', 'required'],
            [undefined, 'required'],
            [null, 'required'],
            [42, 'required'],
            ['not-a-url', 'invalid'],
            ['https://example.com/api/v2/search.json?query=x', 'wrong-site'],
            ['http://localhost/api/v2/search.json?query=x', 'wrong-site'],
            ['https://zendesk.com/api/v2/search.json?query=x', 'wrong-site'],
            ['https://cpanel.zendesk.com/api/v2/tickets.json', 'wrong-path'],
            ['https://cpanel.zendesk.com/api/v2/search.json', 'missing-query']
        ])('rejects %p with reason %p', (url, reason) => {
            expect(describeEndpointUrl(url)).toEqual({ ok: false, reason });
        });
    });

    // ─── readEndpoint: happy path ─────────────────────────────────────────────

    describe('readEndpoint() success', () => {
        test('reports the count and the results', async () => {
            const outcome = await readEndpoint(ENDPOINT_URL);

            expect(outcome.ok).toBe(true);
            expect(outcome.status).toBe('ok');
            expect(outcome.count).toBe(7);
            expect(outcome.hasCount).toBe(true);
            expect(outcome.results).toEqual([{ id: 1 }]);
        });

        test('sends the site cookies and mirrors the site credentials', async () => {
            await readEndpoint(ENDPOINT_URL);

            const [url, options] = global.fetch.mock.calls[0];
            expect(url).toBe(ENDPOINT_URL);
            expect(options.credentials).toBe('include');
            expect(options.headers.Cookie).toBe('session-id=abc123');
            expect(options.headers.Accept).toBe('application/json');
        });

        test('coerces a numeric string count to a number', async () => {
            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({ count: '12' })
            });

            const outcome = await readEndpoint(ENDPOINT_URL);

            expect(outcome.count).toBe(12);
            expect(outcome.hasCount).toBe(false); // the API did not send a number
        });

        test('treats a missing count as zero without failing the read', async () => {
            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({ results: [] })
            });

            const outcome = await readEndpoint(ENDPOINT_URL);

            expect(outcome.ok).toBe(true);
            expect(outcome.count).toBe(0);
            expect(outcome.hasCount).toBe(false);
        });

        test('reports empty results when the payload has none', async () => {
            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({ count: 3 })
            });

            const outcome = await readEndpoint(ENDPOINT_URL);

            expect(outcome.results).toEqual([]);
        });
    });

    // ─── readEndpoint: failures ───────────────────────────────────────────────

    describe('readEndpoint() failures', () => {
        test('reports unauthenticated and never issues a request when there are no cookies', async () => {
            chrome.cookies.getAll.mockResolvedValue([]);
            global.fetch = jest.fn();

            const outcome = await readEndpoint(ENDPOINT_URL);

            expect(outcome).toEqual({ ok: false, status: 'unauthenticated', domain: 'cpanel.zendesk.com' });
            expect(global.fetch).not.toHaveBeenCalled();
        });

        test('reports rate-limited with the Retry-After header verbatim', async () => {
            global.fetch = jest.fn().mockResolvedValue({
                ok: false,
                status: 429,
                headers: { get: (key) => (key === 'Retry-After' ? '60' : null) }
            });

            const outcome = await readEndpoint(ENDPOINT_URL);

            expect(outcome.status).toBe('rate-limited');
            expect(outcome.retryAfter).toBe('60');
            expect(outcome.retryable).toBeFalsy();
        });

        test('reports rate-limited with a null retryAfter when the header is missing', async () => {
            global.fetch = jest.fn().mockResolvedValue({
                ok: false,
                status: 429,
                headers: { get: () => null }
            });

            expect((await readEndpoint(ENDPOINT_URL)).retryAfter).toBeNull();
        });

        test('marks 5xx as retryable and 4xx as not', async () => {
            global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503, statusText: 'Service Unavailable' });
            const serverError = await readEndpoint(ENDPOINT_URL);

            global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' });
            const clientError = await readEndpoint(ENDPOINT_URL);

            expect(serverError).toMatchObject({ status: 'http-error', httpStatus: 503, retryable: true });
            expect(clientError).toMatchObject({ status: 'http-error', httpStatus: 404, retryable: false });
        });

        test('reports timed-out for a TimeoutError, and does not retry it', async () => {
            const timeoutError = new Error('signal timed out');
            timeoutError.name = 'TimeoutError';
            global.fetch = jest.fn().mockRejectedValue(timeoutError);

            const outcome = await readEndpoint(ENDPOINT_URL);

            expect(outcome.status).toBe('timed-out');
            expect(outcome.retryable).toBeFalsy();
        });

        test('reports timed-out for an AbortError too', async () => {
            const abortError = new Error('aborted');
            abortError.name = 'AbortError';
            global.fetch = jest.fn().mockRejectedValue(abortError);

            expect((await readEndpoint(ENDPOINT_URL)).status).toBe('timed-out');
        });

        test('reports network-error as retryable', async () => {
            global.fetch = jest.fn().mockRejectedValue(new Error('Failed to fetch'));

            const outcome = await readEndpoint(ENDPOINT_URL);

            expect(outcome.status).toBe('network-error');
            expect(outcome.retryable).toBe(true);
            expect(outcome.message).toBe('Failed to fetch');
        });

        test('reports malformed when the body is not JSON', async () => {
            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => { throw new SyntaxError('Unexpected token < in JSON'); }
            });

            const outcome = await readEndpoint(ENDPOINT_URL);

            expect(outcome.status).toBe('malformed');
            expect(outcome.retryable).toBeFalsy();
        });
    });

    // ─── Constants ────────────────────────────────────────────────────────────

    describe('constants', () => {
        test('exposes the request timeout used for user-facing messages', () => {
            expect(REQUEST_TIMEOUT_MS).toBe(10000);
        });

        test('exposes a dashboard fallback for the no-Endpoint case', () => {
            expect(DEFAULT_DASHBOARD_URL).toBe('https://cpanel.zendesk.com/agent/dashboard');
        });
    });
});
