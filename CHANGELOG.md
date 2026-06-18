# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.4.3] - 2026-06-18

### Fixed
- **Security M-1 (Data loss)**: Endpoint import now correctly merges with existing endpoints instead of replacing them. `prepareEndpointsForImport` was ignoring the `existingEndpoints` argument.
- **Security M-2 (Stale cookies)**: Cookie cache now has a 5-minute TTL to prevent using stale Zendesk session cookies after logout/re-login.
- **Security L-2 (Input validation)**: Added `maxlength="2048"` to endpoint URL textarea to prevent oversized inputs.
- **Security I-2 (Rate limit)**: GitHub update check now caches results in `chrome.storage.local` for 1 hour, avoiding unnecessary API calls.

### Changed
- Cookie cache timestamps tracked per-domain; `clearCache()` also clears timestamps.

## [3.4.2] - 2026-06-17

### Fixed
- **Security vulnerabilities in dev dependencies** (Dependabot #14, #24, #25):
  - `@babel/core` updated to 7.29.7 (fixes CVE-2026-49356, low severity — arbitrary file read via sourceMappingURL)
  - `@babel/plugin-transform-modules-systemjs` updated to 7.29.7 (fixes CVE-2026-44728, high severity — code injection when compiling malicious input)
  - `js-yaml` overridden to 4.2.0 (fixes CVE-2026-53550, medium severity — DoS via quadratic-complexity in merge key handling)

## [3.4.1] - 2026-06-10

### Added
- **CONTRIBUTING.md**: Full contribution guide with development setup, testing guidelines, commit conventions, and PR process.
- **PULL_REQUEST_TEMPLATE.md**: Standardized PR template with checklist for contributors.
- **.nvmrc**: Node version pinning (20) for consistent development environments.
- **pnpm-workspace.yaml**: Build approval configuration for pnpm.

### Changed
- **Package Manager**: Migrated from npm to pnpm (v11) for faster installs and stricter dependency management. Removed `package-lock.json`. Lockfile is now `pnpm-lock.yaml`.
- **CI/CD Workflows**: Updated `coverage.yml` and `release.yml` to use `pnpm install --frozen-lockfile` and `pnpm test` instead of npm.
- **TESTING.md**: Full rewrite reflecting current state (159 tests, 13 test files, per-module coverage table).
- **README.md**: Updated changelog (v3.4.1), expanded Contributing section with link to CONTRIBUTING.md, updated file structure to reflect `utils/` modules.
- **.github/copilot-instructions.md**: Synced download links and version references to v3.4.1, added Agent skills section.

### Fixed
- **Lint errors**: Removed unused import in `__tests__/background.test.js`, prefixed unused parameters in `__tests__/message-router.test.js`, removed dead code branch in `popup.js` (duplicate `remainingTime === 1` condition).

## [3.4.0] - 2026-06-08

### Changed
- **Architecture Decomposition**: Extracted 5 cohesive modules from `background.js` and `popup.js`, deepening the architecture and creating testable seams:
  - **SnoozeService** (`utils/snooze-service.js`): Encapsulated snooze state (cache, storage persistence, alarm wiring) behind a 4-method interface, reducing 7 scattered touch points in background.js to a single import.
  - **NotificationManager** (`utils/notification-manager.js`): Consolidated notification creation, sound playback, offscreen management, and URL mapping behind one `notify()` call.
  - **CookieService** (`utils/cookie-service.js`): Centralised Zendesk cookie retrieval with in-memory caching and deduplication, eliminating duplicate logic between background.js and popup.js.
  - **RateLimitService** (`utils/rate-limit-service.js`): Wrapped Retry-After parsing, backoff scheduling, and alarm management into a 3-method interface.
  - **MessageRouter** (`utils/message-router.js`): Replaced the 7-branch switch statement in background.js with a handler registry, making each message handler independently testable.

### Added
- 5 new test files (cookie-service, message-router, notification-manager, rate-limit-service, snooze-service) with 45 new unit tests.
- `docs/agents/` — Agent skills configuration for Matt Pocock's engineering skills (issue tracker, triage labels, domain doc layout).

### Changed
- `background.js` reduced from ~450 lines of inline logic to ~300 lines delegating to utility modules.
- `popup.js` now uses `cookieService.getCookies()` instead of duplicating cookie filter logic.

## [3.3.3] - 2026-06-26

### Fixed
- **"Unchecked runtime.lastError: No SW"**: Popup now uses a `sendToSW()` wrapper that properly checks and clears `chrome.runtime.lastError` when the service worker is terminated (normal Manifest V3 behavior).
- **"Cannot destructure property 'endpoints' of undefined"**: `getLocalState()` and `getSessionState()` in the background worker now return `{}` when storage callbacks fire with falsy data, preventing race-condition crashes on service worker startup.

### Changed
- All 7 `chrome.runtime.sendMessage` calls in popup.js now go through the central `sendToSW()` helper with null-guards for when the SW isn't reachable.

## [3.3.2] - 2026-04-15

### Added
- **429 Rate Limit Backoff**: Automatic exponential backoff when Zendesk API returns 429 (Too Many Requests), preventing request failures during rate limiting.
- **Offscreen Document Lock**: Improved offscreen document lifecycle management to prevent race conditions during audio playback.
- **Snooze Cache**: Persistent snooze state caching to maintain snooze status across service worker restarts.

### Changed
- **Test Stability**: Improved test reliability and reduced flaky test failures in background and popup unit tests.

## [3.3.1] - 2026-03-02

### Changed
- **Default Endpoint**: Updated default endpoint in configuration from 'New AMER Tickets' to 'My Tickets' for better out-of-the-box utility, automatically filtering for tickets assigned to the active user.

## [3.3.0] - 2026-02-28

### Added
- **Endpoint Import/Export**: Users can now export their endpoint configurations to a JSON file and import them back, allowing for easy backups and sharing. The import system intelligently merges new endpoints and skips duplicates.

### Changed
- **Endpoint Display**: Endpoint URLs are now fully displayed with text wrapping instead of being truncated at 60 characters, making it easier to see full query parameters at a glance.

## [3.2.3] - 2026-02-28

### Fixed
- **Update Link**: The update available notification is now properly clickable and opens a new tab.


## [3.2.2] - 2026-02-28

### Added
- **Automated Update Checker**: Proactively checks GitHub Releases for new extension versions and displays a notification banner in the popup footer.

### Fixed
- **CSS Syntax Error**: Fixed a missing closing brace in `popup.css` that affected the dark mode media query.

## [3.2.1] - 2026-02-27

### Fixed
- **Dark Mode Accessibility**: Fixed contrast ratios across all buttons and UI elements to meet WCAG AA standards.
- **Dark Mode Coverage**: Added missing dark mode styles for dropdowns, outline buttons, and modals.
- **Dynamic Version Footer**: Replaced hardcoded version number in popup with dynamic manifest version retrieval.
- **Offscreen Module Fix**: Resolved script loading errors in the offscreen document by enabling module script type.

## [3.2.0] - 2026-02-27

### Added
- **Async Snooze**: Persistent snooze functionality across service worker restarts.
- **Session Persistence**: Runtime state is now persisted to `chrome.storage.session` to handle service worker termination.
- **Logger Utility**: Centralized logging system with support for different log levels.
- **Debug Mode**: User-configurable toggle in setting UI for troubleshooting.
- **Privacy Policy**: Added `PRIVACY_POLICY.md` to comply with store requirements.
- **Packaging Script**: Automated release packaging script in `scripts/package.sh`.

### Changed
- Refactored background service worker to export APIs and handle messages more efficiently.
- Updated `manifest.json` to use module scripts for background workers.

### Security
- Improved CSP compliance by removing inline event handlers in `popup.html`.

## [3.1.2] - 2026-01-31
- Initial release with core monitoring features.
