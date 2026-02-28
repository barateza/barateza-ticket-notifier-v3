/**
 * background-unit.test.js
 * Focuses on exported functions in background.js to boost statement/branch/function coverage.
 */

import * as Background from '../background.js';

describe('Background – Unit Tests', () => {
    let mockLocalStorage;
    let mockSessionStorage;

    beforeEach(() => {
        jest.clearAllMocks();

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
                    name: 'AMER Tickets',
                    url: 'https://cpanel.zendesk.com/api/v2/search.json?query=type:ticket+status:new',
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
    });

    // ─── Snooze Functions ───────────────────────────────────────────────────────

    describe('setSnooze()', () => {
        test('sets a finite snooze and creates alarm', async () => {
            const result = await Background.setSnooze(30);

            expect(result.success).toBe(true);
            expect(result.endTime).toBeGreaterThan(Date.now());
            expect(chrome.storage.local.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    snoozeState: expect.objectContaining({ duration: 30 })
                })
            );
            expect(chrome.alarms.create).toHaveBeenCalledWith('snoozeEnd', expect.objectContaining({ delayInMinutes: 30 }));
        });

        test('sets an indefinite snooze (duration = 0) without alarm', async () => {
            const result = await Background.setSnooze(0);

            expect(result.success).toBe(true);
            // No alarm for indefinite snooze
            expect(chrome.alarms.create).not.toHaveBeenCalledWith('snoozeEnd', expect.anything());
            expect(chrome.storage.local.set).toHaveBeenCalledWith(
                expect.objectContaining({ snoozeState: expect.objectContaining({ duration: 0 }) })
            );
        });

        test('updates badge after setting snooze', async () => {
            // Simulate an active snooze for the badge update path
            mockLocalStorage.snoozeState = { endTime: Date.now() + 3600000, duration: 60 };

            await Background.setSnooze(60);

            expect(chrome.action.setBadgeText).toHaveBeenCalled();
        });
    });

    describe('clearSnooze()', () => {
        test('removes snoozeState from storage and clears alarm', async () => {
            mockLocalStorage.snoozeState = { endTime: Date.now() + 3600000, duration: 60 };

            const result = await Background.clearSnooze();

            expect(result.success).toBe(true);
            expect(chrome.storage.local.remove).toHaveBeenCalledWith('snoozeState');
            expect(chrome.alarms.clear).toHaveBeenCalledWith('snoozeEnd');
        });
    });

    describe('isSnoozed()', () => {
        test('returns true when snooze is active and not expired', async () => {
            mockLocalStorage.snoozeState = { endTime: Date.now() + 3600000, duration: 60 };

            const snoozed = await Background.isSnoozed();

            expect(snoozed).toBe(true);
        });

        test('returns false when snooze has expired', async () => {
            mockLocalStorage.snoozeState = { endTime: Date.now() - 1000, duration: 1 };

            const snoozed = await Background.isSnoozed();

            expect(snoozed).toBe(false);
        });

        test('returns false when no snooze state exists', async () => {
            const snoozed = await Background.isSnoozed();

            expect(snoozed).toBe(false);
        });
    });

    describe('getRemainingSnoozeTime()', () => {
        test('returns remaining minutes when snoozed', async () => {
            mockLocalStorage.snoozeState = { endTime: Date.now() + 30 * 60 * 1000, duration: 30 };

            const remaining = await Background.getRemainingSnoozeTime();

            expect(remaining).toBeGreaterThanOrEqual(29);
            expect(remaining).toBeLessThanOrEqual(31);
        });

        test('returns 0 when not snoozed', async () => {
            const remaining = await Background.getRemainingSnoozeTime();

            expect(remaining).toBe(0);
        });
    });

    // ─── Badge ──────────────────────────────────────────────────────────────────

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
            mockLocalStorage.snoozeState = { endTime: Date.now() + 3600000, duration: 60 };
            mockSessionStorage.endpointCounts = [[1, 3]];

            await Background.updateBadge();

            expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '⏰' });
            expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#F39C12' });
        });
    });

    // ─── notifyNewTickets ────────────────────────────────────────────────────────

    describe('notifyNewTickets()', () => {
        const endpoint = {
            id: 1,
            name: 'AMER Tickets',
            url: 'https://cpanel.zendesk.com/api/v2/search.json?query=type:ticket+status:new'
        };

        test('creates notification when notifications are enabled and not snoozed', async () => {
            const settings = { soundEnabled: false, notificationEnabled: true };

            await Background.notifyNewTickets('AMER Tickets', 3, 10, settings, endpoint);

            expect(chrome.notifications.create).toHaveBeenCalledWith(
                expect.stringContaining('ticket-notification-1'),
                expect.objectContaining({ type: 'basic', title: expect.stringContaining('AMER Tickets') })
            );
        });

        test('plays sound when soundEnabled is true and not snoozed', async () => {
            const settings = { soundEnabled: true, notificationEnabled: false };

            await Background.notifyNewTickets('AMER Tickets', 2, 7, settings, endpoint);

            // playNotificationSound() routes through createOffscreen() — verify it was invoked
            expect(chrome.offscreen.hasDocument).toHaveBeenCalled();
        });

        test('skips notification and sound when snoozed', async () => {
            mockLocalStorage.snoozeState = { endTime: Date.now() + 3600000, duration: 60 };
            const settings = { soundEnabled: true, notificationEnabled: true };

            await Background.notifyNewTickets('AMER Tickets', 5, 15, settings, endpoint);

            expect(chrome.notifications.create).not.toHaveBeenCalled();
            expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
        });

        test('skips notification when notificationEnabled is false', async () => {
            const settings = { soundEnabled: false, notificationEnabled: false };

            await Background.notifyNewTickets('AMER Tickets', 1, 6, settings, endpoint);

            expect(chrome.notifications.create).not.toHaveBeenCalled();
        });
    });

    // ─── Offscreen / Sound ───────────────────────────────────────────────────────

    describe('createOffscreen()', () => {
        test('creates an offscreen document if none exists', async () => {
            chrome.offscreen.hasDocument.mockResolvedValue(false);

            await Background.createOffscreen();

            expect(chrome.offscreen.createDocument).toHaveBeenCalledWith(
                expect.objectContaining({ url: 'offscreen.html' })
            );
        });

        test('skips creation when document already exists', async () => {
            chrome.offscreen.hasDocument.mockResolvedValue(true);

            await Background.createOffscreen();

            expect(chrome.offscreen.createDocument).not.toHaveBeenCalled();
        });
    });

    describe('playNotificationSound()', () => {
        test('calls createOffscreen and sends play message', async () => {
            await Background.playNotificationSound();

            expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
                expect.objectContaining({ play: expect.objectContaining({ type: 'beep' }) })
            );
        });

        test('handles errors gracefully', async () => {
            chrome.offscreen.hasDocument.mockRejectedValue(new Error('Offscreen API unavailable'));

            // Should not throw
            await expect(Background.playNotificationSound()).resolves.not.toThrow();
        });
    });

    // ─── checkAllEndpoints ───────────────────────────────────────────────────────

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
