import { createHash } from "node:crypto";
import { parseB3dmGmlIds } from "./background-geometry-evidence.mjs";

export {
  deriveActiveBackgroundObjects,
  parseB3dmGmlIds,
} from "./background-geometry-evidence.mjs";

const AUDIT_SCHEMA_VERSION = "background-geometry-audit-v1";
const RELEASE_SCHEMA_VERSION = "background-geometry-release-v1";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sorted = (values) => [...new Set(values)].sort();

export function classifyRemoteObject(item, remoteBytes) {
  if (
    remoteBytes &&
    !Buffer.isBuffer(remoteBytes) &&
    remoteBytes.matchesLocal === true
  )
    return {
      objectKey: item.objectKey,
      status: "matched",
      remoteState: "current",
      remoteSha256: item.sha256,
      remoteByteLength: remoteBytes.remoteByteLength ?? item.byteLength,
      retainedGmlIds: [],
      affectedVenueIds: [],
    };
  if (
    remoteBytes &&
    !Buffer.isBuffer(remoteBytes) &&
    Array.isArray(remoteBytes.remoteGmlIds)
  ) {
    const selected = new Set(item.selectedGmlIds);
    const retainedGmlIds = sorted(
      remoteBytes.remoteGmlIds.filter((gmlId) => selected.has(gmlId)),
    );
    const affectedVenueIds = sorted(
      retainedGmlIds.flatMap(
        (gmlId) => item.ownersByGmlId?.[gmlId] ?? item.owners ?? [],
      ),
    );
    return {
      objectKey: item.objectKey,
      status: "stale",
      remoteState:
        remoteBytes.remoteState ??
        (retainedGmlIds.length > 0 ? "intermediate" : "unknown"),
      remoteSha256: null,
      remoteByteLength: remoteBytes.remoteByteLength ?? null,
      retainedGmlIds,
      affectedVenueIds,
    };
  }
  if (!Buffer.isBuffer(remoteBytes)) remoteBytes = Buffer.from(remoteBytes);
  const remoteSha256 = digest(remoteBytes);
  if (remoteSha256 === item.sha256)
    return {
      objectKey: item.objectKey,
      status: "matched",
      remoteState: "current",
      remoteSha256,
      remoteByteLength: remoteBytes.length,
      retainedGmlIds: [],
      affectedVenueIds: [],
    };
  const remoteGmlIds = parseB3dmGmlIds(remoteBytes);
  const selected = new Set(item.selectedGmlIds);
  const retainedGmlIds = remoteGmlIds.filter((gmlId) => selected.has(gmlId));
  const affectedVenueIds = sorted(
    retainedGmlIds.flatMap(
      (gmlId) => item.ownersByGmlId?.[gmlId] ?? item.owners ?? [],
    ),
  );
  const pristineHashes = new Set(
    [item.sourceSha256, ...(item.sourceSha256s ?? [])].filter(Boolean),
  );
  return {
    objectKey: item.objectKey,
    status: "stale",
    remoteState: pristineHashes.has(remoteSha256)
      ? "pristine"
      : retainedGmlIds.length > 0
        ? "intermediate"
        : "unknown",
    remoteSha256,
    remoteByteLength: remoteBytes.length,
    retainedGmlIds,
    affectedVenueIds,
  };
}

export function buildReleaseIdentity(snapshotId, objects) {
  const payload = objects
    .map(({ objectKey, sha256 }) => `${objectKey}\0${sha256}`)
    .sort()
    .join("\n");
  return {
    schemaVersion: RELEASE_SCHEMA_VERSION,
    releaseId: digest(`${snapshotId}\n${payload}`).slice(0, 16),
    snapshotId,
    objectCount: objects.length,
  };
}

function summarize(results) {
  const retained = sorted(results.flatMap((result) => result.retainedGmlIds ?? []));
  const venues = sorted(results.flatMap((result) => result.affectedVenueIds ?? []));
  return {
    checkedObjects: results.length,
    matchedObjects: results.filter(({ status }) => status === "matched").length,
    staleObjects: results.filter(({ status }) => status === "stale").length,
    failedObjects: results.filter(({ status }) => status === "failed").length,
    retainedIdentityCount: retained.length,
    affectedVenueCount: venues.length,
  };
}

