import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

import {
  activateStagedSnapshot,
  hashFile,
  loadApprovedSnapshot,
  stageImmutableSnapshot,
} from "../approved-snapshot.mjs";
import { projectEventActivities } from "./activity-projection.mjs";

const require = createRequire(import.meta.url);
const {
  projectPublicActivityCatalogue,
  projectPublicLandmarks,
} = require("../public-event-catalogue.cjs");

const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const REPAIR_VERSION = "parent-first-v4";

function existingStage(root, snapshotId, sourceSnapshotId) {
  const snapshotDirectory = path.join(root, "data/snapshots", snapshotId);
  const manifestPath = path.join(snapshotDirectory, "manifest.json");
  if (!fs.existsSync(manifestPath)) return null;
  const manifest = read(manifestPath);
  if (
    manifest.eventPipelineProvenance?.parentDedupRepair?.version !==
      REPAIR_VERSION ||
    manifest.eventPipelineProvenance?.parentDedupRepair?.sourceSnapshotId !==
      sourceSnapshotId
  )
    throw new Error(`parent_dedup_repair_snapshot_collision:${snapshotId}`);
  return {
    snapshotId,
    snapshotDirectory,
    manifestPath,
    manifestHash: hashFile(manifestPath),
    commitEligibility: { eligible: true },
  };
}

function repairLandmarks(activeLandmarks, internalActivities, publicActivities) {
  const activitiesByLandmark = new Map();
  for (const activity of internalActivities.records)
    for (const group of activity.venueGroups ?? []) {
      if (
        group.publicPlacement !== "mapped" ||
        group.mappingStatus !== "approved" ||
        !group.approvedLocationId
      )
        continue;
      const ids = activitiesByLandmark.get(group.approvedLocationId) ?? [];
      ids.push(activity.activityId);
      activitiesByLandmark.set(group.approvedLocationId, ids);
    }
  const referenced = activeLandmarks.map((landmark) => {
    const { activityRefs: _activityRefs, ...base } = landmark;
    return {
      ...base,
      events: [
        ...new Set(activitiesByLandmark.get(landmark.id) ?? []),
      ].map((activityId) => ({ activityId })),
    };
  });
  return projectPublicLandmarks(referenced, publicActivities);
}

export function repairParentDedupSnapshot({
  root,
  activate = false,
  generatedAt = new Date().toISOString(),
} = {}) {
  const active = loadApprovedSnapshot({ root });
  const activeManifest = read(path.join(active.directory, "manifest.json"));
  const priorRepair =
    activeManifest.eventPipelineProvenance?.parentDedupRepair;
  if (priorRepair?.version === REPAIR_VERSION)
    return {
      complete: true,
      changed: false,
      activated: true,
      snapshotId: active.snapshotId,
      previousSnapshotId: activeManifest.previousSnapshotId,
      reason: "parent_dedup_repair_already_active",
      audit: priorRepair.audit,
    };
  if (!active.internalEventsRef || !active.activitiesRef)
    throw new Error("parent_dedup_repair_requires_activity_snapshot");

  const internal = read(
    path.join(active.directory, active.internalEventsRef),
  );
  const activeLandmarks = read(
    path.join(active.directory, active.landmarksRef),
  );
  const events = [...(internal.mapped ?? []), ...(internal.offMap ?? [])];
  const previousActivities = internal.activities?.records ?? [];
  const projection = projectEventActivities({
    events,
    previousActivities,
    runId: active.snapshotId,
    generatedAt,
  });
  const publicActivities = projectPublicActivityCatalogue(
    projection.activities,
    { snapshotId: `${active.snapshotId}-parent-dedup-v4` },
  );
  const publicLandmarks = repairLandmarks(
    activeLandmarks,
    projection.activities,
    publicActivities,
  );
  const repairedInternal = {
    ...internal,
    schemaVersion: "3.2",
    activities: projection.activities,
    activityGroupingReviews: projection.reviews,
    activityGroupingDecisions: projection.decisions,
    parentActivityGrouping: projection.parentGrouping,
    counts: {
      ...(internal.counts ?? {}),
      activities: projection.activities.counts.activities,
      sessions: projection.activities.counts.sessions,
      venueGroups: projection.activities.counts.venueGroups,
      sourceOffers: projection.activities.counts.sourceOffers,
      groupingReviews: projection.reviews.counts.records,
      parentCandidates: projection.parentGrouping.counts.candidates,
      parentMerges: projection.parentGrouping.counts.mergedParents,
      parentGroupingReviews: projection.parentGrouping.counts.reviews,
    },
  };
  const snapshotId = `${active.snapshotId}-parent-dedup-v4`;
  const audit = {
    inputOccurrences: events.length,
    activitiesBefore: previousActivities.length,
    activitiesAfter: projection.activities.counts.activities,
    activitiesConsolidated:
      previousActivities.length - projection.activities.counts.activities,
    sessionsBefore: previousActivities.reduce(
      (sum, activity) => sum + (activity.sessions?.length ?? 0),
      0,
    ),
    sessionsAfter: projection.activities.counts.sessions,
    parentCandidates: projection.parentGrouping.counts.candidates,
    parentMerges: projection.parentGrouping.counts.mergedParents,
    parentGroupingReviews: projection.parentGrouping.counts.reviews,
  };
  const snapshot = {
    schemaVersion: "1.0",
    snapshotId,
    publishedAt: activeManifest.publishedAt,
    coveredWindow: activeManifest.coveredWindow,
    freshness: activeManifest.freshness,
    staleAfter: activeManifest.staleAfter,
    sourceHealth: activeManifest.sourceHealth,
    landmarksRef: "landmarks.json",
    poisRef: "pois.json",
    tilesetRef: "tileset.json",
    activitiesRef: "activities.json",
    internalEventsRef: "internal-events.json",
    previousSnapshotId: active.snapshotId,
    eventPipelineProvenance: {
      ...(activeManifest.eventPipelineProvenance ?? {}),
      parentDedupRepair: {
        version: REPAIR_VERSION,
        sourceSnapshotId: active.snapshotId,
        repairedAt: generatedAt,
        audit,
      },
    },
  };
  const staged =
    existingStage(root, snapshotId, active.snapshotId) ??
    stageImmutableSnapshot({
      root,
      snapshot,
      commitEligibility: { eligible: true },
      artifacts: {
        "landmarks.json": json(publicLandmarks),
        "pois.json": fs.readFileSync(
          path.join(active.directory, active.poisRef),
          "utf8",
        ),
        "tileset.json": fs.readFileSync(
          path.join(active.directory, active.tilesetRef),
          "utf8",
        ),
        "activities.json": json(publicActivities),
        "internal-events.json": json(repairedInternal),
      },
    });
  if (activate) activateStagedSnapshot({ root, staged });
  return {
    complete: true,
    changed: true,
    activated: activate,
    snapshotId,
    previousSnapshotId: active.snapshotId,
    audit,
    reviewReasonCounts: Object.fromEntries(
      Object.entries(
        projection.reviews.records.reduce((counts, item) => {
          counts[item.reasonCode] = (counts[item.reasonCode] ?? 0) + 1;
          return counts;
        }, {}),
      ).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
}
