import fs from "node:fs";
import path from "node:path";

import { b3dmIdentity, inspectGlb, readB3dm } from "./background-lite-b3dm.mjs";
import { atomicWrite, sha256 } from "./background-lite-run.mjs";
import { loadApprovedSnapshot } from "./approved-snapshot.mjs";
import { deriveHighlightEvidence } from "./highlight-overlay-evidence.mjs";
import { extractOverlayFragment } from "./highlight-overlay-fragment.mjs";
import {
  buildSparseAssetHierarchy,
  removeUnreferencedOverlayContent,
  verifyOverlayCatalogueArtifacts,
} from "./highlight-overlay-artifacts.mjs";
import {
  exactOverlaySourceKey,
  selectCanonicalHighlightRecords,
} from "./highlight-overlay-selection.mjs";
import {
  assertOverlayCatalogueContract,
  reconcileOverlayCatalogue,
  stableBuildingIdentity,
} from "./highlight-overlay-reconcile.mjs";

export {
  buildSparseAssetHierarchy,
  deriveHighlightEvidence,
  extractOverlayFragment,
  selectCanonicalHighlightRecords,
  verifyOverlayCatalogueArtifacts,
};

export function loadActiveHighlightInputs({ root, sourceRoot } = {}) {
  const snapshot = loadApprovedSnapshot({ root });
  const pois = JSON.parse(
    fs.readFileSync(path.join(snapshot.directory, snapshot.poisRef), "utf8"),
  );
  return { snapshotId: snapshot.snapshotId, sourceRoot, pois };
}

function readExactSource(record, sourceRoot) {
  const sourceFile =
    record.sourceAuthority === "approved_pristine_source_cache"
      ? path.join(
          path.dirname(path.resolve(sourceRoot)),
          record.sourceArtifactPath,
        )
      : path.join(path.resolve(sourceRoot), record.sourcePath);
  const source = fs.readFileSync(sourceFile);
  if (sha256(source) !== record.sourceSha256)
    throw new Error(
      `Exact source hash changed for ${record.sourcePath}#${record.batchId}`,
    );
  return source;
}

function assertExpectedBuildingCoverage(catalogue, selectedRecords) {
  const expected = new Map();
  for (const record of selectedRecords)
    expected.set(stableBuildingIdentity(record), {
      gmlId: record.gmlId,
      ownerPoiIds: [...(record.ownerPoiIds ?? [])].sort(),
    });
  if (catalogue.buildings?.length !== expected.size)
    throw new Error("Overlay active building coverage count mismatch");
  for (const building of catalogue.buildings) {
    const selected = expected.get(building.buildingIdentity);
    if (
      !selected ||
      selected.gmlId !== building.gmlId ||
      JSON.stringify(selected.ownerPoiIds) !==
        JSON.stringify(building.ownerPoiIds)
    )
      throw new Error(
        `Overlay active building coverage mismatch: ${building.buildingIdentity}`,
      );
  }
}

