// __tests__/e2e/fixtures.js
//
// Provides two custom Playwright fixtures:
//   - `context`     : A persistent Chromium context with the extension loaded
//                     and Zendesk cookies already present from setup-e2e-auth.js.
//   - `extensionId` : The unpacked extension's ID, resolved robustly to handle
//                     the MV3 "type: module" service worker's slower registration.

/* global document */

import { test as base, chromium } from '@playwright/test';
import path from 'path';
import os from 'os';
import { existsSync, mkdtempSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, '../../');
const AUTH_DATA_DIR = path.resolve(__dirname, '../../.playwright-auth-data');

// ── A saved Zendesk session is OPTIONAL ──────────────────────────────────────
// No spec here requires one: the only code path that calls the live Zendesk API
// is the popup's "Test connection" button, and that is asserted against its
// no-session behaviour (endpoint-source returns `unauthenticated` without issuing
// a request when there are no cookies). background.spec.mjs mocks the search API.
//
// Requiring a session would make this suite un-runnable on a managed machine —
// Microsoft Entra Conditional Access will not sign an automation browser in
// without device compliance — and in CI. So: reuse a saved session when one
// exists, otherwise boot a throwaway profile.
function resolveUserDataDir() {
  if (existsSync(AUTH_DATA_DIR)) return AUTH_DATA_DIR;
  return mkdtempSync(path.join(os.tmpdir(), 'pw-extension-profile-'));
}

/**
 * Resolves the unpacked extension ID without mutating manifest.json.
 *
 * Strategy (in order):
 *   1. Wait up to 5 s for a service worker whose URL starts with
 *      "chrome-extension://" — fastest path for MV3 module workers.
 *   2. Fall back to navigating chrome://extensions and scraping the ID
 *      from the visible card — reliable but slower.
 *
 * @param {import('@playwright/test').BrowserContext} context
 * @returns {Promise<string>} The extension ID (e.g. "abcdefgh...")
 */
async function resolveExtensionId(context) {
  // ── Strategy 1: service worker URL ─────────────────────────────────────────
  try {
    const existing = context.serviceWorkers();
    const sw = existing.find(w => w.url().startsWith('chrome-extension://'));
    if (sw) {
      return sw.url().split('/')[2];
    }

    // Module workers may still be initialising — wait briefly.
    const worker = await Promise.race([
      context.waitForEvent('serviceworker', {
        predicate: w => w.url().startsWith('chrome-extension://'),
        timeout: 5_000,
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('sw timeout')), 5_000)
      ),
    ]);
    return worker.url().split('/')[2];
  } catch {
    // ── Strategy 2: chrome://extensions page scrape ─────────────────────────
    const page = await context.newPage();
    await page.goto('chrome://extensions');

    // The Extensions page is a custom element; pierce into shadow DOM.
    const extensionId = await page.evaluate(() => {
      const manager = document.querySelector('extensions-manager');
      const items = manager?.shadowRoot
        ?.querySelector('extensions-item-list')
        ?.shadowRoot?.querySelectorAll('extensions-item');

      for (const item of items ?? []) {
        const id = item.getAttribute('id');
        // Skip built-in Chrome extensions (they have short IDs or none).
        if (id && id.length === 32) return id;
      }
      return null;
    });

    await page.close();

    if (!extensionId) {
      throw new Error(
        'Could not resolve extension ID. ' +
        'Ensure the extension loaded correctly and manifest.json is valid.'
      );
    }
    return extensionId;
  }
}

export const test = base.extend({
  // Override the default `context` fixture with our persistent one.
  context: async ({ browserName }, use) => {
    void browserName;
    const context = await chromium.launchPersistentContext(resolveUserDataDir(), {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
      ],
    });
    await use(context);
    await context.close();
  },

  // Derive extensionId from the context above.
  extensionId: async ({ context }, use) => {
    const id = await resolveExtensionId(context);
    await use(id);
  },
});

export { expect } from '@playwright/test';
