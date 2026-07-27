import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { APPROVED_POIS } from "../data/approved-pois.js";
import { APPROVED_LANDMARKS } from "../data/approved-landmarks.js";
import {
  contentHash,
  pruneExpiredContent,
  reconcileLandmark,
  reconcilePublishedLandmarks,
  reconcilePoi,
  reconcileSourceAvailability,
} from "./reconcile-event-content.mjs";
import { restorePoiBackgrounds } from "./restore-poi-backgrounds.mjs";
import {
  activateStagedSnapshot,
  loadApprovedSnapshot,
  stageImmutableSnapshot,
} from "./lib/approved-snapshot.mjs";
import { projectEventActivities } from "./lib/event-pipeline/activity-projection.mjs";

const require = createRequire(import.meta.url);
const {
  projectPublicActivityCatalogue,
  projectPublicLandmarks,
} = require("./lib/public-event-catalogue.cjs");

const atomicWrite = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, value);
  renameSync(temporary, path);
};
const writeJson = (path, value) =>
  atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`);
const moduleText = (name, records) =>
  `export const ${name} = ${JSON.stringify(records, null, 2)};\n`;

function catalogueEvents(catalogue) {
  if (Array.isArray(catalogue)) return catalogue;
  return [...(catalogue?.mapped ?? []), ...(catalogue?.offMap ?? [])];
}

export function hydrateInternalLandmarks(landmarks, catalogue) {
  if (landmarks.some(({ events }) => Array.isArray(events))) return landmarks;
  const events = catalogueEvents(catalogue);
  if (!events.length) return landmarks;
  const activityRecords = catalogue?.activities?.records ?? [];
  const activityByOccurrence = new Map(
    activityRecords.flatMap((activity) =>
      (activity.occurrenceIds ?? []).map((occurrenceId) => [
        occurrenceId,
        activity.activityId,
      ]),
    ),
  );
  const activityById = new Map(
    activityRecords.map((activity) => [activity.activityId, activity]),
  );
  const eventsByActivity = new Map();
  for (const event of events) {
    const occurrenceId = event.occurrenceId ?? event.id;
    const activityId =
      event.activityId ??
      event.parentActivityId ??
      activityByOccurrence.get(occurrenceId);
    if (!activityId) continue;
    const rows = eventsByActivity.get(activityId) ?? [];
    rows.push(event);
    eventsByActivity.set(activityId, rows);
  }
  return landmarks.map((landmark) => {
    const landmarkEvents = new Map();
    for (const reference of landmark.activityRefs ?? []) {
      const activity = activityById.get(reference.activityId);
      const venueGroupIds = new Set(reference.venueGroupIds ?? []);
      const sessionIds = new Set(
        (activity?.venueGroups ?? [])
          .filter(({ venueGroupId }) => venueGroupIds.has(venueGroupId))
          .flatMap(({ sessionIds = [] }) => sessionIds),
      );
      const occurrenceIds = new Set(
        (activity?.sessions ?? [])
          .filter(({ sessionId }) => sessionIds.has(sessionId))
          .flatMap(({ occurrenceIds = [] }) => occurrenceIds),
      );
      for (const event of eventsByActivity.get(reference.activityId) ?? []) {
        const occurrenceId = event.occurrenceId ?? event.id;
        if (occurrenceIds.size && !occurrenceIds.has(occurrenceId)) continue;
        landmarkEvents.set(event.id, {
          ...event,
          approvedLocationId: landmark.id,
          coordinates: landmark.anchor,
          publicPlacement: "mapped",
          mappingStatus: "approved",
          lifecycleState: "active",
        });
      }
    }
    return { ...landmark, events: [...landmarkEvents.values()] };
  });
}

export function loadCurrentApprovedData(root) {
  try {
    const active = loadApprovedSnapshot({ root });
    const landmarks = JSON.parse(
      readFileSync(join(active.directory, active.landmarksRef), "utf8"),
    );
    const events = active.internalEventsRef
      ? JSON.parse(
          readFileSync(join(active.directory, active.internalEventsRef), "utf8"),
        )
      : active.eventsRef
        ? JSON.parse(
            readFileSync(join(active.directory, active.eventsRef), "utf8"),
          )
        : [];
    return {
      snapshot: active,
      pois: JSON.parse(
        readFileSync(join(active.directory, active.poisRef), "utf8"),
      ),
      landmarks: hydrateInternalLandmarks(landmarks, events),
      publicLandmarks: landmarks,
      events,
      activities: active.activitiesRef
        ? JSON.parse(
            readFileSync(join(active.directory, active.activitiesRef), "utf8"),
          )
        : null,
    };
  } catch (error) {
    if (error?.code === "snapshot_pointer_missing")
      return {
        snapshot: null,
        pois: APPROVED_POIS,
        landmarks: APPROVED_LANDMARKS,
        events: [],
        activities: null,
      };
    throw error;
  }
}

export function projectEventCatalogue(
  events,
  state,
  mappedEventIds = new Set(),
  previousActivities = [],
  mappedLocations = new Map(),
) {
  const byId = new Map(
    events.map((event) => [event.id, structuredClone(event)]),
  );
  for (const eventId of mappedEventIds) {
    const event = byId.get(eventId);
    const location = mappedLocations.get(eventId);
    if (event)
      Object.assign(event, {
        publicPlacement: "mapped",
        mappingStatus: "approved",
        lifecycleState: "active",
        ...(location
          ? {
              approvedLocationId: location.approvedLocationId,
              coordinates: location.coordinates,
              venue: location.label ?? event.venue,
              venueOccurrences: [
                {
                  ...(event.venueOccurrences?.[0] ?? {}),
                  approvedLocationId: location.approvedLocationId,
                  publishedVenueName: location.label ?? event.venue,
                  address:
                    event.venueOccurrences?.[0]?.address ??
                    event.address ??
                    null,
                  publicPlacement: "mapped",
                  mappingStatus: "approved",
                },
              ],
            }
          : {}),
      });
  }
  for (const venue of Object.values(state.venues ?? {})) {
    const resolution = venue.stages?.resolve;
    if (resolution?.resolutionStatus !== "needs_review") continue;
    for (const eventId of venue.eventIds ?? []) {
      const event = byId.get(eventId);
      if (event && event.lifecycleState !== "held")
        Object.assign(event, {
          publicPlacement: "off_map",
          mappingStatus: "pending_review",
          offMapSubtype: event.offMapSubtype ?? "geometry_unavailable",
          lifecycleState: "active",
        });
    }
  }
  const active = [...byId.values()].filter(
    (event) =>
      event.lifecycleState === "active" &&
      ["mapped", "off_map"].includes(event.publicPlacement),
  );
  const mapped = active.filter((event) => event.publicPlacement === "mapped");
  const offMap = active
    .filter((event) => event.publicPlacement === "off_map")
    .map((event) => ({ ...event, coordinates: null, venueVerified: false }));
  const activityProjection = projectEventActivities({
    events: active,
    previousActivities,
    runId: state.runId ?? null,
    generatedAt: state.completedAt ?? state.updatedAt ?? null,
  });
  return {
    schemaVersion: "3.1",
    mapped,
    offMap,
    activities: activityProjection.activities,
    activityGroupingReviews: activityProjection.reviews,
    activityGroupingDecisions: activityProjection.decisions,
    parentActivityGrouping: activityProjection.parentGrouping,
    counts: {
      active: active.length,
      mapped: mapped.length,
      offMap: offMap.length,
      activities: activityProjection.activities.counts.activities,
      sessions: activityProjection.activities.counts.sessions,
      venueGroups: activityProjection.activities.counts.venueGroups,
      sourceOffers: activityProjection.activities.counts.sourceOffers,
      groupingReviews: activityProjection.reviews.counts.records,
      parentCandidates: activityProjection.parentGrouping.counts.candidates,
      parentMerges: activityProjection.parentGrouping.counts.mergedParents,
      parentGroupingReviews:
        activityProjection.parentGrouping.counts.reviews,
    },
  };
}

function readResolve(runDir, venueId, stage) {
  if (stage.status !== "success" || !stage.outputRef) return null;
  return JSON.parse(readFileSync(join(runDir, stage.outputRef), "utf8")).result;
}

function poiFromResolution(resolution) {
  const tiles = {};
  for (const tile of resolution.sourceTiles ?? []) {
    const path = tile.path ?? tile.tilePath;
    if (path) tiles[path] = [...new Set(tile.batchIds ?? [])];
  }
  return {
    id: resolution.poiId,
    label: resolution.canonicalVenue.toUpperCase(),
    data: `poi-tiles/${resolution.poiId}/tileset.json`,
    names: resolution.acceptedGmlNames,
    tiles,
  };
}

function referenceLandmarkActivities(landmarks, internalCatalogue) {
  const activityByOccurrence = new Map(
    (internalCatalogue.activities?.records ?? []).flatMap((activity) =>
      (activity.occurrenceIds ?? []).map((occurrenceId) => [
        occurrenceId,
        activity.activityId,
      ]),
    ),
  );
  return landmarks.map((landmark) => ({
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
}

export async function prepareFrontendSnapshot({
  runDir,
  state,
  run,
  currentPois = APPROVED_POIS,
  currentLandmarks = APPROVED_LANDMARKS,
  currentEventsCatalogue = null,
}) {
  const currentEvents = JSON.parse(
    readFileSync(join(runDir, "normalized/events.json"), "utf8"),
  ).records;
  const sourceStatuses = Object.fromEntries(
    Object.entries(state.sources ?? {}).map(([name, source]) => [
      name,
      source.status,
    ]),
  );
  const sourceReconciliation = reconcileSourceAvailability({
    previousEvents: catalogueEvents(currentEventsCatalogue).length
      ? catalogueEvents(currentEventsCatalogue)
      : currentLandmarks.flatMap(({ events = [] }) => events),
    currentEvents,
    sourceStatuses,
    asOf: run.window.start,
  });
  const events = sourceReconciliation.events;
  const landmarkReconciliation = reconcilePublishedLandmarks({
    landmarks: currentLandmarks,
    events,
  });
  // Reconciliation may intentionally preserve a previously published identity
  // when a source occurrence gains a date (and therefore a more specific raw
  // occurrence ID). Index both the stable identity and the source occurrence
  // aliases so venue branches produced by the current normalization pass still
  // resolve to the reconciled event instead of creating an empty placeholder.
  const eventMap = new Map();
  for (const event of events) {
    const aliases = [
      event.id,
      event.occurrenceId,
      event.identityAnchor,
      event.publishedEventId,
      ...(event.sourceOccurrenceIds ?? []),
    ];
    for (const alias of aliases)
      if (alias && !eventMap.has(alias)) eventMap.set(alias, event);
  }
  const pruned = pruneExpiredContent({
    landmarks: landmarkReconciliation.records,
    pois: currentPois,
    asOf: run.window.start,
  });
  const pois = new Map(pruned.pois.map((poi) => [poi.id, poi]));
  const landmarks = new Map(
    pruned.landmarks.map((landmark) => [landmark.id, landmark]),
  );
  const groups = new Map();
  for (const [venueId, venue] of Object.entries(state.venues)) {
    const resolution = readResolve(runDir, venueId, venue.stages.resolve);
    if (!resolution) continue;
    const group = groups.get(resolution.poiId) ?? {
      resolution,
      venueIds: [],
      sourceVenues: [],
      eventIds: [],
    };
    group.venueIds.push(venueId);
    group.sourceVenues.push(venue.venue);
    group.eventIds.push(
      ...venue.eventIds.filter(
        (eventId) => eventMap.get(eventId)?.lifecycleState === "active",
      ),
    );
    groups.set(resolution.poiId, group);
  }

  const classifications = [];
  const mappedEventIds = new Set();
  const mappedLocations = new Map();
  for (const [poiId, group] of groups) {
    group.eventIds = [...new Set(group.eventIds)];
    if (!group.eventIds.length) continue;
    const resolution = group.resolution;
    const location = {
      approvedLocationId: poiId,
      coordinates: resolution.coordinates,
      label: resolution.canonicalVenue,
    };
    for (const eventId of group.eventIds) {
      const event = eventMap.get(eventId);
      mappedEventIds.add(event.id);
      for (const alias of [
        eventId,
        event.id,
        event.occurrenceId,
        event.identityAnchor,
        event.publishedEventId,
        ...(event.sourceOccurrenceIds ?? []),
      ])
        if (alias && !mappedLocations.has(alias))
          mappedLocations.set(alias, location);
    }
    const nextPoi = poiFromResolution(resolution);
    const poiResult = reconcilePoi(pois.get(poiId), nextPoi);
    pois.set(poiId, poiResult.poi);
    const nextLandmark = {
      id: poiId,
      label: resolution.canonicalVenue,
      anchor: resolution.coordinates,
      events: group.eventIds.map((id) => ({
        ...eventMap.get(id),
        coordinates: resolution.coordinates,
        venueVerified: true,
        publicPlacement: "mapped",
        mappingStatus: "approved",
        lifecycleState: "active",
      })),
    };
    const landmarkResult = reconcileLandmark(
      landmarks.get(poiId),
      nextLandmark,
      group.sourceVenues,
    );
    landmarks.set(poiId, landmarkResult.landmark);
    classifications.push({
      poiId,
      venueIds: group.venueIds,
      eventIds: group.eventIds,
      highlightAction: poiResult.action,
      pillAction: landmarkResult.action,
      panelAction: landmarkResult.action,
      canonicalVenue: resolution.canonicalVenue,
      anchor: resolution.coordinates,
    });
  }

  const frontendDir = join(runDir, "frontend"),
    assetsDir = join(frontendDir, "assets");
  rmSync(frontendDir, { recursive: true, force: true });
  mkdirSync(assetsDir, { recursive: true });
  const nextPois = [...pois.values()],
    nextLandmarks = [...landmarks.values()];
  for (const landmark of nextLandmarks)
    for (const event of landmark.events ?? []) {
      const location = {
          approvedLocationId: landmark.id,
          coordinates: landmark.anchor,
          label: landmark.label,
        };
      for (const alias of [
        event?.id,
        event?.occurrenceId,
        event?.identityAnchor,
        event?.publishedEventId,
        ...(event?.sourceOccurrenceIds ?? []),
      ])
        if (alias && !mappedLocations.has(alias))
          mappedLocations.set(alias, location);
    }
  const projectedEvents = projectEventCatalogue(
    events,
    state,
    mappedEventIds,
    currentEventsCatalogue?.activities?.records ??
      [],
    mappedLocations,
  );
  const projectedActivities = projectPublicActivityCatalogue(
    projectedEvents.activities,
    { snapshotId: run.runId },
  );
  writeJson(join(frontendDir, "approved-pois.json"), {
    schemaVersion: "1.0",
    records: nextPois,
  });
  writeJson(join(frontendDir, "approved-landmarks.json"), {
    schemaVersion: "1.0",
    records: nextLandmarks,
  });
  writeJson(join(frontendDir, "approved-events.json"), projectedEvents);
  writeJson(join(frontendDir, "approved-activities.json"), projectedActivities);
  const projectedLandmarks = projectPublicLandmarks(
    referenceLandmarkActivities(nextLandmarks, projectedEvents),
    projectedActivities,
  );
  writeJson(join(frontendDir, "approved-public-landmarks.json"), {
    schemaVersion: "1.0",
    records: projectedLandmarks,
  });
  atomicWrite(
    join(frontendDir, "approved-pois.js"),
    moduleText("APPROVED_POIS", nextPois),
  );
  atomicWrite(
    join(frontendDir, "approved-landmarks.js"),
    moduleText("APPROVED_LANDMARKS", nextLandmarks),
  );

  const removedPois = currentPois.filter((poi) =>
    pruned.removedLandmarkIds.includes(poi.id),
  );
  if (removedPois.length)
    await restorePoiBackgrounds({
      pois: removedPois,
      poiIds: pruned.removedLandmarkIds,
      outputRoot: assetsDir,
    });
  const plan = {
    schemaVersion: "1.0",
    runId: run.runId,
    status: "staged",
    classifications,
    expiry: {
      asOf: run.window.start,
      expiredEventIds: pruned.expiredEventIds,
      removedLandmarkIds: pruned.removedLandmarkIds,
      undatedReviewEventIds: pruned.undatedReviewEventIds,
    },
    sourceReconciliation: {
      counts: sourceReconciliation.counts,
      traces: sourceReconciliation.traces,
      removedLandmarkEventIds: landmarkReconciliation.removedEventIds,
    },
    geometryChanged: classifications.some(
      (item) => item.highlightAction !== "noop",
    ),
    hashes: {
      pois: contentHash(nextPois),
      landmarks: contentHash(nextLandmarks),
      events: contentHash(projectedEvents),
      activities: contentHash(projectedActivities),
      publicLandmarks: contentHash(projectedLandmarks),
    },
    eventCounts: projectedEvents.counts,
  };
  writeJson(join(frontendDir, "plan.json"), plan);
  return plan;
}

export function writeVerifiedStageHandoffs({
  runDir,
  state,
  plan,
  verification,
}) {
  if (verification.status !== "success")
    throw new Error(
      "Cannot create successful frontend handoffs without successful executable verification",
    );
  const timestamp = new Date().toISOString(),
    written = [];
  for (const item of plan.classifications)
    for (const venueId of item.venueIds) {
      const eventIds = state.venues[venueId].eventIds;
      const definitions = {
        highlight: {
          changeAction: item.highlightAction,
          poiId: item.poiId,
          canonicalVenue: item.canonicalVenue,
          anchor: item.anchor,
          poiTilesetUrl: `public/poi-tiles/${item.poiId}/tileset.json`,
          extractionManifestUrl: `public/poi-tiles/${item.poiId}/extraction-manifest.json`,
          backgroundTileRefs: ["optimized-tiles/tileset.json"],
          frontendLayerId: "event-venues-3d",
          eventIds,
          verification: {
            command: "npm run test:poi-separation",
            status: verification.poiSeparation.status,
            browser: verification.browser,
            evidenceRef: "verification.json",
          },
          inputEventIds: eventIds,
        },
        pill: {
          changeAction: item.pillAction,
          poiId: item.poiId,
          rootId: `${item.poiId}-event-pill`,
          component: "activity-scenes/landmark-event-pill.js",
          updateMode: "successful-snapshot-reconcile",
          eventIds,
          selectedEventId: eventIds[0],
          verification: {
            command: "npm run test:event-ui",
            status: verification.eventUi.status,
            evidenceRef: "verification.json",
          },
          inputEventIds: eventIds,
        },
        panel: {
          changeAction: item.panelAction,
          poiId: item.poiId,
          component: "activity-scenes/landmark-event-panel.js",
          eventIds,
          fieldContractVersion: "1.0",
          refreshMode: "replace-active-landmark-events",
          verification: {
            command: "npm run test:event-ui",
            status: verification.eventUi.status,
            evidenceRef: "verification.json",
          },
          inputEventIds: eventIds,
        },
      };
      for (const [stage, result] of Object.entries(definitions)) {
        const outputRef = `stages/${venueId}/${stage}.json`;
        const envelope = {
          schemaVersion: "1.0",
          runId: state.runId,
          stage,
          status: "success",
          startedAt: timestamp,
          endedAt: timestamp,
          inputRefs:
            stage === "highlight"
              ? [`stages/${venueId}/resolve.json`]
              : [
                  `stages/${venueId}/${stage === "pill" ? "highlight" : "pill"}.json`,
                ],
          outputRefs: result.changeAction === "noop" ? [] : [outputRef],
          error: null,
          nextStep: null,
          result,
        };
        writeJson(join(runDir, outputRef), envelope);
        written.push(outputRef);
        state.venues[venueId].stages[stage] = {
          status: "success",
          outputRef,
          error: null,
        };
      }
    }
  return written;
}

export function commitFrontendSnapshot({
  runDir,
  root,
  run = null,
  state = null,
  commitEligibility = { eligible: true },
}) {
  const frontendDir = join(runDir, "frontend");
  const plan = JSON.parse(readFileSync(join(frontendDir, "plan.json"), "utf8"));
  if (plan.status !== "verified")
    throw new Error("Refusing to commit an unverified frontend snapshot");
  if (commitEligibility?.eligible !== true)
    throw new Error(
      `Refusing to commit an ineligible frontend snapshot: ${(commitEligibility?.reasons ?? []).join(", ")}`,
    );
  run ??= existsSync(join(runDir, "run.json"))
    ? JSON.parse(readFileSync(join(runDir, "run.json"), "utf8"))
    : {
        runId: plan.runId,
        window: {
          start: new Date().toISOString(),
          end: new Date(Date.now() + 7 * 86400000).toISOString(),
        },
      };
  const assets = join(frontendDir, "assets"),
    backupRoot = join(frontendDir, "commit-backup");
  rmSync(backupRoot, { recursive: true, force: true });
  const files = [];
  const walk = (directory, prefix = "") => {
    if (!existsSync(directory)) return;
    for (const name of readdirSync(directory)) {
      const absolute = join(directory, name),
        relative = join(prefix, name);
      if (statSync(absolute).isDirectory()) walk(absolute, relative);
      else files.push({ source: absolute, relative });
    }
  };
  walk(assets);
  const journal = [];
  try {
    for (const file of files) {
      const destination = join(root, file.relative),
        backup = join(backupRoot, file.relative),
        existed = existsSync(destination);
      if (existed) {
        mkdirSync(dirname(backup), { recursive: true });
        copyFileSync(destination, backup);
      }
      mkdirSync(dirname(destination), { recursive: true });
      const temporary = `${destination}.pipeline-next-${process.pid}`;
      copyFileSync(file.source, temporary);
      renameSync(temporary, destination);
      journal.push({ destination, backup, existed });
    }
    const publishedAt = new Date().toISOString();
    const current = loadCurrentApprovedData(root).snapshot;
    const candidateTileset = join(
      assets,
      "public/poi-tiles/event-venues/tileset.json",
    );
    const tileset = existsSync(candidateTileset)
      ? JSON.parse(readFileSync(candidateTileset, "utf8"))
      : current
        ? JSON.parse(
            readFileSync(join(current.directory, current.tilesetRef), "utf8"),
          )
        : { asset: { version: "1.0" }, geometricError: 0, root: {} };
    const makeDurable = (tile) => {
      const content = tile?.content;
      if (content)
        for (const key of ["uri", "url"])
          if (typeof content[key] === "string") {
            content[key] = content[key].replace(
              /^\/.*?\/frontend\/assets\/public\//,
              "/",
            );
            if (content[key].startsWith("/poi-tiles/"))
              content[key] = `../../../../${content[key].slice(1)}`;
          }
      for (const child of tile?.children ?? []) makeDurable(child);
    };
    makeDurable(tileset.root);
    const records = (name) =>
      JSON.parse(readFileSync(join(frontendDir, name), "utf8")).records;
    const activities = JSON.parse(
      readFileSync(join(frontendDir, "approved-activities.json"), "utf8"),
    );
    const internalCatalogue = JSON.parse(
      readFileSync(join(frontendDir, "approved-events.json"), "utf8"),
    );
    const referencedLandmarks = referenceLandmarkActivities(
      records("approved-landmarks.json"),
      internalCatalogue,
    );
    const publicLandmarks = projectPublicLandmarks(
      referencedLandmarks,
      activities,
    );
    const sourceHealth = Object.fromEntries(
      Object.entries(state?.sources ?? {}).map(([name, source]) => [
        name,
        {
          status: source.status,
          role: source.sourceRole ?? "authoritative",
          mode: source.operatingMode ?? "required",
          lastSuccessfulAt:
            source.status === "success"
              ? (source.completedAt ?? publishedAt)
              : null,
          reasonCode: source.blockerReasonCode ?? null,
          counts: source.counts ?? {},
        },
      ]),
    );
    const snapshot = {
      schemaVersion: "1.0",
      snapshotId: run.runId,
      publishedAt,
      coveredWindow: {
        start: run.window.start.slice(0, 10),
        end: run.window.end.slice(0, 10),
        timezone: run.timezone ?? "Asia/Singapore",
      },
      freshness: "fresh",
      staleAfter: new Date(
        Date.parse(publishedAt) + 7 * 86400000,
      ).toISOString(),
      sourceHealth,
      landmarksRef: "landmarks.json",
      poisRef: "pois.json",
      tilesetRef: "tileset.json",
      activitiesRef: "activities.json",
      internalEventsRef: "internal-events.json",
      eventPipelineProvenance: {
        normalizationArtifacts: state?.normalization?.artifactRefs ?? [],
        deduplicationArtifacts: state?.deduplication?.artifactRefs ?? [],
        deduplicationCounts: state?.deduplication?.counts ?? null,
        supportingDiscoveryRefs: Object.values(state?.sources ?? {}).flatMap(
          (source) => source.confirmationRefs ?? [],
        ),
      },
      previousSnapshotId: current?.snapshotId ?? null,
      contentHash: "0".repeat(64),
    };
    const staged = stageImmutableSnapshot({
      root,
      snapshot,
      commitEligibility,
      artifacts: {
        "landmarks.json": `${JSON.stringify(publicLandmarks, null, 2)}\n`,
        "pois.json": `${JSON.stringify(records("approved-pois.json"), null, 2)}\n`,
        "activities.json": `${JSON.stringify(activities, null, 2)}\n`,
        "internal-events.json": `${JSON.stringify(internalCatalogue, null, 2)}\n`,
        "tileset.json": `${JSON.stringify(tileset, null, 2)}\n`,
      },
    });
    activateStagedSnapshot({ root, staged });
    plan.status = "committed";
    plan.committedAt = publishedAt;
    plan.snapshotId = run.runId;
    plan.previousSnapshotId = current?.snapshotId ?? null;
    writeJson(join(frontendDir, "plan.json"), plan);
    rmSync(backupRoot, { recursive: true, force: true });
    return plan;
  } catch (error) {
    for (const item of journal.reverse()) {
      if (item.existed) copyFileSync(item.backup, item.destination);
      else rmSync(item.destination, { force: true });
    }
    throw new Error(
      `Frontend snapshot commit rolled back before activation: ${error.message}`,
    );
  }
}