export async function auditBackgroundObjects({
  snapshotId,
  objects,
  origin,
  fetchObject,
  mode = "audit",
  concurrency = 8,
}) {
  const startedAt = new Date().toISOString();
  const results = new Array(objects.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < objects.length) {
      const index = cursor;
      cursor += 1;
      const item = objects[index];
    try {
        results[index] = classifyRemoteObject(item, await fetchObject(item));
    } catch (error) {
        results[index] = {
        objectKey: item.objectKey,
        status: "failed",
        remoteState: "unavailable",
        remoteSha256: null,
        remoteByteLength: null,
        retainedGmlIds: [],
        affectedVenueIds: [],
        error: {
          code: "remote_object_unverifiable",
          message: String(error?.message ?? error).slice(0, 500),
        },
        };
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.max(1, Math.min(concurrency, objects.length)) },
      () => worker(),
    ),
  );
  const summary = summarize(results);
  return {
    schemaVersion: AUDIT_SCHEMA_VERSION,
    ...buildReleaseIdentity(snapshotId, objects),
    origin,
    mode,
    startedAt,
    completedAt: new Date().toISOString(),
    summary,
    objects: results,
    complete:
      summary.staleObjects === 0 &&
      summary.failedObjects === 0 &&
      summary.retainedIdentityCount === 0,
  };
}

function contentKey(uri) {
  try {
    const parsed = new URL(uri, "https://tiles.invalid/optimized-tiles/");
    return parsed.pathname
      .replace(/^\/+/u, "")
      .replace(/^optimized-tiles\//u, "");
  } catch {
    return null;
  }
}

export function rewriteTilesetForRelease(tileset, objects) {
  const copy = structuredClone(tileset);
  const hashes = new Map(
    objects.map(({ objectKey, sha256 }) => [
      objectKey.replace(/^optimized-tiles\//u, ""),
      sha256,
    ]),
  );
  const visit = (tile) => {
    for (const field of ["uri", "url"]) {
      const uri = tile?.content?.[field];
      if (typeof uri !== "string") continue;
      const key = contentKey(uri);
      const sha256 = hashes.get(key);
      if (!sha256) continue;
      tile.content[field] = `${uri.split("?")[0]}?backgroundObject=${sha256}`;
    }
    for (const child of tile?.children ?? []) visit(child);
  };
  visit(copy.root);
  return copy;
}

async function retry(operation, attempts) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export async function synchronizeBackgroundRelease({
  snapshotId,
  objects,
  sourceTileset,
  origin,
  fetchObject,
  fetchVerifiedObject = fetchObject,
  uploadObject,
  publishManifest,
  retryAttempts = 3,
  concurrency = 4,
}) {
  const before = await auditBackgroundObjects({
    snapshotId,
    objects,
    origin,
    fetchObject,
    mode: "sync",
    concurrency,
  });
  if (before.summary.failedObjects > 0)
    throw new Error(
      `Preflight audit failed for ${before.summary.failedObjects} object(s)`,
    );
  const staleKeys = new Set(
    before.objects
      .filter(({ status }) => status === "stale")
      .map(({ objectKey }) => objectKey),
  );
  const staleObjects = objects.filter((item) => staleKeys.has(item.objectKey));
  let uploadCursor = 0;
  const uploadWorker = async () => {
    while (uploadCursor < staleObjects.length) {
      const index = uploadCursor;
      uploadCursor += 1;
      const item = staleObjects[index];
      await retry(() => uploadObject(item), retryAttempts);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.max(1, Math.min(concurrency, staleObjects.length)) },
      () => uploadWorker(),
    ),
  );

  const after = await auditBackgroundObjects({
    snapshotId,
    objects,
    origin,
    fetchObject: fetchVerifiedObject,
    mode: "sync",
    concurrency,
  });
  if (!after.complete)
    throw new Error(
      `Post-upload audit is incomplete: ${after.summary.staleObjects} stale, ${after.summary.failedObjects} failed`,
    );
  const identity = buildReleaseIdentity(snapshotId, objects);
  const manifest = rewriteTilesetForRelease(sourceTileset, objects);
  await publishManifest(manifest, identity);
  return {
    ...after,
    summary: {
      ...after.summary,
      uploadedObjects: staleKeys.size,
      skippedObjects: objects.length - staleKeys.size,
    },
    manifest,
  };
}

export function releaseDescriptor({
  snapshotId,
  objects,
  manifestBytes,
  verifiedAt = new Date().toISOString(),
}) {
  const identity = buildReleaseIdentity(snapshotId, objects);
  return {
    schemaVersion: RELEASE_SCHEMA_VERSION,
    ...identity,
    tilesetUrl: `optimized-tiles/tileset.json?backgroundRelease=${identity.releaseId}`,
    manifestSha256: digest(manifestBytes),
    verifiedAt,
  };
}
