/**
 * settings.test.js
 * Unit tests for utils/settings.js — the module that owns the settings object:
 * its defaults, its migration, and every read/write of storage.
 *
 * The pure half (DEFAULTS / migrate / needsMigration) needs no storage at all,
 * which is the point of the module: the shapes the service worker and the popup
 * must agree on are testable without faking chrome.
 */

import { DEFAULTS, migrate, needsMigration, load, patch } from '../utils/settings.js';

jest.mock('../utils/logger.js', () => ({
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    setDebugMode: jest.fn()
}));

describe('Settings', () => {
    let mockLocalStorage;

    beforeEach(() => {
        jest.clearAllMocks();
        mockLocalStorage = {};

        chrome.storage.local.get.mockImplementation((keys, callback) => {
            const result = {};
            if (typeof keys === 'string') {
                if (mockLocalStorage[keys] !== undefined) result[keys] = mockLocalStorage[keys];
            } else if (Array.isArray(keys)) {
                keys.forEach(k => { if (mockLocalStorage[k] !== undefined) result[k] = mockLocalStorage[k]; });
            }
            callback(result);
        });

        chrome.storage.local.set.mockImplementation((data, callback) => {
            Object.assign(mockLocalStorage, data);
            if (callback) callback();
        });
    });

    // ─── DEFAULTS ─────────────────────────────────────────────────────────────

    describe('DEFAULTS', () => {
        test('exposes the documented baseline settings', () => {
            expect(DEFAULTS).toEqual({
                checkInterval: 1,
                soundEnabled: true,
                notificationEnabled: true,
                darkMode: false,
                debugMode: false,
                customSoundEnabled: false,
                customSoundUrl: '',
                customSoundMp3: ''
            });
        });

        test('is frozen so callers cannot mutate the shared baseline', () => {
            expect(Object.isFrozen(DEFAULTS)).toBe(true);
            expect(() => { DEFAULTS.darkMode = true; }).toThrow();
            expect(DEFAULTS.darkMode).toBe(false);
        });
    });

    // ─── migrate ──────────────────────────────────────────────────────────────

    describe('migrate()', () => {
        test('returns DEFAULTS for null / undefined storage', () => {
            expect(migrate(null)).toEqual(DEFAULTS);
            expect(migrate(undefined)).toEqual(DEFAULTS);
        });

        test('returns DEFAULTS for non-object stored values', () => {
            expect(migrate('nonsense')).toEqual(DEFAULTS);
            expect(migrate(42)).toEqual(DEFAULTS);
            expect(migrate([1, 2, 3])).toEqual(DEFAULTS);
        });

        test('fills every missing key with its default', () => {
            const migrated = migrate({ checkInterval: 3, soundEnabled: true, notificationEnabled: true });

            expect(migrated.darkMode).toBe(false);
            expect(migrated.debugMode).toBe(false);
            expect(migrated.customSoundEnabled).toBe(false);
            expect(migrated.customSoundUrl).toBe('');
            expect(migrated.customSoundMp3).toBe('');
        });

        test('preserves stored values, including falsy ones', () => {
            const migrated = migrate({
                checkInterval: 5,
                soundEnabled: false,
                notificationEnabled: false,
                darkMode: true,
                customSoundMp3: 'https://example.com/a.mp3'
            });

            expect(migrated.checkInterval).toBe(5);
            expect(migrated.soundEnabled).toBe(false);
            expect(migrated.notificationEnabled).toBe(false);
            expect(migrated.darkMode).toBe(true);
            expect(migrated.customSoundMp3).toBe('https://example.com/a.mp3');
        });

        test('carries unknown keys through, so other versions round-trip', () => {
            expect(migrate({ checkInterval: 2, futureSetting: 'kept' }).futureSetting).toBe('kept');
        });

        test('does not mutate the object it was given', () => {
            const stored = { checkInterval: 4 };
            migrate(stored);

            expect(stored).toEqual({ checkInterval: 4 });
        });
    });

    // ─── needsMigration ───────────────────────────────────────────────────────

    describe('needsMigration()', () => {
        test('is true when nothing is stored', () => {
            expect(needsMigration(null)).toBe(true);
            expect(needsMigration(undefined)).toBe(true);
            expect(needsMigration('junk')).toBe(true);
        });

        test('is true when any key is missing', () => {
            expect(needsMigration({ checkInterval: 5, soundEnabled: false, notificationEnabled: false })).toBe(true);
        });

        test('is false for a complete settings object, whatever the values', () => {
            expect(needsMigration({ ...DEFAULTS })).toBe(false);
            expect(needsMigration({ ...DEFAULTS, checkInterval: 15, debugMode: true })).toBe(false);
            expect(needsMigration({ ...DEFAULTS, extra: 'unknown' })).toBe(false);
        });
    });

    // ─── load ─────────────────────────────────────────────────────────────────

    describe('load()', () => {
        test('returns DEFAULTS when storage is empty', async () => {
            await expect(load()).resolves.toEqual(DEFAULTS);
        });

        test('returns stored settings completed against DEFAULTS', async () => {
            mockLocalStorage.settings = { checkInterval: 7, darkMode: true };

            const settings = await load();

            expect(settings.checkInterval).toBe(7);
            expect(settings.darkMode).toBe(true);
            expect(settings.soundEnabled).toBe(true);       // filled from DEFAULTS
            expect(settings.customSoundMp3).toBe('');       // filled from DEFAULTS
        });

        test('resolves to DEFAULTS when the read fails', async () => {
            chrome.storage.local.get.mockImplementation((keys, callback) => {
                chrome.runtime.lastError = { message: 'QUOTA_BYTES quota exceeded' };
                callback({});
            });

            const settings = await load();
            chrome.runtime.lastError = undefined;

            expect(settings).toEqual(DEFAULTS);
        });
    });

    // ─── patch ────────────────────────────────────────────────────────────────

    describe('patch()', () => {
        test('writes a complete settings object, not just the changed fields', async () => {
            await patch({ debugMode: true });

            expect(Object.keys(mockLocalStorage.settings).sort()).toEqual(Object.keys(DEFAULTS).sort());
            expect(mockLocalStorage.settings.debugMode).toBe(true);
            expect(mockLocalStorage.settings.checkInterval).toBe(1);
        });

        test('merges into existing settings without dropping untouched fields', async () => {
            mockLocalStorage.settings = { ...DEFAULTS, checkInterval: 9, darkMode: true };

            await patch({ soundEnabled: false });

            expect(mockLocalStorage.settings.checkInterval).toBe(9);
            expect(mockLocalStorage.settings.darkMode).toBe(true);
            expect(mockLocalStorage.settings.soundEnabled).toBe(false);
        });

        test('returns the complete settings object after the merge', async () => {
            const result = await patch({ notificationEnabled: false });

            expect(result).toEqual({ ...DEFAULTS, notificationEnabled: false });
        });

        test('preserves customSoundMp3 when the sound page URL is unchanged', async () => {
            mockLocalStorage.settings = {
                ...DEFAULTS,
                customSoundUrl: 'https://www.myinstants.com/en/instant/ding/',
                customSoundMp3: 'https://www.myinstants.com/media/sounds/ding.mp3'
            };

            await patch({
                customSoundUrl: 'https://www.myinstants.com/en/instant/ding/',
                soundEnabled: false
            });

            expect(mockLocalStorage.settings.customSoundMp3)
                .toBe('https://www.myinstants.com/media/sounds/ding.mp3');
        });

        test('invalidates customSoundMp3 when the sound page URL changes', async () => {
            mockLocalStorage.settings = {
                ...DEFAULTS,
                customSoundUrl: 'https://www.myinstants.com/en/instant/ding/',
                customSoundMp3: 'https://www.myinstants.com/media/sounds/ding.mp3'
            };

            await patch({ customSoundUrl: 'https://www.myinstants.com/en/instant/dong/' });

            expect(mockLocalStorage.settings.customSoundMp3).toBe('');
        });

        test('keeps a newly resolved MP3 passed alongside a new URL (the Fetch flow)', async () => {
            mockLocalStorage.settings = {
                ...DEFAULTS,
                customSoundUrl: 'https://www.myinstants.com/en/instant/ding/',
                customSoundMp3: 'https://www.myinstants.com/media/sounds/ding.mp3'
            };

            await patch({
                customSoundUrl: 'https://www.myinstants.com/en/instant/dong/',
                customSoundMp3: 'https://www.myinstants.com/media/sounds/dong.mp3'
            });

            expect(mockLocalStorage.settings.customSoundMp3)
                .toBe('https://www.myinstants.com/media/sounds/dong.mp3');
        });

        test('leaves customSoundMp3 alone when the patch does not mention the URL', async () => {
            mockLocalStorage.settings = { ...DEFAULTS, customSoundMp3: 'https://example.com/a.mp3' };

            await patch({ checkInterval: 5 });

            expect(mockLocalStorage.settings.customSoundMp3).toBe('https://example.com/a.mp3');
        });

        test('rejects when the write fails', async () => {
            chrome.storage.local.set.mockImplementation((data, callback) => {
                chrome.runtime.lastError = { message: 'QUOTA_BYTES quota exceeded' };
                callback();
            });

            await expect(patch({ checkInterval: 2 })).rejects.toThrow('QUOTA_BYTES quota exceeded');
            chrome.runtime.lastError = undefined;
        });
    });
});
