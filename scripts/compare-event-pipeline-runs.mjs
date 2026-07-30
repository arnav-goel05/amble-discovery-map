#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { compareCanonicalSurfaces } from "./lib/event-pipeline/equivalence.mjs";

const option = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};
const beforeRun = option("--before");
const afterRun = option("--after");
const snapshotRoot = resolve(
  option("--snapshot-root") ??
    new URL("../data/snapshots", import.meta.url).pathname,
);
if (!beforeRun || !afterRun)
  throw new Error(
    "Usage: compare-event-pipeline-runs --before <run-dir> --after <run-dir> [--output file]",
  );

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const readRun = (runDir) => {
  const root = resolve(runDir);
  const status = readJson(`${root}/status.json`);
  const snapshotId =
    status.publication?.candidateSnapshotId ??
    status.publication?.activeSnapshotId ??
    null;
  let published = { mapped: [], offMap: [] };
  let snapshot = {
    manifest: null,
    activities: null,
    landmarks: null,
    pois: null,
    tileset: null,
  };
  if (snapshotId) {
    try {
      const manifest = readJson(`${snapshotRoot}/${snapshotId}/manifest.json`);
      const internalEventsRef =
        manifest.internalEventsRef ?? manifest.eventsRef;
      if (internalEventsRef)
        published = readJson(
          `${snapshotRoot}/${snapshotId}/${internalEventsRef}`,
        );
      snapshot = {
        manifest,
        activities: manifest.activitiesRef
          ? readJson(`${snapshotRoot}/${snapshotId}/${manifest.activitiesRef}`)
          : null,
        landmarks: manifest.landmarksRef
          ? readJson(`${snapshotRoot}/${snapshotId}/${manifest.landmarksRef}`)
          : null,
        pois: manifest.poisRef
          ? readJson(`${snapshotRoot}/${snapshotId}/${manifest.poisRef}`)
          : null,
        tileset: manifest.tilesetRef
          ? readJson(`${snapshotRoot}/${snapshotId}/${manifest.tilesetRef}`)
          : null,
      };
    } catch {
      // A preserved-previous or pre-publication run can still be compared at normalization.
    }
  }
  return {
    root,
    status,
    events: readJson(`${root}/normalized/events.json`).records,
    excluded: readJson(`${root}/normalized/excluded.json`).records,
    published,
    snapshot,
  };
};

function sourcesOf(event) {
  if (event?.event) return sourcesOf(event.event);
  const sources = (event.sources ?? [])
    .map(({ source }) => source)
    .filter(Boolean);
  return [
    ...new Set(sources.length ? sources : [event.sourceName].filter(Boolean)),
  ];
}

function summarizeCompleteness(records) {
  const summary = {};
  for (const record of records)
    for (const completeness of [
      record?.fieldCompleteness,
      ...Object.values(record?.fieldCompletenessByOccurrence ?? {}),
    ].filter(Boolean))
      for (const [field, assessment] of Object.entries(completeness)) {
        summary[field] ??= {
          present: 0,
          not_published_by_source: 0,
          extraction_failed: 0,
        };
        if (assessment?.status in summary[field])
          summary[field][assessment.status] += 1;
      }
  return summary;
}

function summarize(run) {
  const sourceNames = new Set([
    ...Object.keys(run.status.sources ?? {}),
    ...run.events.flatMap(sourcesOf),
    ...run.excluded.flatMap(sourcesOf),
  ]);
  const bySource = {};
  for (const source of [...sourceNames].sort()) {
    const events = run.events.filter((event) =>
      sourcesOf(event).includes(source),
    );
    const excluded = run.excluded.filter((event) =>
      sourcesOf(event).includes(source),
    );
    const mapped = (run.published.mapped ?? []).filter((event) =>
      sourcesOf(event).includes(source),
    );
    const offMap = (run.published.offMap ?? []).filter((event) =>
      sourcesOf(event).includes(source),
    );
    const collectedCompleteness =
      run.status.sources?.[source]?.counts?.fieldCompleteness ?? {};
    const fieldCompleteness = Object.keys(collectedCompleteness).length
      ? collectedCompleteness
      : summarizeCompleteness([
          ...events,
          ...excluded.map((record) => record.event ?? record),
        ]);
    bySource[source] = {
      collection: run.status.sources?.[source]?.counts ?? {},
      uniqueActivities: events.length,
      excluded: excluded.length,
      mapped: mapped.length,
      offMap: offMap.length,
      mappingReview: [...mapped, ...offMap].filter(
        ({ mappingStatus }) => mappingStatus === "pending_review",
      ).length,
      fieldCompleteness,
    };
  }
  return {
    runId: run.status.runId,
    publication: run.status.publication,
    totals: {
      events: run.events.length,
      excluded: run.excluded.length,
      eligiblePreDedup:
        run.status.deduplication?.counts?.eligiblePreDedup ?? null,
      duplicatesCollapsed:
        run.status.deduplication?.counts?.crossSourceDuplicateCollapsed ?? null,
      uniqueActivities:
        run.status.deduplication?.counts?.acceptedPrimary ?? run.events.length,
      publishedMapped: run.published.mapped?.length ?? 0,
      publishedOffMap: run.published.offMap?.length ?? 0,
    },
    bySource,
  };
}

const beforeRaw = readRun(beforeRun);
const afterRaw = readRun(afterRun);
const before = summarize(beforeRaw);
const after = summarize(afterRaw);
const delta = {};
for (const source of new Set([
  ...Object.keys(before.bySource),
  ...Object.keys(after.bySource),
])) {
  const left = before.bySource[source] ?? {};
  const right = after.bySource[source] ?? {};
  delta[source] = Object.fromEntries(
    ["uniqueActivities", "excluded", "mapped", "offMap", "mappingReview"].map(
      (field) => [field, (right[field] ?? 0) - (left[field] ?? 0)],
    ),
  );
}
const report = {
  schemaVersion: "2.0",
  createdAt: new Date().toISOString(),
  before,
  after,
  delta,
  equivalence: compareCanonicalSurfaces(
    {
      sourceAccounting: beforeRaw.status.sources,
      normalization: beforeRaw.events,
      exclusions: beforeRaw.excluded,
      deduplication: beforeRaw.status.deduplication,
      venues: beforeRaw.status.venues,
      publishedEvents: beforeRaw.published,
      activities: beforeRaw.snapshot.activities,
      landmarks: beforeRaw.snapshot.landmarks,
      pois: beforeRaw.snapshot.pois,
      tileset: beforeRaw.snapshot.tileset,
    },
    {
      sourceAccounting: afterRaw.status.sources,
      normalization: afterRaw.events,
      exclusions: afterRaw.excluded,
      deduplication: afterRaw.status.deduplication,
      venues: afterRaw.status.venues,
      publishedEvents: afterRaw.published,
      activities: afterRaw.snapshot.activities,
      landmarks: afterRaw.snapshot.landmarks,
      pois: afterRaw.snapshot.pois,
      tileset: afterRaw.snapshot.tileset,
    },
  ),
};
const output = option("--output");
if (output) {
  const path = resolve(output);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
