import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

import {
  approvedSnapshot,
  temporaryState,
} from "./helpers/baseline-fixtures.mjs";
import {
  ApprovedSnapshotError,
  activateStagedSnapshot,
  computeSnapshotContentHash,
  hashFile,
  loadApprovedSnapshot,
  resolveActiveSnapshotAsset,
  stageImmutableSnapshot,
  writeActiveSnapshotPointer,
} from "../scripts/lib/approved-snapshot.mjs";
import { repairParentDedupSnapshot } from "../scripts/lib/event-pipeline/parent-dedup-repair.mjs";
import { repairScheduleSemanticsSnapshot } from "../scripts/lib/event-pipeline/schedule-semantics-repair.mjs";
import { projectEventActivities } from "../scripts/lib/event-pipeline/activity-projection.mjs";

const require = createRequire(import.meta.url);
const {
  projectPublicActivityCatalogue,
  validatePublicActivityCatalogue,
} = require("../scripts/lib/public-event-catalogue.cjs");
const {
  publicMetadata,
  publicTileset,
} = require("../scripts/approved-snapshot-api-plugin.cjs");

function createSnapshot(root, overrides = {}) {
  const snapshotDir = path.join(root, "data/snapshots/snapshot-fixture");
  fs.mkdirSync(snapshotDir, { recursive: true });
  fs.writeFileSync(path.join(snapshotDir, "landmarks.json"), "[]\n");
  fs.writeFileSync(path.join(snapshotDir, "pois.json"), "[]\n");
  fs.writeFileSync(path.join(snapshotDir, "tileset.json"), "{}\n");
  fs.writeFileSync(
    path.join(snapshotDir, "activities.json"),
    `${JSON.stringify({
      schemaVersion: "1.0",
      snapshotId: "snapshot-fixture",
      generatedAt: "2026-07-14T00:00:00.000Z",
      counts: {
        activities: 0,
        sessions: 0,
        venueGroups: 0,
        sourceOffers: 0,
        mappedActivities: 0,
        offMapActivities: 0,
      },
      records: [],
    })}\n`,
  );
  if (overrides.internalEventsRef)
    fs.writeFileSync(
      path.join(snapshotDir, overrides.internalEventsRef),
      '{"schemaVersion":"3.1","mapped":[],"offMap":[]}\n',
    );
  const artifactHashes = {
    "landmarks.json": hashFile(path.join(snapshotDir, "landmarks.json")),
    "pois.json": hashFile(path.join(snapshotDir, "pois.json")),
    "tileset.json": hashFile(path.join(snapshotDir, "tileset.json")),
    "activities.json": hashFile(path.join(snapshotDir, "activities.json")),
    ...(overrides.internalEventsRef
      ? {
          [overrides.internalEventsRef]: hashFile(
            path.join(snapshotDir, overrides.internalEventsRef),
          ),
        }
      : {}),
    ...(overrides.artifactHashes ?? {}),
  };
  const base = approvedSnapshot({
    landmarksRef: "landmarks.json",
    poisRef: "pois.json",
    tilesetRef: "tileset.json",
    activitiesRef: "activities.json",
    ...overrides,
    artifactHashes,
  });
  const manifest = { ...base, contentHash: computeSnapshotContentHash(base) };
  fs.writeFileSync(
    path.join(snapshotDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  writeActiveSnapshotPointer({
    root,
    snapshotId: manifest.snapshotId,
    manifestPath: path.join(snapshotDir, "manifest.json"),
  });
  return { manifest, snapshotDir };
}

test("loads the active immutable snapshot and validates every artifact hash", () => {
  const state = temporaryState();
  try {
    createSnapshot(state.root);
    const loaded = loadApprovedSnapshot({
      root: state.root,
      now: new Date("2026-07-15T00:00:00.000Z"),
    });
    assert.equal(loaded.snapshotId, "snapshot-fixture");
    assert.equal(loaded.freshness, "fresh");
    assert.match(loaded.publicRefs.landmarks, /^\/api\/snapshot\/assets\//);
  } finally {
    state.cleanup();
  }
});

test("missing active pointer fails closed", () => {
  const state = temporaryState();
  try {
    assert.throws(
      () => loadApprovedSnapshot({ root: state.root }),
      (error) =>
        error instanceof ApprovedSnapshotError &&
        error.code === "snapshot_pointer_missing",
    );
  } finally {
    state.cleanup();
  }
});

test("manifest and artifact hash mismatches fail closed", () => {
  const state = temporaryState();
  try {
    const { snapshotDir } = createSnapshot(state.root);
    fs.appendFileSync(path.join(snapshotDir, "manifest.json"), " ");
    assert.throws(
      () => loadApprovedSnapshot({ root: state.root }),
      (error) => error.code === "snapshot_manifest_hash_mismatch",
    );
    writeActiveSnapshotPointer({
      root: state.root,
      snapshotId: "snapshot-fixture",
      manifestPath: path.join(snapshotDir, "manifest.json"),
    });
    fs.writeFileSync(path.join(snapshotDir, "pois.json"), "[{}]\n");
    assert.throws(
      () => loadApprovedSnapshot({ root: state.root }),
      (error) => error.code === "snapshot_artifact_hash_mismatch",
    );
  } finally {
    state.cleanup();
  }
});

test("stale metadata is surfaced without mutating the approved manifest", () => {
  const state = temporaryState();
  try {
    createSnapshot(state.root);
    const loaded = loadApprovedSnapshot({
      root: state.root,
      now: new Date("2026-07-22T00:00:00.000Z"),
    });
    assert.equal(loaded.freshness, "potentially_outdated");
    assert.equal(loaded.stale, true);
    assert.match(loaded.warning, /potentially outdated/i);
  } finally {
    state.cleanup();
  }
});

test("public snapshot tilesets resolve POI dependencies from the site root", () => {
  const source = {
    root: {
      content: { uri: "/poi-tiles/hall/tileset.json" },
      children: [
        { content: { url: "/poi-tiles/gallery/tileset.json" } },
        { content: { uri: "../theatre/tileset.json" } },
      ],
    },
  };
  const result = publicTileset(source);
  assert.equal(
    result.root.content.uri,
    "../../../../poi-tiles/hall/tileset.json",
  );
  assert.equal(
    result.root.children[0].content.url,
    "../../../../poi-tiles/gallery/tileset.json",
  );
  assert.equal(
    result.root.children[1].content.uri,
    "../../../../poi-tiles/theatre/tileset.json",
  );
  assert.equal(source.root.content.uri, "/poi-tiles/hall/tileset.json");
});

test("public activity validation rejects internal occurrence evidence", () => {
  assert.throws(
    () =>
      validatePublicActivityCatalogue({
        schemaVersion: "1.0",
        counts: {
          activities: 1,
          sessions: 0,
          venueGroups: 0,
          sourceOffers: 0,
          mappedActivities: 0,
          offMapActivities: 1,
        },
        records: [
          {
            activityId: "activity:one",
            occurrenceIds: ["private:one"],
            sessions: [],
            venueGroups: [],
            sourceOffers: [],
          },
        ],
      }),
    /public_activity_internal_audit_present/,
  );
});

test("public activity counts a mixed mapped and review venue as both placement classes", () => {
  const catalogue = projectPublicActivityCatalogue({
    schemaVersion: "1.0",
    runId: "mixed-placement",
    generatedAt: "2026-07-26T00:00:00.000Z",
    records: [
      {
        activityId: "activity:mixed",
        title: "Mixed placement",
        sessions: [],
        sourceOffers: [],
        venueGroups: [
          {
            venueGroupId: "venue:mapped",
            activityId: "activity:mixed",
            label: "Mapped venue",
            publicPlacement: "mapped",
            mappingStatus: "approved",
            approvedLocationId: "mapped-venue",
            coordinates: { lng: 103.8, lat: 1.3 },
            sessionIds: [],
          },
          {
            venueGroupId: "venue:review",
            activityId: "activity:mixed",
            label: "Review venue",
            publicPlacement: "none",
            mappingStatus: "pending_review",
            approvedLocationId: null,
            coordinates: null,
            sessionIds: [],
          },
        ],
      },
    ],
  });
  assert.equal(catalogue.counts.mappedActivities, 1);
  assert.equal(catalogue.counts.offMapActivities, 1);
});

test("public snapshot metadata versions the corrected tileset representation", () => {
  const metadata = publicMetadata({
    schemaVersion: "1.0",
    snapshotId: "snapshot-fixture",
    publishedAt: "2026-07-14T00:00:00.000Z",
    coveredWindow: {
      start: "2026-07-14",
      end: "2026-07-21",
      timezone: "Asia/Singapore",
    },
    freshness: "fresh",
    staleAfter: "2026-07-21T00:00:00.000Z",
    publicRefs: {
      landmarks: "/landmarks",
      pois: "/pois",
      tileset: "/tileset",
      activities: "/activities",
    },
  });
  assert.equal(metadata.landmarksRef, "/landmarks?projection=activity-ui-v1");
  assert.equal(
    metadata.activitiesRef,
    "/activities?projection=activity-ui-v1",
  );
  assert.equal("eventsRef" in metadata, false);
  assert.equal(
    metadata.tilesetRef,
    "/poi-tiles/event-venues/tileset.json?snapshot=snapshot-fixture&assetPaths=site-root-v1",
  );
});

test("private occurrence reconciliation assets are never publicly addressable", () => {
  const state = temporaryState();
  try {
    createSnapshot(state.root, { internalEventsRef: "internal-events.json" });
    assert.throws(
      () =>
        resolveActiveSnapshotAsset({
          root: state.root,
          snapshotId: "snapshot-fixture",
          reference: "internal-events.json",
        }),
      (error) =>
        error instanceof ApprovedSnapshotError &&
        error.code === "snapshot_asset_unapproved",
    );
  } finally {
    state.cleanup();
  }
});

test("dangling activity landmark references reject staging and preserve the active pointer", () => {
  const state = temporaryState();
  try {
    createSnapshot(state.root);
    const activities = {
      schemaVersion: "1.0",
      snapshotId: "invalid-candidate",
      generatedAt: "2026-07-23T00:00:00.000Z",
      counts: {
        activities: 1,
        sessions: 0,
        venueGroups: 1,
        sourceOffers: 0,
        mappedActivities: 1,
        offMapActivities: 0,
      },
      records: [
        {
          schemaVersion: "1.0",
          activityId: "activity:one",
          sessions: [],
          venueGroups: [
            {
              venueGroupId: "venue-group:one",
              activityId: "activity:one",
              publicPlacement: "mapped",
              mappingStatus: "approved",
              approvedLocationId: "venue-one",
              coordinates: { lat: 1.3, lng: 103.8 },
              sessionIds: [],
            },
          ],
          sourceOffers: [],
        },
      ],
    };
    assert.throws(
      () =>
        stageImmutableSnapshot({
          root: state.root,
          snapshot: approvedSnapshot({
            snapshotId: "invalid-candidate",
            landmarksRef: "landmarks.json",
            poisRef: "pois.json",
            tilesetRef: "tileset.json",
            activitiesRef: "activities.json",
            previousSnapshotId: "snapshot-fixture",
          }),
          artifacts: {
            "landmarks.json": "[]\n",
            "pois.json": "[]\n",
            "tileset.json": "{}\n",
            "activities.json": `${JSON.stringify(activities)}\n`,
          },
          commitEligibility: { eligible: true },
        }),
      /public_landmark_mapped_group_unreferenced/,
    );
    assert.equal(
      loadApprovedSnapshot({ root: state.root }).snapshotId,
      "snapshot-fixture",
    );
  } finally {
    state.cleanup();
  }
});

test("parent dedup repair stages immutably, preserves rollback, activates, and becomes idempotent", () => {
  const state = temporaryState();
  try {
    const event = ({ id, parent, source, url }) => ({
      id,
      occurrenceId: id,
      parentActivityId: parent,
      parentListingId: `${source}:${parent}`,
      sourceParentActivities: [
        {
          source,
          parentActivityId: parent,
          parentListingId: `${source}:${parent}`,
        },
      ],
      title: "Two Worlds in One",
      schedule: {
        kind: "exact",
        start: "2026-10-03",
        end: "2026-10-03",
        displayText: "3 Oct 2026",
      },
      sessions: [],
      venue: "Esplanade Theatre",
      approvedLocationId: "esplanade",
      venueOccurrences: [
        {
          approvedLocationId: "esplanade",
          publishedVenueName: "Esplanade Theatre",
          publicPlacement: "mapped",
          mappingStatus: "approved",
        },
      ],
      publicPlacement: "mapped",
      mappingStatus: "approved",
      coordinates: { lat: 1.2897, lng: 103.8559 },
      lifecycleState: "active",
      sources: [{ source, sourceUrl: url }],
    });
    const events = [
      event({
        id: "catch:two-worlds",
        parent: "activity:catch-two-worlds",
        source: "Catch.sg",
        url: "https://www.catch.sg/Event/two-worlds",
      }),
      event({
        id: "sistic:two-worlds",
        parent: "activity:sistic-two-worlds",
        source: "SISTIC",
        url: "https://www.sistic.com.sg/event-details/two-worlds",
      }),
    ];
    const records = events.flatMap(
      (item) =>
        projectEventActivities({
          events: [item],
          runId: "repair-source",
          generatedAt: "2026-07-26T00:00:00.000Z",
        }).activities.records,
    );
    const internalActivities = {
      schemaVersion: "1.0",
      runId: "repair-source",
      generatedAt: "2026-07-26T00:00:00.000Z",
      counts: {
        inputOccurrences: 2,
        occurrences: 2,
        activities: 2,
        sessions: 2,
        venueGroups: 2,
        sourceOffers: 2,
        reviews: 0,
      },
      records,
    };
    const publicActivities = projectPublicActivityCatalogue(
      internalActivities,
      { snapshotId: "repair-source" },
    );
    const landmarks = [
      {
        id: "esplanade",
        label: "Esplanade",
        anchor: { lat: 1.2897, lng: 103.8559 },
        activityRefs: publicActivities.records.map((activity) => ({
          activityId: activity.activityId,
          venueGroupIds: activity.venueGroups.map(
            (group) => group.venueGroupId,
          ),
        })),
      },
    ];
    const source = stageImmutableSnapshot({
      root: state.root,
      snapshot: approvedSnapshot({
        snapshotId: "repair-source",
        landmarksRef: "landmarks.json",
        poisRef: "pois.json",
        tilesetRef: "tileset.json",
        activitiesRef: "activities.json",
        internalEventsRef: "internal-events.json",
      }),
      artifacts: {
        "landmarks.json": `${JSON.stringify(landmarks)}\n`,
        "pois.json": "[]\n",
        "tileset.json": "{}\n",
        "activities.json": `${JSON.stringify(publicActivities)}\n`,
        "internal-events.json": `${JSON.stringify({
          schemaVersion: "3.1",
          mapped: events,
          offMap: [],
          activities: internalActivities,
        })}\n`,
      },
      commitEligibility: { eligible: true },
    });
    activateStagedSnapshot({ root: state.root, staged: source });

    const staged = repairParentDedupSnapshot({
      root: state.root,
      generatedAt: "2026-07-26T01:00:00.000Z",
    });
    assert.equal(staged.activated, false);
    assert.equal(staged.audit.activitiesBefore, 2);
    assert.equal(staged.audit.activitiesAfter, 1);
    assert.equal(loadApprovedSnapshot({ root: state.root }).snapshotId, "repair-source");

    const activated = repairParentDedupSnapshot({
      root: state.root,
      activate: true,
      generatedAt: "2026-07-26T01:00:00.000Z",
    });
    assert.equal(activated.activated, true);
    assert.equal(
      loadApprovedSnapshot({ root: state.root }).snapshotId,
      "repair-source-parent-dedup-v4",
    );
    const repeated = repairParentDedupSnapshot({ root: state.root });
    assert.equal(repeated.changed, false);
    assert.equal(repeated.reason, "parent_dedup_repair_already_active");
  } finally {
    state.cleanup();
  }
});

test("schedule repair expands saved enumerations without recollection and is idempotent", () => {
  const state = temporaryState("schedule-repair-");
  try {
    const base = {
      parentActivityId: "activity:memory",
      parentListingId: "shared:memory",
      sourceParentActivities: [
        {
          source: "Saved",
          parentActivityId: "activity:memory",
          parentListingId: "shared:memory",
        },
      ],
      title: "Memory Palace",
      lifecycleState: "active",
      sources: [],
    };
    const exact = (id, start) => ({
      ...base,
      id,
      occurrenceId: id,
      schedule: { kind: "exact", start, end: start },
      startsAt: start,
      publicPlacement: "off_map",
      mappingStatus: "not_required",
      venue: "Offsite",
      venueOccurrences: [
        {
          publishedVenueName: "Offsite",
          publicPlacement: "off_map",
          mappingStatus: "not_required",
        },
      ],
    });
    const range = {
      ...base,
      id: "sistic-range",
      occurrenceId: "sistic-range",
      schedule: {
        kind: "range",
        start: "2026-07-26T00:00:00+08:00",
        end: "2026-08-02T23:59:59+08:00",
        displayText: "26 Jul & 2 Aug 2026, Sun, 9am",
      },
      dateText: "26 Jul & 2 Aug 2026, Sun, 9am",
      publicPlacement: "mapped",
      mappingStatus: "approved",
      approvedLocationId: "national-museum",
      coordinates: { lat: 1.2966, lng: 103.8485 },
      venue: "National Museum of Singapore",
      venueOccurrences: [
        {
          approvedLocationId: "national-museum",
          publishedVenueName: "National Museum of Singapore",
          publicPlacement: "mapped",
          mappingStatus: "approved",
        },
      ],
    };
    const events = [
      exact("catch-26", "2026-07-26T09:00:00+08:00"),
      exact("catch-02", "2026-08-02T09:00:00+08:00"),
      range,
    ];
    const projection = projectEventActivities({
      events,
      runId: "schedule-source",
      generatedAt: "2026-07-26T00:00:00.000Z",
    });
    const publicActivities = projectPublicActivityCatalogue(
      projection.activities,
      { snapshotId: "schedule-source" },
    );
    const source = stageImmutableSnapshot({
      root: state.root,
      snapshot: approvedSnapshot({
        snapshotId: "schedule-source",
        landmarksRef: "landmarks.json",
        poisRef: "pois.json",
        tilesetRef: "tileset.json",
        activitiesRef: "activities.json",
        internalEventsRef: "internal-events.json",
      }),
      artifacts: {
        "landmarks.json": `${JSON.stringify([
          {
            id: "national-museum",
            label: "National Museum of Singapore",
            anchor: { lat: 1.2966, lng: 103.8485 },
            activityRefs: [
              {
                activityId: projection.activities.records[0].activityId,
                venueGroupIds: projection.activities.records[0].venueGroups
                  .filter((group) => group.approvedLocationId)
                  .map((group) => group.venueGroupId),
              },
            ],
          },
        ])}\n`,
        "pois.json": "[]\n",
        "tileset.json": "{}\n",
        "activities.json": `${JSON.stringify(publicActivities)}\n`,
        "internal-events.json": `${JSON.stringify({
          schemaVersion: "3.2",
          mapped: [range],
          offMap: events.slice(0, 2),
          activities: projection.activities,
        })}\n`,
      },
      commitEligibility: { eligible: true },
    });
    activateStagedSnapshot({ root: state.root, staged: source });

    const result = repairScheduleSemanticsSnapshot({
      root: state.root,
      activate: true,
      generatedAt: "2026-07-26T02:00:00.000Z",
    });
    assert.equal(
      result.audit.enumeratedSchedulesExpanded,
      1,
      JSON.stringify(result),
    );
    assert.equal(result.audit.sessionsAfter, 2);
    const active = loadApprovedSnapshot({ root: state.root });
    const repaired = JSON.parse(
      fs.readFileSync(
        path.join(active.directory, active.activitiesRef),
        "utf8",
      ),
    );
    assert.equal(repaired.records[0].sessions.length, 2);
    assert.equal(
      repaired.records[0].sessions.every(
        (session) => session.schedule.kind === "exact",
      ),
      true,
    );
    assert.equal(
      repairScheduleSemanticsSnapshot({ root: state.root }).changed,
      false,
    );
  } finally {
    state.cleanup();
  }
});
