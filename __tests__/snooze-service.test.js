/**
 * snooze-service.test.js
 * Unit tests for utils/snooze-service.js in isolation.
 */

import * as snoozeService from '../utils/snooze-service.js';

describe('SnoozeService', () => {
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

        chrome.runtime.sendMessage.mockResolvedValue({ success: true });
    });

    afterEach(async () => {
        jest.clearAllMocks();
        delete chrome.runtime.lastError;
        await snoozeService.clearSnooze();
    });

    // ─── setSnooze ───────────────────────────────────────────────────────────────

    describe('setSnooze()', () => {
        test('sets a finite snooze and creates alarm', async () => {
            const result = await snoozeService.setSnooze(30);

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
            const result = await snoozeService.setSnooze(0);

            expect(result.success).toBe(true);
            expect(chrome.alarms.create).not.toHaveBeenCalledWith('snoozeEnd', expect.anything());
            expect(chrome.storage.local.set).toHaveBeenCalledWith(
                expect.objectContaining({ snoozeState: expect.objectContaining({ duration: 0 }) })
            );
        });
    });

    // ─── clearSnooze ─────────────────────────────────────────────────────────────

    describe('clearSnooze()', () => {
        test('removes snoozeState from storage and clears alarm', async () => {
            mockLocalStorage.snoozeState = { endTime: Date.now() + 3600000, duration: 60 };
            await snoozeService.clearSnooze();

            expect(chrome.storage.local.remove).toHaveBeenCalledWith('snoozeState');
            expect(chrome.alarms.clear).toHaveBeenCalledWith('snoozeEnd');
        });
    });

    // ─── isSnoozed ───────────────────────────────────────────────────────────────

    describe('isSnoozed()', () => {
        test('returns true when snooze is active and not expired', async () => {
            await snoozeService.setSnooze(60);

            const snoozed = await snoozeService.isSnoozed();

            expect(snoozed).toBe(true);
        });

        test('returns false when snooze has expired', async () => {
            mockLocalStorage.snoozeState = { endTime: Date.now() - 1000, duration: 1 };

            const snoozed = await snoozeService.isSnoozed();

            expect(snoozed).toBe(false);
        });

        test('returns false when no snooze state exists', async () => {
            const snoozed = await snoozeService.isSnoozed();

            expect(snoozed).toBe(false);
        });
    });

    // ─── getRemainingTime ────────────────────────────────────────────────────────

    describe('getRemainingTime()', () => {
        test('returns remaining minutes when snoozed', async () => {
            await snoozeService.setSnooze(30);

            const remaining = await snoozeService.getRemainingTime();

            expect(remaining).toBeGreaterThanOrEqual(29);
            expect(remaining).toBeLessThanOrEqual(31);
        });

        test('returns 0 when not snoozed', async () => {
            const remaining = await snoozeService.getRemainingTime();

            expect(remaining).toBe(0);
        });
    });

    // ─── handleStorageChange ─────────────────────────────────────────────────────

    describe('handleStorageChange()', () => {
        test('updates cache when snoozeState changes to indefinite', async () => {
            snoozeService.handleStorageChange(
                { snoozeState: { newValue: { endTime: -1 } } },
                'local'
            );

            expect(await snoozeService.isSnoozed()).toBe(true);
        });

        test('updates cache when snoozeState changes to a finite value', async () => {
            const future = Date.now() + 3600000;
            snoozeService.handleStorageChange(
                { snoozeState: { newValue: { endTime: future } } },
                'local'
            );

            expect(await snoozeService.isSnoozed()).toBe(true);
        });

        test('updates cache when snoozeState is removed', async () => {
            snoozeService.handleStorageChange(
                { snoozeState: { newValue: null } },
                'local'
            );

            expect(await snoozeService.isSnoozed()).toBe(false);
        });
    });
});
