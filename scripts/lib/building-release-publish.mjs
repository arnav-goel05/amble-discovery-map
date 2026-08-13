import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const SHA256 = /^[a-f0-9]{64}$/u;
const digest = (value) => createHash("sha256").update(value).digest("hex");

export function collectContentUris(tileset) {
  const uris = [];
  const visit = (tile) => {
    for (const content of [tile?.content, ...(tile?.contents ?? [])]) {
      const uri = content?.uri ?? content?.url;
      if (typeof uri === "string") uris.push(uri);
    }
    for (const child of tile?.children ?? []) visit(child);
  };
  if (!tileset?.root) throw new Error("Building release tileset has no root");
  visit(tileset.root);
  return [...new Set(uris)].sort();
}

function safeRelativeB3dm(uri) {
  const pathname = decodeURIComponent(uri.split("?")[0]);
  if (
    !pathname ||
    pathname.includes("..") ||
    path.isAbsolute(pathname) ||
    !pathname.endsWith(".b3dm")
  )
    throw new Error(`Unsafe building release content URI: ${uri}`);
  return pathname;
}

function localObject(root, relativePath, expected = {}) {
  const localPath = path.join(root, relativePath);
  if (!localPath.startsWith(`${root}${path.sep}`))
    throw new Error(`Building release path escapes its root: ${relativePath}`);
  const bytes = readFileSync(localPath);
  const sha256 = digest(bytes);
  if (expected.sha256 && expected.sha256 !== sha256)
    throw new Error(`Building release hash mismatch: ${relativePath}`);
  if (expected.byteLength && expected.byteLength !== bytes.length)
    throw new Error(`Building release size mismatch: ${relativePath}`);
  if (bytes.subarray(0, 4).toString("ascii") !== "b3dm")
    throw new Error(`Building release object is not B3DM: ${relativePath}`);
  return {
    relativePath,
    localPath,
    byteLength: statSync(localPath).size,
    sha256,
  };
}

export function buildBuildingReleaseInventory({
  outputRoot,
  report,
  backgroundTileset,
  overlayTileset,
  overlayCatalogue,
}) {
  for (const [field, valid] of [
    ["complete", report?.complete === true],
    ["browser", report?.validation?.browser === true],
    ["identityParity", report?.validation?.identityParity === true],
    ["sourceProvenance", report?.validation?.sourceProvenance === true],
    ["rollbackReady", report?.validation?.rollbackReady === true],
  ])
    if (!valid)
      throw new Error(`Building release evidence is not ready: ${field}`);

  const backgroundRoot = path.join(outputRoot, "background-lite");
  const overlayRoot = path.join(outputRoot, "overlays");
  const snapshotId = report.snapshotId ?? report.overlays?.snapshotId;
  if (typeof snapshotId !== "string" || !snapshotId)
    throw new Error("Building release evidence has no snapshot identity");
  const backgroundEvidence = new Map(
    (report.background?.records ?? []).map((item) => [
      item.canonicalPath,
      { sha256: item.outputSha256, byteLength: item.outputBytes },
    ]),
  );
  const overlayEvidence = new Map(
    (overlayCatalogue.buildings ?? []).flatMap((building) =>
      (building.fragments ?? []).map((fragment) => [
        fragment.outputPath,
        { sha256: fragment.outputSha256, byteLength: fragment.outputBytes },
      ]),
    ),
  );
  const background = collectContentUris(backgroundTileset).map((uri) => {
    const relativePath = safeRelativeB3dm(uri);
    const expected = backgroundEvidence.get(relativePath);
    if (!expected)
      throw new Error(`Background release lacks evidence: ${relativePath}`);
    return localObject(backgroundRoot, relativePath, expected);
  });
  const overlays = collectContentUris(overlayTileset).map((uri) => {
    const relativePath = safeRelativeB3dm(uri);
    const expected = overlayEvidence.get(relativePath);
    if (!expected)
      throw new Error(`Overlay release lacks evidence: ${relativePath}`);
    return localObject(overlayRoot, relativePath, expected);
  });
  if (
    background.length !==
    report.payload.uniqueBackgroundTileCount - report.background.excludedCount
  )
    throw new Error(
      "Background release object count does not match final evidence",
    );
  if (overlays.length !== report.payload.uniqueOverlayAssetCount)
    throw new Error(
      "Overlay release object count does not match final evidence",
    );
  const backgroundBytes = background.reduce(
    (sum, item) => sum + item.byteLength,
    0,
  );
  const overlayBytes = overlays.reduce((sum, item) => sum + item.byteLength, 0);
  if (backgroundBytes !== report.payload.backgroundBytes)
    throw new Error(
      "Background release byte total does not match final evidence",
    );
  if (overlayBytes !== report.payload.overlayBytes)
    throw new Error("Overlay release byte total does not match final evidence");
  const backgroundManifestSha256 = digest(
    Buffer.from(`${JSON.stringify(backgroundTileset)}\n`),
  );
  const overlayManifestSha256 = digest(
    Buffer.from(`${JSON.stringify(overlayTileset)}\n`),
  );
  const releaseId = digest(
    `${snapshotId}\n${backgroundManifestSha256}\n${overlayManifestSha256}`,
  ).slice(0, 16);
  return {
    releaseId,
    snapshotId,
    background,
    overlays,
    backgroundBytes,
    overlayBytes,
    backgroundManifestSha256,
    overlayManifestSha256,
    catalogueId: overlayCatalogue.catalogueId,
  };
}

export function releaseObjectKey(kind, releaseId, relativePath) {
  const root = kind === "background" ? "optimized-tiles" : "poi-tiles";
  return `${root}/releases/${releaseId}/${relativePath}`;
}

export async function verifyPublishedBuildingRelease({
  descriptor,
  origin = "https://amblefinds.com",
  fetchImpl = fetch,
}) {
  if (!/^[a-f0-9]{16}$/u.test(descriptor?.releaseId ?? ""))
    throw new Error("Building release descriptor has an invalid release ID");
  const results = [];
  for (const [kind, root, item] of [
    ["background", "optimized-tiles", descriptor.background],
    ["overlays", "poi-tiles", descriptor.overlays],
  ]) {
    const expectedPath = `/${root}/releases/${descriptor.releaseId}/tileset.json`;
    const url = new URL(item?.tilesetUrl ?? "", origin);
    if (url.origin !== new URL(origin).origin || url.pathname !== expectedPath)
      throw new Error(`${kind} manifest URL is not the immutable release path`);
    const response = await fetchImpl(url);
    if (!response.ok)
      throw new Error(`${kind} manifest returned HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const sha256 = digest(bytes);
    if (sha256 !== item.manifestSha256)
      throw new Error(`${kind} published manifest hash mismatch`);
    let tileset;
    try {
      tileset = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new Error(`${kind} published manifest is not valid JSON`);
    }
    const references = collectContentUris(tileset);
    if (references.length !== item.objectCount)
      throw new Error(`${kind} published manifest object count mismatch`);
    for (const reference of references) safeRelativeB3dm(reference);
    results.push({
      kind,
      url: url.href,
      sha256,
      manifestBytes: bytes.length,
      objectCount: references.length,
    });
  }
  return {
    complete: true,
    releaseId: descriptor.releaseId,
    manifestCount: results.length,
    objectCount: results.reduce((sum, item) => sum + item.objectCount, 0),
    results,
  };
}
