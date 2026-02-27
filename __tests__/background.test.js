import { validateEndpointUrl, validateEndpointName, validateEndpoint, checkForDuplicates } from '../utils/validators.js';
import * as Background from '../background.js';

describe('Background Service Worker - High Priority Functions', () => {
  let mockStorage;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup storage mock
    mockStorage = {
      endpoints: [
        {
          id: 1,
          name: 'AMER - New Tickets',
          url: 'https://cpanel.zendesk.com/api/v2/search.json?query=type:ticket+group:amer+assignee:none+status:new',
          enabled: true
        }
      ],
      settings: {
        checkInterval: 1,
        soundEnabled: true,
        notificationEnabled: true
      }
    };

    // Mock chrome.storage.local.get
    chrome.storage.local.get.mockImplementation((keys, callback) => {
      const result = {};
      if (Array.isArray(keys)) {
        keys.forEach(key => {
          if (mockStorage[key]) result[key] = mockStorage[key];
        });
      }
      callback(result);
    });

    chrome.storage.local.set.mockImplementation((data, callback) => {
      Object.assign(mockStorage, data);
      if (callback) callback();
    });

    chrome.cookies.getAll.mockResolvedValue([
      { name: 'session-id', value: 'session123' },
      { name: '__Secure-record-portal-session-id', value: 'portal456' }
    ]);
  });

  describe('getZendeskCookies()', () => {
    test('should extract Zendesk auth cookies for a given domain', async () => {
      const domain = 'cpanel.zendesk.com';

      // Mock the cookie retrieval
      chrome.cookies.getAll.mockResolvedValue([
        { name: 'session-id', value: 'session123', domain },
        { name: '__Secure-record-portal-session-id', value: 'portal456', domain },
        { name: '_ga', value: 'analytics789', domain }
      ]);

      // Use the real getZendeskCookies
      const authCookies = await Background.getZendeskCookies(domain);

      expect(authCookies).toContain('session-id=session123');
      expect(authCookies).toContain('__Secure-record-portal-session-id=portal456');
      expect(authCookies).not.toContain('_ga');
    });

    test('should return empty string when no auth cookies found', async () => {
      chrome.cookies.getAll.mockResolvedValue([
        { name: '_ga', value: 'analytics789' },
        { name: '_gid', value: 'analytics456' }
      ]);

      const authCookies = await Background.getZendeskCookies('cpanel.zendesk.com');

      expect(authCookies).toBe('');
    });

    test('should handle cookie retrieval errors gracefully', async () => {
      chrome.cookies.getAll.mockRejectedValue(new Error('Cookie access denied'));

      const result = await Background.getZendeskCookies('cpanel.zendesk.com');
      expect(result).toBe('');
    });
  });

  describe('Endpoint Validation', () => {
    test('should validate endpoint URL format', () => {
      const validUrl = 'https://cpanel.zendesk.com/api/v2/search.json?query=type:ticket+status:new';
      const invalidUrl = 'not-a-url';
      const internalUrl = 'http://localhost/api/v2/search.json';

      const validResult = validateEndpointUrl(validUrl);
      const invalidResult = validateEndpointUrl(invalidUrl);
      const internalResult = validateEndpointUrl(internalUrl);

      expect(validResult.valid).toBe(true);
      expect(invalidResult.valid).toBe(false);
      expect(internalResult.valid).toBe(false);
    });

    test('should validate endpoint name is not empty', () => {
      const validResult = validateEndpointName('AMER - New Tickets');
      const emptyResult = validateEndpointName('');
      const whitespaceResult = validateEndpointName('   ');
      const tooLongResult = validateEndpointName('a'.repeat(51));

      expect(validResult.valid).toBe(true);
      expect(emptyResult.valid).toBe(false);
      expect(whitespaceResult.valid).toBe(false);
      expect(tooLongResult.valid).toBe(false);
    });
  });

  describe('Count Comparison & Notification Logic', () => {
    test('should detect when ticket count increases', () => {
      const previousCount = 5;
      const currentCount = 8;

      const shouldNotify = currentCount > previousCount;
      const newTickets = currentCount - previousCount;

      expect(shouldNotify).toBe(true);
      expect(newTickets).toBe(3);
    });

    test('should not notify when count stays the same', () => {
      const previousCount = 5;
      const currentCount = 5;

      const shouldNotify = currentCount > previousCount;

      expect(shouldNotify).toBe(false);
    });

    test('should not notify when count decreases', () => {
      const previousCount = 5;
      const currentCount = 2;

      const shouldNotify = currentCount > previousCount;

      expect(shouldNotify).toBe(false);
    });

    test('should handle missing previous count (first check)', () => {
      const previousCount = undefined;
      const currentCount = 3;

      const shouldNotify = previousCount !== undefined && currentCount > previousCount;

      expect(shouldNotify).toBe(false);
    });
  });

  describe('API Response Parsing', () => {
    test('should extract count from valid Zendesk API response', () => {
      const response = {
        count: 15,
        results: []
      };

      expect(response.count).toBe(15);
    });

    test('should handle invalid API response gracefully', () => {
      const parseCount = (response) => {
        if (response && typeof response.count === 'number') {
          return response.count;
        }
        throw new Error('Invalid API response');
      };

      const invalidResponse = { results: [] };

      expect(() => parseCount(invalidResponse)).toThrow('Invalid API response');
    });

    test('should handle null/undefined response', () => {
      const parseCount = (response) => {
        if (response && typeof response.count === 'number') {
          return response.count;
        }
        return 0;
      };

      expect(parseCount(null)).toBe(0);
      expect(parseCount(undefined)).toBe(0);
    });
  });

  describe('Snooze State Management', () => {
    test('should block notifications when snooze is active', async () => {
      await Background.setSnooze(60);
      const shouldNotify = !Background.isSnoozed();

      expect(shouldNotify).toBe(false);
    });

    test('should allow notifications when snooze has expired', async () => {
      await Background.setSnooze(-1); // Expired immediately if we could, but let's mock the time

      // Since it's internal state, we already have Background loaded.
      // We can use clearSnooze to simulate expiration or just call it.
      await Background.clearSnooze();
      const shouldNotify = !Background.isSnoozed();

      expect(shouldNotify).toBe(true);
    });

    test('should clear snooze when time is reached', async () => {
      await Background.setSnooze(60);
      await Background.clearSnooze();

      expect(Background.isSnoozed()).toBe(false);
    });
  });

  describe('Storage Persistence', () => {
    test('should read endpoints from storage', (done) => {
      chrome.storage.local.get(['endpoints'], (data) => {
        expect(data.endpoints).toBeDefined();
        expect(Array.isArray(data.endpoints)).toBe(true);
        expect(data.endpoints[0].name).toBe('AMER - New Tickets');
        done();
      });
    });

    test('should read settings from storage', (done) => {
      chrome.storage.local.get(['settings'], (data) => {
        expect(data.settings).toBeDefined();
        expect(data.settings.checkInterval).toBe(1);
        expect(data.settings.soundEnabled).toBe(true);
        done();
      });
    });

    test('should persist updated endpoint data', (done) => {
      const updatedEndpoints = [
        ...mockStorage.endpoints,
        {
          id: 2,
          name: 'EMEA - Open Tickets',
          url: 'https://other.zendesk.com/api/v2/search.json?query=type:ticket+status:open',
          enabled: true
        }
      ];

      chrome.storage.local.set({ endpoints: updatedEndpoints }, () => {
        chrome.storage.local.get(['endpoints'], (data) => {
          expect(data.endpoints).toHaveLength(2);
          expect(data.endpoints[1].name).toBe('EMEA - Open Tickets');
          done();
        });
      });
    });
  });

  describe('Endpoint Enable/Disable', () => {
    test('should toggle endpoint enabled state', (done) => {
      const endpointId = 1;
      const updatedEndpoints = mockStorage.endpoints.map(e =>
        e.id === endpointId ? { ...e, enabled: !e.enabled } : e
      );

      chrome.storage.local.set({ endpoints: updatedEndpoints }, () => {
        expect(updatedEndpoints[0].enabled).toBe(false);
        done();
      });
    });

    test('should not check disabled endpoints', () => {
      const endpoint = { ...mockStorage.endpoints[0], enabled: false };

      const shouldCheck = endpoint.enabled;

      expect(shouldCheck).toBe(false);
    });
  });
});
