import fs from "node:fs";
import path from "node:path";

const json = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));
const sorted = (values) => [...new Set(values)].sort();

export function parseB3dmGmlIds(bytes) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length < 28 ||
    bytes.toString("ascii", 0, 4) !== "b3dm"
  )
    throw new Error("Remote object is not a valid B3DM header");
  const declaredLength = bytes.readUInt32LE(8);
  const featureJsonLength = bytes.readUInt32LE(12);
  const featureBinaryLength = bytes.readUInt32LE(16);
  const batchJsonLength = bytes.readUInt32LE(20);
  const batchBinaryLength = bytes.readUInt32LE(24);
  const batchStart = 28 + featureJsonLength + featureBinaryLength;
  const batchEnd = batchStart + batchJsonLength;
  const payloadEnd = batchEnd + batchBinaryLength;
  if (
    declaredLength < bytes.length ||
    batchStart < 28 ||
    batchEnd > bytes.length ||
    (declaredLength === bytes.length && payloadEnd > bytes.length)
  )
    throw new Error("B3DM byte lengths are malformed");
  if (batchJsonLength === 0) return [];
  let batchTable;
  try {
    batchTable = JSON.parse(
      bytes
        .subarray(batchStart, batchEnd)
        .toString("utf8")
        .replace(/\0+$/u, "")
        .trim(),
    );
  } catch {
    throw new Error("B3DM batch table JSON is malformed");
  }
  const ids = batchTable["gml:id"];
  if (ids === undefined) return [];
  if (!Array.isArray(ids) || ids.some((value) => typeof value !== "string"))
    throw new Error("B3DM gml:id batch property is malformed");
  return sorted(ids);
}

function activeSnapshot(root) {
  const pointer = json(path.join(root, "data/approved-snapshot.json"));
  const directory = path.join(root, "data/snapshots", pointer.snapshotId);
  const manifest = json(path.join(directory, "manifest.json"));
  if (manifest.snapshotId !== pointer.snapshotId)
    throw new Error("Approved snapshot pointer and manifest do not match");
  return {
    snapshotId: pointer.snapshotId,
    pois: json(path.join(directory, manifest.poisRef)),
  };
}

export function deriveActiveBackgroundObjects({ root }) {
  const snapshot = activeSnapshot(root);
  const objects = new Map();
  for (const poi of snapshot.pois) {
    if (
      !poi ||
      typeof poi.id !== "string" ||
      typeof poi.data !== "string" ||
      !poi.tiles ||
      typeof poi.tiles !== "object"
    )
      throw new Error("Active POI record is malformed");
    const manifestPath = path.join(
      root,
      "public",
      path.dirname(poi.data),
      "extraction-manifest.json",
    );
    const extraction = json(manifestPath);
    const bySource = new Map(
      (extraction.tiles ?? []).map((tile) => [tile.sourceTile, tile]),
    );
    for (const sourceTile of Object.keys(poi.tiles)) {
      const tile = bySource.get(sourceTile);
      if (!tile)
        throw new Error(
          `${poi.id} has no extraction evidence for ${sourceTile}`,
        );
      const objectKey =
        tile.backgroundFile ??
        sourceTile.replace(/^tiles\//u, "optimized-tiles/");
      if (
        !objectKey.startsWith("optimized-tiles/") ||
        !objectKey.endsWith(".b3dm")
      )
        throw new Error(`Invalid background object key: ${objectKey}`);
      const selectedGmlIds = sorted(tile.gmlIds ?? []);
      if (selectedGmlIds.length === 0)
        throw new Error(
          `${poi.id} has no selected GML identity for ${sourceTile}`,
        );
      const localPath = path.join(root, objectKey);
      const existing = objects.get(objectKey);
      if (existing) {
        if (existing.sha256 !== tile.backgroundSha256)
          throw new Error(`Conflicting approved hashes for ${objectKey}`);
        existing.owners.push(poi.id);
        existing.selectedGmlIds.push(...selectedGmlIds);
        existing.sourcePaths.push(path.join(root, sourceTile));
        for (const gmlId of selectedGmlIds) {
          existing.ownersByGmlId[gmlId] ??= [];
          existing.ownersByGmlId[gmlId].push(poi.id);
        }
        if (tile.sourceSha256) existing.sourceSha256s.push(tile.sourceSha256);
      } else {
        if (!fs.existsSync(localPath))
          throw new Error(
            `Approved background object is missing: ${objectKey}`,
          );
        const match = objectKey.match(/_(\d+)\.b3dm$/u);
        objects.set(objectKey, {
          objectKey,
          localPath,
          sha256: tile.backgroundSha256,
          byteLength: fs.statSync(localPath).size,
          level: match ? Number(match[1]) : null,
          selectedGmlIds,
          owners: [poi.id],
          ownersByGmlId: Object.fromEntries(
            selectedGmlIds.map((gmlId) => [gmlId, [poi.id]]),
          ),
          sourceSha256s: tile.sourceSha256 ? [tile.sourceSha256] : [],
          sourcePaths: [path.join(root, sourceTile)],
        });
      }
    }
  }
  const result = [...objects.values()]
    .map((item) => ({
      ...item,
      owners: sorted(item.owners),
      selectedGmlIds: sorted(item.selectedGmlIds),
      ownersByGmlId: Object.fromEntries(
        Object.entries(item.ownersByGmlId)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([gmlId, owners]) => [gmlId, sorted(owners)]),
      ),
      sourceSha256s: sorted(item.sourceSha256s),
      sourcePaths: sorted(item.sourcePaths),
      sourceSha256:
        sorted(item.sourceSha256s).length === 1
          ? sorted(item.sourceSha256s)[0]
          : null,
    }))
    .sort((a, b) => a.objectKey.localeCompare(b.objectKey));
  return {
    snapshotId: snapshot.snapshotId,
    pois: snapshot.pois,
    objects: result,
  };
}
