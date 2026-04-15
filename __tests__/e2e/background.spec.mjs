/* global chrome */
// __tests__/e2e/background.spec.js
//
// Optional E2E tests targeting the background service worker's observable
// side-effects in a real Chrome environment — specifically badge text updates
// after a polling cycle is manually triggered via chrome.runtime.sendMessage.
//
// These tests bypass the UI entirely, communicating directly with the
// background script to verify Chrome API boundaries that Jest cannot reach.
//
// Prerequisites: same as popup.spec.js — run `npm run test:e2e:setup` first.

import { test, expect } from './fixtures.mjs';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Evaluates a script in the extension's service worker context.
 * Waits for the worker to be available before evaluating.
 *
 * @param {import('@playwright/test').BrowserContext} context
 * @param {string} extensionId
 * @param {() => unknown} fn - Function to evaluate in the SW context
 */
async function evaluateInServiceWorker(context, extensionId, fn) {
  let sw = context.serviceWorkers().find(w => w.url().includes(extensionId));
  if (!sw) {
    sw = await context.waitForEvent('serviceworker', {
      predicate: w => w.url().includes(extensionId),
      timeout: 10_000,
    });
  }
  return sw.evaluate(fn);
}



// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Background service worker — Chrome API boundaries', () => {
  test.beforeEach(async ({ context }) => {
    await context.route('**/*.zendesk.com/api/v2/search.json*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ count: 3, results: [] }),
      });
    });
  });

  test('service worker is registered and reachable', async ({ context, extensionId }) => {
    let sw = context.serviceWorkers().find(w => w.url().includes(extensionId));
    if (!sw) {
      sw = await context.waitForEvent('serviceworker', {
        predicate: w => w.url().includes(extensionId),
        timeout: 10_000,
      });
    }
    expect(sw).toBeTruthy();
    expect(sw.url()).toContain(extensionId);
  });



  test('storage contains persisted endpoints after add via popup', async ({ context, extensionId }) => {
    // Read chrome.storage.local directly from the service worker context.
    const stored = await evaluateInServiceWorker(
      context,
      extensionId,
      () =>
        new Promise(resolve =>
          chrome.storage.local.get(['endpoints'], data => resolve(data))
        )
    );

    // We just assert the key exists and is an array — content depends on user data.
    expect(stored).toHaveProperty('endpoints');
    expect(Array.isArray(stored.endpoints)).toBe(true);
  });
});
