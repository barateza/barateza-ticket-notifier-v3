// scripts/setup-e2e-auth.js
//
// PURPOSE: Run this script ONCE (or whenever your Zendesk session expires) to
//          persist your login cookies into .playwright-auth-data/.
//
// USAGE:   npm run test:e2e:setup
//
// HOW IT WORKS:
//   1. Opens a real Chromium window with the extension loaded.
//   2. Navigates to your Zendesk subdomain.
//   3. Pauses — you log in manually via the browser window.
//   4. Press "Resume" in the Playwright Inspector (or close the inspector).
//   5. Session is saved to disk. Future test runs reuse it automatically.

import { chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, '../');
const AUTH_DATA_DIR = path.resolve(__dirname, '../.playwright-auth-data');

// ── UPDATE THIS to your real Zendesk subdomain ──────────────────────────────
const ZENDESK_LOGIN_URL = 'https://YOUR_SUBDOMAIN.zendesk.com/auth/v2/login';
// ────────────────────────────────────────────────────────────────────────────

(async () => {
  console.log('\n🔐  Zendesk E2E Auth Setup');
  console.log('─'.repeat(50));
  console.log('  Auth data dir :', AUTH_DATA_DIR);
  console.log('  Extension path:', EXTENSION_PATH);
  console.log('─'.repeat(50));
  console.log('  A browser window will open. Log in to Zendesk manually.');
  console.log('  When done, click "Resume" in the Playwright Inspector.\n');

  const context = await chromium.launchPersistentContext(AUTH_DATA_DIR, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });

  const page = await context.newPage();
  await page.goto(ZENDESK_LOGIN_URL);

  // Pause here — the user logs in manually in the browser window.
  // The Playwright Inspector opens automatically because PWDEBUG is not
  // required; page.pause() always opens it.
  await page.pause();

  await context.close();

  console.log('\n✅  Session saved to .playwright-auth-data/');
  console.log('    You can now run: npm run test:e2e\n');
})();
