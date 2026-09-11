// Poller multi-provider behavior tests (spec §7, §13):
// per-provider backoff isolation, jira Basic-auth fetch + missing credentials,
// 401 no-notify, count retention on error, monitor error state recording.

import { checkEndpoint } from '../utils/poller.js';
import * as rateLimitService from '../utils/rate-limit-service.js';

jest.mock('../utils/logger.js', () => ({
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    setDebugMode: jest.fn()
}));

const ZEN_MONITOR = {
    id: 1, name: 'Zendesk Queue', provider: 'zendesk', enabled: true,
    url: 'https://cpanel.zendesk.com/api/v2/search.json?query=type:ticket+status:new'
};
const JIRA_MONITOR = {
    id: 2, name: 'Jira Queue', provider: 'jira', enabled: true,
    url: 'https://myco.atlassian.net/issues/?jql=project%20%3D%20SUPPORT%20AND%20status%20%3D%20Open'
};
const SETTINGS = { soundEnabled: false, notificationEnabled: true };

function seedLocalStorage(data) {
    chrome.storage.local.get.mockImplementation((keys, callback) => {
        const result = {};
        const list = typeof keys === 'string' ? [keys] : keys;
        list.forEach(k => { if (data[k] !== undefined) result[k] = data[k]; });
        callback(result);
    });
}

function seedSessionStorage(data) {
    chrome.storage.session.get.mockImplementation((keys, callback) => {
        const result = {};
        const list = typeof keys === 'string' ? [keys] : keys;
        list.forEach(k => { if (data[k] !== undefined) result[k] = data[k]; });
        callback(result);
    });
    chrome.storage.session.set.mockImplementation((update, callback) => {
        Object.assign(data, update);
        if (callback) callback();
    });
}

function mockFetchOk(payload) {
    global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => payload
    });
}

describe('poller multi-provider', () => {
    let session;
    let local;

    beforeEach(() => {
        jest.clearAllMocks();
        rateLimitService.clear();
        session = {};
        local = { settings: SETTINGS };
        seedLocalStorage(local);
        seedSessionStorage(session);
        chrome.cookies.getAll.mockResolvedValue([
            { name: '_zendesk_shared_session', value: 'abc' }
        ]);
        chrome.notifications.create.mockResolvedValue('id');
        chrome.alarms.clear.mockResolvedValue(true);
        chrome.alarms.create.mockImplementation(() => {});
    });

    test('jira monitor: fetches the derived API URL with Basic auth, no cookies', async () => {
        local.jiraCredentials = {
            'myco.atlassian.net': { email: 'me@corp.com', token: 'tok' }
        };
        mockFetchOk({ count: 7, exact: true });

        await checkEndpoint(JIRA_MONITOR, SETTINGS);

        expect(global.fetch).toHaveBeenCalledTimes(1);
        const [url, opts] = global.fetch.mock.calls[0];
        expect(url).toBe('https://myco.atlassian.net/rest/api/3/search/approximate-count?jql=project%20%3D%20SUPPORT%20AND%20status%20%3D%20Open&includeArchived=false');
        expect(opts.headers.Authorization).toBe('Basic ' + btoa('me@corp.com:tok'));
        expect(opts.headers.Cookie).toBeUndefined();
        expect(chrome.cookies.getAll).not.toHaveBeenCalled();
    });

    test('jira monitor without credentials: no fetch, missingCredentials error recorded, no notification', async () => {
        mockFetchOk({ count: 7 });
        await checkEndpoint(JIRA_MONITOR, SETTINGS);

        expect(global.fetch).not.toHaveBeenCalled();
        expect(chrome.notifications.create).not.toHaveBeenCalled();
        expect(session.monitorErrors).toEqual(
            expect.arrayContaining([[2, expect.objectContaining({ type: 'missingCredentials' })]])
        );
    });

    test('jira monitor 401: auth error recorded, no notification, last-known count retained', async () => {
        local.jiraCredentials = { 'myco.atlassian.net': { email: 'me@corp.com', token: 'bad' } };
        session.endpointCounts = [[2, 5]]; // last known count
        global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401, headers: new Headers() });

        await checkEndpoint(JIRA_MONITOR, SETTINGS);

        expect(chrome.notifications.create).not.toHaveBeenCalled();
        expect(session.monitorErrors).toEqual(
            expect.arrayContaining([[2, expect.objectContaining({ type: 'auth' })]])
        );
        // last-known count retained, not zeroed
        expect(session.endpointCounts).toEqual([[2, 5]]);
    });

    test('jira 429 records per-provider limit; zendesk polling unaffected', async () => {
        local.jiraCredentials = { 'myco.atlassian.net': { email: 'e', token: 't' } };
        global.fetch = jest.fn().mockResolvedValue({
            ok: false, status: 429, headers: new Headers({ 'Retry-After': '60' })
        });

        await checkEndpoint(JIRA_MONITOR, SETTINGS);

        expect(rateLimitService.isLimited('jira')).toBe(true);
        expect(rateLimitService.isLimited('zendesk')).toBe(false);
    });

    test('rate-limited provider is skipped before fetching', async () => {
        rateLimitService.record('jira', '60');
        local.jiraCredentials = { 'myco.atlassian.net': { email: 'e', token: 't' } };
        global.fetch = jest.fn();

        await checkEndpoint(JIRA_MONITOR, SETTINGS);

        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('successful poll clears the monitor error state', async () => {
        session.monitorErrors = [[2, { type: 'network', message: 'x', at: 1 }]];
        local.jiraCredentials = { 'myco.atlassian.net': { email: 'e', token: 't' } };
        mockFetchOk({ count: 3 });

        await checkEndpoint(JIRA_MONITOR, SETTINGS);

        expect(session.monitorErrors).toEqual([]);
    });

    test('zendesk monitor still uses cookies and data.count', async () => {
        mockFetchOk({ count: 4, results: [] });

        await checkEndpoint(ZEN_MONITOR, SETTINGS);

        const [url, opts] = global.fetch.mock.calls[0];
        expect(url).toBe(ZEN_MONITOR.url);
        expect(opts.headers.Cookie).toContain('_zendesk_shared_session=abc');
        expect(opts.headers.Authorization).toBeUndefined();
        // first poll seeds the baseline — no notification
        expect(chrome.notifications.create).not.toHaveBeenCalled();
        expect(session.endpointCounts).toEqual([[1, 4]]);
    });

    test('zendesk count increase fires a notification with provider label', async () => {
        session.endpointCounts = [[1, 4]];
        mockFetchOk({ count: 6, results: [] });

        await checkEndpoint(ZEN_MONITOR, SETTINGS);

        expect(chrome.notifications.create).toHaveBeenCalledWith(
            expect.stringContaining('ticket-notification-1'),
            expect.objectContaining({ title: 'New Zendesk Tickets: Zendesk Queue' })
        );
        expect(session.endpointCounts).toEqual([[1, 6]]);
    });
});
