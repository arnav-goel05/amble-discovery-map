import { defineConfig, devices } from "playwright/test";

const fullMatrix = process.env.PLAYWRIGHT_FULL_MATRIX === "1";
const testPort = Number(process.env.PLAYWRIGHT_PORT || 4174);
const projects = [
  { name: "chromium-desktop", use: { ...devices["Desktop Chrome"] } },
  {
    name: "chromium-mobile",
    use: { ...devices["Pixel 7"] },
  },
  { name: "webkit-desktop", use: { ...devices["Desktop Safari"] } },
  {
    name: "webkit-mobile",
    use: { ...devices["iPhone 15"] },
  },
  { name: "firefox-desktop", use: { ...devices["Desktop Firefox"] } },
  {
    name: "firefox-mobile",
    use: {
      browserName: "firefox",
      viewport: { width: 390, height: 844 },
      screen: { width: 390, height: 844 },
      hasTouch: true,
      userAgent:
        "Mozilla/5.0 (Android 14; Mobile; rv:151.0) Gecko/151.0 Firefox/151.0",
    },
  },
];

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.mjs",
  outputDir: "/tmp/onemap-poi-highlight-playwright-results",
  timeout: 60_000,
  // The browser projects share one intentionally single-host test database.
  // Keep the default deterministic; callers can opt into isolated parallel runs.
  workers: Number(process.env.PLAYWRIGHT_WORKERS || 1),
  // WebGL browser processes can occasionally stall under the full six-engine matrix.
  // One bounded retry preserves deterministic failures while isolating process stalls.
  retries: Number(process.env.PLAYWRIGHT_RETRIES ?? 1),
  projects: fullMatrix ? projects : [projects[0]],
  use: {
    baseURL: `http://127.0.0.1:${testPort}`,
    viewport: { width: 1280, height: 720 },
  },
  webServer: {
    command: `PLAN_STORE_ROOT=/tmp/onemap-plan-playwright ADMIN_DATABASE_PATH=/tmp/onemap-admin-playwright.sqlite ADMIN_SECURE_COOKIES=0 ADMIN_PASSWORD_HASH='scrypt$v1$playwright-test-salt$h2xsKXSwyvwSJcOnD7jT1Rk_ZmaQsTCrbV_a4Hl8roNa_aXf0vca7ZiZv1So0degt4ElNIZPwUkPv6emJ4ZgAA' TELEGRAM_BOT_USERNAME=WhatsHereTestBot TELEGRAM_WEBHOOK_SECRET=test-secret npm run dev -- --host 127.0.0.1 --port ${testPort}`,
    url: `http://127.0.0.1:${testPort}`,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
