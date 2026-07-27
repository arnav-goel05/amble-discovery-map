#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import {
  activateStagedSnapshot,
  hashFile,
  loadApprovedSnapshot,
  stageImmutableSnapshot,
} from "./lib/approved-snapshot.mjs";
import { projectEventActivities } from "./lib/event-pipeline/activity-projection.mjs";
import { repairParentDedupSnapshot } from "./lib/event-pipeline/parent-dedup-repair.mjs";
import { repairScheduleSemanticsSnapshot } from "./lib/event-pipeline/schedule-semantics-repair.mjs";

if (process.argv.includes("--repair-schedule-semantics")) {
  const result = repairScheduleSemanticsSnapshot({
    root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
    activate: process.argv.includes("--activate"),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(0);
}

if (process.argv.includes("--repair-parent-dedup")) {
  const result = repairParentDedupSnapshot({
    root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
    activate: process.argv.includes("--activate"),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(0);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const {
  projectPublicActivityCatalogue,
  projectPublicLandmarks,
} = require("./lib/public-event-catalogue.cjs");

const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const active = loadApprovedSnapshot({ root });
const activeManifest = read(path.join(active.directory, "manifest.json"));
const currentInternalCatalogue = active.internalEventsRef
  ? read(path.join(active.directory, active.internalEventsRef))
  : null;
if (
  active.activitiesRef &&
  currentInternalCatalogue?.activities?.records?.length
) {
  process.stdout.write(
    `${JSON.stringify({
      complete: true,
      changed: false,
      snapshotId: active.snapshotId,
      reason: "activity_contract_and_internal_reconciliation_already_active",
    })}\n`,
  );
  process.exit(0);
}

const sourceSnapshotId = active.activitiesRef
  ? activeManifest.eventPipelineProvenance?.activityContractMigration
      ?.sourceSnapshotId ?? activeManifest.previousSnapshotId
  : active.snapshotId;
const sourceDirectory = active.activitiesRef
  ? path.join(root, "data/snapshots", sourceSnapshotId)
  : active.directory;
const sourceManifest = active.activitiesRef
  ? read(path.join(sourceDirectory, "manifest.json"))
  : activeManifest;
if (!sourceManifest.eventsRef)
  throw new Error(
    "Activity migration repair requires the prior occurrence snapshot",
  );
const landmarks = read(path.join(sourceDirectory, sourceManifest.landmarksRef));
const catalogue = read(path.join(sourceDirectory, sourceManifest.eventsRef));
const eventsById = new Map(
  [...(catalogue.mapped ?? []), ...(catalogue.offMap ?? [])].map((event) => [
    event.id,
    event,
  ]),
);
for (const landmark of landmarks)
  for (const event of landmark.events ?? [])
    eventsById.set(event.id, {
      ...eventsById.get(event.id),
      ...event,
      approvedLocationId: landmark.id,
      coordinates: landmark.anchor,
      venue: event.venue ?? landmark.label,
      publicPlacement: "mapped",
      mappingStatus: "approved",
      venueOccurrences: [
        {
          ...(event.venueOccurrences?.[0] ?? {}),
          approvedLocationId: landmark.id,
          publishedVenueName: event.venue ?? landmark.label,
          publicPlacement: "mapped",
          mappingStatus: "approved",
        },
      ],
    });

const projection = projectEventActivities({
  events: [...eventsById.values()],
  runId: active.snapshotId,
  generatedAt: new Date().toISOString(),
});
const activities = active.activitiesRef
  ? read(path.join(active.directory, active.activitiesRef))
  : projectPublicActivityCatalogue(projection.activities, {
      snapshotId: active.snapshotId,
    });
const activityByOccurrence = new Map(
  projection.activities.records.flatMap((activity) =>
    activity.occurrenceIds.map((occurrenceId) => [
      occurrenceId,
      activity.activityId,
    ]),
  ),
);
const referencedLandmarks = landmarks.map((landmark) => ({
  ...landmark,
  events: (landmark.events ?? [])
    .map((event) => ({
      ...event,
      activityId:
        event.activityId ??
        activityByOccurrence.get(event.occurrenceId ?? event.id),
    }))
    .filter((event) => event.activityId),
}));
const publicLandmarks = active.activitiesRef
  ? read(path.join(active.directory, active.landmarksRef))
  : projectPublicLandmarks(referencedLandmarks, activities);
const internalEvents = [...eventsById.values()];
const internalMapped = internalEvents.filter(
  ({ publicPlacement }) => publicPlacement === "mapped",
);
const internalOffMap = internalEvents.filter(
  ({ publicPlacement }) => publicPlacement === "off_map",
);
const internalCatalogue = {
  ...catalogue,
  schemaVersion: "3.1",
  mapped: internalMapped,
  offMap: internalOffMap,
  activities: projection.activities,
  activityGroupingReviews: projection.reviews,
  activityGroupingDecisions: projection.decisions,
  counts: {
    ...(catalogue.counts ?? {}),
    active: internalEvents.length,
    mapped: internalMapped.length,
    offMap: internalOffMap.length,
    activities: projection.activities.counts.activities,
    sessions: projection.activities.counts.sessions,
    venueGroups: projection.activities.counts.venueGroups,
    sourceOffers: projection.activities.counts.sourceOffers,
    groupingReviews: projection.reviews.counts.records,
  },
};
const snapshotId = active.activitiesRef
  ? `${active.snapshotId}-internal-v2`
  : `${active.snapshotId}-activities-v1`;
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
    activityContractMigration: {
      schemaVersion: "1.0",
      sourceSnapshotId,
      migratedAt: new Date().toISOString(),
      counts: activities.counts,
    },
    ...(active.activitiesRef
      ? {
          activityInternalRepair: {
            schemaVersion: "1.0",
            sourceSnapshotId,
            repairedAt: new Date().toISOString(),
            counts: internalCatalogue.counts,
          },
        }
      : {}),
  },
};
const existingDirectory = path.join(root, "data/snapshots", snapshotId);
const existingManifest = path.join(existingDirectory, "manifest.json");
const staged = fs.existsSync(existingManifest)
  ? {
      snapshotId,
      snapshotDirectory: existingDirectory,
      manifestPath: existingManifest,
      manifestHash: hashFile(existingManifest),
      commitEligibility: { eligible: true },
    }
  : stageImmutableSnapshot({
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
        "activities.json": json(activities),
        "internal-events.json": json(internalCatalogue),
      },
    });
const activate = process.argv.includes("--activate");
if (activate) activateStagedSnapshot({ root, staged });
process.stdout.write(
  `${JSON.stringify({
    complete: true,
    changed: true,
    activated: activate,
    snapshotId,
    previousSnapshotId: active.snapshotId,
    counts: activities.counts,
    internalCounts: internalCatalogue.counts,
    bytes: {
      activities: Buffer.byteLength(json(activities)),
      landmarks: Buffer.byteLength(json(publicLandmarks)),
    },
  })}\n`,
);
