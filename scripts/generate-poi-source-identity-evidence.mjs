#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadApprovedSnapshot } from "./lib/approved-snapshot.mjs";
import {
  normalizeSourceTile,
  parseB3dmGmlIds,
} from "./lib/poi-source-identity-evidence.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(root, "data/poi-source-identity-evidence.json");
const sourceRoot = path.join(root, "public/poi-tiles/source");
const active = loadApprovedSnapshot({ root });
const pois = JSON.parse(
  await readFile(path.join(active.directory, active.poisRef), "utf8"),
);
const sources = new Map();

for (const poi of pois) {
  const manifest = JSON.parse(
    await readFile(
      path.join(
        root,
        "public",
        path.dirname(poi.data),
        "extraction-manifest.json",
      ),
      "utf8",
    ),
  );
  for (const tile of manifest.tiles ?? []) {
    const sourceTile = normalizeSourceTile(tile.sourceTile);
    const previous = sources.get(sourceTile);
    if (previous && previous !== tile.sourceSha256)
      throw new Error(`Conflicting source hashes for ${sourceTile}`);
    sources.set(sourceTile, tile.sourceSha256);
  }
}

const records = [];
for (const [sourceTile, sourceSha256] of [...sources].sort(([left], [right]) =>
  left.localeCompare(right),
)) {
  const bytes = await readFile(
    path.join(sourceRoot, sourceTile.replace(/^tiles\//u, "")),
  );
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (actualSha256 !== sourceSha256)
    throw new Error(
      `Pristine source hash mismatch for ${sourceTile}: expected ${sourceSha256}, received ${actualSha256}`,
    );
  records.push({
    sourceTile,
    sourceSha256,
    gmlIds: parseB3dmGmlIds(bytes),
  });
}

const evidence = {
  schemaVersion: "poi-source-identity-evidence-v1",
  snapshotId: active.snapshotId,
  records,
};
await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(
  JSON.stringify({
    snapshotId: active.snapshotId,
    sourceObjectCount: records.length,
    sourceIdentityCount: records.reduce(
      (total, record) => total + record.gmlIds.length,
      0,
    ),
    outputPath,
  }),
);
