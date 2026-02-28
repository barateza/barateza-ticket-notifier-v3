module.exports = {
  testEnvironment: 'jsdom',
  collectCoverage: true,
  collectCoverageFrom: [
    'background.js',
    'popup.js',
    'offscreen.js',
    '!**/*.test.js',
    '!**/node_modules/**'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['html', 'text', 'text-summary', 'lcov', 'json-summary'],
  coveragePathIgnorePatterns: ['/node_modules/'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testMatch: ['**/__tests__/**/*.test.js'],
  transform: {
    '^.+\\.js$': 'babel-jest'
  },
  coverageThreshold: {
    global: {
      branches: 20,
      functions: 35,
      lines: 20,
      statements: 20
    },
    './background.js': { branches: 40, functions: 75, lines: 48, statements: 50 },
    './popup.js': { branches: 0, functions: 0, lines: 0, statements: 0 },
    './offscreen.js': { branches: 0, functions: 0, lines: 0, statements: 0 }
  }
};
