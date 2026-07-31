#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tests = [
  "tests/assistant-capability-contract.test.mjs",
  "tests/assistant-capability-result.test.mjs",
  "tests/assistant-connector-parity.test.mjs",
];

const result = spawnSync(process.execPath, ["--test", ...tests], {
  cwd: root,
  env: {
    ...process.env,
    LIVE_REALTIME_SMOKE: "false",
    REALTIME_ENABLED: "false",
    REALTIME_PROTOCOL_VERSION: "1.1",
  },
  encoding: "utf8",
  stdio: "pipe",
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

if (result.error) {
  console.error(
    `Voice capability verification could not start: ${result.error.message}`,
  );
  process.exitCode = 1;
} else if (result.status !== 0) {
  process.exitCode = result.status ?? 1;
} else {
  console.log(
    `Voice capability coverage verified: ${tests.length} contract, result, and environment-parity suites passed under protocol 1.1.`,
  );
}
