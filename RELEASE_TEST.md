# Release Workflow Test - v3.1.0

## Test Details

**Tag**: `v3.1.0`
**Release Name**: Release v3.1.0 - Complete testing infrastructure (69 tests passing)
**Pushed**: 2026-02-01

## What's Being Tested

The GitHub Actions workflow (`release.yml`) will:

1. ✅ **Run all tests** (21 Phase 1 + 27 Phase 2 + 20 Phase 3)
   - Must pass all 69 tests before proceeding
   - Coverage reports generated

2. ✅ **Extract version from tag**
   - Parse `v3.1.0` → `3.1.0`

3. ✅ **Create extension zip**
   - Include only extension files (no node_modules, tests, etc.)
   - Compress to `barateza-ticket-notifier-v3.1.0.zip`

4. ✅ **Publish GitHub Release**
   - Create release page
   - Add installation instructions
   - Attach zip file

## Monitoring the Release

### Option 1: GitHub Actions Dashboard
```
https://github.com/barateza/barateza-ticket-notifier-v3/actions
```

Look for:
- Workflow: "Release"
- Event: "Push" (for tag)
- Status: Should show ✓ PASS after ~2-3 minutes

### Option 2: GitHub Releases Page
```
https://github.com/barateza/barateza-ticket-notifier-v3/releases
```

Once complete:
- New release "v3.1.0" visible
- Zip file downloadable
- Release notes displayed

### Option 3: Command Line
```bash
# View recent tags
git tag --list -n1

# Check release details (once created)
gh release view v3.1.0
```

## Expected Workflow Steps

```
[1] Checkout code
[2] Run tests (npm test -- --no-coverage)
    └─ 69 tests must pass
[3] Generate coverage report
[4] Extract version (v3.1.0)
[5] Create zip with extension files
[6] Create GitHub Release
[7] Upload zip to release assets
[8] Post coverage summary (if PR)
[9] Complete ✓
```

## Test Acceptance Criteria

✅ **Pass**: All 69 tests pass → Release created → Zip attached
❌ **Fail**: Any test fails → Workflow stops → No release

## Contents of Released Zip

The `barateza-ticket-notifier-v3.1.0.zip` will contain:

```
barateza-ticket-notifier-v3.1.0/
├── background.js
├── manifest.json
├── popup.html
├── popup.js
├── popup.css
├── offscreen.html
├── offscreen.js
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

**NOT included** (as intended):
- node_modules/
- coverage/
- __tests__/
- .github/
- TESTING.md, PHASES.md, jest.config.js, etc.

## Installation from Release

Once released, users can:

1. Download `barateza-ticket-notifier-v3.1.0.zip`
2. Extract the folder
3. Open `chrome://extensions`
4. Enable Developer Mode
5. Click "Load unpacked"
6. Select extracted folder
7. Extension installed ✓

## Troubleshooting

### Workflow Failed
- Check GitHub Actions logs
- Most likely: A test failed
- Fix the issue locally and retag

### Release Not Appearing
- GitHub caches may delay visibility
- Refresh the page (F5)
- Check "Actions" tab first for workflow status

### Zip Not Attached
- Workflow likely failed before step 6
- Check logs for errors

## Next Steps After Workflow Completes

1. Verify release appears on GitHub
2. Download and test zip installation locally
3. Confirm extension works properly
4. Document completion in PHASES.md

---

**Status**: Workflow triggered at 2026-02-01 23:59:59
**Estimated Completion**: 2-3 minutes
**Reference**: `.github/workflows/release.yml`
