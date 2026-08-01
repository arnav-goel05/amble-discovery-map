#!/usr/bin/env node

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
const background = {
  asset: { version: "1.0", generator: "amble-ci-geometry-fixture" },
  geometricError: 0,
  root: {
    ...tile("root.b3dm"),
    children: [tile("nested.b3dm")],
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

console.log(
  JSON.stringify({ ...report, outputRoot, aliasCount: aliases.size }),
);
