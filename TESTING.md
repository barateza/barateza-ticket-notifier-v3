# Code Coverage & Testing Guide

## Overview

This project uses **Jest** for unit testing and **Istanbul/nyc** for code coverage reporting. All tests run in a Node.js environment with mocked Chrome APIs.

## Quick Start

### Install Dependencies
```bash
npm install
```

### Run Tests
```bash
# Run all tests
npm test

# Run tests in watch mode (auto-rerun on file changes)
npm run test:watch

# Generate coverage report
npm run coverage:report
```

## Test Results Summary

### Initial Test Suite Status
- **Test Files**: 1 (`__tests__/background.test.js`)
- **Total Tests**: 21
- **Passing**: 21 ✓
- **Failing**: 0
- **Duration**: ~1.2 seconds

### Test Coverage by Module

#### Phase 1: `background.js` - Background Service Worker (21 tests)

**Cookie Authentication (3 tests)**
- ✓ Extract Zendesk auth cookies for a given domain
- ✓ Return empty string when no auth cookies found
- ✓ Handle cookie retrieval errors gracefully

**Endpoint Validation (3 tests)**
- ✓ Validate endpoint URL format (must be HTTPS Zendesk domain)
- ✓ Prevent duplicate endpoints
- ✓ Validate endpoint name is not empty (1-100 characters)

**Count Comparison Logic (4 tests)**
- ✓ Detect when ticket count increases
- ✓ Not notify when count stays the same
- ✓ Not notify when count decreases
- ✓ Handle missing previous count (first check)

**API Response Parsing (3 tests)**
- ✓ Extract count from valid Zendesk API response
- ✓ Handle invalid API response gracefully
- ✓ Handle null/undefined response

**Snooze State Management (3 tests)**
- ✓ Block notifications when snooze is active
- ✓ Allow notifications when snooze has expired
- ✓ Clear snooze when time is reached

**Storage Persistence (3 tests)**
- ✓ Read endpoints from storage
- ✓ Read settings from storage
- ✓ Persist updated endpoint data

**Endpoint Enable/Disable (2 tests)**
- ✓ Toggle endpoint enabled state
- ✓ Not check disabled endpoints

## Coverage Reports

### HTML Report
Interactive coverage report available at:
```
coverage/index.html
```

Open in browser to see:
- Overall coverage metrics
- Per-file coverage breakdown
- Line-by-line coverage highlighting
- Uncovered branches and functions

### Text Summary
Run `npm test` to see console output with coverage table.

### LCOV Report
For CI/CD integration and external tools:
```
coverage/lcov.info
```

## Coverage Thresholds

Current thresholds are set per-file to track progress toward comprehensive coverage:

| File | Statements | Branches | Functions | Lines |
|------|-----------|----------|-----------|-------|
| `background.js` | 80% | 70% | 75% | 80% |
| `popup.js` | 75% | 60% | 70% | 75% |
| `offscreen.js` | 90% | 80% | 90% | 90% |
| **Global** | 60% | 60% | 60% | 60% |

**Note**: Currently, source files are not being instrumented. This is expected during the planning phase. Once source code is imported into tests, coverage will be measured.

## Testing Strategy

### Phase 1: Business Logic (background.js) ✓ IN PROGRESS
Critical functions for endpoint monitoring:
- Cookie extraction & authentication
- Endpoint validation (URL format, duplicates, naming)
- Count comparison logic
- API response parsing
- Snooze state management
- Storage persistence

**Target Coverage**: 80%+
**Current Tests**: 21
**Status**: All tests passing

### Phase 2: UI State Management (popup.js) - PLANNED
Popup interface and user interactions:
- Form validation (endpoint creation)
- Settings persistence
- Endpoint list rendering
- Snooze controls
- Toast notifications

### Phase 3: Integration Tests - PLANNED
Full workflows:
- Endpoint monitoring cycle
- Notification flow
- Message passing between background & popup
- Snooze lifecycle with timer updates

### Phase 4: E2E Testing (Optional) - PLANNED
Real Chrome extension testing using Playwright

## Chrome API Mocking

All tests use Jest mocks for Chrome APIs to avoid runtime dependencies:

```javascript
// jest.setup.js provides mocks for:
chrome.storage.local.{get, set, clear}
chrome.alarms.{create, get, clearAll}
chrome.notifications.{create, clear}
chrome.cookies.getAll
chrome.runtime.{onMessage, sendMessage}
chrome.tabs.{create, query, update}
```

## CI/CD Integration

### GitHub Actions Workflow
Automatic testing on every push and pull request:

**File**: `.github/workflows/coverage.yml`

**Features**:
- Runs on Node.js 18.x and 20.x
- Generates HTML coverage report
- Uploads coverage as artifact (30-day retention)
- Posts coverage summary on PR comments
- Fails if coverage thresholds not met

**Artifact Location**: 
Navigate to GitHub Actions → Coverage workflow → Artifacts

## Running Specific Tests

```bash
# Run only a specific test file
npm test __tests__/background.test.js

# Run tests matching a pattern
npm test -- --testNamePattern="snooze"

# Run with additional options
npm test -- --verbose --no-cache
```

## Debugging Tests

```bash
# Run in debug mode with Node inspector
node --inspect-brk node_modules/.bin/jest --runInBand

# Or use VS Code debugger with launch config:
# .vscode/launch.json
{
  "type": "node",
  "request": "launch",
  "name": "Debug Jest",
  "program": "${workspaceFolder}/node_modules/.bin/jest",
  "args": ["--runInBand"],
  "console": "integratedTerminal",
  "internalConsoleOptions": "neverOpen"
}
```

## Common Issues

### Coverage Not Showing for Source Files
**Cause**: Source files not imported into test files
**Solution**: Tests currently focus on business logic patterns; actual instrumentation will occur as tests evolve

### Tests Timeout
**Fix**: Increase timeout in jest.config.js:
```javascript
testTimeout: 10000 // ms
```

### Mock Not Working
**Check**:
1. Verify mock is set up in `jest.setup.js`
2. Ensure `setupFilesAfterEnv` configured in `jest.config.js`
3. Call `jest.clearAllMocks()` in test `beforeEach`

## Next Steps

1. **Add popup.js tests** (Phase 2)
   - Form validation
   - DOM rendering with testing-library
   - Event listener integration

2. **Add integration tests** (Phase 3)
   - End-to-end notification flows
   - Message passing between service worker and popup
   - Snooze lifecycle verification

3. **Set up E2E testing** (Phase 4 - Optional)
   - Use Playwright for real Chrome extension testing
   - Test actual Zendesk API integration (with sandbox/demo environment)

4. **Monitor coverage trends**
   - Review coverage reports in GitHub Actions artifacts
   - Adjust thresholds as needed
   - Track coverage improvements over time

## Resources

- [Jest Documentation](https://jestjs.io/)
- [Testing Library](https://testing-library.com/)
- [Chrome Extensions Testing](https://developer.chrome.com/docs/extensions/testing/)
- [Istanbul Coverage Tool](https://istanbul.js.org/)

---

**Last Updated**: January 31, 2026
**Coverage Status**: Initial test suite complete, awaiting Phase 2
