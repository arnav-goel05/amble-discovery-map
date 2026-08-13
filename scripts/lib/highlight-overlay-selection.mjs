import { canonicalSourcePath } from "./background-lite-run.mjs";
import { stableBuildingIdentity } from "./highlight-overlay-reconcile.mjs";

export function exactOverlaySourceKey(record) {
  return JSON.stringify([
    record.sourceAuthority ?? "active_original_source_corpus",
    record.sourceArtifactPath ?? null,
    record.sourcePath,
    record.sourceSha256,
  ]);
}

function sourceQualityByPath(sourceTileset) {
  if (!sourceTileset?.root) throw new Error("Source tileset has no root");
  const quality = new Map();
  const visit = (tile) => {
    const raw = tile.content?.uri ?? tile.content?.url;
    if (raw) {
      const sourcePath = canonicalSourcePath(raw.split("?")[0]);
      const geometricError = Number(tile.geometricError ?? 0);
      const previous = quality.get(sourcePath);
      if (previous !== undefined && previous !== geometricError)
        throw new Error(`Contradictory source quality: ${sourcePath}`);
      quality.set(sourcePath, geometricError);
    }
    for (const child of tile.children ?? []) visit(child);
  };
  visit(sourceTileset.root);
  return quality;
}

/** Select one source-backed, finest-LOD representation for each building. */
export function selectCanonicalHighlightRecords({ records, sourceTileset }) {
  const quality = sourceQualityByPath(sourceTileset);
  const groups = new Map();
  for (const record of records) {
    const buildingIdentity = stableBuildingIdentity(record);
    const group = groups.get(buildingIdentity) ?? [];
    group.push(record);
    groups.set(buildingIdentity, group);
  }
  const resolved = [];
  const review = [];
  for (const [buildingIdentity, candidates] of groups) {
    const scored = candidates.map((record) => ({
      record,
      geometricError: quality.get(record.sourcePath),
    }));
    if (scored.some(({ geometricError }) => !Number.isFinite(geometricError))) {
      review.push({
        state: "review",
        ownerPoiIds: [
          ...new Set(
            candidates.flatMap(({ ownerPoiIds }) => ownerPoiIds ?? []),
          ),
        ].sort(),
        reason: "canonical_overlay_source_missing_from_tileset",
        buildingIdentity,
      });
      continue;
    }
    const minimum = Math.min(
      ...scored.map(({ geometricError }) => geometricError),
    );
    const finest = scored.filter(
      ({ geometricError }) => geometricError === minimum,
    );
    const exactCandidates = new Map(
      finest.map(({ record }) => [
        `${exactOverlaySourceKey(record)}#${record.batchId}`,
        record,
      ]),
    );
    if (exactCandidates.size !== 1) {
      review.push({
        state: "review",
        ownerPoiIds: [
          ...new Set(
            candidates.flatMap(({ ownerPoiIds }) => ownerPoiIds ?? []),
          ),
        ].sort(),
        reason: "canonical_overlay_source_ambiguous",
        buildingIdentity,
      });
      continue;
    }
    const selected = [...exactCandidates.values()][0];
    resolved.push({
      ...selected,
      ownerPoiIds: [
        ...new Set(candidates.flatMap(({ ownerPoiIds }) => ownerPoiIds ?? [])),
      ].sort(),
      lodSelection: {
        strategy: "minimum-source-geometric-error",
        sourceClaimCount: candidates.length,
        selectedGeometricError: minimum,
      },
    });
  }
  return {
    resolved: resolved.sort((left, right) =>
      left.gmlId.localeCompare(right.gmlId),
    ),
    review,
    sourceClaimCount: records.length,
  };
}
