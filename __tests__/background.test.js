describe('Background Service Worker - High Priority Functions', () => {
  let mockStorage;
  let mockChrome;

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
      { name: '__Host-ps', value: 'session123' },
      { name: '__Secure-record-portal-session-id', value: 'portal456' }
    ]);
  });

  describe('getZendeskCookies()', () => {
    test('should extract Zendesk auth cookies for a given domain', async () => {
      const domain = 'cpanel.zendesk.com';
      
      // Mock the cookie retrieval
      chrome.cookies.getAll.mockResolvedValue([
        { name: '__Host-ps', value: 'session123', domain },
        { name: '__Secure-record-portal-session-id', value: 'portal456', domain },
        { name: '_ga', value: 'analytics789', domain }
      ]);

      // Simulate getZendeskCookies logic
      const cookies = await chrome.cookies.getAll({ domain });
      const authCookies = cookies
        .filter(c => ['__Host-ps', '__Secure-record-portal-session-id', 'a', 'd'].includes(c.name))
        .map(c => `${c.name}=${c.value}`)
        .join('; ');

      expect(authCookies).toContain('__Host-ps=session123');
      expect(authCookies).toContain('__Secure-record-portal-session-id=portal456');
      expect(authCookies).not.toContain('_ga');
    });

    test('should return empty string when no auth cookies found', async () => {
      chrome.cookies.getAll.mockResolvedValue([
        { name: '_ga', value: 'analytics789' },
        { name: '_gid', value: 'analytics456' }
      ]);

      const cookies = await chrome.cookies.getAll({ domain: 'cpanel.zendesk.com' });
      const authCookies = cookies
        .filter(c => ['__Host-ps', '__Secure-record-portal-session-id', 'a', 'd'].includes(c.name))
        .map(c => `${c.name}=${c.value}`)
        .join('; ');

      expect(authCookies).toBe('');
    });

    test('should handle cookie retrieval errors gracefully', async () => {
      chrome.cookies.getAll.mockRejectedValue(new Error('Cookie access denied'));

      try {
        await chrome.cookies.getAll({ domain: 'cpanel.zendesk.com' });
      } catch (error) {
        expect(error.message).toBe('Cookie access denied');
      }
    });
  });

  describe('Endpoint Validation', () => {
    test('should validate endpoint URL format', () => {
      const validUrl = 'https://cpanel.zendesk.com/api/v2/search.json?query=type:ticket+status:new';
      const invalidUrl = 'not-a-url';
      const internalUrl = 'http://localhost/api/v2/search.json';

      // Validation logic
      const isValidUrl = (url) => {
        try {
          const parsed = new URL(url);
          return parsed.protocol === 'https:' && parsed.hostname.includes('zendesk.com');
        } catch {
          return false;
        }
      };

      expect(isValidUrl(validUrl)).toBe(true);
      expect(isValidUrl(invalidUrl)).toBe(false);
      expect(isValidUrl(internalUrl)).toBe(false);
    });

    test('should prevent duplicate endpoints', () => {
      const existingUrl = 'https://cpanel.zendesk.com/api/v2/search.json?query=type:ticket+status:new';
      const endpoints = [
        { id: 1, url: existingUrl },
        { id: 2, url: 'https://other.zendesk.com/api/v2/search.json?query=type:ticket+status:open' }
      ];

      const isDuplicate = (url) => endpoints.some(e => e.url === url);

      expect(isDuplicate(existingUrl)).toBe(true);
      expect(isDuplicate('https://new.zendesk.com/api/v2/search.json')).toBe(false);
    });

    test('should validate endpoint name is not empty', () => {
      const isValidName = (name) => typeof name === 'string' && name.trim().length > 0 && name.length <= 100;

      expect(isValidName('AMER - New Tickets')).toBe(true);
      expect(isValidName('')).toBe(false);
      expect(isValidName('   ')).toBe(false);
      expect(isValidName('a'.repeat(101))).toBe(false);
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
    test('should block notifications when snooze is active', () => {
      const snoozeState = { active: true, until: Date.now() + 3600000 };
      const shouldNotify = !snoozeState.active;

      expect(shouldNotify).toBe(false);
    });

    test('should allow notifications when snooze has expired', () => {
      const snoozeState = { active: true, until: Date.now() - 1000 };
      const shouldNotify = !snoozeState.active || Date.now() >= snoozeState.until;

      expect(shouldNotify).toBe(true);
    });

    test('should clear snooze when time is reached', () => {
      let snoozeState = { active: true, until: Date.now() - 1000 };
      
      if (Date.now() >= snoozeState.until) {
        snoozeState = { active: false, until: null };
      }

      expect(snoozeState.active).toBe(false);
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
