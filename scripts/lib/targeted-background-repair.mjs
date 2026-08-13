import fs from "node:fs";
import path from "node:path";

import {
  b3dmIdentity,
  inspectTextureSemantics,
  makeBackgroundTextureLite,
  readB3dm,
} from "./background-lite-b3dm.mjs";
import {
  atomicWrite,
  BACKGROUND_LITE_POLICY,
  canonicalJson,
  sha256,
  verifyBackgroundLiteIntegrity,
} from "./background-lite-run.mjs";
import {
  buildFinalValidationReport,
  readValidationInputs,
  writeFinalValidationReport,
} from "./local-background-validation.mjs";
import {
  activeLocalSelectionId,
  rebindActiveValidationReport,
} from "./local-asset-switch.mjs";
import { terminalizeSwitchReport } from "./local-asset-switch-report.mjs";

const APPROVED_CACHE = "approved_pristine_source_cache";
const readJson = (filename) => JSON.parse(fs.readFileSync(filename, "utf8"));
const identity = (bytes) => b3dmIdentity(readB3dm(bytes));

function contained(root, candidate, label) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  if (!resolved.startsWith(`${resolvedRoot}${path.sep}`))
    throw new Error(`${label} escapes its allowed root: ${candidate}`);
  return resolved;
}

function familyStem(canonicalPath) {
  const match = canonicalPath.match(/^(.*)_0\.b3dm$/u);
  if (!match)
    throw new Error(`Approved cache claim is not an _0 tile: ${canonicalPath}`);
  return match[1];
}

function evidenceIndex(evidence) {
  const records = Array.isArray(evidence?.records) ? evidence.records : [];
  return new Map(records.map((record) => [record.sourceTile, record]));
}

function catalogueClaims(catalogue) {
  const claims = [];
  for (const building of catalogue?.buildings ?? [])
    for (const fragment of building.fragments ?? []) {
      if (fragment.sourceAuthority !== APPROVED_CACHE) continue;
      const provenance = fragment.sourceProvenance;
      if (!provenance?.exactIdentityOnly || provenance.inferredByNameOrPosition)
        throw new Error(`Non-exact pristine claim for ${fragment.sourcePath}`);
      claims.push({
        buildingIdentity: building.buildingIdentity,
        gmlId: fragment.gmlId,
        sourcePath: provenance.sourcePath,
        sourceSha256: fragment.sourceSha256,
        pristineCachePath: provenance.pristineCachePath,
      });
    }
  return claims;
}

function familyFiles(cacheRoot, canonicalZeroPath) {
  const stem = familyStem(canonicalZeroPath);
  const directory = contained(
    cacheRoot,
    path.join(cacheRoot, path.dirname(stem)),
    "cache family",
  );
  const basename = path.basename(stem);
  return fs
    .readdirSync(directory)
    .filter((entry) =>
      new RegExp(
        `^${basename.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}_\\d+\\.b3dm$`,
        "u",
      ).test(entry),
    )
    .map((entry) => path.posix.join(path.posix.dirname(stem), entry))
    .sort((left, right) => left.localeCompare(right));
}

