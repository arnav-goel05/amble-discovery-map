#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export function selectCloudflareBuildCommand(
  workersCi = process.env.WORKERS_CI,
) {
  return workersCi === "1"
    ? { command: "npm", args: ["run", "cloudflare:cloud:build"] }
    : { command: "npm", args: ["run", "cloudflare:cloud:contracts"] };
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const selected = selectCloudflareBuildCommand();
  const result = spawnSync(selected.command, selected.args, {
    cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
