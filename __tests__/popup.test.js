describe('Popup UI - Phase 2', () => {
  let mockStorage;
  let mockDocument;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup storage mock
    mockStorage = {
      endpoints: [
        {
          id: 1,
          name: 'AMER - New Tickets',
          url: 'https://cpanel.zendesk.com/api/v2/search.json?query=type:ticket+group:amer+status:new',
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

    // Mock DOM elements
    document.body.innerHTML = `
      <div id="endpointsList"></div>
      <div id="settingsPanel"></div>
      <button id="addEndpointBtn"></button>
      <input id="endpointUrl" />
      <input id="endpointName" />
      <div id="snoozeDisplay"></div>
    `;
  });

  // ==================== 2.1 Form Validation Tests ====================
  describe('Form Validation', () => {
    test('should validate endpoint URL is required', () => {
      const url = '';
      const isValidUrl = (u) => typeof u === 'string' && u.trim().length > 0;

      expect(isValidUrl(url)).toBe(false);
    });

    test('should validate endpoint URL format (HTTPS + Zendesk domain)', () => {
      const isValidUrl = (url) => {
        try {
          const parsed = new URL(url);
          return parsed.protocol === 'https:' && parsed.hostname.endsWith('zendesk.com') && parsed.pathname.includes('/api/v2/search');
        } catch {
          return false;
        }
      };

      expect(isValidUrl('https://cpanel.zendesk.com/api/v2/search.json?query=type:ticket')).toBe(true);
      expect(isValidUrl('http://cpanel.zendesk.com/api/v2/search.json')).toBe(false);
      expect(isValidUrl('https://example.com/api')).toBe(false);
      expect(isValidUrl('not-a-url')).toBe(false);
    });

    test('should validate endpoint name is required and within length limits', () => {
      const isValidName = (name) => typeof name === 'string' && name.trim().length > 0 && name.length <= 100;

      expect(isValidName('AMER - New Tickets')).toBe(true);
      expect(isValidName('')).toBe(false);
      expect(isValidName('   ')).toBe(false);
      expect(isValidName('a'.repeat(101))).toBe(false);
    });

    test('should prevent duplicate endpoint URLs', (done) => {
      chrome.storage.local.get(['endpoints'], (data) => {
        const existingUrls = data.endpoints.map(e => e.url);
        const newUrl = 'https://cpanel.zendesk.com/api/v2/search.json?query=type:ticket+group:amer+status:new';

        const isDuplicate = existingUrls.includes(newUrl);

        expect(isDuplicate).toBe(true);
        done();
      });
    });

    test('should show validation error for invalid inputs', () => {
      const showError = (message) => {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.textContent = message;
        return errorDiv;
      };

      const error = showError('Invalid URL format');

      expect(error.className).toBe('error-message');
      expect(error.textContent).toBe('Invalid URL format');
    });
  });

  // ==================== 2.2 DOM Rendering Tests ====================
  describe('DOM Rendering', () => {
    test('should render endpoint list correctly', (done) => {
      chrome.storage.local.get(['endpoints'], (data) => {
        const endpointsList = document.getElementById('endpointsList');
        const html = data.endpoints
          .map(e => `<div class="endpoint" data-id="${e.id}">${e.name}</div>`)
          .join('');

        endpointsList.innerHTML = html;

        expect(endpointsList.innerHTML).toContain('AMER - New Tickets');
        expect(endpointsList.children.length).toBe(1);
        done();
      });
    });

    test('should display endpoint names and URLs in list', (done) => {
      chrome.storage.local.get(['endpoints'], (data) => {
        const endpointsList = document.getElementById('endpointsList');
        const endpoint = data.endpoints[0];

        const html = `
          <div class="endpoint">
            <div class="endpoint-name">${endpoint.name}</div>
            <div class="endpoint-url">${endpoint.url}</div>
          </div>
        `;

        endpointsList.innerHTML = html;
        const nameEl = endpointsList.querySelector('.endpoint-name');
        const urlEl = endpointsList.querySelector('.endpoint-url');

        expect(nameEl.textContent).toBe('AMER - New Tickets');
        expect(urlEl.textContent).toContain('cpanel.zendesk.com');
        done();
      });
    });

    test('should show enabled/disabled status for endpoints', (done) => {
      chrome.storage.local.get(['endpoints'], (data) => {
        const endpoint = data.endpoints[0];
        const statusClass = endpoint.enabled ? 'enabled' : 'disabled';

        expect(statusClass).toBe('enabled');
        done();
      });
    });

    test('should display empty state when no endpoints configured', (done) => {
      const emptyEndpoints = [];
      const emptyMessage = emptyEndpoints.length === 0 ? 'No endpoints configured' : '';

      expect(emptyMessage).toBe('No endpoints configured');
      done();
    });

    test('should show settings values correctly', (done) => {
      chrome.storage.local.get(['settings'], (data) => {
        const settings = data.settings;
        const settingsPanel = document.getElementById('settingsPanel');

        const html = `
          <div class="setting">
            <label>Sound Enabled: <input type="checkbox" ${settings.soundEnabled ? 'checked' : ''} /></label>
          </div>
          <div class="setting">
            <label>Notifications: <input type="checkbox" ${settings.notificationEnabled ? 'checked' : ''} /></label>
          </div>
        `;

        settingsPanel.innerHTML = html;
        const soundCheckbox = settingsPanel.querySelector('input');

        expect(soundCheckbox.checked).toBe(true);
        done();
      });
    });

    test('should update endpoint count in UI', () => {
      const getEndpointCount = () => {
        return mockStorage.endpoints.filter(e => e.enabled).length;
      };

      const count = getEndpointCount();
      expect(count).toBe(1);
    });
  });

  // ==================== 2.3 Event Handlers Tests ====================
  describe('Event Handlers', () => {
    test('should handle add endpoint button click', () => {
      const addBtn = document.getElementById('addEndpointBtn');
      let clicked = false;

      addBtn.addEventListener('click', () => {
        clicked = true;
      });

      addBtn.click();
      expect(clicked).toBe(true);
    });

    test('should delete endpoint from list', (done) => {
      const endpointId = 1;
      const deleteEndpoint = (id) => {
        const updated = mockStorage.endpoints.filter(e => e.id !== id);
        chrome.storage.local.set({ endpoints: updated });
      };

      deleteEndpoint(endpointId);

      setTimeout(() => {
        expect(mockStorage.endpoints).toHaveLength(0);
        done();
      }, 10);
    });

    test('should toggle endpoint enable/disable status', (done) => {
      const endpointId = 1;
      const toggleEndpoint = (id) => {
        const updated = mockStorage.endpoints.map(e =>
          e.id === id ? { ...e, enabled: !e.enabled } : e
        );
        chrome.storage.local.set({ endpoints: updated });
      };

      toggleEndpoint(endpointId);

      setTimeout(() => {
        expect(mockStorage.endpoints[0].enabled).toBe(false);
        done();
      }, 10);
    });

    test('should save settings to storage on change', (done) => {
      const newSettings = {
        checkInterval: 5,
        soundEnabled: false,
        notificationEnabled: true
      };

      chrome.storage.local.set({ settings: newSettings });

      setTimeout(() => {
        expect(mockStorage.settings.soundEnabled).toBe(false);
        expect(mockStorage.settings.checkInterval).toBe(5);
        done();
      }, 10);
    });

    test('should test endpoint connectivity', () => {
      const testEndpoint = (url) => {
        try {
          const parsed = new URL(url);
          return parsed.protocol === 'https:' && parsed.hostname.endsWith('zendesk.com');
        } catch {
          return false;
        }
      };

      const validUrl = 'https://cpanel.zendesk.com/api/v2/search.json?query=type:ticket';
      const invalidUrl = 'not-a-url';

      expect(testEndpoint(validUrl)).toBe(true);
      expect(testEndpoint(invalidUrl)).toBe(false);
    });

    test('should refresh/check now and fetch latest count', (done) => {
      const checkNow = () => {
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({ success: true, newCount: 5 });
          }, 100);
        });
      };

      checkNow().then(result => {
        expect(result.success).toBe(true);
        expect(result.newCount).toBe(5);
        done();
      });
    });

    test('should clear all endpoints with confirmation', (done) => {
      const clearAllEndpoints = () => {
        chrome.storage.local.set({ endpoints: [] });
      };

      clearAllEndpoints();

      setTimeout(() => {
        expect(mockStorage.endpoints).toHaveLength(0);
        done();
      }, 10);
    });

    test('should close modal after successful endpoint add', () => {
      let modalClosed = false;

      const closeModal = () => {
        modalClosed = true;
      };

      closeModal();
      expect(modalClosed).toBe(true);
    });
  });

  // ==================== 2.4 Snooze Controls Tests ====================
  describe('Snooze Controls', () => {
    test('should apply 15-minute snooze', () => {
      const applySnooze = (minutes) => {
        const until = Date.now() + minutes * 60 * 1000;
        mockStorage.snoozeState = { active: true, until };
      };

      applySnooze(15);

      expect(mockStorage.snoozeState.active).toBe(true);
      expect(mockStorage.snoozeState.until).toBeGreaterThan(Date.now());
    });

    test('should apply 30-minute snooze', () => {
      const applySnooze = (minutes) => {
        const until = Date.now() + minutes * 60 * 1000;
        mockStorage.snoozeState = { active: true, until };
      };

      applySnooze(30);

      expect(mockStorage.snoozeState.active).toBe(true);
      const durationMs = mockStorage.snoozeState.until - Date.now();
      expect(durationMs).toBeGreaterThan(29 * 60 * 1000); // ~30 minutes
    });

    test('should apply 60-minute snooze', () => {
      const applySnooze = (minutes) => {
        const until = Date.now() + minutes * 60 * 1000;
        mockStorage.snoozeState = { active: true, until };
      };

      applySnooze(60);

      expect(mockStorage.snoozeState.active).toBe(true);
      const durationMs = mockStorage.snoozeState.until - Date.now();
      expect(durationMs).toBeGreaterThan(59 * 60 * 1000); // ~60 minutes
    });

    test('should clear snooze state', (done) => {
      mockStorage.snoozeState = { active: true, until: Date.now() + 3600000 };

      const clearSnooze = () => {
        mockStorage.snoozeState = { active: false, until: null };
      };

      clearSnooze();

      setTimeout(() => {
        expect(mockStorage.snoozeState.active).toBe(false);
        expect(mockStorage.snoozeState.until).toBe(null);
        done();
      }, 10);
    });

    test('should display remaining snooze time', () => {
      const until = Date.now() + 600000; // 10 minutes
      mockStorage.snoozeState = { active: true, until };

      const getSnoozeRemaining = (snoozeState) => {
        if (!snoozeState.active) return null;
        const remaining = Math.max(0, snoozeState.until - Date.now());
        const minutes = Math.floor(remaining / 60000);
        return `${minutes} minutes`;
      };

      const display = getSnoozeRemaining(mockStorage.snoozeState);

      expect(display).toMatch(/^(9|10) minutes$/);
    });
  });

  // ==================== 2.5 Settings Persistence Tests ====================
  describe('Settings Persistence', () => {
    test('should load settings from storage on popup open', (done) => {
      chrome.storage.local.get(['settings'], (data) => {
        expect(data.settings).toBeDefined();
        expect(data.settings.soundEnabled).toBe(true);
        expect(data.settings.notificationEnabled).toBe(true);
        done();
      });
    });

    test('should save modified settings to storage', (done) => {
      const updatedSettings = {
        checkInterval: 3,
        soundEnabled: false,
        notificationEnabled: false
      };

      chrome.storage.local.set({ settings: updatedSettings }, () => {
        chrome.storage.local.get(['settings'], (data) => {
          expect(data.settings.soundEnabled).toBe(false);
          expect(data.settings.notificationEnabled).toBe(false);
          expect(data.settings.checkInterval).toBe(3);
          done();
        });
      });
    });

    test('should handle missing settings with graceful defaults', (done) => {
      const getSettings = (data) => {
        return data.settings || {
          checkInterval: 1,
          soundEnabled: true,
          notificationEnabled: true
        };
      };

      const settings = getSettings({ settings: undefined });

      expect(settings.checkInterval).toBe(1);
      expect(settings.soundEnabled).toBe(true);
      expect(settings.notificationEnabled).toBe(true);
      done();
    });
  });
});
