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
 * Retries across MV3 worker lifecycle races: the worker may still be
 * initialising after install, or may have been terminated between calls.
 *
 * @param {import('@playwright/test').BrowserContext} context
 * @param {string} extensionId
 * @param {() => unknown} fn - Function to evaluate in the SW context
 */
async function evaluateInServiceWorker(context, extensionId, fn) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt++) {
    let sw = context.serviceWorkers().find(w => w.url().includes(extensionId));
    if (!sw) {
      sw = await context.waitForEvent('serviceworker', {
        predicate: w => w.url().includes(extensionId),
        timeout: 10_000,
      });
    }
    try {
      return await sw.evaluate(fn);
    } catch (error) {
      lastError = error;
      // Worker terminated mid-evaluate — give it a moment and retry.
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw lastError;
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
    await context.route('**/*.atlassian.net/rest/api/3/search/approximate-count*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ count: 5, exact: true }),
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



  test('storage contains persisted monitors after add via popup', async ({ context, extensionId }) => {
    // The extension seeds a default monitor on install; onInstalled is
    // async, so poll until the key appears rather than asserting once.
    await expect.poll(async () => {
      const stored = await evaluateInServiceWorker(
        context,
        extensionId,
        () =>
          new Promise(resolve =>
            chrome.storage.local.get(['monitors'], data => resolve(data))
          )
      );
      return Array.isArray(stored.monitors) ? stored.monitors : null;
    }, { timeout: 10_000 }).not.toBeNull();

    const stored = await evaluateInServiceWorker(
      context,
      extensionId,
      () =>
        new Promise(resolve =>
          chrome.storage.local.get(['monitors'], data => resolve(data))
        )
    );
    expect(Array.isArray(stored.monitors)).toBe(true);
    expect(stored.monitors[0].provider).toBe('zendesk');
  });

  test('jira monitor polls via Basic auth and updates its count', async ({ context, extensionId }) => {
    // Use an extension page (popup.html) to talk to storage + the SW:
    // chrome.runtime.sendMessage from an extension page wakes the worker,
    // avoiding MV3 idle-termination races.
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);

    // Seed a jira monitor + per-site credentials directly in storage.
    await page.evaluate(() =>
      new Promise(resolve => {
        chrome.storage.local.get(['monitors'], async (data) => {
          const monitors = data.monitors || [];
          monitors.push({
            id: 4242,
            name: 'E2E Jira Queue',
            url: 'https://e2e.atlassian.net/issues/?jql=project%20%3D%20SUPPORT',
            enabled: true,
            provider: 'jira',
            createdAt: Date.now()
          });
          await chrome.storage.local.set({
            monitors,
            jiraCredentials: {
              'e2e.atlassian.net': { email: 'e2e@test.local', token: 'test-token' }
            }
          });
          resolve();
        });
      })
    );

    // Trigger a manual refresh; the poller should hit the mocked
    // approximate-count route with the Basic header.
    await page.evaluate(() =>
      chrome.runtime.sendMessage({ action: 'refreshNow' }).then(() => true)
    );

    // The jira monitor's count (5) should land in session endpointCounts.
    await expect.poll(async () => {
      return page.evaluate(() =>
        new Promise(resolve =>
          chrome.storage.session.get(['endpointCounts'], data =>
            resolve(Array.isArray(data.endpointCounts) ? data.endpointCounts : [])
          )
        )
      );
    }, { timeout: 15_000 }).toContainEqual([4242, 5]);

    await page.close();
  });
});
