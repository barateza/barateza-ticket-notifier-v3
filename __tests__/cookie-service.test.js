/**
 * cookie-service.test.js
 * Unit tests for utils/cookie-service.js in isolation.
 */

import * as cookieService from '../utils/cookie-service.js';

describe('CookieService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        cookieService.clearCache();
    });

    describe('getCookies()', () => {
        test('extracts Zendesk auth cookies for a given domain', async () => {
            chrome.cookies.getAll.mockResolvedValue([
                { name: '_zendesk_shared_api_token', value: 'tok123' },
                { name: '_help_center_session', value: 'sess456' },
                { name: '_ga', value: 'analytics' }
            ]);

            const result = await cookieService.getCookies('cpanel.zendesk.com');

            expect(result).toContain('_zendesk_shared_api_token=tok123');
            expect(result).toContain('_help_center_session=sess456');
            expect(result).not.toContain('_ga');
            expect(chrome.cookies.getAll).toHaveBeenCalledWith({ domain: 'cpanel.zendesk.com' });
        });

        test('returns empty string when no auth cookies found', async () => {
            chrome.cookies.getAll.mockResolvedValue([
                { name: '_ga', value: 'analytics' },
                { name: '_gid', value: 'analytics2' }
            ]);

            const result = await cookieService.getCookies('cpanel.zendesk.com');

            expect(result).toBe('');
        });

        test('handles cookie retrieval errors gracefully', async () => {
            chrome.cookies.getAll.mockRejectedValue(new Error('cookie failure'));

            const result = await cookieService.getCookies('cpanel.zendesk.com');

            expect(result).toBe('');
        });

        test('caches result so second call does not re-fetch', async () => {
            chrome.cookies.getAll.mockResolvedValue([
                { name: '_zendesk_shared_api_token', value: 'tok123' }
            ]);

            await cookieService.getCookies('cpanel.zendesk.com');
            await cookieService.getCookies('cpanel.zendesk.com');

            // Should only fetch once
            expect(chrome.cookies.getAll).toHaveBeenCalledTimes(1);
        });

        test('deduplicates concurrent requests for the same domain', async () => {
            let resolvePromise;
            const promise = new Promise(resolve => { resolvePromise = resolve; });
            chrome.cookies.getAll.mockReturnValue(promise);

            const result1 = cookieService.getCookies('cpanel.zendesk.com');
            const result2 = cookieService.getCookies('cpanel.zendesk.com');

            resolvePromise([{ name: '_zendesk_shared_api_token', value: 'tok123' }]);

            const [r1, r2] = await Promise.all([result1, result2]);

            expect(r1).toBe(r2); // Same resolved value
            expect(chrome.cookies.getAll).toHaveBeenCalledTimes(1);
        });
    });

    describe('clearCache()', () => {
        test('forces re-fetch on next getCookies call', async () => {
            chrome.cookies.getAll.mockResolvedValue([
                { name: '_zendesk_shared_api_token', value: 'tok123' }
            ]);

            await cookieService.getCookies('cpanel.zendesk.com');
            cookieService.clearCache();
            await cookieService.getCookies('cpanel.zendesk.com');

            expect(chrome.cookies.getAll).toHaveBeenCalledTimes(2);
        });
    });
});
