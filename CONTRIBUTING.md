# Contributing to Zendesk Ticket Monitor

First off, thanks for taking the time to contribute! 🎉

This document outlines the workflow and conventions for contributing. Following these guidelines helps maintainers and contributors communicate effectively.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Architecture](#project-architecture)
- [Making Changes](#making-changes)
- [Testing](#testing)
- [Linting](#linting)
- [Pull Request Process](#pull-request-process)
- [Commit Conventions](#commit-conventions)
- [Issue Labels](#issue-labels)
- [Release Process](#release-process)

## Code of Conduct

This project adheres to a [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold it.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/barateza/barateza-ticket-notifier-v3.git`
3. Create a branch: `git checkout -b feature/my-feature`

## Development Setup

### Prerequisites

- **Node.js** >= 18 (see `.nvmrc` — recomenda-se usar `nvm use`)
- **pnpm** >= 11 (gerenciador de pacotes oficial do projeto)

### Install dependencies

```bash
pnpm install
```

> ⚠️ O projeto usa **pnpm** como gerenciador de pacotes. Não use `npm install`. Ambos os lockfiles (`package-lock.json` e `pnpm-lock.yaml`) existiram por um período de transição, mas apenas `pnpm-lock.yaml` é mantido ativamente.

### Available scripts

```bash
pnpm test           # Run all unit tests
pnpm test:watch     # Run tests in watch mode
pnpm test:coverage  # Run tests with coverage report
pnpm lint           # Run ESLint
pnpm build          # Create extension ZIP package (dist/)
pnpm test:e2e       # Run E2E tests (requires auth setup)
```

## Project Architecture

```
├── background.js           # Service worker — monitoring loop
├── popup.js / html / css   # Extension popup UI
├── offscreen.js / html     # Audio playback (Manifest V3)
├── manifest.json           # Extension declaration
├── utils/
│   ├── cookie-service.js       # Zendesk cookie auth
│   ├── endpoint-io.js          # Import/export endpoints
│   ├── logger.js               # Logging utility
│   ├── message-router.js       # Message routing (BG ↔ popup)
│   ├── notification-manager.js # Notification lifecycle
│   ├── rate-limit-service.js   # API rate-limit tracking
│   ├── snooze-service.js       # Per-endpoint snooze
│   └── validators.js           # URL/settings validation
└── __tests__/              # Tests (Jest + Playwright E2E)
```

## Making Changes

### Code Style

- ESLint is pre-configured — run `pnpm lint` before committing
- Use modern JavaScript (ES modules, `async/await`)
- No semicolons (project convention — configured in ESLint)
- Use `const` by default, `let` only when rebinding
- Prefer meaningful variable names over comments

### Adding a New Feature

1. Check for existing issues/discussions about the feature
2. Open a feature request issue to discuss before implementing
3. Follow the existing patterns in `utils/` for new modules
4. Add tests for the new functionality
5. Update README.md if the feature changes the user interface

### Fixing a Bug

1. Check open issues to see if the bug is already reported
2. If not, create a bug report with reproduction steps
3. Include the solution approach in the issue
4. Add a test that covers the bug scenario before fixing

## Testing

All code changes must include or update tests.

```bash
# Run all tests
pnpm test

# Run specific test file
pnpm test __tests__/background.test.js

# Run tests matching a pattern
pnpm test -- --testNamePattern="snooze"

# Run with verbose output
pnpm test -- --verbose
```

The project has **159 unit tests** across 13 test files:

| Test File | Focus Area |
|-----------|-----------|
| `__tests__/background.test.js` | Background service worker |
| `__tests__/background-unit.test.js` | Background unit tests |
| `__tests__/popup.test.js` | Popup UI state |
| `__tests__/popup-unit.test.js` | Popup unit tests |
| `__tests__/integration.test.js` | Cross-module workflows |
| `__tests__/cookie-service.test.js` | Cookie retrieval |
| `__tests__/endpoint-io.test.js` | Import/export endpoints |
| `__tests__/message-router.test.js` | Message routing |
| `__tests__/notification-manager.test.js` | Notification lifecycle |
| `__tests__/rate-limit-service.test.js` | Rate limiting |
| `__tests__/snooze-service.test.js` | Snooze functionality |
| `__tests__/offscreen.test.js` | Audio playback |
| `__tests__/e2e/*.spec.mjs` | E2E (Playwright) |

### Testing Guidelines

- **Unit tests** go in `__tests__/module-name.test.js`
- **E2E tests** go in `__tests__/e2e/`
- Mock Chrome APIs using the setup in `jest.setup.js`
- Don't use `done()` callback unless async patterns require it (prefer `async/await`)

## Linting

```bash
pnpm lint
```

ESLint is configured with:
- `eslint:recommended` rules
- `eslint-plugin-jest` for test files
- No console.log (allow only console.warn/error)
- Enforced `const` over `let`
- Strict equality (`===`)
- JSDoc comments for exported functions (encouraged)

## Pull Request Process

### Template Checklist

When opening a PR, fill out the template:

- [ ] Title follows commit conventions
- [ ] Description explains what and why
- [ ] All tests pass (`pnpm test`)
- [ ] Lint passes (`pnpm lint`)
- [ ] Added/modified tests for new code
- [ ] README.md updated if UI/behavior changed
- [ ] CHANGELOG.md updated if applicable

### Review Process

1. All PRs require at least one review
2. Address all review comments before merging
3. Maintainers will squash-merge the PR
4. The `main` branch is protected — no direct pushes

## Commit Conventions

Use conventional commits for commit messages:

```
<type>: <description>

[optional body]
```

Types:
- **feat**: New feature
- **fix**: Bug fix
- **refactor**: Code change that neither fixes a bug nor adds a feature
- **test**: Adding or updating tests
- **docs**: Documentation changes
- **chore**: Build, CI, or tooling changes
- **style**: Formatting changes (no code logic change)
- **perf**: Performance improvement

Examples:
```
feat: add endpoint import/export via JSON
fix: handle service worker termination gracefully
test: add rate-limit-service unit tests
docs: update README with new feature
```

## Issue Labels

The project uses the following standard labels:

| Label | Purpose |
|-------|---------|
| `bug` | Confirmed bug |
| `enhancement` | Feature request |
| `needs-triage` | Needs maintainer evaluation |
| `needs-info` | Waiting for more information from reporter |
| `ready-for-agent` | Fully specified, ready for automated handling |
| `ready-for-human` | Needs human implementation |
| `good first issue` | Beginner-friendly task |
| `wontfix` | Will not be actioned |

## Release Process

Maintainers handle releases. The process is documented in [RELEASE.md](RELEASE.md).

In short:
1. Version bump in `manifest.json` and `package.json`
2. Update `CHANGELOG.md`
3. Tag with `vX.X.X`
4. Push tag → GitHub Actions builds and publishes release

---

**Questions?** Open a [discussion](https://github.com/barateza/barateza-ticket-notifier-v3/discussions) or an issue.

*Last updated: June 2026*
