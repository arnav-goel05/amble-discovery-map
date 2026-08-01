import { defineConfig, devices } from "playwright/test";

const fullMatrix = process.env.PLAYWRIGHT_FULL_MATRIX === "1";
const compactMatrix = process.env.PLAYWRIGHT_COMPACT_MATRIX === "1";
const releaseDesktopMatrix =
  process.env.PLAYWRIGHT_RELEASE_DESKTOP_MATRIX === "1";
const releaseCompactMatrix =
  process.env.PLAYWRIGHT_RELEASE_COMPACT_MATRIX === "1";
const geometryFixture = process.env.PLAYWRIGHT_GEOMETRY_FIXTURE === "1";
const skipDeviceSupport = process.env.PLAYWRIGHT_SKIP_DEVICE_SUPPORT === "1";
const skipVoiceUi = process.env.PLAYWRIGHT_SKIP_VOICE_UI === "1";
const geometryEnvironment = geometryFixture
  ? "VITE_AMBLE_E2E_OFFLINE_MAP=1 CI_GEOMETRY_ROOT=outputs/ci-geometry TILE_FALLBACK_ORIGIN=''"
  : "TILE_FALLBACK_ORIGIN=''";
const testPort = Number(process.env.PLAYWRIGHT_PORT || 4174);
const reuseExistingServer =
  process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER === "1";
const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL || null;
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
        "Mozilla/5.0 (Android 14; Mobile; rv:142.0) Gecko/142.0 Firefox/142.0",
    },
  },
];
const compactProjects = ["chromium", "webkit", "firefox"].map(
  (browserName) => ({
    name: `${browserName}-compact`,
    use: {
      browserName,
      viewport: { width: 1024, height: 768 },
      screen: { width: 1024, height: 768 },
      hasTouch: true,
    },
  }),
);

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.mjs",
  testIgnore: [
    ...(geometryFixture
      ? [
          "**/building-layer-visibility.spec.mjs",
          "**/map-render-sync.spec.mjs",
          "**/map-performance-diagnostics.spec.mjs",
        ]
      : []),
    ...(skipDeviceSupport ? ["**/device-support.spec.mjs"] : []),
    ...(skipVoiceUi ? ["**/voice-*.spec.mjs"] : []),
  ],
  outputDir: "/tmp/onemap-poi-highlight-playwright-results",
  timeout: 60_000,
  // The browser projects share one intentionally single-host test database.
  // Keep the default deterministic; callers can opt into isolated parallel runs.
  workers: Number(process.env.PLAYWRIGHT_WORKERS || 1),
  // WebGL browser processes can occasionally stall under the full six-engine matrix.
  // One bounded retry preserves deterministic failures while isolating process stalls.
  retries: Number(process.env.PLAYWRIGHT_RETRIES ?? 1),
  projects: fullMatrix
    ? projects
    : releaseDesktopMatrix
      ? projects.filter(({ name }) => name.endsWith("-desktop"))
      : releaseCompactMatrix
        ? compactProjects
        : compactMatrix
          ? [compactProjects[0]]
          : [projects[0]],
  use: {
    baseURL: externalBaseUrl ?? `http://127.0.0.1:${testPort}`,
    viewport: { width: 1280, height: 720 },
  },
  webServer: externalBaseUrl
    ? undefined
    : {
        command: `VITE_AMBLE_E2E_BYPASS_INTRO=1 ${geometryEnvironment} PLAN_STORE_ROOT=/tmp/onemap-plan-playwright ADMIN_DATABASE_PATH=/tmp/onemap-admin-playwright.sqlite ADMIN_SECURE_COOKIES=0 ADMIN_PASSWORD_HASH='scrypt$v1$playwright-test-salt$h2xsKXSwyvwSJcOnD7jT1Rk_ZmaQsTCrbV_a4Hl8roNa_aXf0vca7ZiZv1So0degt4ElNIZPwUkPv6emJ4ZgAA' TELEGRAM_BOT_USERNAME=WhatsHereTestBot TELEGRAM_WEBHOOK_SECRET=test-secret node node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${testPort} --strictPort`,
        url: `http://127.0.0.1:${testPort}`,
        reuseExistingServer,
        timeout: 30_000,
      },
});
