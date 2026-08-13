import {
  canonicalJson,
  canonicalSourcePath,
  sha256,
} from "./background-lite-run.mjs";

const sortedUnique = (values) => [...new Set(values)].sort();

export function stableBuildingIdentity({ gmlId }) {
  const identity = String(gmlId ?? "").trim();
  if (!identity) throw new Error("A source-backed gml:id is required");
  return `building:${sha256(identity).slice(0, 24)}`;
}

function normalizedFragment(record) {
  const sourcePath = canonicalSourcePath(record.sourcePath);
  if (!Number.isInteger(record.batchId) || record.batchId < 0)
    throw new Error(`Invalid batch id for ${sourcePath}`);
  return {
    fragmentId: `fragment:${sha256(`${sourcePath}\n${record.sourceSha256}\n${record.batchId}\n${record.gmlId}`).slice(0, 24)}`,
    sourcePath,
    sourceSha256: record.sourceSha256,
    sourceAuthority: record.sourceAuthority ?? "active_original_source_corpus",
    sourceProvenance: record.sourceProvenance ?? null,
    batchId: record.batchId,
    gmlId: record.gmlId,
    gmlName: record.gmlName ?? null,
    assetId: record.assetId ?? null,
    outputPath: record.outputPath,
    outputSha256: record.outputSha256,
    outputBytes: record.outputBytes,
    boundingVolume: record.boundingVolume ?? null,
    geometry: record.geometry ?? null,
    material: record.material ?? null,
    lodSelection: record.lodSelection ?? null,
  };
}

export function assertOverlayCatalogueContract({ catalogue, tileset } = {}) {
  if (!catalogue || !tileset?.root)
    throw new Error("Overlay catalogue and tileset are required");
  const buildings = new Map();
  const fragments = new Map();
  const expectedAssets = new Map();
  for (const building of catalogue.buildings ?? []) {
    if (buildings.has(building.buildingIdentity))
      throw new Error(
        `Duplicate overlay building identity: ${building.buildingIdentity}`,
      );
    buildings.set(building.buildingIdentity, building);
    if (building.fragments?.length !== 1)
      throw new Error(
        `Overlay building must be reachable exactly once: ${building.buildingIdentity}`,
      );
    const fragment = building.fragments[0];
    if (fragments.has(fragment.fragmentId))
      throw new Error(`Duplicate overlay fragment: ${fragment.fragmentId}`);
    fragments.set(fragment.fragmentId, fragment);
    const assetId = fragment.assetId ?? `asset:${fragment.outputSha256}`;
    const asset = expectedAssets.get(assetId) ?? {
      outputPath: fragment.outputPath,
      buildingIdentities: new Set(),
    };
    if (asset.outputPath !== fragment.outputPath)
      throw new Error(`Contradictory overlay asset path: ${assetId}`);
    asset.buildingIdentities.add(building.buildingIdentity);
    expectedAssets.set(assetId, asset);
  }
  if (tileset.extras?.layout !== "sparse-source-hierarchy-finest-v2")
    throw new Error("Overlay tileset sparse spatial layout is missing");
  const reachableAssets = new Map();
  const visit = (tile) => {
    if (tile.refine !== "ADD")
      throw new Error("Overlay spatial hierarchy must refine with ADD");
    if (tile.content?.uri) {
      const assetId = tile.extras?.assetId;
      if (!assetId) throw new Error("Reachable overlay asset id is missing");
      if (reachableAssets.has(assetId))
        throw new Error(
          `Overlay asset is reachable more than once: ${assetId}`,
        );
      reachableAssets.set(assetId, tile);
      if ((tile.children?.length ?? 0) !== 0)
        throw new Error(`Overlay content asset must be a leaf: ${assetId}`);
    }
    for (const child of tile.children ?? []) visit(child);
  };
  visit(tileset.root);
  if (reachableAssets.size !== expectedAssets.size)
    throw new Error("Reachable overlay asset count does not match catalogue");
  for (const [assetId, expected] of expectedAssets) {
    const tile = reachableAssets.get(assetId);
    if (!tile || tile.content.uri !== expected.outputPath)
      throw new Error(`Overlay asset is not reachable: ${assetId}`);
    const identities = tile.extras?.buildingIdentities ?? [];
    if (
      identities.length !== expected.buildingIdentities.size ||
      identities.some((identity) => !expected.buildingIdentities.has(identity))
    )
      throw new Error(
        `Overlay asset identity reachability mismatch: ${assetId}`,
      );
  }
  return {
    buildingCount: buildings.size,
    fragmentCount: fragments.size,
    assetCount: expectedAssets.size,
    everyBuildingReachableExactlyOnce: true,
    everyAssetReachableExactlyOnce: true,
    sparseAdditiveHierarchy: true,
  };
}

function buildingFingerprint(building) {
  return sha256(
    canonicalJson({
      buildingIdentity: building.buildingIdentity,
      ownerPoiIds: building.ownerPoiIds,
      fragments: building.fragments,
    }),
  );
}

