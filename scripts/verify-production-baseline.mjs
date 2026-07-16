#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCommandSuite } from "./run-command-suite.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nodeTests = fs.readdirSync(path.join(root, "tests"))
  .filter((file) => file.endsWith(".test.mjs"))
  .sort()
  .map((file) => `tests/${file}`);

const result = runCommandSuite([
  { name: "production-build", command: "npm", args: ["run", "build"] },
  { name: "node-contracts", command: process.execPath, args: ["--test", ...nodeTests] },
  { name: "event-sources", command: "npm", args: ["run", "test:event-sources"] },
  { name: "poi-separation", command: "npm", args: ["run", "test:poi-separation"] },
  { name: "browser-matrix", command: "npx", args: ["playwright", "test", "-c", "playwright.config.mjs"], env: { PLAYWRIGHT_FULL_MATRIX: "1" } },
  { name: "artifact-policy", command: process.execPath, args: ["scripts/verify-artifact-policy.mjs"] },
  { name: "production-smoke", command: process.execPath, args: ["scripts/smoke-production-baseline.mjs"] },
  { name: "performance-contract", command: process.execPath, args: ["scripts/benchmark-frontend-performance.mjs", "--runs", "1", "--settle-ms", "1000", "--motion-ms", "500"] },
], { cwd: root });

process.exitCode = result.status;