export function buildTargetedBackgroundRepairPlan({
  repositoryRoot,
  outputRoot,
  cataloguePath = path.join(outputRoot, "overlays", "catalogue.json"),
  evidencePath = path.join(
    repositoryRoot,
    "data",
    "poi-source-identity-evidence.json",
  ),
  pristineCacheRoot = path.join(
    repositoryRoot,
    "public",
    "poi-tiles",
    "source",
  ),
} = {}) {
  const catalogueBytes = fs.readFileSync(cataloguePath);
  const evidenceBytes = fs.readFileSync(evidencePath);
  const catalogue = JSON.parse(catalogueBytes);
  const evidence = JSON.parse(evidenceBytes);
  const backgroundReportPath = path.join(
    outputRoot,
    "reports",
    "background.json",
  );
  const background = readJson(backgroundReportPath);
  if (!catalogue.complete || !background.complete)
    throw new Error("Catalogue and background report must both be complete");
  if (background.policyId !== "dcd5d769566da97b")
    throw new Error(`Unexpected background policy: ${background.policyId}`);
  const reportRecords = new Map(
    background.records.map((record) => [record.canonicalPath, record]),
  );
  const approvedEvidence = evidenceIndex(evidence);
  const claims = catalogueClaims(catalogue);
  const families = new Map();
  for (const claim of claims) {
    if (!claim.pristineCachePath?.startsWith("public/poi-tiles/source/"))
      throw new Error(
        `Unsafe pristine cache claim: ${claim.pristineCachePath}`,
      );
    const canonicalZeroPath = claim.pristineCachePath.slice(
      "public/poi-tiles/source/".length,
    );
    const claimedSource = `tiles/${canonicalZeroPath}`;
    if (claim.sourcePath !== claimedSource)
      throw new Error(`Source/cache path mismatch for ${canonicalZeroPath}`);
    const evidenceRecord = approvedEvidence.get(claimedSource);
    if (
      !evidenceRecord ||
      evidenceRecord.sourceSha256 !== claim.sourceSha256 ||
      !evidenceRecord.gmlIds?.includes(claim.gmlId)
    )
      throw new Error(
        `Checked-in identity evidence mismatch for ${canonicalZeroPath}`,
      );
    const cacheZero = contained(
      pristineCacheRoot,
      path.join(pristineCacheRoot, canonicalZeroPath),
      "pristine tile",
    );
    const pristineBytes = fs.readFileSync(cacheZero);
    if (sha256(pristineBytes) !== claim.sourceSha256)
      throw new Error(`Pristine _0 hash mismatch for ${canonicalZeroPath}`);
    const family = familyStem(canonicalZeroPath);
    const old = families.get(family) ?? {
      family,
      zeroPath: canonicalZeroPath,
      approvedGmlIds: new Set(),
      buildingIdentities: new Set(),
    };
    old.approvedGmlIds.add(claim.gmlId);
    old.buildingIdentities.add(claim.buildingIdentity);
    families.set(family, old);
  }

  const records = [];
  const restored = new Set();
  for (const family of [...families.values()].sort((a, b) =>
    a.family.localeCompare(b.family),
  )) {
    const siblings = familyFiles(pristineCacheRoot, family.zeroPath);
    if (!siblings.length)
      throw new Error(`No cached LOD files for ${family.family}`);
    for (const canonicalPath of siblings) {
      const pristinePath = contained(
        pristineCacheRoot,
        path.join(pristineCacheRoot, canonicalPath),
        "pristine sibling",
      );
      const currentPath = contained(
        outputRoot,
        path.join(outputRoot, "background-lite", canonicalPath),
        "background tile",
      );
      const reportRecord = reportRecords.get(canonicalPath);
      if (!reportRecord || !fs.existsSync(currentPath))
        throw new Error(
          `Affected tile is absent from the completed background: ${canonicalPath}`,
        );
      const pristineBytes = fs.readFileSync(pristinePath);
      const siblingEvidence = approvedEvidence.get(`tiles/${canonicalPath}`);
      if (
        !siblingEvidence ||
        siblingEvidence.sourceSha256 !== sha256(pristineBytes)
      )
        throw new Error(
          `Checked-in sibling hash mismatch for ${canonicalPath}`,
        );
      const currentBytes = fs.readFileSync(currentPath);
      const pristineIdentity = identity(pristineBytes);
      if (
        canonicalJson(pristineIdentity.gmlIds) !==
        canonicalJson(siblingEvidence.gmlIds)
      )
        throw new Error(
          `Checked-in sibling identities mismatch for ${canonicalPath}`,
        );
      const currentIdentity = identity(currentBytes);
      const pristineIds = new Set(pristineIdentity.gmlIds);
      const currentIds = new Set(currentIdentity.gmlIds);
      const added = [...currentIds].filter((gmlId) => !pristineIds.has(gmlId));
      const missing = [...pristineIds].filter(
        (gmlId) => !currentIds.has(gmlId),
      );
      if (added.length)
        throw new Error(
          `Current tile has identities absent from pristine cache: ${canonicalPath}`,
        );
      if (!missing.length)
        throw new Error(
          `Catalogue-selected family is not actually stripped: ${canonicalPath}`,
        );
      missing.forEach((gmlId) => restored.add(gmlId));
      records.push({
        canonicalPath,
        pristinePath,
        currentPath,
        pristineSha256: sha256(pristineBytes),
        pristineBytes: pristineBytes.length,
        currentSha256: sha256(currentBytes),
        currentBytes: currentBytes.length,
        missingGmlIds: missing.sort(),
      });
    }
  }
  const projection = {
    schemaVersion: "targeted-background-repair-plan-v1",
    policyId: background.policyId,
    catalogueId: catalogue.catalogueId,
    catalogueSha256: sha256(catalogueBytes),
    evidenceSha256: sha256(evidenceBytes),
    families: [...families.keys()].sort(),
    records: records.map(
      ({ canonicalPath, pristineSha256, currentSha256, missingGmlIds }) => ({
        canonicalPath,
        pristineSha256,
        currentSha256,
        missingGmlIds,
      }),
    ),
  };
  const repairId = sha256(canonicalJson(projection)).slice(0, 16);
  return {
    ...projection,
    repairId,
    familyCount: families.size,
    fileCount: records.length,
    restoredIdentityCount: restored.size,
    activeHighlightedIdentityCount: new Set(claims.map(({ gmlId }) => gmlId))
      .size,
    pristineBytes: records.reduce(
      (sum, record) => sum + record.pristineBytes,
      0,
    ),
    currentBytes: records.reduce((sum, record) => sum + record.currentBytes, 0),
    records,
    localOnly: true,
    publicationActions: [],
  };
}

