require('@testing-library/jest-dom');

// Mock chrome APIs for all tests
global.chrome = {
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn(),
      clear: jest.fn()
    }
  },
  alarms: {
    create: jest.fn(),
    get: jest.fn(),
    clearAll: jest.fn()
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
    sendMessage: jest.fn()
  },
  tabs: {
    create: jest.fn(),
    query: jest.fn(),
    update: jest.fn()
  }
};
