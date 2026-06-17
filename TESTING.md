# Code Coverage & Testing Guide

## Overview

This document outlines the complete testing strategy and current status for the Zendesk Ticket Monitor Chrome Extension.

**Current Status**: ✅ **159 Tests Passing** across 13 test files

## Quick Start

### Prerequisites

- **Node.js** >= 18
- **pnpm** >= 11 (official package manager)

### Install & Run

```bash
pnpm install        # Install dependencies
pnpm test           # Run all tests
pnpm test:coverage  # Run with coverage report
pnpm test:watch     # Watch mode
pnpm test -- --verbose  # Verbose output
```

## Test Results Summary

### Current Status

```
Test Files:     13 passed, 13 total
Tests:          159 passed, 159 total
Time:           ~5.9 seconds
```

### Test Files Breakdown

| Test File | Tests | Focus Area |
|-----------|-------|------------|
| `__tests__/background.test.js` | 21 | Background service worker |
| `__tests__/background-unit.test.js` | 14 | Background unit tests |
| `__tests__/popup.test.js` | 27 | Popup UI state management |
| `__tests__/popup-unit.test.js` | 6 | Popup unit tests |
| `__tests__/integration.test.js` | 20 | Cross-module workflows |
| `__tests__/cookie-service.test.js` | 5 | Cookie retrieval |
| `__tests__/endpoint-io.test.js` | 17 | Import/export endpoints |
| `__tests__/message-router.test.js` | 8 | Message routing |
| `__tests__/notification-manager.test.js` | 13 | Notification lifecycle |
| `__tests__/rate-limit-service.test.js` | 7 | Rate limiting |
| `__tests__/snooze-service.test.js` | 14 | Snooze functionality |
| `__tests__/offscreen.test.js` | 3 | Audio playback |
| `__tests__/e2e/*.spec.mjs` | 4 | E2E (Playwright) |

### Coverage by Module

| Module | Statements | Branches | Functions | Lines |
|--------|:----------:|:--------:|:---------:|:-----:|
| **Overall** | **42.69%** | **45.41%** | **57.35%** | **42.41%** |
| `background.js` | 54.16% | 48.03% | 70% | 52.97% |
| `popup.js` | 10.02% | 7.64% | 14.28% | 10.24% |
| `offscreen.js` | 86.66% | 60% | 50% | 86.66% |
| `utils/cookie-service.js` | 100% | 100% | 100% | 100% |
| `utils/endpoint-io.js` | 100% | 93.75% | 100% | 100% |
| `utils/message-router.js` | 100% | 75% | 100% | 100% |
| `utils/notification-manager.js` | 78.72% | 80% | 84.61% | 77.77% |
| `utils/rate-limit-service.js` | 92.3% | 85% | 100% | 95.45% |
| `utils/snooze-service.js` | 75% | 65.3% | 90% | 76.78% |
| `utils/validators.js` | 71.42% | 76.47% | 80% | 71.42% |
| `utils/logger.js` | 50% | 25% | 60% | 50% |

## Test Categories

### Background Service Worker (35 tests)

- Cookie Authentication — Extract Zendesk auth cookies, handle missing cookies
- Endpoint Validation — URL format validation, prevent duplicates, name validation
- Count Comparison Logic — Detect increases, ignore same/decreasing counts, handle first check
- API Response Parsing — Extract count, handle invalid/null responses
- Snooze State Management — Block/allow notifications during snooze
- Storage Persistence — Read/persist endpoints and settings
- Endpoint Enable/Disable — Toggle state, skip disabled endpoints

### Popup UI State Management (33 tests)

- Form Validation — URL format, name validation, duplicate detection, error display
- DOM Rendering — Endpoint list rendering, empty state, enabled/disabled status
- Event Handlers — Add/delete/toggle endpoints, save settings, refresh
- Snooze Controls — Apply/clear snooze, display countdown
- Settings Persistence — Load/save settings, handle corrupted data

### Integration & Workflows (20 tests)

- Endpoint Monitoring Cycle — Complete cycle with new tickets, no changes, count decrease, multiple endpoints
- Notification Flow — Ticket arrival → notification, click → open Zendesk, sound plays
- Message Passing — Popup ↔ background communication, error handling
- Snooze Lifecycle — Set snooze blocks notifications, expiration resumes, persistence

### Utility Modules (71 tests)

- **Cookie Service** — Cookie caching, domain matching, error handling
- **Endpoint I/O** — Import/export JSON, duplicate detection, merge logic
- **Message Router** — Action registration, unknown action handling, error propagation
- **Notification Manager** — Sound playback, offscreen lifecycle, snooze gating
- **Rate Limit Service** — Retry-After parsing, backoff scheduling, alarm management
- **Snooze Service** — Set/clear snooze, persistence across SW restarts, countdown
- **Validators** — URL validation, name length, duplicate detection

## Chrome API Mocking

All tests use Jest mocks for Chrome APIs (configured in `jest.setup.js`):

```javascript
chrome.storage.local.{get, set, clear}
chrome.storage.session.{get, set}
chrome.alarms.{create, get, clear, clearAll}
chrome.notifications.{create, clear}
chrome.cookies.getAll
chrome.runtime.{onMessage, sendMessage, lastError}
chrome.tabs.{create, query, update}
chrome.offscreen.{hasDocument, createDocument}
chrome.action.{setBadgeText, setBadgeBackgroundColor}
```

## Running Specific Tests

```bash
# Run a specific test file
pnpm test __tests__/background.test.js

# Run tests matching a pattern
pnpm test -- --testNamePattern="snooze"

# Run with coverage
pnpm test:coverage

# Run E2E tests (requires auth setup first)
pnpm test:e2e:setup
pnpm test:e2e
```

## CI/CD Integration

Runs on every push/PR via **GitHub Actions** (`.github/workflows/coverage.yml`):

- Node.js 18.x and 20.x
- pnpm with frozen lockfile
- Generates HTML coverage report
- Uploads coverage as artifact (30-day retention)
- Posts coverage summary on PR comments

## Debugging Tests

```bash
# Debug with Node inspector
node --inspect-brk node_modules/.bin/jest --runInBand

# VS Code launch config
# .vscode/launch.json
{
  "type": "node",
  "request": "launch",
  "name": "Debug Jest",
  "program": "${workspaceFolder}/node_modules/.bin/jest",
  "args": ["--runInBand"],
  "console": "integratedTerminal"
}
```

## Resources

- [Jest Documentation](https://jestjs.io/)
- [Testing Library](https://testing-library.com/)
- [Chrome Extensions Testing](https://developer.chrome.com/docs/extensions/testing/)
- [Istanbul Coverage Tool](https://istanbul.js.org/)

---

**Last Updated**: June 2026
**Test Count**: 159 passing
**Package Manager**: pnpm
