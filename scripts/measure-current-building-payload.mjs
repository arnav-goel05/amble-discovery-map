#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

import { loadApprovedSnapshot } from "./lib/approved-snapshot.mjs";
import {
  atomicWrite,
  canonicalJson,
  sha256,
} from "./lib/background-lite-run.mjs";

const root = path.resolve(import.meta.dirname, "..");

function collectTilesetContent(tileset, tilesetPath) {
  const base = path.dirname(tilesetPath);
  const records = [];
  const visit = (tile) => {
    const reference = tile.content?.uri ?? tile.content?.url;
    if (reference) {
      const filename = path.resolve(base, reference);
      if (!fs.existsSync(filename))
        throw new Error(`Missing runtime asset: ${filename}`);
      const bytes = fs.readFileSync(filename);
      records.push({
        path: filename,
        bytes: bytes.length,
        sha256: sha256(bytes),
      });
    }
    for (const child of tile.children ?? []) visit(child);
  };
  visit(tileset.root);
  return records;
}

export function measureCurrentRuntimePayload({
  repositoryRoot = root,
  backgroundInventory,
} = {}) {
  if (!backgroundInventory?.deletionCandidate)
    throw new Error("Pre-deletion background inventory is required");
  const active = loadApprovedSnapshot({ root: repositoryRoot });
  const pois = JSON.parse(
    fs.readFileSync(path.join(active.directory, active.poisRef), "utf8"),
  );
  const highlightedRecords = pois.flatMap((poi) => {
    const tilesetPath = path.join(repositoryRoot, "public", poi.data);
    const tileset = JSON.parse(fs.readFileSync(tilesetPath, "utf8"));
    return collectTilesetContent(tileset, tilesetPath);
  });
  const uniqueHighlighted = new Map();
  for (const record of highlightedRecords) {
    const key = record.path;
    const previous = uniqueHighlighted.get(key);
    if (previous && canonicalJson(previous) !== canonicalJson(record))
      throw new Error(`Contradictory highlighted asset: ${key}`);
    uniqueHighlighted.set(key, record);
  }
  const backgroundBytes = Number(
    backgroundInventory.deletionCandidate.logicalBytes,
  );
  const highlightedBytes = [...uniqueHighlighted.values()].reduce(
    (sum, record) => sum + record.bytes,
    0,
  );
  const content = {
    schemaVersion: "current-building-runtime-payload-v1",
    localOnly: true,
    productionChanged: false,
    source: "pre-deletion-inventory-plus-active-approved-highlight-assets",
    snapshotId: active.snapshotId,
    background: {
      inventoryId: backgroundInventory.deletionCandidate.inventoryId,
      uniqueFileCount: backgroundInventory.deletionCandidate.regularFileCount,
      bytes: backgroundBytes,
      deletedPath: backgroundInventory.deletionCandidate.path,
    },
    highlighted: {
      uniqueFileCount: uniqueHighlighted.size,
      bytes: highlightedBytes,
      records: [...uniqueHighlighted.values()].sort((left, right) =>
        left.path.localeCompare(right.path),
      ),
    },
    uniqueRuntimeBytes: backgroundBytes + highlightedBytes,
  };
  return { ...content, evidenceId: sha256(canonicalJson(content)) };
}

function main() {
  const outputRoot = path.join(root, "outputs", "background-lite-local");
  const preflight = JSON.parse(
    fs.readFileSync(path.join(outputRoot, "reports", "preflight.json"), "utf8"),
  );
  const result = measureCurrentRuntimePayload({
    repositoryRoot: root,
    backgroundInventory: preflight,
  });
  const destination = path.join(
    outputRoot,
    "reports",
    "current-runtime-payload.json",
  );
  atomicWrite(destination, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] === import.meta.filename) main();
