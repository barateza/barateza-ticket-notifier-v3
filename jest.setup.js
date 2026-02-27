require('@testing-library/jest-dom');

// Mock chrome APIs for all tests
global.chrome = {
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn(),
      clear: jest.fn(),
      remove: jest.fn()
    },
    onChanged: {
      addListener: jest.fn()
    }
  },
  alarms: {
    create: jest.fn(),
    get: jest.fn(),
    clearAll: jest.fn(),
    clear: jest.fn(),
    onAlarm: {
      addListener: jest.fn()
    }
  },
  notifications: {
    create: jest.fn(),
    clear: jest.fn(),
    onClicked: {
      addListener: jest.fn()
    }
  },
  cookies: {
    getAll: jest.fn()
  },
  runtime: {
    onMessage: {
      addListener: jest.fn()
    },
    sendMessage: jest.fn(),
    onInstalled: {
      addListener: jest.fn()
    }
  },
  tabs: {
    create: jest.fn(),
    query: jest.fn(),
    update: jest.fn()
  },
  action: {
    setBadgeText: jest.fn(),
    setBadgeBackgroundColor: jest.fn()
  },
  offscreen: {
    hasDocument: jest.fn(),
    createDocument: jest.fn()
  }
};