async function buildFragmentGroup(records, sourceRoot, resolvedOutput) {
  const ordered = [...records].sort(
    (left, right) =>
      left.batchId - right.batchId || left.gmlId.localeCompare(right.gmlId),
  );
  const byBatchId = new Map();
  for (const record of ordered) {
    const existing = byBatchId.get(record.batchId);
    if (existing && existing.gmlId !== record.gmlId)
      throw new Error(
        `Contradictory identities for ${record.sourcePath}#${record.batchId}`,
      );
    byBatchId.set(record.batchId, record);
  }
  const selected = [...byBatchId.values()];
  const output = await extractOverlayFragment(
    readExactSource(selected[0], sourceRoot),
    { batchIds: selected.map(({ batchId }) => batchId) },
  );
  const outputParts = readB3dm(output, selected[0].sourcePath);
  const outputIdentity = b3dmIdentity(outputParts);
  if (
    outputIdentity.batchLength !== selected.length ||
    outputIdentity.gmlIds.length !== selected.length ||
    outputIdentity.gmlIds.some(
      (gmlId, index) => gmlId !== selected[index].gmlId,
    )
  )
    throw new Error(
      `Extracted overlay identity mismatch for ${selected[0].sourcePath}`,
    );
  const geometry = inspectGlb(outputParts.glb);
  if (geometry.triangles < 1 || geometry.vertices < 1)
    throw new Error(
      `Extracted overlay geometry is empty for ${selected[0].sourcePath}`,
    );
  const outputSha256 = sha256(output);
  const assetId = `asset:${outputSha256}`;
  const relative = `content/${outputSha256}.b3dm`;
  const destination = path.join(resolvedOutput, relative);
  if (
    !fs.existsSync(destination) ||
    sha256(fs.readFileSync(destination)) !== outputSha256
  )
    atomicWrite(destination, output);
  const shared = {
    assetId,
    outputPath: relative,
    outputSha256,
    outputBytes: output.length,
    geometry: {
      vertices: geometry.vertices,
      triangles: geometry.triangles,
      semantics: geometry.semantics,
      dracoSemantics: geometry.dracoSemantics,
    },
    material: { quality: "original", transformed: false },
  };
  return ordered.map((record) => ({ ...record, ...shared }));
}

function buildTileset({ sourceRoot, catalogue, snapshotId }) {
  const sourceTileset = JSON.parse(
    fs.readFileSync(path.join(path.resolve(sourceRoot), "tileset.json")),
  );
  const assets = new Map();
  for (const building of catalogue.buildings)
    for (const fragment of building.fragments) {
      const assetId = fragment.assetId ?? fragment.outputPath;
      const existing = assets.get(assetId) ?? {
        assetId,
        outputPath: fragment.outputPath,
        outputSha256: fragment.outputSha256,
        outputBytes: fragment.outputBytes,
        sourcePath: fragment.sourcePath,
        boundingVolume: fragment.boundingVolume,
        buildingIdentity: new Set(),
        ownerPoiIds: new Set(),
        fragmentIds: new Set(),
      };
      if (
        existing.outputPath !== fragment.outputPath ||
        existing.outputSha256 !== fragment.outputSha256 ||
        existing.outputBytes !== fragment.outputBytes ||
        existing.sourcePath !== fragment.sourcePath ||
        JSON.stringify(existing.boundingVolume) !==
          JSON.stringify(fragment.boundingVolume)
      )
        throw new Error(`Contradictory shared overlay asset: ${assetId}`);
      existing.buildingIdentity.add(building.buildingIdentity);
      for (const owner of building.ownerPoiIds) existing.ownerPoiIds.add(owner);
      existing.fragmentIds.add(fragment.fragmentId);
      assets.set(assetId, existing);
    }
  const root = buildSparseAssetHierarchy(sourceTileset.root, [
    ...assets.values(),
  ]);
  return {
    asset: sourceTileset.asset ?? { version: "1.0" },
    geometricError: sourceTileset.geometricError ?? 0,
    root,
    extras: {
      schemaVersion: catalogue.schemaVersion,
      layout: "sparse-source-hierarchy-finest-v2",
      catalogueId: catalogue.catalogueId,
      snapshotId,
      complete: catalogue.complete,
    },
  };
}

