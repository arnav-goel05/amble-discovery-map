#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadApprovedSnapshot } from "./lib/approved-snapshot.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pointerPath = path.join(root, "data/approved-snapshot.json");
const args = [path.join(root, "scripts/verify-poi-background-separation.mjs")];

if (fs.existsSync(pointerPath)) {
  const active = loadApprovedSnapshot({ root, pointerPath });
  args.push("--registry", path.join(active.directory, active.poisRef));
  args.push(
    "--source-evidence",
    path.join(root, "data/poi-source-identity-evidence.json"),
    "--snapshot-id",
    active.snapshotId,
  );
}

const result = spawnSync(process.execPath, args, {
  cwd: root,
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
