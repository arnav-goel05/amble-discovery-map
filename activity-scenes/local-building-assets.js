export const LOCAL_BUILDING_ASSET_MANIFEST_URL =
  "/__local-building-assets/manifest.json";

export function planLocalOverlaySnapshotReconcile({
  assetManifest,
  currentPois,
  nextPois,
  nextSnapshotId,
  nextTilesetUrl,
}) {
  const pinnedSnapshotId = assetManifest?.snapshotId;
  const pinned =
    assetManifest?.state === "active-local" &&
    typeof pinnedSnapshotId === "string" &&
    pinnedSnapshotId.length > 0 &&
    typeof assetManifest?.overlays?.url === "string";
  if (!pinned)
    return {
      pinned: false,
      pois: nextPois,
      snapshotMismatch: false,
      tilesetUrl: nextTilesetUrl,
    };
  const snapshotMismatch = nextSnapshotId !== pinnedSnapshotId;
  return {
    pinned: true,
    pois: snapshotMismatch ? currentPois : nextPois,
    snapshotMismatch,
    tilesetUrl: assetManifest.overlays.url,
  };
}

const requiredAsset = (asset, { allowEmpty = false } = {}) =>
  asset?.complete === true &&
  (allowEmpty && asset.empty === true
    ? true
    : typeof asset?.url === "string" && asset.url.length > 0);

export function validateBrowserBuildingAssetManifest(manifest) {
  if (manifest?.schemaVersion !== "local-building-assets-v1")
    throw new Error("local-building-manifest-schema-invalid");
  if (!["active-local", "rolled-back"].includes(manifest.state))
    throw new Error("local-building-manifest-not-active");
  if (!requiredAsset(manifest.background))
    throw new Error("local-building-background-unavailable");
  if (!requiredAsset(manifest.overlays, { allowEmpty: true }))
    throw new Error("local-building-overlays-unavailable");
  if (manifest.background.opacity !== 0.3)
    throw new Error("local-building-background-opacity-invalid");
  if (manifest.overlays.opacity !== 1)
    throw new Error("local-building-overlay-opacity-invalid");
  return manifest;
}

export async function loadLocalBuildingAssetManifest({
  enabled,
  fetchImpl = globalThis.fetch,
  manifestUrl = LOCAL_BUILDING_ASSET_MANIFEST_URL,
} = {}) {
  if (!enabled) return { manifest: null, state: "disabled", url: manifestUrl };

  const unavailableManifest = (state, error = null) => ({
    manifest: {
      schemaVersion: "local-building-assets-v1",
      state: "intentionally-unavailable",
      localOnly: true,
      background: { complete: false, opacity: 0.3 },
      overlays: { complete: false, opacity: 1 },
    },
    error,
    state,
    url: manifestUrl,
  });

  let response;
  try {
    response = await fetchImpl(manifestUrl, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
  } catch (error) {
    return unavailableManifest(
      "unavailable",
      error?.message ?? "request-failed",
    );
  }

  if (response.status === 404) return unavailableManifest("missing");
  if (!response.ok) {
    let details = null;
    try {
      details = await response.json();
    } catch {
      // The HTTP status is enough to expose a deterministic unavailable state.
    }
    return unavailableManifest(
      details?.state === "invalid" ? "invalid" : "unavailable",
      details?.error ?? `http-${response.status}`,
    );
  }

  try {
    const manifest = validateBrowserBuildingAssetManifest(
      await response.json(),
    );
    return {
      manifest: {
        ...manifest,
        // A verified rollback is an active local selection for rendering. Keep
        // the observed state separately for diagnostics.
        state: "active-local",
      },
      observedState: manifest.state,
      state: manifest.state,
      url: manifestUrl,
    };
  } catch (error) {
    return unavailableManifest("invalid", error?.message ?? "invalid-json");
  }
}
