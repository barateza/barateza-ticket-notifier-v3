// playwright.config.js
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './__tests__/e2e',
  timeout: 30_000,
  retries: 0,
  workers: 1, // Extensions require single-worker — parallel contexts conflict with persistent user data dirs
  use: {
    headless: false, // Chrome extensions do not load in legacy headless mode
    viewport: { width: 1280, height: 720 },
  },
  reporter: [['list'], ['html', { open: 'never' }]],
});
