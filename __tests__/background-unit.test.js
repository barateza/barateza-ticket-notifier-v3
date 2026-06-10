/**
 * background-unit.test.js
 * Focuses on exported functions in background.js to boost statement/branch/function coverage.
 */

import * as Background from '../background.js';
import * as snoozeService from '../utils/snooze-service.js';
import * as cookieService from '../utils/cookie-service.js';
const alarmListeners = chrome.alarms.onAlarm.addListener.mock.calls.map(([listener]) => listener);

describe('Background – Unit Tests', () => {
    let mockLocalStorage;
    let mockSessionStorage;

    beforeEach(() => {
        mockLocalStorage = {
            settings: {
                checkInterval: 1,
                soundEnabled: true,
                notificationEnabled: true,
                darkMode: false,
                debugMode: false
            },
            endpoints: [
                {
                    id: 1,
                    name: 'My Tickets',
                    url: 'https://cpanel.zendesk.com/api/v2/search.json?query=type:ticket+assignee:me+status:open',
                    enabled: true
                }
            ]
        };
        mockSessionStorage = {};

        chrome.storage.local.get.mockImplementation((keys, callback) => {
            const result = {};
            if (Array.isArray(keys)) {
                keys.forEach(k => { if (mockLocalStorage[k] !== undefined) result[k] = mockLocalStorage[k]; });
            }
            callback(result);
        });

        chrome.storage.local.set.mockImplementation((data, callback) => {
            Object.assign(mockLocalStorage, data);
            if (callback) callback();
        });

        chrome.storage.local.remove.mockImplementation((_keys, callback) => {
            if (callback) callback();
        });

        chrome.storage.session.get.mockImplementation((keys, callback) => {
            const result = {};
            if (Array.isArray(keys)) {
                keys.forEach(k => { if (mockSessionStorage[k] !== undefined) result[k] = mockSessionStorage[k]; });
            }
            callback(result);
        });

        chrome.storage.session.set.mockImplementation((data, callback) => {
            Object.assign(mockSessionStorage, data);
            if (callback) callback();
        });

        chrome.alarms.create.mockImplementation(() => { });
        chrome.alarms.clear.mockResolvedValue(true);
        chrome.alarms.clearAll.mockResolvedValue(true);

        chrome.action.setBadgeText.mockResolvedValue(undefined);
        chrome.action.setBadgeBackgroundColor.mockResolvedValue(undefined);

        chrome.notifications.create.mockResolvedValue('notification-id');

        chrome.offscreen.hasDocument.mockResolvedValue(false);
        chrome.offscreen.createDocument.mockResolvedValue(undefined);

        chrome.runtime.sendMessage.mockResolvedValue({ success: true });

        chrome.cookies.getAll.mockResolvedValue([
            { name: 'session-id', value: 'sess123' }
        ]);

        // Mock fetch to avoid "reading 'ok' of undefined" in startMonitoring's background checks
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ count: 5 })
        });

        cookieService.clearCache();
    });

    afterEach(async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ count: 0 })
        });
        // Reset module-level rateLimitResumeAt by simulating the resume alarm event.
        for (const listener of alarmListeners) {
            await listener({ name: 'rateLimitResume' });
        }
        jest.clearAllMocks();
        delete chrome.runtime.lastError;
        await snoozeService.clearSnooze();
    });


    describe('updateBadge()', () => {
        test('shows ticket count badge when not snoozed and counts > 0', async () => {
            // Simulate endpoint counts in session storage
            mockSessionStorage.endpointCounts = [[1, 5]];

            await Background.updateBadge();

            expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '5' });
        });

        test('shows empty badge when there are no tickets', async () => {
            mockSessionStorage.endpointCounts = [[1, 0]];

            await Background.updateBadge();

            expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '' });
        });

        test('shows snooze badge when snoozed', async () => {
            await snoozeService.setSnooze(60);
            mockSessionStorage.endpointCounts = [[1, 3]];

            await Background.updateBadge();

            expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '⏰' });
            expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#F39C12' });
        });
    });


    describe('checkAllEndpoints()', () => {
        test('skips when there are no endpoints configured', async () => {
            mockLocalStorage.endpoints = undefined;

            // Should complete without errors
            await expect(Background.checkAllEndpoints()).resolves.not.toThrow();
            expect(chrome.notifications.create).not.toHaveBeenCalled();
        });

        test('does not check disabled endpoints', async () => {
            mockLocalStorage.endpoints = [
                {
                    id: 1,
                    name: 'Disabled Endpoint',
                    url: 'https://cpanel.zendesk.com/api/v2/search.json?query=type:ticket',
                    enabled: false
                }
            ];

            // Mock fetch to confirm it's not called
            global.fetch = jest.fn();

            await Background.checkAllEndpoints();

            expect(global.fetch).not.toHaveBeenCalled();
        });

        test('reuses cached cookies for endpoints on the same domain in a cycle', async () => {
            mockLocalStorage.endpoints = [
                {
                    id: 1,
                    name: 'Endpoint A',
                    url: 'https://cpanel.zendesk.com/api/v2/search.json?query=type:ticket+status:new',
                    enabled: true
                },
                {
                    id: 2,
                    name: 'Endpoint B',
                    url: 'https://cpanel.zendesk.com/api/v2/search.json?query=type:ticket+status:open',
                    enabled: true
                }
            ];

            await Background.checkAllEndpoints();

            expect(chrome.cookies.getAll).toHaveBeenCalledTimes(1);
            expect(global.fetch).toHaveBeenCalledTimes(2);
        });
    });

    describe('checkEndpoint() edge cases', () => {
        const endpoint = {
            id: 1,
            name: 'My Tickets',
            url: 'https://cpanel.zendesk.com/api/v2/search.json?query=type:ticket+status:new',
            enabled: true
        };
        const settings = { soundEnabled: true, notificationEnabled: true };

        test('handles cookie retrieval failure (empty cookie string) without fetch', async () => {
            chrome.cookies.getAll.mockRejectedValue(new Error('cookie failure'));
            global.fetch = jest.fn();

            await expect(Background.checkEndpoint(endpoint, settings)).resolves.toBeUndefined();
            expect(global.fetch).not.toHaveBeenCalled();
        });

        test('handles non-JSON HTML response body without crashing worker', async () => {
            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => {
                    throw new SyntaxError('Unexpected token < in JSON');
                }
            });

            await expect(Background.checkEndpoint(endpoint, settings)).resolves.toBeUndefined();
            expect(chrome.notifications.create).not.toHaveBeenCalled();
        });

        test('handles chrome.storage.session.set QUOTA_BYTES errors gracefully', async () => {
            chrome.storage.session.set.mockImplementation((_data, callback) => {
                chrome.runtime.lastError = { message: 'QUOTA_BYTES quota exceeded' };
                if (callback) callback();
            });

            await expect(Background.checkEndpoint(endpoint, settings)).resolves.toBeUndefined();
            expect(global.fetch).toHaveBeenCalled();
        });

        test('pauses monitoring when Zendesk responds with HTTP 429 and Retry-After', async () => {
            global.fetch = jest.fn().mockResolvedValue({
                ok: false,
                status: 429,
                headers: {
                    get: (key) => key === 'Retry-After' ? '60' : null
                }
            });

            await expect(Background.checkEndpoint(endpoint, settings)).resolves.toBeUndefined();
            expect(chrome.alarms.clear).toHaveBeenCalledWith('ticketCheck');
            expect(chrome.alarms.create).toHaveBeenCalledWith('rateLimitResume', expect.any(Object));
        });
    });

    // ─── startMonitoring ─────────────────────────────────────────────────────────

    describe('startMonitoring()', () => {
        test('creates a ticketCheck alarm with the configured interval', async () => {
            await Background.startMonitoring();

            expect(chrome.alarms.create).toHaveBeenCalledWith('ticketCheck', expect.objectContaining({ periodInMinutes: 1 }));
        });

        test('uses minimum 1 minute if checkInterval is 0 or missing', async () => {
            mockLocalStorage.settings = undefined;

            await Background.startMonitoring();

            expect(chrome.alarms.create).toHaveBeenCalledWith('ticketCheck', expect.objectContaining({ periodInMinutes: 1 }));
        });
    });
});
