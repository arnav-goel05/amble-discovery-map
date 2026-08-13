import fs from "node:fs";
import path from "node:path";

import { b3dmIdentity, readB3dm } from "./background-lite-b3dm.mjs";
import {
  canonicalJson,
  canonicalSourcePath,
  sha256,
} from "./background-lite-run.mjs";
import { assertOverlayCatalogueContract } from "./highlight-overlay-reconcile.mjs";

function spatialSourceIndex(sourceRoot) {
  const byContent = new Map();
  const visit = (tile, tilePath) => {
    const raw = tile.content?.uri ?? tile.content?.url;
    if (raw) {
      const sourcePath = canonicalSourcePath(raw.split("?")[0]);
      if (byContent.has(sourcePath))
        throw new Error(`Duplicate spatial source content: ${sourcePath}`);
      byContent.set(sourcePath, { tile, tilePath });
    }
    for (const [index, child] of (tile.children ?? []).entries())
      visit(child, [...tilePath, index]);
  };
  visit(sourceRoot, []);
  return byContent;
}

function cloneSpatialNode(source) {
  const node = {
    boundingVolume: source.boundingVolume,
    geometricError: Number(source.geometricError ?? 0),
    refine: "ADD",
    extras: { kind: "overlay-spatial-node" },
  };
  if (source.transform) node.transform = source.transform;
  return node;
}

function sourceFamily(value) {
  return value.replace(/_\d+(?=\.b3dm$)/u, "");
}

export function buildSparseAssetHierarchy(sourceRoot, assets) {
  const byContent = spatialSourceIndex(sourceRoot);
  const attachments = new Map();
  const requiredPaths = new Set([""]);
  for (const asset of assets) {
    const sourceEntry = byContent.get(asset.sourcePath);
    if (!sourceEntry)
      throw new Error(
        `Overlay source is absent from spatial hierarchy: ${asset.sourcePath}`,
      );
    const family = sourceFamily(asset.sourcePath);
    const familyEntries = [...byContent.entries()]
      .filter(([sourcePath]) => sourceFamily(sourcePath) === family)
      .map(([, entry]) => entry);
    const coarsest = familyEntries.reduce((selected, entry) =>
      entry.tilePath.length < selected.tilePath.length ? entry : selected,
    );
    // Attach finest payload beside the coarsest LOD branch. Attaching it at
    // the finest node's parent leaves the content below the renderer's normal
    // screen-space-error stopping point, so no overlay tile is ever selected.
    const attachmentPath = coarsest.tilePath.slice(0, -1);
    const key = attachmentPath.join(".");
    const attached = attachments.get(key) ?? [];
    attached.push(asset);
    attachments.set(key, attached);
    for (let length = 0; length <= attachmentPath.length; length += 1)
      requiredPaths.add(attachmentPath.slice(0, length).join("."));
  }
  const clone = (sourceNode, tilePath) => {
    const key = tilePath.join(".");
    const node = cloneSpatialNode(sourceNode);
    const children = [];
    for (const [index, child] of (sourceNode.children ?? []).entries()) {
      const childPath = [...tilePath, index];
      if (requiredPaths.has(childPath.join(".")))
        children.push(clone(child, childPath));
    }
    children.push(
      ...(attachments.get(key) ?? [])
        .sort((left, right) => left.assetId.localeCompare(right.assetId))
        .map((asset) => ({
          boundingVolume: asset.boundingVolume,
          geometricError: 0,
          refine: "ADD",
          content: { uri: asset.outputPath },
          extras: {
            kind: "overlay-fragment",
            assetId: asset.assetId,
            sourcePath: asset.sourcePath,
            buildingIdentities: [...asset.buildingIdentity].sort(),
            ownerPoiIds: [...asset.ownerPoiIds].sort(),
            fragmentIds: [...asset.fragmentIds].sort(),
          },
        })),
    );
    node.children = children;
    return node;
  };
  return clone(sourceRoot, []);
}

export function collectReferencedOverlayAssets(catalogue) {
  const assets = new Map();
  for (const building of catalogue.buildings ?? [])
    for (const fragment of building.fragments ?? []) {
      const assetId = fragment.assetId ?? `asset:${fragment.outputSha256}`;
      const existing = assets.get(assetId) ?? {
        assetId,
        outputPath: fragment.outputPath,
        outputSha256: fragment.outputSha256,
        outputBytes: fragment.outputBytes,
        gmlIds: new Set(),
      };
      if (
        existing.outputPath !== fragment.outputPath ||
        existing.outputSha256 !== fragment.outputSha256 ||
        existing.outputBytes !== fragment.outputBytes
      )
        throw new Error(`Contradictory shared overlay asset: ${assetId}`);
      existing.gmlIds.add(building.gmlId);
      assets.set(assetId, existing);
    }
  return assets;
}

