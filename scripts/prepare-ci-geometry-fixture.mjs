#!/usr/bin/env node

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  activateStagedSnapshot,
  stageImmutableSnapshot,
} from "./lib/approved-snapshot.mjs";
import { validateCiGeometryFixture } from "./verify-ci-geometry-fixture.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(root, "outputs/ci-geometry");
const manifest = JSON.parse(
  await readFile(
    path.join(root, "tests/fixtures/geometry-release/manifest.json"),
    "utf8",
  ),
);
const report = validateCiGeometryFixture(manifest);
const fixtureSnapshotId = "ci-geometry-fixture-v1";

await rm(outputRoot, { recursive: true, force: true });
for (const object of manifest.objects) {
  const destination = path.resolve(outputRoot, object.path);
  if (!destination.startsWith(`${outputRoot}${path.sep}`))
    throw new Error(`Unsafe fixture output path: ${object.path}`);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, Buffer.from(object.base64, "base64"));
}

const region = [
  103.857 * (Math.PI / 180),
  1.285 * (Math.PI / 180),
  103.86 * (Math.PI / 180),
  1.287 * (Math.PI / 180),
  0,
  80,
];
const tile = (uri) => ({
  boundingVolume: { region },
  geometricError: 0,
  refine: "ADD",
  content: { uri },
});
const sourceTiles = {
  root: "tiles/1/1/1_0.b3dm",
  nested: "tiles/1/1/1_1.b3dm",
};
for (const [role, sourceTile] of Object.entries(sourceTiles)) {
  const object = manifest.objects.find(({ role: objectRole }) =>
    role === "root" ? objectRole === "background" : objectRole === "nested",
  );
  const destination = path.join(outputRoot, "optimized-tiles", sourceTile);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, Buffer.from(object.base64, "base64"));
}
const background = {
  asset: { version: "1.0", generator: "amble-ci-geometry-fixture" },
  geometricError: 0,
  root: {
    ...tile(sourceTiles.root),
    children: [tile(sourceTiles.nested)],
  },
};
await writeFile(
  path.join(outputRoot, "optimized-tiles/tileset.json"),
  `${JSON.stringify(background)}\n`,
);

const highlight = {
  asset: { version: "1.0", generator: "amble-ci-geometry-fixture" },
  geometricError: 0,
  root: tile("../fixture/poi.b3dm"),
};
const sourcePoiRoot = path.join(root, "public/poi-tiles");
const aliases = new Set(["event-venues", "fixture", "wisma-geylang-serai"]);
for (const entry of await readdir(sourcePoiRoot, { withFileTypes: true }))
  if (entry.isDirectory()) aliases.add(entry.name);
for (const alias of [...aliases].sort()) {
  const directory = path.join(outputRoot, "poi-tiles", alias);
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "tileset.json"),
    `${JSON.stringify(highlight)}\n`,
  );
}

