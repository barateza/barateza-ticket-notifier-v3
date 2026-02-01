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
  }
  // Coverage thresholds disabled during development
  // Will re-enable once source files are instrumented in tests
  // Thresholds to implement (Phase 2+):
  // coverageThreshold: {
  //   global: { branches: 60, functions: 60, lines: 60, statements: 60 },
  //   './background.js': { branches: 70, functions: 75, lines: 80, statements: 80 },
  //   './popup.js': { branches: 60, functions: 70, lines: 75, statements: 75 },
  //   './offscreen.js': { branches: 80, functions: 90, lines: 90, statements: 90 }
  // }
};
