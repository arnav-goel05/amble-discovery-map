#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  auditRemoteTilesetObjects,
  buildTilesetIntegrityInventory,
  compareR2BindingInventory,
} from "./lib/tileset-integrity.mjs";
import {
  buildIntegrityReleaseId,
  createIntegrityVerificationId,
  fetchR2BindingInventory,
} from "./lib/r2-binding-inventory.mjs";
import { collectTilesetReleaseEntries } from "./lib/background-release-hydration.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback = null) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const localOnly = args.includes("--local-only");
const objectHeads = args.includes("--object-heads");
const preDeploy = args.includes("--pre-deploy");
const deployment = args.includes("--deployment");
const origin = option("origin", "https://amble.project-hub-arnav.workers.dev");
const inventoryOrigin = option(
  "inventory-origin",
  process.env.R2_INVENTORY_ORIGIN ??
    "https://amble-tile-integrity.project-hub-arnav.workers.dev",
);
const concurrency = Number(option("concurrency", "24"));
const reportPath = path.resolve(
  root,
  option("report", "outputs/tileset-integrity-report.json"),
);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 64)
  throw new Error("--concurrency must be an integer from 1 to 64");

const definitions = [
  {
    id: "background",
    manifestPath: path.join(root, "optimized-tiles/tileset.json"),
    manifestUrl: "https://inventory.invalid/optimized-tiles/tileset.json",
    publicRoot: root,
  },
  {
    id: "highlighted",
    manifestPath: path.join(root, "public/poi-tiles/event-venues/tileset.json"),
    manifestUrl:
      "https://inventory.invalid/poi-tiles/event-venues/tileset.json",
    publicRoot: path.join(root, "public"),
  },
];

const releaseDescriptor = JSON.parse(
  await readFile(
    path.join(root, "data/background-geometry-release.json"),
    "utf8",
  ),
);
const backgroundTileset = deployment
  ? null
  : JSON.parse(
      await readFile(path.join(root, "optimized-tiles/tileset.json"), "utf8"),
    );
const activeBackgroundPaths = new Set(
  backgroundTileset
    ? collectTilesetReleaseEntries({
        tileset: backgroundTileset,
        origin: new URL("https://inventory.invalid"),
      }).map(({ pathname }) => `/optimized-tiles/${pathname}`)
    : [],
);
const inventoryById = new Map();
for (const definition of definitions) {
  if (deployment && definition.id === "background") continue;
  inventoryById.set(
    definition.id,
    await buildTilesetIntegrityInventory({
      ...definition,
      validateLocalContent: deployment
        ? false
        : objectHeads || definition.id === "highlighted"
          ? true
          : localOnly
            ? ({ pathname }) => activeBackgroundPaths.has(pathname)
            : false,
    }),
  );
}
const integrityReleaseId = deployment
  ? createHash("sha256")
      .update(
        `${releaseDescriptor.releaseId}\n${inventoryById.get("highlighted").referenceSha256}`,
      )
      .digest("hex")
      .slice(0, 16)
  : buildIntegrityReleaseId({
      backgroundReleaseId: releaseDescriptor.releaseId,
      objects: inventoryById.get("highlighted").objects,
    });
const integrityVerificationId = createIntegrityVerificationId();
const bindingInventory =
  localOnly || objectHeads
    ? null
    : await fetchR2BindingInventory({
        origin: inventoryOrigin,
        scope: "poi",
        releaseId: integrityReleaseId,
        verificationId: integrityVerificationId,
      });

const tilesets = [];
for (const definition of definitions) {
  const inventory =
    inventoryById.get(definition.id) ??
    (deployment && definition.id === "background"
      ? {
          complete: true,
          manifestCount: 0,
          referenceCount: releaseDescriptor.objectCount,
          objectCount: releaseDescriptor.objectCount,
          errors: [],
        }
      : null);
  if (!inventory) throw new Error(`Missing local inventory ${definition.id}`);
  const remote = localOnly
    ? null
    : objectHeads
      ? await auditRemoteTilesetObjects({
          objects: inventory.objects,
          origin,
          concurrency,
          onProgress: (checked, total) =>
            console.error(
              `${definition.id}: verified ${checked}/${total} published objects`,
            ),
        })
      : deployment && definition.id === "background"
        ? (() => {
            const published = bindingInventory.tilesets?.find(
              ({ id }) => id === definition.id,
            );
            const errors = [];
            if (!published)
              errors.push({
                kind: "inventory-missing",
                path: definition.id,
                message: "The R2 binding report omitted this tileset",
              });
            else {
              if (!published.complete)
                errors.push(
                  ...(published.errors?.length
                    ? published.errors
                    : [
                        {
                          kind: "published-inventory-incomplete",
                          path: definition.id,
                          message: `${published.errorCount ?? "unknown"} published inventory errors`,
                        },
                      ]),
                );
            }
            return { complete: errors.length === 0, errors };
          })()
        : compareR2BindingInventory({
            id: definition.id,
            inventory,
            published: bindingInventory.tilesets?.find(
              ({ id }) => id === definition.id,
            ),
            requireObjectMetadata:
              definition.id === "highlighted" && !deployment,
            requireReferenceParity:
              !deployment && (!preDeploy || definition.id !== "highlighted"),
          });
  tilesets.push({
    id: definition.id,
    complete: inventory.complete && (remote?.complete ?? true),
    manifestCount: inventory.manifestCount,
    referenceCount: inventory.referenceCount,
    objectCount: inventory.objectCount,
    localErrors: inventory.errors,
    remoteErrors: remote?.errors ?? [],
  });
}

const report = {
  schemaVersion: 1,
  complete: tilesets.every(({ complete }) => complete),
  mode: localOnly
    ? "local"
    : objectHeads
      ? "published-r2-object-heads"
      : deployment
        ? "deployment-r2-binding-inventory"
        : preDeploy
          ? "pre-deploy-r2-binding-inventory"
          : "r2-binding-inventory",
  origin: localOnly ? null : origin,
  inventoryOrigin: localOnly || objectHeads ? null : inventoryOrigin,
  integrityReleaseId,
  integrityVerificationId,
  requestBudget: {
    publicIntegrityRequests: localOnly || objectHeads ? 0 : 1,
    publicObjectRequests: objectHeads
      ? tilesets.reduce((sum, item) => sum + item.objectCount, 0)
      : 0,
  },
  checkedAt: new Date().toISOString(),
  summary: {
    manifestCount: tilesets.reduce((sum, item) => sum + item.manifestCount, 0),
    referenceCount: tilesets.reduce(
      (sum, item) => sum + item.referenceCount,
      0,
    ),
    objectCount: tilesets.reduce((sum, item) => sum + item.objectCount, 0),
    localErrorCount: tilesets.reduce(
      (sum, item) => sum + item.localErrors.length,
      0,
    ),
    remoteErrorCount: tilesets.reduce(
      (sum, item) => sum + item.remoteErrors.length,
      0,
    ),
  },
  tilesets,
};

await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report, reportPath }, null, 2));
if (!report.complete) process.exitCode = 1;
