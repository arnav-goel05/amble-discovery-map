#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "public");
const destination = path.join(root, ".cloudflare-public");
const excludedRoots = new Set(["optimized-tiles", "poi-tiles"]);

fs.rmSync(destination, { recursive: true, force: true });
fs.mkdirSync(destination, { recursive: true });

for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
  if (excludedRoots.has(entry.name)) continue;
  fs.cpSync(path.join(source, entry.name), path.join(destination, entry.name), { recursive: true });
}

console.log("Prepared lightweight Cloudflare public assets; 3D geometry remains in R2.");
