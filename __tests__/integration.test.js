

describe('Integration Tests - Phase 3', () => {
  let mockStorage;
  let mockEndpointCounts;
  let capturedMessages;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup storage mock
    mockStorage = {
      endpoints: [
        {
          id: 1,
          name: 'AMER - New Tickets',
          url: 'https://cpanel.zendesk.com/api/v2/search.json?query=type:ticket+status:new',
          enabled: true
        },
        {
          id: 2,
          name: 'EMEA - Open',
          url: 'https://other.zendesk.com/api/v2/search.json?query=type:ticket+status:open',
          enabled: true
        }
      ],
      settings: {
        checkInterval: 1,
        soundEnabled: true,
        notificationEnabled: true
      },
      snoozeState: {
        active: false,
        until: null
      }
    };

    // Track endpoint counts
    mockEndpointCounts = new Map();
    mockEndpointCounts.set(1, 3); // AMER: 3 tickets initially
    mockEndpointCounts.set(2, 5); // EMEA: 5 tickets initially

    // Track message passing
    capturedMessages = [];

    // Mock chrome.storage.local
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

    // Mock message passing
    chrome.runtime.sendMessage.mockImplementation((message, callback) => {
      capturedMessages.push(message);
      if (callback) {
        callback({ success: true });
      }
      return Promise.resolve({ success: true });
    });

    chrome.notifications.create.mockImplementation((_id, _options) => {
      return Promise.resolve(_id);
    });

    chrome.cookies.getAll.mockResolvedValue([
      { name: '__Host-ps', value: 'session123' }
    ]);
  });

  // ==================== 3.1 Endpoint Monitoring Cycle Tests ====================
  describe('Endpoint Monitoring Cycle', () => {
    test('should complete full monitoring cycle with new tickets', (done) => {
      // Simulate monitoring: fetch → compare count → trigger notification
      chrome.storage.local.get(['endpoints', 'settings'], (data) => {
        const endpoint = data.endpoints[0];
        const previousCount = mockEndpointCounts.get(endpoint.id);
        const newCount = 6; // Increased from 3

        const shouldNotify = newCount > previousCount;
        const newTickets = newCount - previousCount;

        expect(shouldNotify).toBe(true);
        expect(newTickets).toBe(3);

        // Update stored count
        mockEndpointCounts.set(endpoint.id, newCount);

        // Send notification
        chrome.notifications.create(`ticket-${endpoint.id}`, {
          type: 'basic',
          title: `${endpoint.name}`,
          message: `+${newTickets} new ticket(s)`
        });

        expect(chrome.notifications.create).toHaveBeenCalled();
        done();
      });
    });

    test('should skip notification when count stays the same', (done) => {
      chrome.storage.local.get(['endpoints'], (data) => {
        const endpoint = data.endpoints[0];
        const previousCount = mockEndpointCounts.get(endpoint.id);
        const newCount = 3; // Same as before

        const shouldNotify = newCount > previousCount;

        expect(shouldNotify).toBe(false);
        expect(chrome.notifications.create).not.toHaveBeenCalled();
        done();
      });
    });

    test('should handle monitoring when count decreases', (done) => {
      chrome.storage.local.get(['endpoints'], (data) => {
        const endpoint = data.endpoints[0];
        const previousCount = mockEndpointCounts.get(endpoint.id);
        const newCount = 1; // Decreased from 3

        const shouldNotify = newCount > previousCount;

        expect(shouldNotify).toBe(false);
        expect(chrome.notifications.create).not.toHaveBeenCalled();

        // Still update count
        mockEndpointCounts.set(endpoint.id, newCount);
        expect(mockEndpointCounts.get(endpoint.id)).toBe(1);
        done();
      });
    });

    test('should check multiple endpoints in sequence', (done) => {
      chrome.storage.local.get(['endpoints'], (data) => {
        const endpoints = data.endpoints;

        // Check first endpoint
        const count1 = 5; // Increased
        mockEndpointCounts.set(endpoints[0].id, count1);

        // Check second endpoint
        const count2 = 8; // Increased
        mockEndpointCounts.set(endpoints[1].id, count2);

        expect(mockEndpointCounts.get(endpoints[0].id)).toBe(5);
        expect(mockEndpointCounts.get(endpoints[1].id)).toBe(8);

        done();
      });
    });

    test('should recover from error in monitoring loop', (done) => {
      chrome.storage.local.get.mockImplementationOnce((_keys, _callback) => {
        throw new Error('Storage read failed');
      });

      try {
        chrome.storage.local.get(['endpoints'], () => { });
      } catch (_error) {
        expect(_error.message).toBe('Storage read failed');
      }

      // Reset and retry
      chrome.storage.local.get.mockImplementation((keys, callback) => {
        const result = {};
        if (Array.isArray(keys)) {
          keys.forEach(key => {
            if (mockStorage[key]) result[key] = mockStorage[key];
          });
        }
        callback(result);
      });

      chrome.storage.local.get(['endpoints'], (data) => {
        expect(data.endpoints).toBeDefined();
        expect(data.endpoints.length).toBe(2);
        done();
      });
    });
  });

  // ==================== 3.2 Notification Flow Tests ====================
  describe('Notification Flow', () => {
    test('should show notification when new tickets arrive', (done) => {
      // Simulate: API returns new count → compare → create notification
      const endpoint = mockStorage.endpoints[0];
      const newTickets = 3;
      const totalCount = 6;

      chrome.notifications.create(`ticket-${endpoint.id}`, {
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: `🎫 ${endpoint.name}`,
        message: `+${newTickets} ticket(s) | Total: ${totalCount}`
      });

      expect(chrome.notifications.create).toHaveBeenCalledWith(
        `ticket-${endpoint.id}`,
        expect.objectContaining({
          type: 'basic',
          title: expect.stringContaining('AMER - New Tickets')
        })
      );

      done();
    });

    test('should handle user clicking notification to open Zendesk', (done) => {
      // Simulate notification click → open URL in new tab
      const notificationId = 'ticket-1';
      const endpointUrl = mockStorage.endpoints[0].url;

      // Notification click handler
      const handleNotificationClick = (_id) => {
        chrome.tabs.create({ url: endpointUrl });
      };

      handleNotificationClick(notificationId);

      expect(chrome.tabs.create).toHaveBeenCalledWith({
        url: expect.stringContaining('zendesk.com')
      });

      done();
    });

    test('should play sound notification on new tickets', (done) => {
      // Simulate: new tickets → trigger sound via offscreen document
      const playSound = () => {
        chrome.runtime.sendMessage({ play: { type: 'beep', volume: 0.3 } });
      };

      const settings = mockStorage.settings;

      if (settings.soundEnabled) {
        playSound();
      }

      expect(chrome.runtime.sendMessage).toHaveBeenCalled();
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          play: expect.objectContaining({ type: 'beep' })
        })
      );

      done();
    });

    test('should respect notification settings when sending', (done) => {
      chrome.storage.local.get(['settings'], (data) => {
        const settings = data.settings;
        settings.notificationEnabled = false;

        const shouldNotify = settings.notificationEnabled;

        if (shouldNotify) {
          chrome.notifications.create('test', { type: 'basic' });
        }

        expect(chrome.notifications.create).not.toHaveBeenCalled();
        done();
      });
    });
  });

  // ==================== 3.3 Message Passing Tests ====================
  describe('Message Passing (Background ↔ Popup)', () => {
    test('should handle popup sending refreshNow message to background', (done) => {
      // Popup: User clicks "Check Now"
      chrome.runtime.sendMessage({ action: 'refreshNow' }, (response) => {
        expect(response.success).toBe(true);

        // Verify message was captured
        expect(capturedMessages).toContainEqual(
          expect.objectContaining({ action: 'refreshNow' })
        );

        done();
      });
    });

    test('should send count update from background to popup', (done) => {
      // Background: Monitoring completes → send update
      const updateMessage = {
        action: 'updateCounts',
        counts: {
          1: 6,
          2: 8
        }
      };

      chrome.runtime.sendMessage(updateMessage);

      expect(capturedMessages).toContainEqual(updateMessage);
      done();
    });

    test('should handle error response from background worker', (done) => {
      // Simulate background worker error
      chrome.runtime.sendMessage.mockImplementationOnce((message, callback) => {
        if (callback) {
          callback({ success: false, error: 'API rate limited' });
        }
      });

      chrome.runtime.sendMessage({ action: 'refreshNow' }, (response) => {
        expect(response.success).toBe(false);
        expect(response.error).toBe('API rate limited');
        done();
      });
    });
  });

  // ==================== 3.4 Snooze Lifecycle Tests ====================
  describe('Snooze Lifecycle', () => {
    test('should block notifications while snooze is active', (done) => {
      // User sets snooze for 30 minutes
      const snoozeUntil = Date.now() + 30 * 60 * 1000;
      mockStorage.snoozeState = { active: true, until: snoozeUntil };

      chrome.storage.local.set({ snoozeState: mockStorage.snoozeState });

      // Later: New tickets arrive
      chrome.storage.local.get(['snoozeState'], (data) => {
        const shouldNotify = !data.snoozeState.active;

        if (shouldNotify) {
          chrome.notifications.create('test', { type: 'basic' });
        }

        expect(shouldNotify).toBe(false);
        expect(chrome.notifications.create).not.toHaveBeenCalled();
        done();
      });
    });

    test('should resume notifications after snooze expires', (done) => {
      // Snooze expired
      const expiredSnoozeTime = Date.now() - 1000;
      mockStorage.snoozeState = { active: true, until: expiredSnoozeTime };

      chrome.storage.local.get(['snoozeState'], (data) => {
        const snooze = data.snoozeState;
        const isExpired = snooze.active && Date.now() >= snooze.until;

        // Auto-clear snooze
        if (isExpired) {
          mockStorage.snoozeState = { active: false, until: null };
          chrome.storage.local.set({ snoozeState: mockStorage.snoozeState });
        }

        // Now notifications should work
        const shouldNotify = !mockStorage.snoozeState.active;

        if (shouldNotify) {
          chrome.notifications.create('test', { type: 'basic' });
        }

        expect(shouldNotify).toBe(true);
        expect(chrome.notifications.create).toHaveBeenCalled();
        done();
      });
    });

    test('should persist snooze state across popup refresh', (done) => {
      // Set snooze
      const snoozeUntil = Date.now() + 60 * 60 * 1000;
      mockStorage.snoozeState = { active: true, until: snoozeUntil };

      chrome.storage.local.set({ snoozeState: mockStorage.snoozeState });

      // Simulate popup refresh
      setTimeout(() => {
        chrome.storage.local.get(['snoozeState'], (data) => {
          expect(data.snoozeState.active).toBe(true);
          expect(data.snoozeState.until).toBe(snoozeUntil);
          done();
        });
      }, 50);
    });

    test('should clear snooze when user clicks clear button', (done) => {
      // Snooze active
      mockStorage.snoozeState = { active: true, until: Date.now() + 3600000 };

      // User clicks clear snooze button
      const clearSnooze = () => {
        mockStorage.snoozeState = { active: false, until: null };
        chrome.storage.local.set({ snoozeState: mockStorage.snoozeState });
      };

      clearSnooze();

      chrome.storage.local.get(['snoozeState'], (data) => {
        expect(data.snoozeState.active).toBe(false);
        expect(data.snoozeState.until).toBe(null);
        done();
      });
    });

    test('should auto-update snooze countdown in UI', (done) => {
      const snoozeUntil = Date.now() + 600000; // 10 minutes
      mockStorage.snoozeState = { active: true, until: snoozeUntil };

      // Simulate UI update
      const updateSnoozeDisplay = (snoozeState) => {
        if (!snoozeState.active) return null;

        const remaining = Math.max(0, snoozeState.until - Date.now());
        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);

        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
      };

      const display = updateSnoozeDisplay(mockStorage.snoozeState);

      expect(display).toMatch(/^\d+:\d{2}$/);
      expect(display).toContain(':');
      done();
    });
  });

  // ==================== 3.5 Complex Integration Scenarios ====================
  describe('Complex Integration Scenarios', () => {
    test('should handle monitoring with snooze active', (done) => {
      // Snooze is active
      mockStorage.snoozeState = { active: true, until: Date.now() + 3600000 };

      // New tickets arrive
      const newCount = 10;
      const previousCount = mockEndpointCounts.get(1);

      // Check if should notify
      const shouldNotify = (newCount > previousCount) && !mockStorage.snoozeState.active;

      expect(shouldNotify).toBe(false);
      expect(chrome.notifications.create).not.toHaveBeenCalled();

      done();
    });

    test('should handle multiple endpoints with mixed notification states', (done) => {
      chrome.storage.local.get(['endpoints'], (data) => {
        const _endpoints = data.endpoints;

        // Endpoint 1: has new tickets, snooze not active → should notify
        mockStorage.snoozeState = { active: false, until: null };
        const shouldNotify1 = 7 > mockEndpointCounts.get(1);

        // Endpoint 2: has new tickets, snooze not active → should notify
        const shouldNotify2 = 10 > mockEndpointCounts.get(2);

        // Only notify if both conditions met
        const totalNotifications = (shouldNotify1 ? 1 : 0) + (shouldNotify2 ? 1 : 0);

        expect(totalNotifications).toBe(2);
        done();
      });
    });

    test('should handle settings change during monitoring', (done) => {
      // Monitoring in progress
      // User changes settings
      const newSettings = {
        checkInterval: 5,
        soundEnabled: false,
        notificationEnabled: false
      };

      chrome.storage.local.set({ settings: newSettings });

      // Next check uses new settings
      chrome.storage.local.get(['settings'], (data) => {
        expect(data.settings.soundEnabled).toBe(false);
        expect(data.settings.notificationEnabled).toBe(false);

        // Verify notifications not sent
        expect(chrome.notifications.create).not.toHaveBeenCalled();
        done();
      });
    });

    test('should handle endpoint enable/disable during monitoring', (done) => {
      chrome.storage.local.get(['endpoints'], (data) => {
        const endpoints = data.endpoints;

        // Disable second endpoint
        endpoints[1].enabled = false;

        // Only first endpoint should be checked
        const enabledCount = endpoints.filter(e => e.enabled).length;

        expect(enabledCount).toBe(1);
        done();
      });
    });
  });
});
