import fs from "node:fs";
import path from "node:path";

import { b3dmIdentity, inspectGlb, readB3dm } from "./background-lite-b3dm.mjs";
import { sha256 } from "./background-lite-run.mjs";
import { indexPoiSourceIdentityEvidence } from "./poi-source-identity-evidence.mjs";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

const sameValues = (left, right) =>
  Array.isArray(left) &&
  Array.isArray(right) &&
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

function safeFragmentName(value) {
  return (
    typeof value === "string" &&
    value.endsWith(".b3dm") &&
    path.basename(value) === value
  );
}

export function createLegacyEvidenceContext({
  sourceRoot,
  snapshotId,
  approvedOverlayRoot,
  evidencePath,
} = {}) {
  if (!approvedOverlayRoot)
    return { error: "approved_pristine_source_cache_missing" };
  const filename =
    evidencePath ??
    path.join(
      path.dirname(path.resolve(sourceRoot)),
      "data",
      "poi-source-identity-evidence.json",
    );
  if (!fs.existsSync(filename))
    return { error: "approved_source_identity_evidence_missing" };
  try {
    const evidence = JSON.parse(fs.readFileSync(filename, "utf8"));
    return {
      approvedOverlayRoot: path.resolve(approvedOverlayRoot),
      evidencePath: path.resolve(filename),
      evidenceSha256: sha256(fs.readFileSync(filename)),
      records: indexPoiSourceIdentityEvidence({
        evidence,
        expectedSnapshotId: snapshotId,
      }),
      cache: new Map(),
    };
  } catch {
    return { error: "approved_source_identity_evidence_invalid" };
  }
}

function validationFailure(reason) {
  return { ok: false, reason };
}

/**
 * Resolve a historical approved claim only from byte- and identity-bound
 * evidence. This deliberately does not inspect a name, position, or current
 * batch number to infer a replacement.
 */
export function validateLegacyExactSource({
  context,
  poiId,
  sourcePath,
  approvedIdentity,
} = {}) {
  if (context?.error) return validationFailure(context.error);
  const cacheKey = `${poiId}\n${sourcePath}\n${approvedIdentity?.gmlId ?? ""}`;
  if (context.cache.has(cacheKey)) return context.cache.get(cacheKey);
  const fail = (reason) => {
    const result = validationFailure(reason);
    context.cache.set(cacheKey, result);
    return result;
  };
  if (
    !approvedIdentity ||
    !Number.isInteger(approvedIdentity.originalBatchId) ||
    !approvedIdentity.gmlId ||
    !SHA256_PATTERN.test(approvedIdentity.sourceSha256 ?? "") ||
    !SHA256_PATTERN.test(approvedIdentity.poiSha256 ?? "") ||
    !Number.isSafeInteger(approvedIdentity.poiTriangles) ||
    approvedIdentity.poiTriangles < 1 ||
    !safeFragmentName(approvedIdentity.poiFile)
  )
    return fail("approved_legacy_provenance_incomplete");

  const evidence = context.records.get(`tiles/${sourcePath}`);
  if (!evidence) return fail("approved_source_identity_record_missing");
  if (evidence.sourceSha256 !== approvedIdentity.sourceSha256)
    return fail("approved_source_hash_disagreement");
  if (
    evidence.gmlIds[approvedIdentity.originalBatchId] !== approvedIdentity.gmlId
  )
    return fail("approved_source_batch_identity_disagreement");

  const sourceCachePath = path.join(
    context.approvedOverlayRoot,
    "source",
    sourcePath,
  );
  if (!fs.existsSync(sourceCachePath))
    return fail("approved_pristine_source_object_missing");
  const sourceBytes = fs.readFileSync(sourceCachePath);
  if (sha256(sourceBytes) !== approvedIdentity.sourceSha256)
    return fail("approved_pristine_source_hash_mismatch");
  let sourceIdentity;
  try {
    sourceIdentity = b3dmIdentity(readB3dm(sourceBytes, sourceCachePath));
  } catch {
    return fail("approved_pristine_source_invalid");
  }
  if (!sameValues(sourceIdentity.gmlIds, evidence.gmlIds))
    return fail("approved_pristine_source_identity_table_mismatch");
  if (
    sourceIdentity.gmlIds[approvedIdentity.originalBatchId] !==
    approvedIdentity.gmlId
  )
    return fail("approved_pristine_source_identity_mismatch");

  const fragmentPath = path.join(
    context.approvedOverlayRoot,
    poiId,
    approvedIdentity.poiFile,
  );
  if (!fs.existsSync(fragmentPath))
    return fail("approved_legacy_fragment_missing");
  const fragmentBytes = fs.readFileSync(fragmentPath);
  if (sha256(fragmentBytes) !== approvedIdentity.poiSha256)
    return fail("approved_legacy_fragment_hash_mismatch");
  let fragmentIdentity;
  let fragmentGeometry;
  try {
    const fragment = readB3dm(fragmentBytes, fragmentPath);
    fragmentIdentity = b3dmIdentity(fragment);
    fragmentGeometry = inspectGlb(fragment.glb);
  } catch {
    return fail("approved_legacy_fragment_invalid");
  }
  if (!sameValues(fragmentIdentity.gmlIds, approvedIdentity.manifestGmlIds))
    return fail("approved_legacy_fragment_identity_mismatch");
  if (fragmentGeometry.triangles !== approvedIdentity.poiTriangles)
    return fail("approved_legacy_fragment_geometry_mismatch");

  const result = {
    ok: true,
    sourceBytes,
    sourceArtifactPath: path.relative(
      path.dirname(path.dirname(context.approvedOverlayRoot)),
      sourceCachePath,
    ),
    batchId: approvedIdentity.originalBatchId,
    gmlId: approvedIdentity.gmlId,
    gmlName:
      sourceIdentity.gmlNames[approvedIdentity.originalBatchId] ??
      approvedIdentity.gmlName ??
      null,
    sourceSha256: approvedIdentity.sourceSha256,
    sourceAuthority: "approved_pristine_source_cache",
    sourceProvenance: {
      activeSnapshotId: true,
      sourcePath: `tiles/${sourcePath}`,
      sourceSha256: approvedIdentity.sourceSha256,
      originalBatchId: approvedIdentity.originalBatchId,
      gmlId: approvedIdentity.gmlId,
      checkedInEvidencePath: path.relative(
        path.dirname(path.dirname(context.evidencePath)),
        context.evidencePath,
      ),
      checkedInEvidenceSha256: context.evidenceSha256,
      pristineCachePath: path.relative(
        path.dirname(path.dirname(context.approvedOverlayRoot)),
        sourceCachePath,
      ),
      legacyFragmentPath: path.relative(
        path.dirname(path.dirname(context.approvedOverlayRoot)),
        fragmentPath,
      ),
      legacyFragmentSha256: approvedIdentity.poiSha256,
      legacyFragmentTriangles: fragmentGeometry.triangles,
      exactIdentityOnly: true,
      inferredByNameOrPosition: false,
    },
  };
  context.cache.set(cacheKey, result);
  return result;
}