export async function stageTargetedBackgroundRepair({ plan, outputRoot } = {}) {
  const repairRoot = path.join(outputRoot, "repairs", plan.repairId);
  const stageRoot = path.join(repairRoot, "staged", "background-lite");
  const stagedRecords = [];
  for (const record of plan.records) {
    if (sha256(fs.readFileSync(record.currentPath)) !== record.currentSha256)
      throw new Error(
        `Current tile changed after planning: ${record.canonicalPath}`,
      );
    const pristineBytes = fs.readFileSync(record.pristinePath);
    const semantics = await inspectTextureSemantics(pristineBytes);
    if (semantics.ambiguousImages.length)
      throw new Error(`Ambiguous texture semantics: ${record.canonicalPath}`);
    const outputBytes = await makeBackgroundTextureLite(pristineBytes, {
      maximumDimension: BACKGROUND_LITE_POLICY.maximumTextureDimension,
      quality: BACKGROUND_LITE_POLICY.jpegQuality,
      blurSigma: BACKGROUND_LITE_POLICY.blurSigma,
      preserveSourceColour: BACKGROUND_LITE_POLICY.preserveSourceColour,
    });
    const checks = verifyBackgroundLiteIntegrity(pristineBytes, outputBytes);
    if (!checks.identityPreserved || !checks.geometryPreserved)
      throw new Error(`Repair integrity failed: ${record.canonicalPath}`);
    const repairedIds = new Set(identity(outputBytes).gmlIds);
    if (record.missingGmlIds.some((gmlId) => !repairedIds.has(gmlId)))
      throw new Error(
        `Repair did not restore every identity: ${record.canonicalPath}`,
      );
    const stagedPath = path.join(stageRoot, record.canonicalPath);
    atomicWrite(stagedPath, outputBytes);
    stagedRecords.push({
      ...record,
      stagedPath,
      outputSha256: sha256(outputBytes),
      outputBytes: outputBytes.length,
      textureSemantics: semantics,
      ...checks,
    });
  }
  const result = {
    schemaVersion: "targeted-background-repair-stage-v1",
    repairId: plan.repairId,
    complete: true,
    familyCount: plan.familyCount,
    fileCount: stagedRecords.length,
    restoredIdentityCount: plan.restoredIdentityCount,
    overlayCatalogueSha256: plan.catalogueSha256,
    policyId: plan.policyId,
    localOnly: true,
    publicationActions: [],
    records: stagedRecords,
  };
  atomicWrite(
    path.join(repairRoot, "stage.json"),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  return result;
}

function repairedBackgroundReport(background, stage, tilesetSha256) {
  const replacements = new Map(
    stage.records.map((record) => [record.canonicalPath, record]),
  );
  const records = background.records.map((record) => {
    const replacement = replacements.get(record.canonicalPath);
    if (!replacement) return record;
    return {
      ...record,
      sourceSha256: replacement.pristineSha256,
      sourceBytes: replacement.pristineBytes,
      outputSha256: replacement.outputSha256,
      outputBytes: replacement.outputBytes,
      textureSemantics: replacement.textureSemantics,
      identityPreserved: replacement.identityPreserved,
      retainedBuffersPreserved: replacement.retainedBuffersPreserved,
      dracoPreserved: replacement.dracoPreserved,
      geometryPreserved: replacement.geometryPreserved,
      repairedFromApprovedPristineCache: true,
      sourceAuthority: APPROVED_CACHE,
      repairId: stage.repairId,
      outcome: "processed",
    };
  });
  const sourceBytes = records.reduce(
    (sum, record) => sum + Number(record.sourceBytes ?? 0),
    0,
  );
  const outputBytes = records.reduce(
    (sum, record) => sum + Number(record.outputBytes ?? 0),
    0,
  );
  return {
    ...background,
    runId: `${background.runId}-repair-${stage.repairId}`,
    inventoryId: sha256(
      canonicalJson(
        records.map(({ canonicalPath, sourceSha256 }) => ({
          canonicalPath,
          sourceSha256,
        })),
      ),
    ).slice(0, 16),
    tilesetSha256,
    totals: {
      sourceBytes,
      outputBytes,
      reductionPercent: Number(
        (((sourceBytes - outputBytes) / sourceBytes) * 100).toFixed(2),
      ),
    },
    repair: {
      schemaVersion: "targeted-background-repair-v1",
      repairId: stage.repairId,
      complete: true,
      familyCount: stage.familyCount,
      fileCount: stage.fileCount,
      restoredIdentityCount: stage.restoredIdentityCount,
      overlayCatalogueSha256: stage.overlayCatalogueSha256,
      policyId: stage.policyId,
      localOnly: true,
      publicationActions: [],
    },
    records,
  };
}

export async function applyTargetedBackgroundRepair({
  stage,
  outputRoot,
  repositoryRoot,
  confirmationToken,
} = {}) {
  if (confirmationToken !== stage.repairId)
    throw new Error("The exact repairId is required as the confirmation token");
  const cataloguePath = path.join(outputRoot, "overlays", "catalogue.json");
  const overlayTilesetPath = path.join(outputRoot, "overlays", "tileset.json");
  const overlayBefore = {
    catalogue: sha256(fs.readFileSync(cataloguePath)),
    tileset: sha256(fs.readFileSync(overlayTilesetPath)),
  };
  if (overlayBefore.catalogue !== stage.overlayCatalogueSha256)
    throw new Error("Overlay catalogue changed after repair planning");
  const tilesetPath = path.join(outputRoot, "background-lite", "tileset.json");
  const backgroundReportPath = path.join(
    outputRoot,
    "reports",
    "background.json",
  );
  const checkpointPath = path.join(outputRoot, "checkpoints", "latest.json");
  const activePath = path.join(outputRoot, "active-building-assets.json");
  const metadataPaths = [
    tilesetPath,
    backgroundReportPath,
    checkpointPath,
    activePath,
    path.join(outputRoot, "reports", "switch.json"),
    path.join(outputRoot, "final", "report.json"),
  ];
  const repairRoot = path.join(outputRoot, "repairs", stage.repairId);
  const backupRoot = path.join(repairRoot, "backup");
  const backups = [];
  for (const filename of [
    ...stage.records.map(({ currentPath }) => currentPath),
    ...metadataPaths,
  ]) {
    if (!fs.existsSync(filename)) continue;
    const relative = path.relative(outputRoot, filename);
    const backup = path.join(backupRoot, relative);
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.copyFileSync(filename, backup);
    backups.push({ filename, backup });
  }
  try {
    for (const record of stage.records) {
      if (sha256(fs.readFileSync(record.currentPath)) !== record.currentSha256)
        throw new Error(
          `Current tile changed after staging: ${record.canonicalPath}`,
        );
      const stagedBytes = fs.readFileSync(record.stagedPath);
      if (sha256(stagedBytes) !== record.outputSha256)
        throw new Error(`Staged tile hash mismatch: ${record.canonicalPath}`);
    }
    for (const record of stage.records)
      atomicWrite(record.currentPath, fs.readFileSync(record.stagedPath));
    const tilesetBytes = fs.readFileSync(tilesetPath);
    const background = repairedBackgroundReport(
      readJson(backgroundReportPath),
      stage,
      sha256(tilesetBytes),
    );
    const backgroundBytes = Buffer.from(
      `${JSON.stringify(background, null, 2)}\n`,
    );
    atomicWrite(backgroundReportPath, backgroundBytes);
    atomicWrite(checkpointPath, backgroundBytes);

    let active = readJson(activePath);
    active.manifestId = sha256(
      canonicalJson({
        policyId: active.policyId,
        snapshotId: active.snapshotId,
        catalogueId: active.catalogueId,
        background: active.background,
        overlays: active.overlays,
        rollbackReference: active.rollbackReference,
      }),
    );
    atomicWrite(activePath, `${JSON.stringify(active, null, 2)}\n`);
    await terminalizeSwitchReport({ active, activeManifestPath: activePath });
    const finalReport = buildFinalValidationReport(
      readValidationInputs(outputRoot),
    );
    const finalReportPath = writeFinalValidationReport(outputRoot, finalReport);
    if (!finalReport.complete || finalReport.state !== "active-local")
      throw new Error("Repaired evidence did not converge to active-local");
    active = await rebindActiveValidationReport({
      activeManifestPath: activePath,
      reportPath: finalReportPath,
      repositoryRoot,
    });

    const overlayAfter = {
      catalogue: sha256(fs.readFileSync(cataloguePath)),
      tileset: sha256(fs.readFileSync(overlayTilesetPath)),
    };
    if (canonicalJson(overlayAfter) !== canonicalJson(overlayBefore))
      throw new Error(
        "Overlay artefacts changed during background-only repair",
      );
    const result = {
      schemaVersion: "targeted-background-repair-result-v1",
      repairId: stage.repairId,
      complete: true,
      state: "active-local",
      familyCount: stage.familyCount,
      fileCount: stage.fileCount,
      restoredIdentityCount: stage.restoredIdentityCount,
      backgroundTilesetSha256: sha256(fs.readFileSync(tilesetPath)),
      activeSelectionId: activeLocalSelectionId(active),
      overlayUnchanged: true,
      backupRoot,
      localOnly: true,
      publicationActions: [],
    };
    atomicWrite(
      path.join(repairRoot, "result.json"),
      `${JSON.stringify(result, null, 2)}\n`,
    );
    return result;
  } catch (error) {
    for (const { filename, backup } of backups.reverse())
      atomicWrite(filename, fs.readFileSync(backup));
    throw error;
  }
}
