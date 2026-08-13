import fs from "node:fs";
import path from "node:path";

import { b3dmIdentity, readB3dm } from "./background-lite-b3dm.mjs";
import {
  canonicalJson,
  canonicalSourcePath,
  indexTileset,
  sha256,
} from "./background-lite-run.mjs";
import {
  createLegacyEvidenceContext,
  validateLegacyExactSource,
} from "./highlight-overlay-legacy-evidence.mjs";

function approvedEvidenceRoot(sourceRoot, configuredRoot) {
  if (configuredRoot) return path.resolve(configuredRoot);
  const candidate = path.join(
    path.dirname(path.resolve(sourceRoot)),
    "public",
    "poi-tiles",
  );
  return fs.existsSync(candidate) ? candidate : null;
}

function loadApprovedGmlEvidence({ root, poi }) {
  if (!root) return null;
  const filename = path.join(root, poi.id, "extraction-manifest.json");
  if (!fs.existsSync(filename))
    return { error: "approved_identity_evidence_missing" };
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(filename, "utf8"));
  } catch {
    return { error: "approved_identity_evidence_invalid" };
  }
  if (manifest.poiId !== poi.id || !Array.isArray(manifest.tiles))
    return { error: "approved_identity_evidence_invalid" };
  const tiles = new Map();
  for (const record of manifest.tiles) {
    let sourcePath;
    try {
      sourcePath = canonicalSourcePath(record.sourceTile);
    } catch {
      return { error: "approved_identity_evidence_invalid" };
    }
    if (
      !Array.isArray(record.originalBatchIds) ||
      !Array.isArray(record.gmlIds) ||
      record.originalBatchIds.length !== record.gmlIds.length ||
      record.gmlIds.some(
        (value) => typeof value !== "string" || !value.trim(),
      ) ||
      new Set(record.originalBatchIds).size !==
        record.originalBatchIds.length ||
      tiles.has(sourcePath)
    )
      return { error: "approved_identity_evidence_invalid" };
    tiles.set(
      sourcePath,
      new Map(
        record.originalBatchIds.map((batchId, index) => [
          batchId,
          {
            originalBatchId: batchId,
            gmlId: record.gmlIds[index],
            gmlName: record.gmlNames?.[index] ?? null,
            sourceSha256: record.sourceSha256 ?? null,
            poiFile: record.poiFile ?? null,
            poiSha256: record.poiSha256 ?? null,
            poiTriangles: record.poiTriangles ?? null,
            manifestGmlIds: [...record.gmlIds],
          },
        ]),
      ),
    );
  }
  return { tiles };
}

function collectCandidateClaims({
  pois,
  nodes,
  resolvedRoot,
  evidenceRoot,
  legacyContext,
  review,
}) {
  const candidates = [];
  for (const poi of pois) {
    const approved = loadApprovedGmlEvidence({ root: evidenceRoot, poi });
    for (const [rawPath, batchIds] of Object.entries(poi.tiles ?? {})) {
      let sourcePath;
      try {
        sourcePath = canonicalSourcePath(rawPath);
      } catch {
        review.push({
          state: "review",
          sourcePath: rawPath,
          ownerPoiIds: [poi.id],
          reason: "invalid_source_path",
        });
        continue;
      }
      const absolute = path.join(resolvedRoot, sourcePath);
      if (!nodes.has(sourcePath) || !fs.existsSync(absolute)) {
        review.push({
          state: "review",
          sourcePath,
          ownerPoiIds: [poi.id],
          reason: "source_tile_missing",
        });
        continue;
      }
      let bytes;
      let identity;
      try {
        bytes = fs.readFileSync(absolute);
        identity = b3dmIdentity(readB3dm(bytes, sourcePath));
      } catch {
        review.push({
          state: "review",
          sourcePath,
          ownerPoiIds: [poi.id],
          reason: "source_tile_invalid",
        });
        continue;
      }
      for (const [claimIndex, requestedBatchId] of (Array.isArray(batchIds)
        ? batchIds
        : []
      ).entries()) {
        const base = {
          state: "review",
          sourcePath,
          batchId: requestedBatchId,
          ownerPoiIds: [poi.id],
        };
        if (!Number.isInteger(requestedBatchId) || requestedBatchId < 0) {
          review.push({ ...base, reason: "batch_out_of_range" });
          continue;
        }
        let batchId = requestedBatchId;
        let resolution = "approved_batch";
        const approvedIdentity = approved?.tiles
          ?.get(sourcePath)
          ?.get(requestedBatchId);
        if (approved?.error) {
          review.push({ ...base, reason: approved.error });
          continue;
        }
        if (approved && !approvedIdentity) {
          review.push({ ...base, reason: "approved_identity_claim_missing" });
          continue;
        }
        if (approvedIdentity) {
          const matches = identity.gmlIds
            .map((gmlId, index) => ({ gmlId, index }))
            .filter(({ gmlId }) => gmlId === approvedIdentity.gmlId);
          if (matches.length > 1) {
            review.push({
              ...base,
              approvedGmlId: approvedIdentity.gmlId,
              reason: "approved_gml_id_ambiguous",
            });
            continue;
          }
          if (matches.length === 1) {
            batchId = matches[0].index;
            resolution =
              batchId === requestedBatchId
                ? "approved_gml_id_at_batch"
                : "approved_gml_id_recovery";
          } else {
            const legacy = validateLegacyExactSource({
              context: legacyContext,
              poiId: poi.id,
              sourcePath,
              approvedIdentity,
            });
            if (!legacy.ok) {
              review.push({
                ...base,
                approvedGmlId: approvedIdentity.gmlId,
                reason: "approved_gml_id_not_found",
                exactLegacyEvidenceFailure: legacy.reason,
              });
              continue;
            }
            batchId = legacy.batchId;
            bytes = legacy.sourceBytes;
            identity = b3dmIdentity(readB3dm(bytes, sourcePath));
            resolution = "approved_pristine_source_cache";
            base.sourceAuthority = legacy.sourceAuthority;
            base.sourceArtifactPath = legacy.sourceArtifactPath;
            base.sourceProvenance = legacy.sourceProvenance;
          }
        } else if (
          batchId >= identity.batchLength ||
          (poi.names?.length && !poi.names.includes(identity.gmlNames[batchId]))
        ) {
          const matches = identity.gmlNames
            .map((name, index) => ({ name, index }))
            .filter(({ name }) => poi.names?.includes(name));
          if (matches.length !== 1) {
            review.push({
              ...base,
              reason:
                matches.length > 1
                  ? "batch_name_ambiguous"
                  : batchId >= identity.batchLength
                    ? "batch_out_of_range"
                    : "batch_name_not_found",
            });
            continue;
          }
          batchId = matches[0].index;
          resolution = "unique_name_recovery";
        }
        const gmlId = identity.gmlIds[batchId];
        const gmlName = identity.gmlNames[batchId];
        if (!gmlId) {
          review.push({ ...base, reason: "building_identity_missing" });
          continue;
        }
        candidates.push({
          state: "resolved",
          sourcePath,
          sourceSha256: sha256(bytes),
          batchId,
          requestedBatchId,
          gmlId,
          gmlName: gmlName ?? null,
          ownerPoiIds: [poi.id],
          boundingVolume: nodes.get(sourcePath).boundingVolume,
          resolution,
          sourceAuthority:
            base.sourceAuthority ?? "active_original_source_corpus",
          sourceArtifactPath: base.sourceArtifactPath ?? null,
          sourceProvenance: base.sourceProvenance ?? {
            sourcePath: `tiles/${sourcePath}`,
            sourceSha256: sha256(bytes),
            exactIdentityOnly: true,
            inferredByNameOrPosition: false,
          },
          claimIndex,
        });
      }
    }
  }
  return candidates;
}

