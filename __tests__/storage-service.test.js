/**
 * storage-service.test.js
 * Unit tests for utils/storage-service.js in isolation.
 */

import * as storageService from '../utils/storage-service.js';
import Logger from '../utils/logger.js';

jest.mock('../utils/logger.js', () => ({
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    setDebugMode: jest.fn()
}));

describe('StorageService', () => {
    let mockLocalStorage;
    let mockSessionStorage;

    beforeEach(() => {
        jest.clearAllMocks();

        mockLocalStorage = {};
        mockSessionStorage = {};

        chrome.storage.session.get.mockImplementation((keys, callback) => {
            const result = {};
            if (typeof keys === 'string') {
                if (mockSessionStorage[keys] !== undefined) result[keys] = mockSessionStorage[keys];
            } else if (Array.isArray(keys)) {
                keys.forEach(k => { if (mockSessionStorage[k] !== undefined) result[k] = mockSessionStorage[k]; });
            }
            callback(result);
        });

        chrome.storage.session.set.mockImplementation((data, callback) => {
            Object.assign(mockSessionStorage, data);
            if (callback) callback();
        });

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

        chrome.storage.local.remove.mockImplementation((keys, callback) => {
            if (typeof keys === 'string') keys = [keys];
            keys.forEach(k => { delete mockLocalStorage[k]; });
            if (callback) callback();
        });
    });

    // ─── getSession ─────────────────────────────────────────────────────

    describe('getSession()', () => {
        test('reads existing keys from session storage', async () => {
            mockSessionStorage = { foo: 'bar', num: 42 };

            const result = await storageService.getSession(['foo', 'num']);
            expect(result).toEqual({ foo: 'bar', num: 42 });
        });

        test('returns empty object for missing keys', async () => {
            mockSessionStorage = {};

            const result = await storageService.getSession(['nonexistent']);
            expect(result).toEqual({});
        });

        test('handles chrome.runtime.lastError gracefully', async () => {
            chrome.storage.session.get.mockImplementationOnce((_keys, callback) => {
                chrome.runtime.lastError = { message: 'Storage read failed' };
                callback({});
                chrome.runtime.lastError = null;
            });

            const result = await storageService.getSession(['key']);
            expect(result).toEqual({});
            expect(Logger.error).toHaveBeenCalledWith(
                'Error reading session storage:',
                'Storage read failed'
            );
        });

        test('handles thrown exceptions gracefully', async () => {
            chrome.storage.session.get.mockImplementationOnce(() => {
                throw new Error('Unexpected crash');
            });

            const result = await storageService.getSession(['key']);
            expect(result).toEqual({});
            expect(Logger.error).toHaveBeenCalledWith(
                'Error reading session storage:',
                expect.any(Error)
            );
        });

        test('accepts a single string key', async () => {
            mockSessionStorage = { singleKey: 'value' };

            const result = await storageService.getSession('singleKey');
            expect(result).toEqual({ singleKey: 'value' });
        });
    });

    // ─── setSession ─────────────────────────────────────────────────────

    describe('setSession()', () => {
        test('writes data to session storage', async () => {
            await storageService.setSession({ foo: 'bar' });
            expect(mockSessionStorage.foo).toBe('bar');
        });

        test('resolves successfully on write', async () => {
            await expect(storageService.setSession({ key: 'val' })).resolves.toBeUndefined();
        });

        test('rejects on chrome.runtime.lastError', async () => {
            chrome.storage.session.set.mockImplementationOnce((_data, callback) => {
                chrome.runtime.lastError = { message: 'QUOTA_BYTES exceeded' };
                callback();
                chrome.runtime.lastError = null;
            });

            await expect(storageService.setSession({ big: 'data' })).rejects.toThrow('QUOTA_BYTES exceeded');
            expect(Logger.error).toHaveBeenCalledWith(expect.stringContaining('QUOTA_BYTES'));
        });

        test('rejects on thrown exception', async () => {
            chrome.storage.session.set.mockImplementationOnce(() => {
                throw new Error('Unexpected crash');
            });

            await expect(storageService.setSession({ key: 'val' })).rejects.toThrow('Unexpected crash');
            expect(Logger.error).toHaveBeenCalled();
        });
    });

    // ─── getLocal ───────────────────────────────────────────────────────

    describe('getLocal()', () => {
        test('reads existing keys from local storage', async () => {
            mockLocalStorage = { settings: { interval: 5 } };

            const result = await storageService.getLocal(['settings']);
            expect(result).toEqual({ settings: { interval: 5 } });
        });

        test('returns empty object for missing keys', async () => {
            const result = await storageService.getLocal(['missing']);
            expect(result).toEqual({});
        });

        test('handles chrome.runtime.lastError gracefully', async () => {
            chrome.storage.local.get.mockImplementationOnce((_keys, callback) => {
                chrome.runtime.lastError = { message: 'Local storage error' };
                callback({});
                chrome.runtime.lastError = null;
            });

            const result = await storageService.getLocal(['key']);
            expect(result).toEqual({});
            expect(Logger.error).toHaveBeenCalledWith(
                'Error reading local storage:',
                'Local storage error'
            );
        });

        test('handles thrown exceptions gracefully', async () => {
            chrome.storage.local.get.mockImplementationOnce(() => {
                throw new Error('Crash');
            });

            const result = await storageService.getLocal(['key']);
            expect(result).toEqual({});
            expect(Logger.error).toHaveBeenCalled();
        });
    });

    // ─── setLocal ───────────────────────────────────────────────────────

    describe('setLocal()', () => {
        test('writes data to local storage', async () => {
            await storageService.setLocal({ settings: { interval: 10 } });
            expect(mockLocalStorage.settings).toEqual({ interval: 10 });
        });

        test('resolves successfully on write', async () => {
            await expect(storageService.setLocal({ key: 'val' })).resolves.toBeUndefined();
        });

        test('rejects on chrome.runtime.lastError', async () => {
            chrome.storage.local.set.mockImplementationOnce((_data, callback) => {
                chrome.runtime.lastError = { message: 'Write failed' };
                callback();
                chrome.runtime.lastError = null;
            });

            await expect(storageService.setLocal({ key: 'val' })).rejects.toThrow('Write failed');
            expect(Logger.error).toHaveBeenCalled();
        });

        test('rejects on thrown exception', async () => {
            chrome.storage.local.set.mockImplementationOnce(() => {
                throw new Error('Crash');
            });

            await expect(storageService.setLocal({ key: 'val' })).rejects.toThrow('Crash');
            expect(Logger.error).toHaveBeenCalled();
        });
    });

    // ─── getMonitors / saveMonitors (multi-provider) ────────────────────

    describe('getMonitors()', () => {
        test('returns monitors when the monitors key exists', async () => {
            mockLocalStorage = {
                monitors: [
                    { id: 1, name: 'A', url: 'https://a.zendesk.com/api/v2/search.json?query=q', enabled: true, provider: 'zendesk' },
                    { id: 2, name: 'B', url: 'https://x.atlassian.net/issues/?jql=q', enabled: false, provider: 'jira' }
                ]
            };

            const result = await storageService.getMonitors();
            expect(result).toHaveLength(2);
            expect(result[0].provider).toBe('zendesk');
            expect(result[1].provider).toBe('jira');
        });

        test('migrates legacy endpoints key with provider defaulting to zendesk', async () => {
            mockLocalStorage = {
                endpoints: [
                    { id: 1, name: 'Legacy', url: 'https://a.zendesk.com/api/v2/search.json?query=q', enabled: true }
                ]
            };

            const result = await storageService.getMonitors();
            expect(result).toHaveLength(1);
            expect(result[0].provider).toBe('zendesk');
            expect(result[0].name).toBe('Legacy');
            // Migration persisted: monitors written, endpoints removed
            expect(mockLocalStorage.monitors).toHaveLength(1);
            expect(mockLocalStorage.endpoints).toBeUndefined();
        });

        test('sanitises invalid provider values back to zendesk', async () => {
            mockLocalStorage = {
                monitors: [
                    { id: 1, name: 'A', url: 'https://a.zendesk.com/api/v2/search.json?query=q', enabled: true, provider: 'nope' }
                ]
            };

            const result = await storageService.getMonitors();
            expect(result[0].provider).toBe('zendesk');
        });

        test('returns empty array when neither key exists', async () => {
            const result = await storageService.getMonitors();
            expect(result).toEqual([]);
        });
    });

    describe('saveMonitors()', () => {
        test('writes the monitors key', async () => {
            const monitors = [{ id: 1, name: 'A', url: 'https://a.zendesk.com/api/v2/search.json?query=q', enabled: true, provider: 'zendesk' }];
            await storageService.saveMonitors(monitors);
            expect(mockLocalStorage.monitors).toEqual(monitors);
        });
    });

    describe('removeLocal()', () => {
        test('removes the given keys from local storage', async () => {
            mockLocalStorage = { endpoints: [1, 2], settings: { a: 1 } };
            await storageService.removeLocal(['endpoints']);
            expect(mockLocalStorage.endpoints).toBeUndefined();
            expect(mockLocalStorage.settings).toEqual({ a: 1 });
        });
    });
});
