#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const policy = JSON.parse(
  fs.readFileSync(path.join(root, "data/realtime-voice-policy.json"), "utf8"),
);
const enabled = process.env.LIVE_REALTIME_SMOKE === "true";

if (!enabled) {
  console.log(
    "Live Realtime smoke skipped: set LIVE_REALTIME_SMOKE=true only for an owner-controlled run. Mock verification remains active.",
  );
  process.exit(0);
}

const required = {
  owner: process.env.REALTIME_SMOKE_OWNER === policy.owner,
  environment: process.env.REALTIME_ENABLED === "true",
  runtime: process.env.REALTIME_RUNTIME_ENABLED === "true",
  key: Boolean(process.env.OPENAI_API_KEY),
  reservation:
    Number(process.env.REALTIME_AVAILABLE_MICRO_USD) >=
    policy.worstCaseReservation.maxTurnReservedMicroUsd,
  endpoint: /^https:\/\//.test(process.env.REALTIME_SMOKE_ENDPOINT || ""),
};
const missing = Object.entries(required)
  .filter(([, value]) => !value)
  .map(([name]) => name);
if (missing.length) {
  console.error(
    `Live Realtime smoke refused: missing owner-controlled gates: ${missing.join(", ")}.`,
  );
  process.exit(2);
}
if (policy.capMicroUsd !== 10_000_000 || policy.resetPolicy !== "none") {
  console.error(
    "Live Realtime smoke refused: lifetime budget policy is not the approved USD 10 policy.",
  );
  process.exit(2);
}

console.error(
  "Live Realtime smoke requires the deployed owner endpoint to execute the bounded turn and return ledger-only evidence; no provider call was made by this local guard.",
);
process.exit(3);
