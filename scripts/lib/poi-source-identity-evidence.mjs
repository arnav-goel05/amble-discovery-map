import path from "node:path";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SOURCE_TILE_PATTERN = /^tiles\/(?:\d+\/)+[^/]+\.b3dm$/u;

function fail(message) {
  throw new Error(`POI source identity evidence: ${message}`);
}

export function normalizeSourceTile(value) {
  if (typeof value !== "string") fail("source tile is missing");
  const normalized = value.replace(/^optimized-tiles\//u, "tiles/");
  if (
    !SOURCE_TILE_PATTERN.test(normalized) ||
    normalized.includes("..") ||
    path.isAbsolute(normalized)
  )
    fail(`unsafe source tile ${value}`);
  return normalized;
}

export function parseB3dmGmlIds(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.toString("utf8", 0, 4) !== "b3dm")
    fail("source object is not a B3DM tile");
  if (bytes.length < 28) fail("source B3DM header is truncated");
  const featureJsonLength = bytes.readUInt32LE(12);
  const featureBinaryLength = bytes.readUInt32LE(16);
  const batchJsonLength = bytes.readUInt32LE(20);
  const start = 28 + featureJsonLength + featureBinaryLength;
  const end = start + batchJsonLength;
  if (end > bytes.length) fail("source B3DM batch table is truncated");
  let table;
  try {
    table = JSON.parse(bytes.subarray(start, end).toString("utf8").trim());
  } catch {
    fail("source B3DM batch table is invalid JSON");
  }
  const gmlIds = table?.["gml:id"];
  if (
    !Array.isArray(gmlIds) ||
    gmlIds.some((value) => typeof value !== "string" || value.length === 0) ||
    new Set(gmlIds).size !== gmlIds.length
  )
    fail("source B3DM gml:id table is missing or invalid");
  return gmlIds;
}

export function indexPoiSourceIdentityEvidence({
  evidence,
  expectedSnapshotId = null,
}) {
  if (evidence?.schemaVersion !== "poi-source-identity-evidence-v1")
    fail("schema version is invalid");
  if (typeof evidence.snapshotId !== "string" || !evidence.snapshotId)
    fail("snapshot ID is missing");
  if (expectedSnapshotId && evidence.snapshotId !== expectedSnapshotId)
    fail(
      `snapshot mismatch: expected ${expectedSnapshotId}, received ${evidence.snapshotId}`,
    );
  if (!Array.isArray(evidence.records) || evidence.records.length === 0)
    fail("records are missing");
  const records = new Map();
  for (const record of evidence.records) {
    const sourceTile = normalizeSourceTile(record?.sourceTile);
    if (!SHA256_PATTERN.test(record?.sourceSha256 ?? ""))
      fail(`${sourceTile} has an invalid source hash`);
    if (
      !Array.isArray(record.gmlIds) ||
      record.gmlIds.some(
        (value) => typeof value !== "string" || value.length === 0,
      ) ||
      new Set(record.gmlIds).size !== record.gmlIds.length
    )
      fail(`${sourceTile} has an invalid gml:id table`);
    if (records.has(sourceTile)) fail(`${sourceTile} is duplicated`);
    records.set(sourceTile, {
      sourceTile,
      sourceSha256: record.sourceSha256,
      gmlIds: [...record.gmlIds],
    });
  }
  return records;
}
