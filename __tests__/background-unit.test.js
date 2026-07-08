/**
 * background-unit.test.js
 * Focuses on exported functions in background.js to boost statement/branch/function coverage.
 */

import * as Background from '../background.js';
import * as snoozeService from '../utils/snooze-service.js';
import * as cookieService from '../utils/cookie-service.js';
import Logger from '../utils/logger.js';
const alarmListeners = chrome.alarms.onAlarm.addListener.mock.calls.map(([listener]) => listener);
const installListeners = chrome.runtime.onInstalled.addListener.mock.calls.map(([listener]) => listener);
const messageListeners = chrome.runtime.onMessage.addListener.mock.calls.map(([listener]) => listener);
const storageChangeListeners = chrome.storage.onChanged.addListener.mock.calls.map(([listener]) => listener);

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

    // ─── onInstalled Handler ──────────────────────────────────────────────────

    describe('onInstalled handler', () => {
        test('sets default endpoints and settings when storage is empty', async () => {
            mockLocalStorage.endpoints = undefined;
            mockLocalStorage.settings = undefined;

            await installListeners[0]({ reason: 'install' });

            expect(mockLocalStorage.endpoints).toBeDefined();
            expect(mockLocalStorage.endpoints.length).toBe(1);
            expect(mockLocalStorage.endpoints[0].name).toBe('My Tickets');
            expect(mockLocalStorage.settings).toBeDefined();
            expect(mockLocalStorage.settings.checkInterval).toBe(1);
        });

        test('preserves existing endpoints and settings', async () => {
            mockLocalStorage.endpoints = [{ id: 99, name: 'Custom', url: 'https://test.zendesk.com/api/v2/search.json?query=type:ticket', enabled: true }];
            mockLocalStorage.settings = { checkInterval: 5, soundEnabled: false, notificationEnabled: false };

            await installListeners[0]({ reason: 'update' });

            expect(mockLocalStorage.endpoints.length).toBe(1);
            expect(mockLocalStorage.endpoints[0].name).toBe('Custom');
            expect(mockLocalStorage.settings.checkInterval).toBe(5);
        });

        test('migrates missing settings properties', async () => {
            mockLocalStorage.settings = { checkInterval: 3, soundEnabled: true, notificationEnabled: true };

            await installListeners[0]({ reason: 'update' });

            expect(mockLocalStorage.settings.darkMode).toBe(false);
            expect(mockLocalStorage.settings.debugMode).toBe(false);
            expect(mockLocalStorage.settings.customSoundEnabled).toBe(false);
        });

        test('sets isEnabled true and lastCheckTime 0 in session', async () => {
            mockLocalStorage.endpoints = undefined;
            mockLocalStorage.settings = undefined;

            await installListeners[0]({ reason: 'install' });

            expect(mockSessionStorage.isEnabled).toBe(true);
            expect(mockSessionStorage.lastCheckTime).toBe(0);
        });
    });

    // ─── Alarm Handler ────────────────────────────────────────────────────────

    describe('Alarm handler', () => {
        test('clears snooze on snoozeEnd alarm', async () => {
            await snoozeService.setSnooze(60);
            expect(await snoozeService.isSnoozed()).toBe(true);

            for (const listener of alarmListeners) {
                await listener({ name: 'snoozeEnd' });
            }

            expect(await snoozeService.isSnoozed()).toBe(false);
        });

        test('handles ticketCheck alarm by running handleAlarmTick', async () => {
            mockSessionStorage.endpointCounts = [[1, 5]];
            mockSessionStorage.isEnabled = true;

            for (const listener of alarmListeners) {
                await listener({ name: 'ticketCheck' });
            }

            expect(chrome.action.setBadgeText).toHaveBeenCalled();
        });

        test('logs warning for unknown alarm', async () => {
            Logger.setDebugMode(true);
            const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

            for (const listener of alarmListeners) {
                await listener({ name: 'unknown_alarm' });
            }

            expect(warnSpy).toHaveBeenCalledWith('Unknown alarm received:', 'unknown_alarm');
            warnSpy.mockRestore();
            Logger.setDebugMode(false);
        });
    });

    // ─── Message Handlers ─────────────────────────────────────────────────────

    describe('Message handlers', () => {
        function sendMessage(action, data = {}) {
            return new Promise((resolve) => {
                const sendResponse = jest.fn((response) => {
                    resolve(response);
                });
                for (const listener of messageListeners) {
                    listener({ action, ...data }, {}, sendResponse);
                }
            });
        }

        test('refreshNow — performs manual refresh', async () => {
            const response = await sendMessage('refreshNow');
            expect(response.success).toBe(true);
            expect(mockSessionStorage.lastCheckTime).toBeGreaterThan(0);
        });

        test('refreshNow — rejects too-frequent refresh', async () => {
            mockSessionStorage.lastCheckTime = Date.now();
            const response = await sendMessage('refreshNow');
            expect(response.success).toBe(false);
            expect(response.error).toContain('30 seconds');
        });

        test('toggleEnabled — enables/disables monitoring', async () => {
            mockSessionStorage.isEnabled = false;
            const response = await sendMessage('toggleEnabled', { enabled: true });
            expect(response.success).toBe(true);
            expect(mockSessionStorage.isEnabled).toBe(true);
        });

        test('getStatus — returns current monitoring status', async () => {
            mockSessionStorage.endpointCounts = [[1, 3]];
            const response = await sendMessage('getStatus');

            expect(response.enabled).toBe(true);
            expect(response.counts).toEqual([[1, 3]]);
            expect(response.isSnoozed).toBe(false);
        });

        test('getStatus — handles missing endpointCounts', async () => {
            const response = await sendMessage('getStatus');
            expect(response.counts).toEqual([]);
        });

        test('setSnooze — sets snooze duration', async () => {
            const response = await sendMessage('setSnooze', { duration: 30 });
            expect(response.success).toBe(true);
            expect(await snoozeService.isSnoozed()).toBe(true);
        });

        test('clearSnooze — clears active snooze', async () => {
            await snoozeService.setSnooze(30);
            expect(await snoozeService.isSnoozed()).toBe(true);

            const response = await sendMessage('clearSnooze');
            expect(response.success).toBe(true);
            expect(await snoozeService.isSnoozed()).toBe(false);
        });

        test('getSnoozeStatus — returns snooze state', async () => {
            const response = await sendMessage('getSnoozeStatus');
            expect(response.isSnoozed).toBe(false);
            expect(typeof response.remainingTime).toBe('number');
        });

        test('updateInterval — updates alarm interval', async () => {
            const response = await sendMessage('updateInterval', { interval: 5 });
            expect(response.success).toBe(true);
            expect(chrome.alarms.clear).toHaveBeenCalledWith('ticketCheck');
            expect(chrome.alarms.create).toHaveBeenCalledWith('ticketCheck', { periodInMinutes: 5 });
        });
    });

    // ─── resolveSoundUrl Handler ──────────────────────────────────────────────

    describe('resolveSoundUrl handler', () => {
        function sendMessage(action, data = {}) {
            return new Promise((resolve) => {
                const sendResponse = jest.fn((response) => {
                    resolve(response);
                });
                for (const listener of messageListeners) {
                    listener({ action, ...data }, {}, sendResponse);
                }
            });
        }

        test('rejects non-myinstants URLs', async () => {
            const response = await sendMessage('resolveSoundUrl', { myinstantsUrl: 'https://example.com/sound' });
            expect(response.success).toBe(false);
            expect(response.error).toContain('valid myinstants.com URL');
        });

        test('rejects empty URL', async () => {
            const response = await sendMessage('resolveSoundUrl', { myinstantsUrl: '' });
            expect(response.success).toBe(false);
        });

        test('fetches myinstants page and extracts MP3 URL', async () => {
            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                text: async () => '<a href="/media/sounds/my-sound_abc123.mp3">Download MP3</a>'
            });

            const response = await sendMessage('resolveSoundUrl', { myinstantsUrl: 'https://www.myinstants.com/en/instant/my-sound/' });
            expect(response.success).toBe(true);
            expect(response.mp3Url).toBe('https://www.myinstants.com/media/sounds/my-sound_abc123.mp3');
            expect(response.soundName).toBe('my-sound_abc123');
        });

        test('returns error when no MP3 link found on page', async () => {
            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                text: async () => '<html>No sound here</html>'
            });

            const response = await sendMessage('resolveSoundUrl', { myinstantsUrl: 'https://www.myinstants.com/en/instant/bad-sound/' });
            expect(response.success).toBe(false);
            expect(response.error).toContain('Could not find');
        });

        test('returns error on fetch failure', async () => {
            global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

            const response = await sendMessage('resolveSoundUrl', { myinstantsUrl: 'https://www.myinstants.com/en/instant/sound/' });
            expect(response.success).toBe(false);
        });

        test('returns error on HTTP error response', async () => {
            global.fetch = jest.fn().mockResolvedValue({
                ok: false,
                status: 404
            });

            const response = await sendMessage('resolveSoundUrl', { myinstantsUrl: 'https://www.myinstants.com/en/instant/missing/' });
            expect(response.success).toBe(false);
            expect(response.error).toContain('HTTP 404');
        });
    });

    // ─── playTestSound / createOffscreenForSound ──────────────────────────────

    describe('playTestSound handler', () => {
        function sendMessage(action, data = {}) {
            return new Promise((resolve) => {
                const sendResponse = jest.fn((response) => {
                    resolve(response);
                });
                for (const listener of messageListeners) {
                    listener({ action, ...data }, {}, sendResponse);
                }
            });
        }

        test('plays test sound via offscreen document', async () => {
            chrome.offscreen.hasDocument.mockResolvedValue(false);
            chrome.offscreen.createDocument.mockResolvedValue(undefined);

            const response = await sendMessage('playTestSound', { mp3Url: 'https://example.com/test.mp3' });

            expect(response.success).toBe(true);
            expect(chrome.offscreen.hasDocument).toHaveBeenCalled();
            expect(chrome.offscreen.createDocument).toHaveBeenCalled();
            expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
                expect.objectContaining({ play: expect.objectContaining({ type: 'mp3', url: 'https://example.com/test.mp3' }) })
            );
        });

        test('reuses existing offscreen document if already created', async () => {
            chrome.offscreen.hasDocument.mockResolvedValue(true);

            const response = await sendMessage('playTestSound', { mp3Url: 'https://example.com/test.mp3' });

            expect(response.success).toBe(true);
            expect(chrome.offscreen.hasDocument).toHaveBeenCalled();
            expect(chrome.offscreen.createDocument).not.toHaveBeenCalled();
        });
    });

    // ─── storage.onChanged Handler ────────────────────────────────────────────

    describe('storage.onChanged handler', () => {
        test('processes settings change event without crashing', () => {
            const changes = {
                settings: {
                    newValue: { debugMode: true }
                }
            };

            for (const listener of storageChangeListeners) {
                listener(changes, 'local');
            }

            expect(chrome.alarms.create).not.toHaveBeenCalled();
        });
    });
});