export async function buildOverlayCatalogue({
  sourceRoot,
  outputRoot,
  snapshotId,
  pois,
  previousCatalogue = null,
  approvedOverlayRoot,
  approvedSourceEvidencePath,
} = {}) {
  const resolvedOutput = path.resolve(outputRoot);
  const evidence = deriveHighlightEvidence({
    snapshotId,
    sourceRoot,
    pois,
    approvedOverlayRoot,
    approvedSourceEvidencePath,
  });
  const sourceTileset = JSON.parse(
    fs.readFileSync(path.join(path.resolve(sourceRoot), "tileset.json")),
  );
  const canonical = selectCanonicalHighlightRecords({
    records: evidence.resolved,
    sourceTileset,
  });
  const prior =
    previousCatalogue ??
    (fs.existsSync(path.join(resolvedOutput, "catalogue.json"))
      ? JSON.parse(
          fs.readFileSync(path.join(resolvedOutput, "catalogue.json"), "utf8"),
        )
      : null);
  const tilesetPath = path.join(resolvedOutput, "tileset.json");
  const existingTileset = fs.existsSync(tilesetPath)
    ? JSON.parse(fs.readFileSync(tilesetPath, "utf8"))
    : null;
  const expectedBuildingIdentities = new Set(
    canonical.resolved.map(stableBuildingIdentity),
  );
  if (
    prior?.schemaVersion === "local-highlight-overlays-v2" &&
    prior.selectionPolicy === "one-finest-source-lod-per-building-v1" &&
    prior.snapshotId === snapshotId &&
    prior.evidenceIdentity === evidence.evidenceIdentity &&
    prior.complete === true &&
    canonical.review.length === 0 &&
    evidence.review.length === 0 &&
    prior.buildings?.length === expectedBuildingIdentities.size &&
    prior.buildings.every(({ buildingIdentity }) =>
      expectedBuildingIdentities.has(buildingIdentity),
    ) &&
    existingTileset?.extras?.layout === "sparse-source-hierarchy-finest-v2"
  ) {
    const tileset = existingTileset;
    assertExpectedBuildingCoverage(prior, canonical.resolved);
    const verification = verifyOverlayCatalogueArtifacts({
      sourceRoot,
      outputRoot: resolvedOutput,
      catalogue: prior,
      tileset,
    });
    return {
      complete: true,
      noOp: true,
      counts: {
        create: 0,
        update: 0,
        noop: prior.uniqueBuildingCount,
        expire: 0,
        review: 0,
      },
      catalogue: prior,
      tileset,
      evidence,
      verification,
      selection: {
        sourceClaimCount: canonical.sourceClaimCount,
        selectedSourceRecordCount: canonical.resolved.length,
        reviewCount: 0,
      },
    };
  }
  const records = [...evidence.review, ...canonical.review];
  const sourceGroups = new Map();
  for (const record of canonical.resolved) {
    const key = exactOverlaySourceKey(record);
    const group = sourceGroups.get(key) ?? [];
    group.push(record);
    sourceGroups.set(key, group);
  }
  for (const group of sourceGroups.values())
    records.push(
      ...(await buildFragmentGroup(group, sourceRoot, resolvedOutput)),
    );
  const { catalogue, counts } = reconcileOverlayCatalogue({
    snapshotId,
    evidenceIdentity: evidence.evidenceIdentity,
    records,
    previousCatalogue: prior,
  });
  assertExpectedBuildingCoverage(catalogue, canonical.resolved);
  const tileset = buildTileset({ sourceRoot, catalogue, snapshotId });
  assertOverlayCatalogueContract({ catalogue, tileset });
  atomicWrite(
    path.join(resolvedOutput, "tileset.json"),
    `${JSON.stringify(tileset, null, 2)}\n`,
  );
  atomicWrite(
    path.join(resolvedOutput, "catalogue.json"),
    `${JSON.stringify(catalogue, null, 2)}\n`,
  );
  const removedContent = removeUnreferencedOverlayContent(
    resolvedOutput,
    catalogue,
  );
  const verification = verifyOverlayCatalogueArtifacts({
    sourceRoot,
    outputRoot: resolvedOutput,
    catalogue,
    tileset,
  });
  atomicWrite(
    path.join(resolvedOutput, "verification.json"),
    `${JSON.stringify({ ...verification, removedContentCount: removedContent.length }, null, 2)}\n`,
  );
  return {
    complete: catalogue.complete,
    counts,
    catalogue,
    tileset,
    evidence,
    verification,
    selection: {
      sourceClaimCount: canonical.sourceClaimCount,
      selectedSourceRecordCount: canonical.resolved.length,
      reviewCount: canonical.review.length,
    },
  };
}
