import { defineConfig, devices } from '@playwright/test';

// E2E runs against the production build behind `vite preview` so we exercise
// the same bundle that ships to the VPS (DEPLOY.md). VITE_E2E=true switches
// on the test-only seed surface (window.__inventarSeed) — without it the
// production code path stays clean.

const PORT = 4173;
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e/tests',
  fullyParallel: false, // shared IndexedDB state between specs is too fragile
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'mobile-chromium',
      // clipboard permissions are Chromium-only; Firefox/WebKit reject them.
      // The app's copy-SKU button uses optional chaining so it no-ops on
      // browsers that don't grant clipboard.
      use: { ...devices['Pixel 7'], permissions: ['clipboard-read', 'clipboard-write'] },
    },
    {
      name: 'mobile-webkit',
      // The app is mobile-first; testing desktop viewports breaks selectors
      // that depend on the bottom nav and small-screen layout.
      use: { ...devices['iPhone 14'] },
    },
    {
      name: 'mobile-firefox',
      // Firefox doesn't ship with iPhone/Pixel device profiles, but we can
      // mimic mobile by setting viewport + userAgent + isMobile via context.
      use: {
        browserName: 'firefox',
        viewport: { width: 412, height: 915 },
        userAgent: 'Mozilla/5.0 (Android 14; Mobile; rv:130.0) Gecko/130.0 Firefox/130.0',
        deviceScaleFactor: 2.625,
        // Firefox doesn't emulate touch / isMobile, but viewport+UA is enough
        // for the responsive layout to render in mobile mode.
      },
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'npm run preview:e2e',
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: 'pipe',
        stderr: 'pipe',
      },
});