function reconcileCandidateClaims(candidateClaims, review) {
  const rejected = new Set();
  const siblingGroups = new Map();
  for (const [index, record] of candidateClaims.entries()) {
    const family = record.sourcePath.replace(/_\d+(?=\.b3dm$)/u, "");
    const key = `${record.ownerPoiIds[0]}\n${family}\n${record.claimIndex}`;
    const group = siblingGroups.get(key) ?? [];
    group.push({ index, record });
    siblingGroups.set(key, group);
  }
  for (const group of siblingGroups.values()) {
    if (new Set(group.map(({ record }) => record.gmlId)).size <= 1) continue;
    for (const { index, record } of group) {
      rejected.add(index);
      review.push({
        state: "review",
        sourcePath: record.sourcePath,
        batchId: record.requestedBatchId,
        ownerPoiIds: record.ownerPoiIds,
        reason: "lod_identity_disagreement",
      });
    }
  }
  const claims = new Map();
  for (const [index, candidate] of candidateClaims.entries()) {
    if (rejected.has(index)) continue;
    const claimKey = `${candidate.sourcePath}@${candidate.sourceSha256}#${candidate.batchId}`;
    const existing = claims.get(claimKey);
    if (existing && existing.gmlId !== candidate.gmlId) {
      review.push({
        state: "review",
        sourcePath: candidate.sourcePath,
        batchId: candidate.batchId,
        ownerPoiIds: [
          ...new Set([...existing.ownerPoiIds, ...candidate.ownerPoiIds]),
        ].sort(),
        reason: "contradictory_source_identity",
      });
      claims.delete(claimKey);
      continue;
    }
    const record = existing ?? candidate;
    record.ownerPoiIds = [
      ...new Set([...record.ownerPoiIds, ...candidate.ownerPoiIds]),
    ].sort();
    claims.set(claimKey, record);
  }
  return [...claims.values()].sort((left, right) =>
    `${left.sourcePath}#${left.batchId}`.localeCompare(
      `${right.sourcePath}#${right.batchId}`,
    ),
  );
}

export function deriveHighlightEvidence({
  snapshotId,
  sourceRoot,
  pois,
  sourceTileset,
  approvedOverlayRoot,
  approvedSourceEvidencePath,
} = {}) {
  if (!snapshotId || !sourceRoot || !Array.isArray(pois))
    throw new Error("Snapshot, original source root, and POIs are required");
  const resolvedRoot = path.resolve(sourceRoot);
  const tileset =
    sourceTileset ??
    JSON.parse(fs.readFileSync(path.join(resolvedRoot, "tileset.json")));
  const nodes = new Map(
    indexTileset(tileset).map((record) => [record.canonicalPath, record]),
  );
  const review = [];
  const evidenceRoot = approvedEvidenceRoot(sourceRoot, approvedOverlayRoot);
  const candidateClaims = collectCandidateClaims({
    pois,
    nodes,
    resolvedRoot,
    evidenceRoot,
    legacyContext: createLegacyEvidenceContext({
      sourceRoot,
      snapshotId,
      approvedOverlayRoot: evidenceRoot,
      evidencePath: approvedSourceEvidencePath,
    }),
    review,
  });
  const resolved = reconcileCandidateClaims(candidateClaims, review);
  const evidenceContract = { snapshotId, resolved, review };
  return {
    ...evidenceContract,
    evidenceIdentity: sha256(canonicalJson(evidenceContract)),
  };
}