export function reconcileOverlayCatalogue({
  snapshotId,
  evidenceIdentity,
  records,
  previousCatalogue = null,
} = {}) {
  if (!snapshotId || !evidenceIdentity || !Array.isArray(records))
    throw new Error(
      "Snapshot identity, evidence identity, and records are required",
    );

  const groups = new Map();
  const unresolved = [];
  for (const record of records) {
    if (record.state !== "resolved") {
      unresolved.push({
        reviewId: `review:${sha256(canonicalJson(record)).slice(0, 24)}`,
        state: "review",
        sourcePath: record.sourcePath ?? null,
        batchId: record.batchId ?? null,
        ownerPoiIds: sortedUnique(record.ownerPoiIds ?? []),
        reason: record.reason ?? "unresolved_source_evidence",
      });
      continue;
    }
    const buildingIdentity = stableBuildingIdentity(record);
    const group = groups.get(buildingIdentity) ?? {
      buildingIdentity,
      gmlId: record.gmlId,
      ownerPoiIds: new Set(),
      fragments: new Map(),
    };
    for (const owner of record.ownerPoiIds ?? []) group.ownerPoiIds.add(owner);
    const fragment = normalizedFragment(record);
    const existing = group.fragments.get(fragment.fragmentId);
    if (existing && canonicalJson(existing) !== canonicalJson(fragment)) {
      unresolved.push({
        reviewId: `review:${sha256(`${fragment.fragmentId}\nconflict`).slice(0, 24)}`,
        state: "review",
        sourcePath: fragment.sourcePath,
        batchId: fragment.batchId,
        ownerPoiIds: sortedUnique(record.ownerPoiIds ?? []),
        reason: "contradictory_fragment_evidence",
      });
    } else group.fragments.set(fragment.fragmentId, fragment);
    groups.set(buildingIdentity, group);
  }

  const previous = new Map(
    (previousCatalogue?.buildings ?? []).map((item) => [
      item.buildingIdentity,
      item,
    ]),
  );
  const buildings = [...groups.values()]
    .map((group) => {
      const building = {
        buildingIdentity: group.buildingIdentity,
        gmlId: group.gmlId,
        ownerPoiIds: [...group.ownerPoiIds].sort(),
        fragments: [...group.fragments.values()].sort((left, right) =>
          left.fragmentId.localeCompare(right.fragmentId),
        ),
      };
      building.fingerprint = buildingFingerprint(building);
      const old = previous.get(building.buildingIdentity);
      building.action = !old
        ? "create"
        : old.fingerprint === building.fingerprint
          ? "noop"
          : "update";
      return building;
    })
    .sort((left, right) =>
      left.buildingIdentity.localeCompare(right.buildingIdentity),
    );

  const expired = [...previous.values()]
    .filter((item) => !groups.has(item.buildingIdentity))
    .map((item) => ({
      buildingIdentity: item.buildingIdentity,
      ownerPoiIds: item.ownerPoiIds ?? [],
      action: "expire",
    }))
    .sort((left, right) =>
      left.buildingIdentity.localeCompare(right.buildingIdentity),
    );
  const counts = {
    create: buildings.filter(({ action }) => action === "create").length,
    update: buildings.filter(({ action }) => action === "update").length,
    noop: buildings.filter(({ action }) => action === "noop").length,
    expire: expired.length,
    review: unresolved.length,
  };
  const assets = new Map();
  for (const fragment of buildings.flatMap(({ fragments }) => fragments)) {
    const assetId = fragment.assetId ?? `asset:${fragment.outputSha256}`;
    const asset = {
      assetId,
      outputPath: fragment.outputPath,
      outputSha256: fragment.outputSha256,
      outputBytes: fragment.outputBytes,
    };
    const existing = assets.get(assetId);
    if (existing && canonicalJson(existing) !== canonicalJson(asset))
      throw new Error(`Contradictory shared overlay asset: ${assetId}`);
    assets.set(assetId, asset);
  }
  const content = {
    schemaVersion: "local-highlight-overlays-v2",
    selectionPolicy: "one-finest-source-lod-per-building-v1",
    snapshotId,
    evidenceIdentity,
    complete: unresolved.length === 0,
    counts,
    uniqueBuildingCount: buildings.length,
    uniqueFragmentCount: buildings.reduce(
      (sum, item) => sum + item.fragments.length,
      0,
    ),
    uniqueAssetCount: assets.size,
    uniqueAssetBytes: [...assets.values()].reduce(
      (sum, asset) => sum + asset.outputBytes,
      0,
    ),
    uniqueOwnerCount: new Set(buildings.flatMap((item) => item.ownerPoiIds))
      .size,
    buildings,
    expired,
    unresolved,
  };
  const catalogue = {
    ...content,
    catalogueId: sha256(canonicalJson(content)),
  };
  return { catalogue, counts };
}
