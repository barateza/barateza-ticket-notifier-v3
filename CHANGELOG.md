# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
