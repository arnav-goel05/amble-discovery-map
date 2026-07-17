#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
  throw new Error(`Cloudflare frontend verification failed: ${message}`);
}

export function verifyCloudflareFrontend(buildRoot = path.join(root, "dist-cloudflare")) {
  const indexPath = path.join(buildRoot, "index.html");
  if (!fs.existsSync(indexPath)) fail("dist-cloudflare/index.html is missing; run cloudflare:prepare first");

  const html = fs.readFileSync(indexPath, "utf8");
  const moduleMatch = html.match(/<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["']/i);
  if (!moduleMatch) fail("the production HTML has no module entry script");

  const entryUrl = moduleMatch[1];
  const entryPath = path.join(buildRoot, entryUrl.replace(/^\//, ""));
  if (!fs.existsSync(entryPath)) fail(`the module entry ${entryUrl} does not exist`);

  const entry = fs.readFileSync(entryPath, "utf8");
  const requiredEntrySignals = [
    "device-gate",
    "deviceSupport",
    "maxTouchPoints",
    "Singapore is waiting on the big screen",
    "Open Amble on your laptop",
  ];

  for (const signal of requiredEntrySignals) {
    if (!entry.includes(signal)) fail(`the module entry is missing ${JSON.stringify(signal)}`);
  }

  if (!entry.includes("import(")) fail("the 3D application is not loaded through a dynamic import");
  if (Buffer.byteLength(entry) > 100_000) fail("the compatibility entry unexpectedly contains the full 3D application");

  const stylesheets = [...html.matchAll(/<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref=["']([^"']+)["']/gi)]
    .map((match) => path.join(buildRoot, match[1].replace(/^\//, "")))
    .filter((filePath) => fs.existsSync(filePath));
  if (!stylesheets.some((filePath) => fs.readFileSync(filePath, "utf8").includes("device-gate"))) {
    fail("the production HTML does not load the device-gate styles");
  }

  return { entryUrl };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { entryUrl } = verifyCloudflareFrontend();
  console.log(`Verified Cloudflare compatibility entry ${entryUrl}.`);
}
