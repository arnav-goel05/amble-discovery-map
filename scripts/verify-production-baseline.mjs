#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCommandSuite } from "./run-command-suite.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nodeTests = fs
  .readdirSync(path.join(root, "tests"))
  .filter((file) => file.endsWith(".test.mjs"))
  .sort()
  .map((file) => `tests/${file}`);
const browserSpecs = fs
  .readdirSync(path.join(root, "tests"))
  .filter((file) => file.endsWith(".spec.mjs"))
  .sort()
  .map((file) => `tests/${file}`);
const isolatedBrowserSpecs = [
  "tests/event-discovery.spec.mjs",
  "tests/event-ui.spec.mjs",
  "tests/restaurant-ui.spec.mjs",
];
const remainingBrowserSpecs = browserSpecs.filter(
  (file) => !isolatedBrowserSpecs.includes(file),
);
const browserCommand = (name, specs) => ({
  name,
  command: "npx",
  args: ["playwright", "test", "-c", "playwright.config.mjs", ...specs],
  env: { PLAYWRIGHT_FULL_MATRIX: "1" },
});

const result = runCommandSuite(
  [
    { name: "production-build", command: "npm", args: ["run", "build"] },
    {
      name: "voice-action-coverage",
      command: "npm",
      args: ["run", "verify:voice-actions"],
    },
    {
      name: "voice-zero-spend-contracts",
      command: process.execPath,
      args: [
        "--test",
        "tests/realtime-policy.test.mjs",
        "tests/realtime-relay.test.mjs",
        "tests/voice-budget.test.mjs",
        "tests/voice-budget-repository.test.mjs",
      ],
      env: { REALTIME_ENABLED: "false", LIVE_REALTIME_SMOKE: "false" },
    },
    {
      name: "map-asset-validation",
      command: process.execPath,
      args: [
        "--test",
        "tests/discovery-area-assets.test.mjs",
        "tests/transit-assets.test.mjs",
      ],
      env: { REALTIME_ENABLED: "false" },
    },
    {
      name: "node-contracts",
      command: process.execPath,
      args: ["--test", ...nodeTests],
    },
    {
      name: "event-sources",
      command: "npm",
      args: ["run", "test:event-sources"],
    },
    {
      name: "poi-separation",
      command: "npm",
      args: ["run", "test:poi-separation"],
    },
    browserCommand("browser-event-discovery", [
      "tests/event-discovery.spec.mjs",
    ]),
    browserCommand("browser-event-ui", ["tests/event-ui.spec.mjs"]),
    browserCommand("browser-restaurants", ["tests/restaurant-ui.spec.mjs"]),
    browserCommand("browser-matrix", remainingBrowserSpecs),
    {
      name: "artifact-policy",
      command: process.execPath,
      args: ["scripts/verify-artifact-policy.mjs"],
    },
    {
      name: "production-smoke",
      command: process.execPath,
      args: ["scripts/smoke-production-baseline.mjs"],
    },
    {
      name: "performance-contract",
      command: process.execPath,
      args: [
        "scripts/benchmark-frontend-performance.mjs",
        "--runs",
        "1",
        "--settle-ms",
        "1000",
        "--motion-ms",
        "500",
      ],
    },
  ],
  { cwd: root },
);

process.exitCode = result.status;
