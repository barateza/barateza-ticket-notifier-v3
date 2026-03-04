// __tests__/e2e/popup.spec.js
//
// E2E tests for the Zendesk Ticket Monitor popup UI running inside a real
// Chromium instance with the extension loaded and a live Zendesk session.
//
// Prerequisites:
//   - Run `npm run test:e2e:setup` at least once to persist Zendesk cookies.
//   - The Zendesk account used must have at least one accessible view/endpoint.
//
// Run:  npm run test:e2e

import { test, expect } from './fixtures.mjs';

// ── UPDATE THIS to a real Zendesk API endpoint valid for your account ────────
const TEST_ENDPOINT_URL =
  'https://playwright.zendesk.com/api/v2/search.json?query=type:ticket';
const TEST_ENDPOINT_NAME = 'Playwright – My Tickets';
// ────────────────────────────────────────────────────────────────────────────

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Opens the extension popup in a new page and returns it. */
async function openPopup(context, extensionId) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  return page;
}

/** Removes any endpoint whose name text matches `name`. Safe if none exist. */
async function cleanupEndpoint(page, name) {
  const items = page.locator('.endpoint-item');
  const count = await items.count();
  for (let i = 0; i < count; i++) {
    const item = items.nth(i);
    const text = await item.locator('.endpoint-name').textContent();
    if (text?.trim() === name) {
      page.once('dialog', dialog => dialog.accept());
      await item.locator('.delete-endpoint-btn').click();
      await expect(page.locator('.endpoint-item', { hasText: name })).toHaveCount(0);
      break;
    }
  }
}

// ── Test Suite ───────────────────────────────────────────────────────────────

test.describe('Popup UI — authenticated session', () => {
  test('popup page loads without errors', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);

    // The popup document should reach a ready state.
    await expect(page).toHaveTitle(/zendesk|ticket|monitor/i);

    // No JS error dialogs should appear.
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.waitForLoadState('domcontentloaded');

    expect(errors).toHaveLength(0);
    await page.close();
  });

  test('authenticated session is detected — cookie present', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);

    // The popup should NOT show an "unauthenticated" or "please login" banner
    // when a valid Zendesk session exists.
    const authWarning = page.locator('[data-testid="auth-warning"], .auth-error, .no-auth');
    await expect(authWarning).toHaveCount(0);

    await page.close();
  });
});

test.describe('Endpoint management', () => {
  test.beforeEach(async ({ context, extensionId }) => {
    // Clean up the test endpoint from any prior run to keep tests idempotent.
    const page = await openPopup(context, extensionId);
    await cleanupEndpoint(page, TEST_ENDPOINT_NAME);
    await page.close();
  });

  test('can add a new endpoint via the popup form', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);

    // Open add modal
    await page.click('#addEndpointBtn');

    // Fill in the add-endpoint form.
    await page.fill('#endpointUrl', TEST_ENDPOINT_URL);
    await page.fill('#endpointName', TEST_ENDPOINT_NAME);
    await page.click('#saveEndpoint');

    // The new endpoint should now appear in the list.
    const endpointItem = page.locator('.endpoint-item').filter({ hasText: TEST_ENDPOINT_NAME });
    await expect(endpointItem).toBeVisible({ timeout: 5_000 });

    await page.close();
  });

  test('duplicate endpoint URL is rejected with a validation error', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);

    // Add the endpoint once.
    await page.click('#addEndpointBtn');
    await page.fill('#endpointUrl', TEST_ENDPOINT_URL);
    await page.fill('#endpointName', TEST_ENDPOINT_NAME);
    await page.click('#saveEndpoint');
    await expect(page.locator('.endpoint-item').filter({ hasText: TEST_ENDPOINT_NAME })).toBeVisible();

    // Try to add the same URL again.
    await page.click('#addEndpointBtn');
    await page.fill('#endpointUrl', TEST_ENDPOINT_URL);
    await page.fill('#endpointName', TEST_ENDPOINT_NAME + ' 2');
    await page.click('#saveEndpoint');

    // An error message should appear.
    const error = page.locator('.error, .form-error, [role="alert"]');
    await expect(error).toBeVisible({ timeout: 3_000 });

    await page.close();
  });

  test('can delete an endpoint and it disappears from the list', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);

    // Add first.
    await page.click('#addEndpointBtn');
    await page.fill('#endpointUrl', TEST_ENDPOINT_URL);
    await page.fill('#endpointName', TEST_ENDPOINT_NAME);
    await page.click('#saveEndpoint');

    const endpointItem = page.locator('.endpoint-item').filter({ hasText: TEST_ENDPOINT_NAME });
    await expect(endpointItem).toBeVisible();

    // Delete it.
    page.once('dialog', dialog => dialog.accept());
    await endpointItem.locator('.delete-endpoint-btn').click();

    // Should be gone.
    await expect(endpointItem).toHaveCount(0);

    await page.close();
  });

  test('can toggle an endpoint enabled/disabled', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);

    // Add endpoint.
    await page.click('#addEndpointBtn');
    await page.fill('#endpointUrl', TEST_ENDPOINT_URL);
    await page.fill('#endpointName', TEST_ENDPOINT_NAME);
    await page.click('#saveEndpoint');

    const endpointItem = page.locator('.endpoint-item').filter({ hasText: TEST_ENDPOINT_NAME });
    await expect(endpointItem).toBeVisible();

    const toggle = endpointItem.locator('.toggle-endpoint-btn');
    const initialText = await toggle.textContent();

    // Toggle off.
    await toggle.click();

    // State should have flipped.
    await expect(toggle).not.toHaveText(initialText, { timeout: 3_000 });

    await page.close();
  });
});

test.describe('Snooze controls', () => {
  test('can activate snooze and see countdown appear', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);

    // Open snooze modal
    await page.click('#snoozeBtn');

    // Select snooze duration
    await page.selectOption('#snoozeDuration', '5');

    // Confirm snooze
    await page.click('#confirmSnooze');

    // The snooze status container should lose the hidden class
    const snoozeStatus = page.locator('#snoozeStatus');
    await expect(snoozeStatus).not.toHaveClass(/hidden/, { timeout: 3_000 });

    await page.close();
  });

  test('can clear an active snooze', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);

    // Activate snooze first.
    await page.click('#snoozeBtn');
    await page.selectOption('#snoozeDuration', '5');
    await page.click('#confirmSnooze');
    await expect(page.locator('#snoozeStatus')).not.toHaveClass(/hidden/, { timeout: 3_000 });

    // Clear it.
    await page.click('#cancelSnoozeBtn');

    // Countdown should be hidden.
    await expect(page.locator('#snoozeStatus')).toHaveClass(/hidden/, { timeout: 3_000 });

    await page.close();
  });
});
