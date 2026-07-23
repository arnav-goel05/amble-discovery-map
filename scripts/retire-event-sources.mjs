import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  activateStagedSnapshot,
  loadApprovedSnapshot,
  stageImmutableSnapshot,
} from "./lib/approved-snapshot.mjs";

const sourceName = (value) =>
  value?.sourceName ??
  value?.source ??
  String(value?.sourceRecordId ?? "").split(":")[0];

export function stripRetiredEvent(event, retiredSources) {
  const sources = event.sources ?? [];
  const contributions = event.sourceContributions ?? [];
  const namedSources = new Set(
    [...sources.map(sourceName), ...contributions.map(sourceName)].filter(
      Boolean,
    ),
  );
  const supportedSources = [...namedSources].filter(
    (name) => !retiredSources.has(name),
  );
  if (namedSources.size && !supportedSources.length) return null;
  return {
    ...event,
    sources: sources.filter((item) => !retiredSources.has(sourceName(item))),
    sourceContributions: contributions.filter(
      (item) => !retiredSources.has(sourceName(item)),
    ),
    supportingDiscoveryIds: (event.supportingDiscoveryIds ?? []).filter(
      (id) =>
        ![...retiredSources].some((name) => String(id).startsWith(`${name}:`)),
    ),
  };
}

function stripCatalogue(catalogue, retiredSources) {
  const mapped = (catalogue.mapped ?? [])
    .map((event) => stripRetiredEvent(event, retiredSources))
    .filter(Boolean);
  const offMap = (catalogue.offMap ?? [])
    .map((event) => stripRetiredEvent(event, retiredSources))
    .filter(Boolean);
  const next = {
    ...catalogue,
    mapped,
    offMap,
    counts: {
      ...(catalogue.counts ?? {}),
      active: mapped.length + offMap.length,
      mapped: mapped.length,
      offMap: offMap.length,
    },
  };
  if (catalogue.activities?.records) {
    const records = catalogue.activities.records
      .map((activity) => {
        const sources = (activity.sources ?? []).filter(
          (name) => !retiredSources.has(name),
        );
        if ((activity.sources ?? []).length && !sources.length) return null;
        return {
          ...activity,
          sources,
          sourceOffers: (activity.sourceOffers ?? []).filter(
            (offer) => !retiredSources.has(offer.source),
          ),
        };
      })
      .filter(Boolean);
    next.activities = {
      ...catalogue.activities,
      records,
      counts: {
        ...(catalogue.activities.counts ?? {}),
        activities: records.length,
      },
    };
    next.counts.activities = records.length;
  }
  return next;
}

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

export function buildRetiredSnapshot({
  root,
  retiredSources,
  snapshotId,
  now,
}) {
  const active = loadApprovedSnapshot({ root });
  const read = (reference) =>
    JSON.parse(fs.readFileSync(path.join(active.directory, reference), "utf8"));
  const originalLandmarks = read(active.landmarksRef);
  let removedEvents = 0;
  const landmarks = originalLandmarks
    .map((landmark) => {
      const events = (landmark.events ?? [])
        .map((event) => stripRetiredEvent(event, retiredSources))
        .filter(Boolean);
      removedEvents += (landmark.events ?? []).length - events.length;
      return { ...landmark, events };
    })
    .filter(({ events }) => events.length);
  const retainedLandmarkIds = new Set(landmarks.map(({ id }) => id));
  const removedLandmarkIds = new Set(
    originalLandmarks
      .map(({ id }) => id)
      .filter((id) => !retainedLandmarkIds.has(id)),
  );
  const pois = read(active.poisRef).filter(
    ({ id }) => !removedLandmarkIds.has(id),
  );
  const tileset = read(active.tilesetRef);
  if (Array.isArray(tileset.root?.children))
    tileset.root.children = tileset.root.children.filter(
      ({ extras }) => !removedLandmarkIds.has(extras?.poiId),
    );
  const events = active.eventsRef
    ? stripCatalogue(read(active.eventsRef), retiredSources)
    : null;
  const sourceHealth = Object.fromEntries(
    Object.entries(active.sourceHealth).filter(
      ([name]) => !retiredSources.has(name),
    ),
  );
  const removedLandmarks = originalLandmarks.length - landmarks.length;
  const migrationTime = now.toISOString();
  const snapshot = {
    ...active,
    snapshotId,
    sourceHealth,
    previousSnapshotId: active.snapshotId,
    eventPipelineProvenance: {
      ...(active.eventPipelineProvenance ?? {}),
      sourceRetirement: {
        retiredSources: [...retiredSources].sort(),
        baseSnapshotId: active.snapshotId,
        migratedAt: migrationTime,
        removedEvents,
        removedLandmarks,
      },
    },
  };
  for (const key of [
    "directory",
    "manifestHash",
    "publicRefs",
    "freshness",
    "stale",
    "warning",
    "artifactHashes",
    "contentHash",
  ])
    delete snapshot[key];
  snapshot.freshness = active.stale ? "potentially_outdated" : active.freshness;
  return {
    active,
    snapshot,
    artifacts: {
      [active.landmarksRef]: json(landmarks),
      [active.poisRef]: json(pois),
      [active.tilesetRef]: json(tileset),
      ...(active.eventsRef ? { [active.eventsRef]: json(events) } : {}),
    },
    counts: {
      removedEvents,
      removedLandmarks,
      landmarks: landmarks.length,
      pois: pois.length,
    },
  };
}

export function retireApprovedSnapshotSources({
  root,
  sourceNames,
  apply = false,
  now = new Date(),
  snapshotId = `${now
    .toISOString()
    .replace(/[-:.]/g, "")
    .replace(/\.\d{3}Z$/, "Z")}-source-retirement`,
}) {
  const retiredSources = new Set(sourceNames.filter(Boolean));
  if (!retiredSources.size)
    throw new Error("At least one retired source is required");
  const candidate = buildRetiredSnapshot({
    root,
    retiredSources,
    snapshotId,
    now,
  });
  if (!apply) return { ...candidate.counts, snapshotId, applied: false };
  const staged = stageImmutableSnapshot({
    root,
    snapshot: candidate.snapshot,
    artifacts: candidate.artifacts,
    commitEligibility: {
      eligible: true,
      reason: "offline_source_retirement_verified",
      ...candidate.counts,
    },
  });
  activateStagedSnapshot({ root, staged });
  return { ...candidate.counts, snapshotId, applied: true };
}

function parseArgs(argv) {
  const sourceNames = [];
  let apply = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--source") sourceNames.push(argv[++index]);
    else if (argv[index] === "--apply") apply = true;
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return { sourceNames, apply };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = retireApprovedSnapshotSources({
    root: process.cwd(),
    ...parseArgs(process.argv.slice(2)),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
