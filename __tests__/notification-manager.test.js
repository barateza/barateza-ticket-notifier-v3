/**
 * notification-manager.test.js
 * Unit tests for utils/notification-manager.js in isolation.
 */

import * as notificationManager from '../utils/notification-manager.js';

describe('NotificationManager', () => {
    let mockLocalStorage;
    let mockSessionStorage;

    const endpointUrl = 'https://cpanel.zendesk.com/api/v2/search.json?query=type:ticket+assignee:me+status:open';

    beforeEach(() => {
        mockLocalStorage = {
            settings: {
                checkInterval: 1,
                soundEnabled: true,
                notificationEnabled: true,
                darkMode: false,
                debugMode: false
            },
            endpoints: []
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
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    const baseOpts = {
        endpointId: 1,
        endpointName: 'My Tickets',
        newTickets: 3,
        totalCount: 10,
        endpointUrl,
        settings: { soundEnabled: false, notificationEnabled: true }
    };

    describe('notify()', () => {
        test('creates notification when notifications are enabled and not snoozed', async () => {
            await notificationManager.notify(baseOpts);

            expect(chrome.notifications.create).toHaveBeenCalledWith(
                expect.stringContaining('ticket-notification-1'),
                expect.objectContaining({ type: 'basic', title: expect.stringContaining('My Tickets') })
            );
        });

        test('plays sound when soundEnabled is true and not snoozed', async () => {
            const opts = { ...baseOpts, settings: { soundEnabled: true, notificationEnabled: false } };

            await notificationManager.notify(opts);

            // Routes through createOffscreen — verify offscreen was checked
            expect(chrome.offscreen.hasDocument).toHaveBeenCalled();
        });

        test('skips notification when notificationEnabled is false', async () => {
            const opts = { ...baseOpts, settings: { soundEnabled: false, notificationEnabled: false } };

            await notificationManager.notify(opts);

            expect(chrome.notifications.create).not.toHaveBeenCalled();
        });
    });

    describe('playSound (via notify with soundEnabled)', () => {
        test('creates an offscreen document if none exists', async () => {
            chrome.offscreen.hasDocument.mockResolvedValue(false);

            await notificationManager.notify({
                ...baseOpts,
                settings: { soundEnabled: true, notificationEnabled: false }
            });

            expect(chrome.offscreen.createDocument).toHaveBeenCalledWith(
                expect.objectContaining({ url: 'offscreen.html' })
            );
        });

        test('skips creation when document already exists', async () => {
            chrome.offscreen.hasDocument.mockResolvedValue(true);

            await notificationManager.notify({
                ...baseOpts,
                settings: { soundEnabled: true, notificationEnabled: false }
            });

            expect(chrome.offscreen.createDocument).not.toHaveBeenCalled();
        });

        test('uses a single createDocument call during concurrent calls', async () => {
            chrome.offscreen.hasDocument.mockResolvedValue(false);

            await Promise.all([
                notificationManager.notify({
                    ...baseOpts,
                    settings: { soundEnabled: true, notificationEnabled: false }
                }),
                notificationManager.notify({
                    ...baseOpts,
                    settings: { soundEnabled: true, notificationEnabled: false }
                })
            ]);

            expect(chrome.offscreen.createDocument).toHaveBeenCalledTimes(1);
        });

        test('sends play message to offscreen document', async () => {
            await notificationManager.notify({
                ...baseOpts,
                settings: { soundEnabled: true, notificationEnabled: false }
            });

            expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
                expect.objectContaining({ play: expect.objectContaining({ type: 'beep' }) })
            );
        });

        test('handles errors gracefully', async () => {
            chrome.runtime.sendMessage.mockRejectedValue(new Error('mock error'));

            await expect(
                notificationManager.notify({
                    ...baseOpts,
                    settings: { soundEnabled: true, notificationEnabled: false }
                })
            ).resolves.not.toThrow();
        });
    });

    describe('init()', () => {
        test('registers the notification click handler', () => {
            notificationManager.init();

            expect(chrome.notifications.onClicked.addListener).toHaveBeenCalledWith(
                expect.any(Function)
            );
        });
    });
});