const backgroundObjects = Object.fromEntries(
  manifest.objects
    .filter(({ role }) => ["background", "nested"].includes(role))
    .map((object) => [object.path, object]),
);
const fixturePoi = {
  id: "fixture",
  label: "Fixture Venue",
  data: "poi-tiles/fixture/tileset.json",
  names: ["Fixture Venue"],
  tiles: {
    [sourceTiles.root]: [0],
    [sourceTiles.nested]: [0],
  },
};
const extractionManifest = {
  poiId: fixturePoi.id,
  tiles: [
    {
      sourceTile: sourceTiles.root,
      backgroundFile: `optimized-tiles/${sourceTiles.root}`,
      backgroundSha256: backgroundObjects["optimized-tiles/root.b3dm"].sha256,
      sourceSha256: "1".repeat(64),
      gmlIds: ["fixture-building-root"],
      poiFile: "poi.b3dm",
    },
    {
      sourceTile: sourceTiles.nested,
      backgroundFile: `optimized-tiles/${sourceTiles.nested}`,
      backgroundSha256: backgroundObjects["optimized-tiles/nested.b3dm"].sha256,
      sourceSha256: "2".repeat(64),
      gmlIds: ["fixture-building-nested"],
      poiFile: "event.b3dm",
    },
  ],
};
const publicPoiRoot = path.join(outputRoot, "public/poi-tiles/fixture");
await mkdir(publicPoiRoot, { recursive: true });
await writeFile(
  path.join(publicPoiRoot, "tileset.json"),
  `${JSON.stringify({
    ...highlight,
    extras: { fixturePadding: "x".repeat(2048) },
  })}\n`,
);
await writeFile(
  path.join(publicPoiRoot, "extraction-manifest.json"),
  `${JSON.stringify(extractionManifest)}\n`,
);
await writeFile(
  path.join(publicPoiRoot, "poi.b3dm"),
  Buffer.from(
    manifest.objects.find(({ role }) => role === "highlight").base64,
    "base64",
  ),
);
await writeFile(
  path.join(publicPoiRoot, "event.b3dm"),
  Buffer.from(
    manifest.objects.find(({ role }) => role === "event-highlight").base64,
    "base64",
  ),
);

const combinedTileset = {
  asset: { version: "1.0", generator: "amble-ci-geometry-fixture" },
  geometricError: 0,
  root: {
    boundingVolume: { region },
    geometricError: 0,
    children: [
      {
        boundingVolume: { region },
        geometricError: 0,
        content: { uri: "../fixture/poi.b3dm" },
        extras: { poiId: fixturePoi.id },
      },
    ],
  },
  extras: {
    venueCount: 1,
    venueIds: [fixturePoi.id],
    venueBranchCount: 1,
    fragmentCount: 1,
    sourceFragmentCount: 2,
    spatialNodeCount: 1,
    externalTilesetCount: 0,
  },
};
const combinedRoot = path.join(outputRoot, "public/poi-tiles/event-venues");
await mkdir(combinedRoot, { recursive: true });
await writeFile(
  path.join(combinedRoot, "tileset.json"),
  `${JSON.stringify(combinedTileset)}\n`,
);

const activities = {
  schemaVersion: "1.0",
  snapshotId: fixtureSnapshotId,
  generatedAt: "2026-01-01T00:00:00.000Z",
  counts: {
    activities: 0,
    sessions: 0,
    venueGroups: 0,
    sourceOffers: 0,
    mappedActivities: 0,
    offMapActivities: 0,
  },
  records: [],
};
const staged = stageImmutableSnapshot({
  root: outputRoot,
  snapshot: {
    schemaVersion: "1.0",
    snapshotId: fixtureSnapshotId,
    publishedAt: "2026-01-01T00:00:00.000Z",
    coveredWindow: {
      start: "2026-01-01",
      end: "2026-01-08",
      timezone: "Asia/Singapore",
    },
    freshness: "fresh",
    staleAfter: "2099-01-01T00:00:00.000Z",
    sourceHealth: {},
    previousSnapshotId: null,
    landmarksRef: "landmarks.json",
    poisRef: "pois.json",
    tilesetRef: "tileset.json",
    activitiesRef: "activities.json",
    internalEventsRef: "internal-events.json",
  },
  artifacts: {
    "landmarks.json": "[]\n",
    "pois.json": `${JSON.stringify([fixturePoi])}\n`,
    "tileset.json": `${JSON.stringify(combinedTileset)}\n`,
    "activities.json": `${JSON.stringify(activities)}\n`,
    "internal-events.json": `${JSON.stringify({
      schemaVersion: "3.1",
      mapped: [],
      offMap: [],
      counts: { active: 0, mapped: 0, offMap: 0 },
    })}\n`,
  },
  commitEligibility: { eligible: true },
});
activateStagedSnapshot({ root: outputRoot, staged });

console.log(
  JSON.stringify({
    ...report,
    outputRoot,
    aliasCount: aliases.size,
    fixtureSnapshotId,
  }),
);
