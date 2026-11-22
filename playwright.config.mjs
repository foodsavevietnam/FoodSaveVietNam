import { defineConfig } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5517';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL,
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1440, height: 1000 },
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : {
    command: 'node scripts/dev.mjs --port 5517',
    url: 'http://127.0.0.1:5517/',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
