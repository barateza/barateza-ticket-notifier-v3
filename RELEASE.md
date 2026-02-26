# Release & Publication Guide

## How to Create a Release

### Prerequisites
- Code coverage tests must pass
- All changes committed to main branch
- Decide on version number

### Step 1: Create and Push a Tag

```bash
# Create annotated tag (recommended)
git tag -a v3.1.0 -m "Release version 3.1.0"

# Or lightweight tag
git tag v3.1.0

# Push tag to GitHub
git push origin v3.1.0
```

### Step 2: Watch GitHub Actions

The release workflow automatically:
1. ✅ Runs all tests (coverage)
2. ✅ Creates extension zip with only necessary files
3. ✅ Publishes GitHub Release with zip attached
4. ✅ Generates release notes with installation instructions

Monitor at: `https://github.com/YOUR_ORG/barateza-ticket-notifier-v3/actions`

### Step 3: Download from Release

Once complete, users can download from:
`https://github.com/YOUR_ORG/barateza-ticket-notifier-v3/releases/tag/v3.1.0`

---

## Versioning Strategy

Recommended semantic versioning: `v{MAJOR}.{MINOR}.{PATCH}`

**Examples:**
- `v3.1.0` – New feature release
- `v3.0.1` – Bug fix
- `v4.0.0` – Major breaking changes

---

## What Gets Included in Release Zip

✅ **Included:**
- `background.js`
- `manifest.json`
- `popup.html`, `popup.js`, `popup.css`
- `offscreen.html`, `offscreen.js`
- `icons/` folder
- `utils/` folder

❌ **Excluded:**
- `node_modules/`
- `coverage/`
- `__tests__/`
- All configuration files (`jest.config.js`, `.babelrc`, etc.)
- Documentation files

---

## Release Workflow Triggers

The workflow runs **only when**:
- A tag matching `v*` is pushed
  - ✅ `v3.1.0` → Triggers
  - ✅ `v3.0.0-beta` → Triggers
  - ❌ Regular commits → Does not trigger

---

## Manual Release (Alternative)

If you prefer to create a release without a tag:

1. Go to GitHub repository
2. Click "Releases" → "Draft a new release"
3. Click "Choose a tag" → Create new tag
4. Add release notes
5. Upload `barateza-ticket-notifier-vX.X.X.zip` manually

---

## Automated Zip Creation (Without Tag)

To just create the zip locally without releasing:

```bash
# Create zip directory
mkdir -p barateza-ticket-notifier-v3.1.0

# Copy extension files
cp background.js manifest.json popup.* offscreen.* -t barateza-ticket-notifier-v3.1.0/
cp -r icons/ utils/ barateza-ticket-notifier-v3.1.0/

# Create zip
zip -r barateza-ticket-notifier-v3.1.0.zip barateza-ticket-notifier-v3.1.0/
```

---

## Troubleshooting

### Release Workflow Failed
- Check test results in GitHub Actions
- Fix any test failures
- Delete the tag locally: `git tag -d v3.1.0`
- Fix the issue and retag

### Download says "File not found"
- Wait a few minutes for release to fully process
- Refresh the page
- Check GitHub Actions for errors

### Tag Not Recognized
- Ensure tag starts with `v`: `v3.1.0` not `3.1.0`
- Push tag: `git push origin v3.1.0`

---

## Example Release Workflow

```bash
# Make final changes and commit
git add .
git commit -m "Bump version to 3.1.0 with new snooze feature"

# Create and push tag
git tag -a v3.1.0 -m "Release: Add snooze functionality"
git push origin main
git push origin v3.1.0

# Monitor at GitHub Actions
# → Tests run
# → Zip created
# → Release published
# → Download available

# Done! Users can now download from Releases page
```

---

**Last Updated**: January 31, 2026