export function removeUnreferencedOverlayContent(outputRoot, catalogue) {
  const contentRoot = path.join(outputRoot, "content");
  if (!fs.existsSync(contentRoot)) return [];
  const referenced = new Set(
    [...collectReferencedOverlayAssets(catalogue).values()].map(
      ({ outputPath }) => path.basename(outputPath),
    ),
  );
  const removed = [];
  for (const filename of fs.readdirSync(contentRoot)) {
    if (!filename.endsWith(".b3dm") || referenced.has(filename)) continue;
    fs.unlinkSync(path.join(contentRoot, filename));
    removed.push(filename);
  }
  return removed.sort();
}

export function verifyOverlayCatalogueArtifacts({
  sourceRoot,
  outputRoot,
  catalogue,
  tileset,
} = {}) {
  const contract = assertOverlayCatalogueContract({ catalogue, tileset });
  const { catalogueId, ...catalogueContent } = catalogue;
  if (sha256(canonicalJson(catalogueContent)) !== catalogueId)
    throw new Error("Overlay catalogue identity mismatch");
  const assets = collectReferencedOverlayAssets(catalogue);
  const expectedFiles = new Set(
    [...assets.values()].map(({ outputPath }) => path.basename(outputPath)),
  );
  const contentRoot = path.join(path.resolve(outputRoot), "content");
  const actualFiles = fs
    .readdirSync(contentRoot)
    .filter((filename) => filename.endsWith(".b3dm"));
  if (
    actualFiles.length !== expectedFiles.size ||
    actualFiles.some((filename) => !expectedFiles.has(filename))
  )
    throw new Error("Overlay content contains missing or stale assets");
  let uniqueAssetBytes = 0;
  for (const asset of assets.values()) {
    const filename = path.join(path.resolve(outputRoot), asset.outputPath);
    const bytes = fs.readFileSync(filename);
    if (
      bytes.length !== asset.outputBytes ||
      sha256(bytes) !== asset.outputSha256
    )
      throw new Error(`Overlay asset bytes changed: ${asset.assetId}`);
    const identity = b3dmIdentity(readB3dm(bytes, filename));
    const actualGmlIds = [...identity.gmlIds].sort();
    const expectedGmlIds = [...asset.gmlIds].sort();
    if (
      actualGmlIds.length !== expectedGmlIds.length ||
      actualGmlIds.some((gmlId, index) => gmlId !== expectedGmlIds[index])
    )
      throw new Error(`Overlay asset identity mismatch: ${asset.assetId}`);
    uniqueAssetBytes += bytes.length;
  }
  const sources = new Map();
  for (const building of catalogue.buildings ?? []) {
    const fragment = building.fragments[0];
    if (
      fragment.material?.quality !== "original" ||
      fragment.material?.transformed !== false ||
      fragment.lodSelection?.strategy !== "minimum-source-geometric-error"
    )
      throw new Error(
        `Overlay quality contract mismatch: ${building.buildingIdentity}`,
      );
    const sourceFile =
      fragment.sourceAuthority === "approved_pristine_source_cache"
        ? path.join(
            path.dirname(path.resolve(sourceRoot)),
            fragment.sourceProvenance?.pristineCachePath ?? "",
          )
        : path.join(path.resolve(sourceRoot), fragment.sourcePath);
    sources.set(`${sourceFile}\n${fragment.sourceSha256}`, {
      sourceFile,
      sourceSha256: fragment.sourceSha256,
    });
  }
  for (const { sourceFile, sourceSha256 } of sources.values())
    if (sha256(fs.readFileSync(sourceFile)) !== sourceSha256)
      throw new Error(`Overlay source provenance changed: ${sourceFile}`);
  if (
    catalogue.uniqueAssetCount !== assets.size ||
    catalogue.uniqueAssetBytes !== uniqueAssetBytes
  )
    throw new Error("Overlay unique payload accounting mismatch");
  return {
    schemaVersion: "local-highlight-overlay-verification-v2",
    catalogueId,
    ...contract,
    uniqueAssetBytes,
    sourceObjectCount: sources.size,
    noStaleContent: true,
    originalQuality: true,
    sourceProvenanceVerified: true,
    spatialLayout: tileset.extras?.layout ?? null,
    complete: catalogue.complete === true && catalogue.unresolved.length === 0,
  };
}
