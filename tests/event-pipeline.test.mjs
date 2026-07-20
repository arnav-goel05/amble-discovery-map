import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import test from "node:test";
import { Accessor, Document, NodeIO } from "@gltf-transform/core";

import {
  branchEvidenceHash,
  canCommitFrontendSnapshot,
  classifyNonBuildingRecovery,
  collectLocationClues,
  collectOfficialCandidatePages,
  enrichRecoveryCoordinates,
  eventInterval,
  explicitMultiVenueSourceUrls,
  jsonPointer,
  nextAction,
  parseManifest,
  progressResponse,
  readPipelineConfig,
  reconcileNormalizedVenueBranches,
  renderStatus,
  reopenImprovedLocalCandidates,
  replaceLastSuccessfulUse,
  reusableResolutionEntry,
  selectDeterministicOneMapAddress,
  singaporeWindow,
  terminalProblems,
  validateApprovedResolution,
  validateHighlightArtifacts,
  validateNormalizedSemantics,
  validateNotMappableAgainstLocalCandidates,
  validateResolveRecoveryEvidence,
  validateSourceEvidence,
  validateSourceResult,
  validateSourceSemantics,
  validateStageEventIds,
  validateVenueRecoveryEvidence,
} from "../scripts/event-pipeline.mjs";
import {
  pruneExpiredContent,
  reconcileLandmark,
  reconcilePoi,
} from "../scripts/reconcile-event-content.mjs";
import { restorationTiles } from "../scripts/restore-poi-backgrounds.mjs";
import { normalizeRun } from "../scripts/event-normalizer.mjs";
import {
  canonicalDetailUrl,
  classifyFixture,
  collectSource,
  mapCatchDetail,
  mapSisticDetail,
} from "../scripts/event-source-collector.mjs";
import {
  createTraceWriter,
  redactTraceValue,
} from "../scripts/lib/event-sources/trace.mjs";
import { TRACE_REASON_CODES } from "../scripts/lib/event-sources/trace.mjs";
import {
  assessActivityInclusion,
  deriveEventFreshness,
  normalizeActivityContract,
  normalizeSchedule,
} from "../scripts/lib/event-sources/activity-policy.mjs";
import {
  commitFrontendSnapshot,
  prepareFrontendSnapshot,
  writeVerifiedStageHandoffs,
} from "../scripts/event-frontend-snapshot.mjs";
import {
  consolidateCoordinateCandidates,
  coordinateBuildingChoice,
  groupExactOneMapRows,
  isPreciseProviderPin,
  preferPristineOneMapRows,
  selectAddressNamedBuilding,
} from "../scripts/lib/venue-resolution-evidence.mjs";
import {
  extractCoordinates,
  extractEvidenceFromBody,
  extractRelevantLinks,
  shopifyProductJsonUrl,
  shouldRetryStatus,
} from "../scripts/extract-web-evidence.mjs";
import {
  normalizeOneMapResults,
  searchQueries,
} from "../scripts/query-onemap-location.mjs";
import {
  collectLocationStrings,
  extractAddressEvidence,
  preferAuthoritativeRecovery,
} from "../scripts/lib/location-evidence.mjs";
import { clearPipelineEventData } from "../scripts/clear-event-pipeline-data.mjs";
import { loadApprovedSnapshot } from "../scripts/lib/approved-snapshot.mjs";
import {
  summarizeActivityOutcomes,
  summarizeEvidenceLevels,
} from "../scripts/lib/event-pipeline/reporting.mjs";
import { temporaryState } from "./helpers/baseline-fixtures.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = resolve(ROOT, "scripts/event-pipeline.mjs");
const require = createRequire(import.meta.url);
const { AdminRepository } = require("../scripts/lib/admin-repository.cjs");
const { AdminService } = require("../scripts/lib/admin-service.cjs");

test("v3 activity contracts keep schedule, identity, placement, mapping, lifecycle, and freshness orthogonal", () => {
  const activity = normalizeActivityContract({
    sourceName: "Fixture",
    sourceRecordId: "fixture:secret",
    title: "Secret Supper",
    scope: "Singapore",
    schedule: { kind: "anytime" },
    venueOccurrences: [
      {
        venueOccurrenceId: "fixture:secret:venue",
        publishedVenueName: "Secret location",
        publicPlacement: "off_map",
        mappingStatus: "not_required",
        offMapSubtype: "secret_tba",
      },
    ],
    sourceContributions: [
      {
        sourceRecordId: "fixture:secret",
        freshness: "current",
        fields: ["title", "schedule", "location"],
      },
    ],
  });
  assert.equal(activity.schemaVersion, "3.0");
  assert.match(activity.parentActivityId, /^activity:/);
  assert.deepEqual(activity.schedule, {
    kind: "anytime",
    start: null,
    end: null,
    recurrence: null,
    sessionRefs: [],
    displayText: null,
    finalKnownOccurrence: null,
  });
  assert.deepEqual(
    [
      activity.lifecycleState,
      activity.publicPlacement,
      activity.mappingStatus,
      activity.freshness,
    ],
    ["active", "off_map", "not_required", "current"],
  );
  assert.equal(activity.sessions.length, 0);
  assert.equal(activity.venueOccurrences.length, 1);
});

test("v3 contribution freshness derives stale fields without changing placement or lifecycle", () => {
  assert.deepEqual(
    deriveEventFreshness(
      [
        {
          sourceRecordId: "old",
          freshness: "stale",
          fields: ["description"],
          staleReason: "source_incomplete",
        },
        {
          sourceRecordId: "new",
          freshness: "current",
          fields: ["title", "schedule", "location"],
        },
      ],
      ["title", "description", "schedule", "location"],
    ),
    {
      freshness: "stale",
      staleReason: "source_incomplete",
      fieldFreshness: {
        title: "current",
        description: "stale",
        schedule: "current",
        location: "current",
      },
    },
  );
});

test("reporting counts unique activities separately from contributions and preserves stale/review outcomes", () => {
  const events = [
    {
      id: "one",
      lifecycleState: "active",
      publicPlacement: "off_map",
      mappingStatus: "pending_review",
      freshness: "stale",
      evidenceLevel: "direct_corroborated",
      sourceContributions: [
        { sourceRecordId: "Catch:one", freshness: "current" },
        {
          sourceRecordId: "Honey:one",
          freshness: "stale",
          upgradedFrom: "editorial_authoritative",
        },
      ],
    },
  ];
  assert.deepEqual(summarizeActivityOutcomes(events), {
    mapped: 0,
    off_map: 1,
    carry_forward_stale: 1,
    review: 1,
    held: 0,
    excluded: 0,
    archived: 0,
    release_rollback: 0,
  });
  assert.deepEqual(summarizeEvidenceLevels(events), {
    uniqueActivities: 1,
    levels: { direct_corroborated: 1 },
    upgrades: { "editorial_authoritative->direct_corroborated": 1 },
  });
});

test("v3 trace vocabulary covers schedule, evidence, off-map, carry-forward, holds, archives, and rollback", () => {
  for (const code of [
    "anytime",
    "schedule_unverified",
    "editorial_sufficient",
    "secret_tba",
    "carry_forward_stale",
    "hold_new",
    "expired",
    "release_validation_failed",
  ]) {
    assert.ok(TRACE_REASON_CODES.has(code), code);
  }
  const redacted = redactTraceValue({
    reasonCode: "carry_forward_stale",
    sourceContributionId: "source:1",
    url: "https://example.test/?token=secret",
    rawBody: "private",
  });
  assert.equal(redacted.url, "https://example.test/?token=%5BREDACTED%5D");
  assert.equal("rawBody" in redacted, false);
});

test("active and future activity policy preserves exact, range, recurring, selectable, anytime, and unverified schedules without a weekly cutoff", () => {
  const asOf = "2026-07-18T00:00:00+08:00";
  const cases = [
    [
      {
        title: "Exact show",
        scope: "Singapore",
        schedule: { kind: "exact", start: "2027-01-01T20:00:00+08:00" },
      },
      true,
      "active",
    ],
    [
      {
        title: "Long exhibition",
        scope: "Singapore",
        schedule: {
          kind: "range",
          start: "2026-08-01T00:00:00+08:00",
          end: "2027-02-01T23:59:59+08:00",
        },
      },
      true,
      "active",
    ],
    [
      {
        title: "Friday comedy",
        scope: "Singapore",
        schedule: { kind: "recurring", recurrence: { frequency: "weekly" } },
      },
      true,
      "active",
    ],
    [
      {
        title: "Choose a workshop",
        scope: "Singapore",
        schedule: { kind: "selectable", sessionRefs: ["one", "two"] },
      },
      true,
      "active",
    ],
    [
      {
        title: "By appointment perfume lab",
        scope: "Singapore",
        schedule: { kind: "anytime" },
      },
      true,
      "active",
    ],
    [
      {
        title: "Announced programme",
        scope: "Singapore",
        schedule: { kind: "unverified" },
      },
      true,
      "held",
    ],
    [
      {
        title: "Past concert",
        scope: "Singapore",
        schedule: {
          kind: "exact",
          start: "2026-01-01T20:00:00+08:00",
          finalKnownOccurrence: "2026-01-01T22:00:00+08:00",
        },
      },
      false,
      "archived",
    ],
    [
      {
        title: "Past editorial listing",
        scope: "Singapore",
        dateText: "17 July 2026",
        schedule: { kind: "exact", displayText: "17 July 2026" },
      },
      false,
      "archived",
    ],
    [
      {
        title: "Discount only",
        scope: "Singapore",
        purePromotion: true,
        schedule: { kind: "anytime" },
      },
      false,
      "excluded",
    ],
    [
      {
        title: "Webinar",
        scope: "Singapore",
        mode: "online",
        schedule: { kind: "exact", start: "2027-01-01T20:00:00+08:00" },
      },
      false,
      "excluded",
    ],
    [
      {
        title: "Johor workshop",
        scope: "overseas",
        schedule: { kind: "exact", start: "2027-01-01T20:00:00+08:00" },
      },
      false,
      "excluded",
    ],
  ];
  for (const [record, eligible, lifecycle] of cases) {
    const result = assessActivityInclusion(record, { asOf });
    assert.equal(result.eligible, eligible, record.title);
    assert.equal(result.lifecycleState, lifecycle, record.title);
  }
  assert.equal(
    normalizeSchedule({
      kind: "recurring",
      recurrence: { frequency: "weekly" },
    }).sessionRefs.length,
    0,
    "recurrence is not expanded infinitely",
  );
});

test("frontend reconciliation creates, updates, and no-ops by stable identity", () => {
  const base = {
    id: "venue",
    label: "Venue",
    anchor: { lng: 1, lat: 1 },
    events: [
      {
        id: "merged:old",
        parentEventId: "source-event",
        venue: "Room A",
        title: "Old title",
      },
    ],
  };
  assert.equal(reconcileLandmark(null, base, ["Room A"]).action, "create");
  assert.equal(
    reconcileLandmark(base, structuredClone(base), ["Room A"]).action,
    "noop",
  );
  const changed = {
    ...base,
    events: [
      {
        id: "merged:new",
        parentEventId: "source-event",
        venue: "Room A",
        title: "New title",
      },
    ],
  };
  const updated = reconcileLandmark(base, changed, ["Room A"]);
  assert.equal(updated.action, "update");
  assert.deepEqual(
    updated.landmark.events.map((event) => event.title),
    ["New title"],
  );
  const poi = { id: "venue", names: ["VENUE"] };
  assert.equal(reconcilePoi(null, poi).action, "create");
  assert.equal(reconcilePoi(poi, structuredClone(poi)).action, "noop");
});

test("needs-review and evidenced not-mappable venues are safely isolated from publication", () => {
  const state = {
    sources: { Catch: { status: "success" }, SISTIC: { status: "success" } },
    normalization: { status: "success" },
    resolutionPreparation: { status: "success" },
    verification: {
      status: "success",
      poiSeparation: { status: "success" },
      build: { status: "success" },
      eventUi: { status: "success" },
      browser: { status: "success" },
    },
    venues: {
      resolved: { stages: { resolve: { status: "success" } } },
      ambiguous: {
        stages: {
          resolve: { status: "unresolved", resolutionStatus: "needs_review" },
        },
      },
    },
  };
  assert.equal(canCommitFrontendSnapshot(state), true);
  state.venues.ambiguous.stages.resolve.resolutionStatus = "not_mappable";
  assert.equal(canCommitFrontendSnapshot(state), true);
});

test("OneMap resolution prefers pristine cached batch IDs over rewritten background tiles", () => {
  const clean = (value) =>
    String(value).replace(/^public\/poi-tiles\/source\//, "tiles/");
  const rows = [
    { tile_path: "tiles/6/39/5_0.b3dm", batch_id: 13 },
    { tile_path: "public/poi-tiles/source/6/39/5_0.b3dm", batch_id: 14 },
    { tile_path: "public/poi-tiles/generated-poi/5_0.b3dm", batch_id: 0 },
  ];
  assert.deepEqual(preferPristineOneMapRows(rows, clean), [rows[1]]);
});

test("expired events and empty locations are removed at the run boundary", () => {
  const result = pruneExpiredContent({
    asOf: "2026-07-11T00:00:00+08:00",
    landmarks: [
      { id: "expired", events: [{ id: "old", dateText: "10 Jul 2026" }] },
      {
        id: "mixed",
        events: [
          { id: "old-2", endDateTime: "2026-07-10T20:00:00+08:00" },
          { id: "today", dateText: "11 Jul 2026" },
        ],
      },
      {
        id: "unknown",
        events: [
          { id: "undated", dateText: null, schedule: { kind: "unverified" } },
          { id: "anytime", dateText: null, schedule: { kind: "anytime" } },
        ],
      },
      {
        id: "schedule-expired",
        events: [
          {
            id: "old-schedule",
            schedule: {
              kind: "range",
              finalKnownOccurrence: "2026-07-10T23:00:00+08:00",
            },
          },
        ],
      },
    ],
    pois: [
      { id: "expired" },
      { id: "mixed" },
      { id: "unknown" },
      { id: "schedule-expired" },
    ],
  });
  assert.deepEqual(result.expiredEventIds.sort(), [
    "old",
    "old-2",
    "old-schedule",
  ]);
  assert.deepEqual(result.removedLandmarkIds, ["expired", "schedule-expired"]);
  assert.deepEqual(
    result.landmarks.map((item) => item.id),
    ["mixed", "unknown"],
  );
  assert.deepEqual(
    result.pois.map((item) => item.id),
    ["mixed", "unknown"],
  );
});

test("pipeline data clear removes only currently managed POIs and resets published event modules", async () => {
  const root = resolve(tmpdir(), `event-clear-${process.pid}-${Date.now()}`);
  mkdirSync(join(root, "public/poi-tiles/managed"), { recursive: true });
  mkdirSync(join(root, "public/poi-tiles/source"), { recursive: true });
  mkdirSync(join(root, "public/poi-tiles/unmanaged"), { recursive: true });
  writeFileSync(join(root, "public/poi-tiles/managed/tileset.json"), "{}");
  try {
    const result = await clearPipelineEventData({
      root,
      pois: [{ id: "managed", tiles: {} }],
      restore: false,
    });
    assert.deepEqual(result.removedPoiIds, ["managed"]);
    assert.equal(
      readFileSync(join(root, "data/approved-pois.js"), "utf8"),
      "export const APPROVED_POIS = [];\n",
    );
    assert.equal(
      readFileSync(join(root, "data/approved-landmarks.js"), "utf8"),
      "export const APPROVED_LANDMARKS = [];\n",
    );
    assert.equal(
      readFileSync(join(root, "outputs/data/events.json"), "utf8"),
      "[]\n",
    );
    assert.equal(existsSync(join(root, "public/poi-tiles/managed")), false);
    assert.equal(existsSync(join(root, "public/poi-tiles/source")), true);
    assert.equal(existsSync(join(root, "public/poi-tiles/unmanaged")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("frontend snapshot stages reconciliation and commits only after executable verification", async () => {
  const root = resolve(
    tmpdir(),
    `event-frontend-root-${process.pid}-${Date.now()}`,
  );
  const runDir = join(root, "outputs/event-pipeline/run-a");
  mkdirSync(join(runDir, "normalized"), { recursive: true });
  mkdirSync(join(runDir, "stages/venue-a"), { recursive: true });
  mkdirSync(join(root, "data"), { recursive: true });
  writeFileSync(join(root, "data/approved-pois.js"), "original pois\n");
  writeFileSync(
    join(root, "data/approved-landmarks.js"),
    "original landmarks\n",
  );
  writeFileSync(
    join(runDir, "normalized/events.json"),
    JSON.stringify({
      records: [
        {
          id: "event-a",
          title: "Show",
          venue: "Hall",
          dateText: "12 Jul 2026",
          sources: [],
        },
      ],
    }),
  );
  const resolution = {
    schemaVersion: "1.0",
    runId: "run-a",
    stage: "resolve",
    status: "success",
    result: {
      resolutionStatus: "approved",
      poiId: "hall",
      canonicalVenue: "Hall",
      acceptedGmlNames: ["HALL"],
      coordinates: { lng: 103.8, lat: 1.3 },
      sourceTiles: [],
      inputEventIds: ["event-a"],
    },
  };
  writeFileSync(
    join(runDir, "stages/venue-a/resolve.json"),
    JSON.stringify(resolution),
  );
  const state = {
    runId: "run-a",
    venues: {
      "venue-a": {
        venue: "Hall",
        eventIds: ["event-a"],
        stages: {
          resolve: {
            status: "success",
            outputRef: "stages/venue-a/resolve.json",
          },
          highlight: { status: "pending" },
          pill: { status: "pending" },
          panel: { status: "pending" },
        },
      },
    },
  };
  try {
    const plan = await prepareFrontendSnapshot({
      runDir,
      state,
      run: { runId: "run-a", window: singaporeWindow("2026-07-11") },
      currentPois: [],
      currentLandmarks: [],
    });
    assert.equal(plan.classifications[0].highlightAction, "create");
    assert.equal(
      readFileSync(join(root, "data/approved-pois.js"), "utf8"),
      "original pois\n",
    );
    assert.throws(() => commitFrontendSnapshot({ runDir, root }), /unverified/);
    const verification = {
      status: "success",
      poiSeparation: { status: "success" },
      eventUi: { status: "success" },
      browser: { status: "success" },
    };
    const refs = writeVerifiedStageHandoffs({
      runDir,
      state,
      plan,
      verification,
    });
    assert.equal(refs.length, 3);
    plan.status = "verified";
    writeFileSync(
      join(runDir, "frontend/plan.json"),
      `${JSON.stringify(plan, null, 2)}\n`,
    );
    commitFrontendSnapshot({ runDir, root });
    assert.equal(
      readFileSync(join(root, "data/approved-pois.js"), "utf8"),
      "original pois\n",
    );
    const active = loadApprovedSnapshot({ root });
    assert.equal(active.snapshotId, "run-a");
    assert.equal(
      JSON.parse(
        readFileSync(join(active.directory, active.poisRef), "utf8"),
      )[0].id,
      "hall",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("frontend snapshot resolves a newly dated occurrence through its preserved stable identity", async () => {
  const root = resolve(
    tmpdir(),
    `event-frontend-identity-alias-${process.pid}-${Date.now()}`,
  );
  const runDir = join(root, "run");
  mkdirSync(join(runDir, "normalized"), { recursive: true });
  mkdirSync(join(runDir, "stages/venue-a"), { recursive: true });
  const oldId = "Fever Singapore:/m/652048#1";
  const newId = "Fever Singapore:/m/652048#2026-09-18#1";
  const parentActivityId = "activity:wine-guide";
  const previousEvent = {
    id: oldId,
    occurrenceId: oldId,
    identityAnchor: oldId,
    publishedEventId: oldId,
    parentActivityId,
    title: "An Idiot’s Guide to Wine",
    venue: "MDLR, TPI Building",
    schedule: { kind: "selectable", start: null, end: null, displayText: null },
    publicPlacement: "mapped",
    mappingStatus: "approved",
    lifecycleState: "active",
    sourceOccurrenceIds: [oldId],
    sources: [{ source: "Fever Singapore", sourceId: "/m/652048#1" }],
  };
  const incomingEvent = {
    ...previousEvent,
    id: newId,
    occurrenceId: newId,
    identityAnchor: newId,
    publishedEventId: newId,
    dateText: "2026-09-18",
    schedule: {
      kind: "selectable",
      start: "2026-09-18",
      end: "2026-09-18",
      displayText: "2026-09-18",
    },
    publicPlacement: "none",
    mappingStatus: "pending_review",
    sourceOccurrenceIds: [newId],
    sources: [
      { source: "Fever Singapore", sourceId: "/m/652048#2026-09-18#1" },
    ],
  };
  writeFileSync(
    join(runDir, "normalized/events.json"),
    JSON.stringify({ records: [incomingEvent] }),
  );
  writeFileSync(
    join(runDir, "stages/venue-a/resolve.json"),
    JSON.stringify({
      result: {
        resolutionStatus: "approved",
        poiId: "tpi-building",
        canonicalVenue: "TPI BUILDING",
        acceptedGmlNames: ["TPI BUILDING"],
        coordinates: { lng: 103.84947, lat: 1.28213 },
        sourceTiles: [],
        inputEventIds: [newId],
      },
    }),
  );
  const state = {
    runId: "run-alias",
    sources: { "Fever Singapore": { status: "success" } },
    venues: {
      "venue-a": {
        venue: "MDLR, TPI Building",
        eventIds: [newId],
        stages: {
          resolve: {
            status: "success",
            outputRef: "stages/venue-a/resolve.json",
          },
        },
      },
    },
  };
  try {
    await prepareFrontendSnapshot({
      runDir,
      state,
      run: { runId: "run-alias", window: singaporeWindow("2026-07-20") },
      currentPois: [
        {
          id: "tpi-building",
          label: "TPI BUILDING",
          data: "poi-tiles/tpi-building/tileset.json",
          names: ["TPI BUILDING"],
          tiles: {},
        },
      ],
      currentLandmarks: [
        {
          id: "tpi-building",
          label: "TPI BUILDING",
          anchor: { lng: 103.84947, lat: 1.28213 },
          events: [previousEvent],
        },
      ],
    });
    const landmark = JSON.parse(
      readFileSync(join(runDir, "frontend/approved-landmarks.json"), "utf8"),
    ).records[0];
    assert.equal(landmark.events.length, 1);
    assert.equal(landmark.events[0].id, oldId);
    assert.equal(landmark.events[0].dateText, "2026-09-18");
    assert.equal(landmark.events[0].title, "An Idiot’s Guide to Wine");
    const catalogue = JSON.parse(
      readFileSync(join(runDir, "frontend/approved-events.json"), "utf8"),
    );
    assert.equal(catalogue.mapped.length, 1);
    assert.equal(catalogue.mapped[0].id, oldId);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("frontend snapshot commit rolls back earlier files when a later publication fails", () => {
  const root = resolve(
    tmpdir(),
    `event-frontend-rollback-${process.pid}-${Date.now()}`,
  );
  const runDir = join(root, "run"),
    frontend = join(runDir, "frontend");
  mkdirSync(frontend, { recursive: true });
  mkdirSync(join(root, "data/approved-landmarks.js"), { recursive: true });
  writeFileSync(join(root, "data/approved-pois.js"), "original\n");
  writeFileSync(join(frontend, "approved-pois.js"), "replacement\n");
  writeFileSync(
    join(frontend, "approved-landmarks.js"),
    "replacement landmarks\n",
  );
  writeFileSync(
    join(frontend, "plan.json"),
    JSON.stringify({ status: "verified" }),
  );
  try {
    assert.throws(
      () => commitFrontendSnapshot({ runDir, root }),
      /rolled back/,
    );
    assert.equal(
      readFileSync(join(root, "data/approved-pois.js"), "utf8"),
      "original\n",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("expiry identifies every background tile that must be restored", () => {
  assert.deepEqual(
    restorationTiles(
      [
        {
          id: "venue",
          tiles: {
            "tiles/7/1/2_0.b3dm": [3],
            "optimized-tiles/7/1/2_1.b3dm": [3],
          },
        },
      ],
      ["venue"],
    ),
    ["7/1/2_0.b3dm", "7/1/2_1.b3dm"],
  );
  assert.deepEqual(
    restorationTiles([], ["esplanade"]),
    Array.from({ length: 6 }, (_, index) => `7/78/12_${index}.b3dm`),
  );
});

test("manifest parsing preserves configured source order", () => {
  const manifest = parseManifest(
    `- Timezone: \`Asia/Singapore\`\n| Source | Enabled | Adapter | Date filter | Last successful use |\n|---|---|---|---|---|\n| Catch.sg | yes | \`catch-v1\` | shared | never |\n| Disabled | no | \`off-v1\` | shared | never |\n| SISTIC | yes | \`sistic-v1\` | shared | never |`,
  );
  assert.deepEqual(
    manifest.sources.map((source) => source.name),
    ["Catch.sg", "SISTIC"],
  );
  assert.deepEqual(
    manifest.sources.map((source) => source.operatingMode),
    ["required", "required"],
  );
});

test("last-success metadata updates compact and padded Markdown source rows", () => {
  const timestamp = "2026-07-18T13:30:00.000Z";
  for (const row of [
    "| SISTIC | yes | `sistic-v1` | shared | never |",
    "| SISTIC                         | yes      | `sistic-v1`                         | shared window | `2026-07-17T19:02:11.146Z` |",
  ]) {
    const result = replaceLastSuccessfulUse(
      `| Source | Enabled | Adapter | Date filter | Last successful use |\n${row}`,
      "SISTIC",
      timestamp,
    );
    assert.equal(result.updated, true);
    assert.match(
      result.markdown,
      /\| SISTIC\s+\|.*\| `2026-07-18T13:30:00\.000Z` \|/,
    );
  }
  assert.equal(
    replaceLastSuccessfulUse(
      "| Other | yes | `other` | shared | never |",
      "SISTIC",
      timestamp,
    ).updated,
    false,
  );
});

test("window covers the run date plus seven following dates inclusively", () => {
  assert.deepEqual(singaporeWindow("2026-07-11"), {
    start: "2026-07-11T00:00:00+08:00",
    end: "2026-07-18T23:59:59+08:00",
    inclusive: true,
  });
});

test("structured pipeline configuration is authoritative for sources and window", () => {
  const config = readPipelineConfig();
  assert.equal(config.windowDaysAfterStart, 7);
  assert.deepEqual(
    config.sources
      .filter((source) => source.enabled)
      .map((source) => source.adapterId),
    [
      "catch-official-listing-v1",
      "sistic-official-listing-v1",
      "fever-singapore-rendered-v1",
      "visit-singapore-rendered-v1",
      "singapore-film-society-rendered-v1",
      "honeycombers-discovery-v1",
      "arts-equator-discovery-v1",
      "time-out-singapore-discovery-v1",
    ],
  );
  const roots = config.sources.find(
    (source) => source.adapterId === "roots-han-rendered-v1",
  );
  assert.equal(roots.enabled, false);
  assert.equal(roots.operatingMode, "disabled");
  assert.equal(roots.unavailableReason, "layout_contract_changed");
  assert.ok(
    config.sources.find(
      (source) => source.adapterId === "sistic-official-listing-v1",
    ).listing.pageSize <= 30,
  );
});

test("structured trace records preserve lineage while redacting credentials and raw bodies", () => {
  const state = temporaryState();
  try {
    const tracePath = join(state.root, "logs/trace.jsonl");
    const writer = createTraceWriter({
      path: tracePath,
      runId: "run-a",
      window: singaporeWindow("2026-07-11"),
      now: () => "2026-07-11T00:00:00.000Z",
    });
    writer.write({
      stage: "collection",
      action: "capture",
      outcome: "success",
      sourceName: "Fever Singapore",
      entityType: "authority",
      entityId: "event-1",
      resumeDisposition: "new",
      durationMs: 2,
      authorization: "Bearer secret",
      evidenceRefs: ["raw/one.json"],
      url: "https://example.com/event?api_key=secret",
      rawBody: "private",
    });
    const [record] = writer.read();
    assert.equal(record.authorization, "[REDACTED]");
    assert.match(record.url, /api_key=%5BREDACTED%5D/);
    assert.equal(record.rawBody, undefined);
    assert.equal(record.entityId, "event-1");
    assert.deepEqual(redactTraceValue({ cookie: "abc", safe: 1 }), {
      cookie: "[REDACTED]",
      safe: 1,
    });
  } finally {
    state.cleanup();
  }
});

test("detail URL canonicalization removes trackers and orders retained parameters", () => {
  assert.equal(
    canonicalDetailUrl(
      "HTTPS://Example.COM:443/event/?z=2&utm_source=x&a=1#section",
      "https://unused.example",
    ),
    "https://example.com/event?a=1&z=2",
  );
});

test("source detail mappers produce the universal fixture contract", () => {
  const sistic = mapSisticDetail(
    {
      alias: "show",
      title: "Show",
      start_date: "2026-07-12T12:00:00+08:00",
      venue_name: { name: "Hall", latitude: "1.3001", longitude: "103.8002" },
    },
    {},
    "https://www.sistic.com.sg/event-details/show",
    1,
  );
  assert.equal(sistic.mode, "physical");
  assert.equal(sistic.performances.length, 1);
  assert.deepEqual(sistic.sourceCoordinates, { lat: 1.3001, lng: 103.8002 });
  const festival = mapSisticDetail(
    {
      alias: "festival",
      title: "Band Festival",
      event_date: "Thu, 23 Jul 2026 - Sun, 26 Jul 2026",
      venue_name: { name: "Various Venues" },
      description:
        "<strong>Opening Concert</strong><br>Date: 23 July, Thursday<br>Time: 1930h<br>Venue: YSTCM, Concert Hall<br><strong>Gala Concert</strong><br>Date: 24 July, Friday<br>Time: 1930h<br>Venue: NUS University Cultural Centre, Ho Bee Auditorium",
    },
    {},
    "https://www.sistic.com.sg/event-details/festival",
    1,
  );
  assert.deepEqual(festival.performances, [
    {
      title: "Opening Concert",
      venue: "YSTCM, Concert Hall",
      startDateTime: "2026-07-23T19:30:00+08:00",
      endDateTime: null,
      dateText: "2026-07-23",
      timeText: "19:30",
    },
    {
      title: "Gala Concert",
      venue: "NUS University Cultural Centre, Ho Bee Auditorium",
      startDateTime: "2026-07-24T19:30:00+08:00",
      endDateTime: null,
      dateText: "2026-07-24",
      timeText: "19:30",
    },
  ]);
  const catchFixture = mapCatchDetail(
    {
      DisplayEventTitle: "Catch Show",
      Location: "Room",
      EventFormat: "Physical",
    },
    {},
    "https://www.catch.sg/event/show",
    1,
  );
  assert.equal(catchFixture.title, "Catch Show");
  assert.equal(
    mapCatchDetail(
      {
        DisplayEventTitle: "Merchant Offer",
        Venue: "Mall",
        EventFormat: "Physical",
        MembershipExclusivesPromo: "10% off",
        AdmissionRule:
          "• Offer is valid for in-store redemptions by Catch members only.",
      },
      {},
      "https://www.catch.sg/Event/offer",
      1,
    ).recordType,
    "membership_offer",
  );
  assert.equal(
    mapCatchDetail(
      {
        DisplayEventTitle: "Ticketed Festival",
        Venue: "Hall",
        EventFormat: "Physical",
        MembershipExclusivesPromo: "5% off",
        AdmissionRule: "Age limit: admission requires a valid ticket.",
      },
      {},
      "https://www.catch.sg/Event/festival",
      1,
    ).recordType,
    "event",
  );

  const currentCatchFixture = mapCatchDetail(
    {
      DisplayEventTitle: "Current Catch Show",
      EventFormat: "Physical",
      Venue: "The Arts House",
      EventStartDate: "2026-07-12T00:00:00",
      EventEndDate: "2026-07-12T00:00:00",
      LstDateTime: [
        { SetDate: "12/Jul/2026", StartHour: "10:00", EndHour: "17:30" },
      ],
    },
    {},
    "https://www.catch.sg/Event/current-show",
    1,
  );
  assert.equal(currentCatchFixture.dateText, "2026-07-12");
  assert.deepEqual(currentCatchFixture.performances, [
    {
      startDateTime: "2026-07-12T10:00:00+08:00",
      endDateTime: "2026-07-12T17:30:00+08:00",
      dateText: "2026-07-12",
      timeText: "10:00 - 17:30",
    },
  ]);

  const recurringCatchFixture = mapCatchDetail(
    {
      DisplayEventTitle: "Recurring Catch Show",
      EventFormat: "Physical",
      Venue: "The Arts House",
      EventStartDate: "2026-07-01T00:00:00",
      EventEndDate: "2026-07-31T00:00:00",
      LstDateTime: [
        { SetDayArr: ["Mon", "Wed"], StartHour: "10:00", EndHour: "11:00" },
      ],
    },
    {},
    "https://www.catch.sg/Event/recurring-show",
    1,
    singaporeWindow("2026-07-11"),
  );
  assert.deepEqual(
    recurringCatchFixture.performances.map((item) => item.startDateTime),
    ["2026-07-13T10:00:00+08:00", "2026-07-15T10:00:00+08:00"],
  );

  const mixedCatchFixture = mapCatchDetail(
    {
      DisplayEventTitle: "Mixed Catch Show",
      EventFormat: "Physical",
      Venue: "The Arts House",
      EventStartDate: "2026-07-01T00:00:00",
      EventEndDate: "2026-07-31T00:00:00",
      LstDateTime: [
        { SetDayArr: ["Mon", "Wed"], IsFullDayEvent: true },
        { SetDayArr: ["Mon", "Wed"], StartHour: "16:00", EndHour: "18:00" },
      ],
    },
    {},
    "https://www.catch.sg/Event/mixed-show",
    1,
    singaporeWindow("2026-07-11"),
  );
  assert.deepEqual(mixedCatchFixture.performances, [
    {
      startDateTime: "2026-07-13T16:00:00+08:00",
      endDateTime: "2026-07-13T18:00:00+08:00",
      dateText: "2026-07-13",
      timeText: "16:00 - 18:00",
    },
    {
      startDateTime: "2026-07-15T16:00:00+08:00",
      endDateTime: "2026-07-15T18:00:00+08:00",
      dateText: "2026-07-15",
      timeText: "16:00 - 18:00",
    },
  ]);

  const timedCatchFixture = mapCatchDetail(
    {
      DisplayEventTitle: "Timed Catch Show",
      EventFormat: "Physical",
      Venue: "The Arts House",
      EventStartDate: "2026-07-14T20:00:00",
      EventEndDate: "2026-07-14T22:30:00",
    },
    {},
    "https://www.catch.sg/Event/timed-show",
    1,
  );
  assert.deepEqual(timedCatchFixture.performances, [
    {
      startDateTime: "2026-07-14T20:00:00+08:00",
      endDateTime: "2026-07-14T22:30:00+08:00",
      dateText: "2026-07-14",
      timeText: "20:00 - 22:30",
    },
  ]);
  assert.equal(catchFixture.venue, "Room");
});

test("executable source collector captures full SISTIC evidence and accounts invalid rows", async () => {
  const runDir = resolve(
    tmpdir(),
    `event-source-collector-${process.pid}-${Date.now()}`,
  );
  const config = readPipelineConfig();
  const source = structuredClone(
    config.sources.find(
      (item) => item.adapterId === "sistic-official-listing-v1",
    ),
  );
  const responses = [
    {
      status: 200,
      ok: true,
      body: {
        total_records: 2,
        data: [
          {
            alias: "show",
            title: "Show",
            start_date: "2026-07-12T12:00:00+08:00",
            venue_name: "Hall",
          },
          { title: "Missing alias" },
        ],
      },
      text: "",
    },
    {
      status: 200,
      ok: true,
      body: {
        alias: "show",
        title: "Show",
        start_date: "2026-07-12T12:00:00+08:00",
        end_date: "2026-07-12T13:00:00+08:00",
        venue_name: { name: "Hall" },
      },
      text: "",
    },
    {
      status: 200,
      ok: true,
      url: "https://www.sistic.com.sg/event-details/show",
      body: null,
      text: "<html></html>",
    },
  ];
  const transport = async () => responses.shift();
  try {
    const result = await collectSource({
      runDir,
      run: { runId: "run-a", window: singaporeWindow("2026-07-11") },
      source,
      transport,
    });
    assert.equal(result.status, "success");
    assert.deepEqual(result.counts, {
      pages: 1,
      sourceRecordsReceived: 2,
      invalidSourceRecords: 1,
      processedSourceRecords: 1,
      occurrencesEmitted: 1,
      excludedOccurrences: 0,
      eligiblePreDedup: 1,
    });
    assert.equal(
      result.invalidReasonCodes[result.invalidSourceRecordRefs[0]],
      "missing_detail_url",
    );
    assert.equal(result.completion.providerReportedTotal, 2);
    assert.ok(
      result.artifactRefs.some((ref) => ref.endsWith(".response.json")),
    );
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("executable source collector deduplicates repeated detail URLs before capture", async () => {
  const runDir = resolve(
    tmpdir(),
    `event-source-collector-dup-${process.pid}-${Date.now()}`,
  );
  const config = readPipelineConfig();
  const source = structuredClone(
    config.sources.find(
      (item) => item.adapterId === "sistic-official-listing-v1",
    ),
  );
  const requests = [];
  const responses = [
    {
      status: 200,
      ok: true,
      body: {
        total_records: 2,
        data: [
          {
            alias: "show",
            title: "Show",
            start_date: "2026-07-12T12:00:00+08:00",
            venue_name: { name: "Hall" },
          },
          {
            alias: "show",
            title: "Show copy",
            start_date: "2026-07-12T12:00:00+08:00",
            venue_name: { name: "Hall" },
          },
        ],
      },
      text: "",
    },
    {
      status: 200,
      ok: true,
      body: {
        alias: "show",
        title: "Show",
        start_date: "2026-07-12T12:00:00+08:00",
        end_date: "2026-07-12T13:00:00+08:00",
        venue_name: { name: "Hall" },
      },
      text: "",
    },
    {
      status: 200,
      ok: true,
      url: "https://www.sistic.com.sg/event-details/show",
      body: null,
      text: "<html></html>",
    },
  ];
  const transport = async (request) => {
    requests.push(request);
    return responses.shift();
  };
  try {
    const result = await collectSource({
      runDir,
      run: { runId: "run-a", window: singaporeWindow("2026-07-11") },
      source,
      transport,
    });
    assert.equal(result.status, "success");
    assert.deepEqual(result.counts, {
      pages: 1,
      sourceRecordsReceived: 2,
      invalidSourceRecords: 1,
      processedSourceRecords: 1,
      occurrencesEmitted: 1,
      excludedOccurrences: 0,
      eligiblePreDedup: 1,
    });
    assert.equal(
      result.invalidReasonCodes[result.invalidSourceRecordRefs[0]],
      "duplicate_detail_url",
    );
    assert.equal(requests.length, 3);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("executable Catch collector performs bootstrap and detail API capture", async () => {
  const runDir = resolve(
    tmpdir(),
    `event-source-catch-${process.pid}-${Date.now()}`,
  );
  const source = structuredClone(
    readPipelineConfig().sources.find(
      (item) => item.adapterId === "catch-official-listing-v1",
    ),
  );
  const requests = [];
  const responses = [
    {
      status: 200,
      ok: true,
      body: {
        data: {
          ItemTotal: 1,
          PageTotal: 1,
          Items: [
            {
              Url: "/event/show",
              Title: "Show",
              Info: {
                Location: "Hall",
                EventFormat: "Physical",
                EventDate: "12 Jul 2026",
              },
            },
          ],
        },
      },
      text: "",
    },
    {
      status: 200,
      ok: true,
      body: null,
      text: '<div id="event-detail-page" event-detail-page-id="42"></div>',
    },
    {
      status: 200,
      ok: true,
      body: {
        data: {
          ID: "42",
          DisplayEventTitle: "Show",
          Location: "Hall",
          EventFormat: "Physical",
          DisplayEventDate: "12 Jul 2026",
        },
      },
      text: "",
    },
  ];
  const transport = async (request) => {
    requests.push(request);
    return responses.shift();
  };
  try {
    const result = await collectSource({
      runDir,
      run: { runId: "run-a", window: singaporeWindow("2026-07-11") },
      source,
      transport,
    });
    assert.equal(result.status, "success");
    assert.equal(result.counts.processedSourceRecords, 1);
    assert.equal(result.counts.eligiblePreDedup, 1);
    assert.equal(requests[1].method, "GET");
    assert.match(requests[2].body, /eventPageID=42/);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("human-readable event dates produce an interval", () => {
  const interval = eventInterval({ dateText: "11 Jul 2026 to 18 Jul 2026" });
  assert.ok(interval.start < interval.end);
});

test("source fixtures keep optional mode and date gaps for downstream classification", () => {
  const partial = {
    sourceId: "/event/partial",
    title: "Partial event",
    detailUrl: "https://example.com/event/partial",
    mode: "unknown",
    dateText: null,
    performances: [],
  };
  assert.equal(classifyFixture(partial), null);
  assert.equal(
    classifyFixture({ ...partial, detailUrl: null }),
    "missing_detail_url",
  );
});

test("code normalizer filters, preserves cross-source candidates, provenance, and venue branches", () => {
  const runDir = resolve(
    tmpdir(),
    `event-normalizer-${process.pid}-${Date.now()}`,
  );
  mkdirSync(join(runDir, "raw/catch/details"), { recursive: true });
  mkdirSync(join(runDir, "raw/sistic/details"), { recursive: true });
  const fixture = (sourceId, title, mode, dateText, venue) => ({
    schemaVersion: "1.0",
    runId: "run-a",
    createdAt: "2026-07-11T00:00:00Z",
    counts: { records: 1 },
    records: [
      {
        adapterVersion: "1.0",
        listingPage: 1,
        detailUrl: `https://example.com/${sourceId}`,
        sourceId,
        title,
        mode,
        dateText,
        timeText: null,
        venue,
        performances: [],
      },
    ],
  });
  writeFileSync(
    join(runDir, "raw/catch/details/a.json"),
    JSON.stringify(
      fixture("a", "Same Show", "physical", "12 Jul 2026", "Venue A"),
    ),
  );
  writeFileSync(
    join(runDir, "raw/sistic/details/b.json"),
    JSON.stringify(
      fixture("b", "Same Show", "physical", "12 Jul 2026", "Venue A"),
    ),
  );
  writeFileSync(
    join(runDir, "raw/catch/details/online.json"),
    JSON.stringify(fixture("online", "Stream", "online", "12 Jul 2026", null)),
  );
  const offer = fixture(
    "offer",
    "Merchant Discount",
    "physical",
    "12 Jul 2026",
    "Mall",
  );
  offer.records[0].recordType = "membership_offer";
  writeFileSync(
    join(runDir, "raw/catch/details/offer.json"),
    JSON.stringify(offer),
  );
  const state = {
    sources: {
      Catch: {
        status: "success",
        invalidSourceRecordRefs: [],
        processedSourceRecordRefs: [
          "raw/catch/details/a.json#/records/0",
          "raw/catch/details/online.json#/records/0",
          "raw/catch/details/offer.json#/records/0",
        ],
      },
      SISTIC: {
        status: "success",
        invalidSourceRecordRefs: [],
        processedSourceRecordRefs: ["raw/sistic/details/b.json#/records/0"],
      },
    },
  };
  try {
    const result = normalizeRun({
      runDir,
      state,
      run: { runId: "run-a", window: singaporeWindow("2026-07-11") },
    });
    assert.deepEqual(result.counts, {
      eligiblePreDedup: 2,
      duplicateCollapsed: 0,
      acceptedPostDedup: 2,
      acceptedPrimary: 2,
    });
    assert.equal(result.venueBranches.length, 1);
    const events = JSON.parse(
      readFileSync(join(runDir, "normalized/events.json"), "utf8"),
    ).records;
    assert.equal(events.length, 2);
    assert.equal(events[0].sources.length, 1);
    assert.match(events[0].sources[0].sourceId, /#2026-07-12#1$/);
    assert.equal(events[0].id, events[0].occurrenceId);
    assert.notEqual(events[0].occurrenceId, events[0].parentListingId);
    assert.notEqual(events[0].occurrenceId, events[0].mergedEventId);
    assert.equal(events[0].sourceOccurrenceIds.length, 1);
    assert.equal(events[0].venueId, result.venueBranches[0].id);
    assert.match(events[0].contentHash, /^[a-f0-9]{64}$/);
    assert.deepEqual(result.sourceAccounting, {
      Catch: {
        occurrencesEmitted: 3,
        excludedOccurrences: 2,
        eligiblePreDedup: 1,
        duplicateCollapsed: 0,
        acceptedPrimary: 1,
      },
      SISTIC: {
        occurrencesEmitted: 1,
        excludedOccurrences: 0,
        eligiblePreDedup: 1,
        duplicateCollapsed: 0,
        acceptedPrimary: 1,
      },
    });
    const decisions = JSON.parse(
      readFileSync(join(runDir, "normalized/dedup-decisions.json"), "utf8"),
    ).records;
    assert.ok(decisions.every((decision) => decision.primarySource));
    const excluded = JSON.parse(
      readFileSync(join(runDir, "normalized/excluded.json"), "utf8"),
    ).records;
    assert.deepEqual(excluded.map((record) => record.reasonCode).sort(), [
      "membership_offer",
      "online",
    ]);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("sufficient editorial records normalize with provenance, optional fields, off-map review, and exact accounting", () => {
  const runDir = resolve(
    tmpdir(),
    `event-normalizer-editorial-${process.pid}-${Date.now()}`,
  );
  mkdirSync(join(runDir, "raw/honeycombers/discoveries"), { recursive: true });
  const recordRef = "raw/honeycombers/discoveries/art.json#/records/0";
  writeFileSync(
    join(runDir, "raw/honeycombers/discoveries/art.json"),
    JSON.stringify({
      schemaVersion: "1.0",
      records: [
        {
          recordType: "discovery",
          discoveryRecordId: "honeycombers:art-night",
          sourceId: "honeycombers:art-night",
          title: "Future Art Night",
          dateText: "20 December 2027",
          timeText: null,
          venue: "National Gallery Singapore",
          scope: "Singapore",
          detailUrl: "https://thehoneycombers.com/singapore/event/art-night",
          schedule: { kind: "exact", displayText: "20 December 2027" },
          publicPlacement: "off_map",
          mappingStatus: "pending_review",
          lifecycleState: "active",
          evidenceLevel: "editorial_authoritative",
          primaryEvidenceId: "honeycombers:art-night",
          sourceContributions: [
            {
              sourceRecordId: "honeycombers:art-night",
              freshness: "current",
              fields: ["title", "schedule", "location"],
            },
          ],
        },
      ],
    }),
  );
  const state = {
    sources: {
      Honeycombers: {
        status: "success",
        sourceRole: "discovery",
        operatingMode: "required",
        invalidSourceRecordRefs: [],
        processedSourceRecordRefs: [recordRef],
      },
    },
  };
  try {
    const result = normalizeRun({
      runDir,
      state,
      run: { runId: "run-a", window: singaporeWindow("2026-07-18") },
    });
    assert.deepEqual(result.counts, {
      eligiblePreDedup: 1,
      duplicateCollapsed: 0,
      acceptedPostDedup: 1,
      acceptedPrimary: 1,
    });
    assert.equal(
      result.venueBranches.length,
      1,
      "pending exact-building review remains resolvable while publicly off-map",
    );
    const [event] = JSON.parse(
      readFileSync(join(runDir, "normalized/events.json"), "utf8"),
    ).records;
    assert.deepEqual(
      [
        event.publicPlacement,
        event.mappingStatus,
        event.evidenceLevel,
        event.timeText,
      ],
      ["off_map", "pending_review", "editorial_authoritative", null],
    );
    assert.deepEqual(event.supportingDiscoveryIds, ["honeycombers:art-night"]);
    assert.equal(event.provenanceRefs[0], recordRef);
    assert.deepEqual(summarizeEvidenceLevels([event]), {
      uniqueActivities: 1,
      levels: { editorial_authoritative: 1 },
      upgrades: {},
    });
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("normalizer collapses an all-day duplicate into the more precise timed occurrence", () => {
  const runDir = resolve(
    tmpdir(),
    `event-normalizer-schedule-precision-${process.pid}-${Date.now()}`,
  );
  mkdirSync(join(runDir, "raw/catch/details"), { recursive: true });
  const record = (sourceId, performance) => ({
    schemaVersion: "1.0",
    runId: "run-a",
    counts: { records: 1 },
    records: [
      {
        adapterVersion: "1.0",
        listingPage: 1,
        detailUrl: `https://example.com/${sourceId}`,
        sourceId,
        title: "Same Exhibition",
        mode: "physical",
        dateText: "2026-07-18",
        timeText: null,
        venue: "Museum",
        performances: [performance],
      },
    ],
  });
  writeFileSync(
    join(runDir, "raw/catch/details/all-day.json"),
    JSON.stringify(
      record("all-day", {
        startDateTime: null,
        endDateTime: null,
        dateText: "2026-07-18",
        timeText: "Full day",
      }),
    ),
  );
  writeFileSync(
    join(runDir, "raw/catch/details/timed.json"),
    JSON.stringify(
      record("timed", {
        startDateTime: "2026-07-18T10:00:00+08:00",
        endDateTime: "2026-07-18T19:00:00+08:00",
        dateText: "2026-07-18",
        timeText: "10:00 - 19:00",
      }),
    ),
  );
  const state = {
    sources: {
      Catch: {
        status: "success",
        invalidSourceRecordRefs: [],
        processedSourceRecordRefs: [
          "raw/catch/details/all-day.json#/records/0",
          "raw/catch/details/timed.json#/records/0",
        ],
      },
    },
  };
  try {
    const result = normalizeRun({
      runDir,
      state,
      run: { runId: "run-a", window: singaporeWindow("2026-07-18") },
    });
    assert.deepEqual(result.counts, {
      eligiblePreDedup: 2,
      duplicateCollapsed: 1,
      acceptedPostDedup: 1,
      acceptedPrimary: 1,
    });
    const [event] = JSON.parse(
      readFileSync(join(runDir, "normalized/events.json"), "utf8"),
    ).records;
    assert.equal(event.startsAt, "2026-07-18T10:00:00+08:00");
    assert.equal(event.timeText, "10:00 - 19:00");
    assert.equal(event.allDay, false);
    assert.equal(event.sourceOccurrenceIds.length, 2);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("normalizer retains undated venue events and audits partial records without a venue", () => {
  const runDir = resolve(
    tmpdir(),
    `event-normalizer-partial-${process.pid}-${Date.now()}`,
  );
  mkdirSync(join(runDir, "raw/catch/details"), { recursive: true });
  const document = (sourceId, title, venue) => ({
    schemaVersion: "1.0",
    runId: "run-a",
    counts: { records: 1 },
    records: [
      {
        adapterVersion: "1.0",
        listingPage: 1,
        detailUrl: `https://example.com/${sourceId}`,
        sourceId,
        title,
        mode: "unknown",
        dateText: null,
        timeText: null,
        venue,
        performances: [],
      },
    ],
  });
  writeFileSync(
    join(runDir, "raw/catch/details/venue.json"),
    JSON.stringify(document("venue", "Undated venue event", "Venue A")),
  );
  writeFileSync(
    join(runDir, "raw/catch/details/no-venue.json"),
    JSON.stringify(document("no-venue", "Partial listing", null)),
  );
  const state = {
    sources: {
      Catch: {
        status: "success",
        invalidSourceRecordRefs: [],
        processedSourceRecordRefs: [
          "raw/catch/details/venue.json#/records/0",
          "raw/catch/details/no-venue.json#/records/0",
        ],
      },
    },
  };
  try {
    const result = normalizeRun({
      runDir,
      state,
      run: { runId: "run-a", window: singaporeWindow("2026-07-11") },
    });
    assert.equal(result.counts.acceptedPostDedup, 1);
    assert.equal(result.venueBranches.length, 0);
    const events = JSON.parse(
      readFileSync(join(runDir, "normalized/events.json"), "utf8"),
    ).records;
    assert.equal(events[0].dateText, null);
    assert.equal(events[0].lifecycleState, "held");
    const excluded = JSON.parse(
      readFileSync(join(runDir, "normalized/excluded.json"), "utf8"),
    ).records;
    assert.equal(excluded[0].reasonCode, "missing_venue");
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("normalizer retains open-schedule and non-specific-venue activities without title hardcoding while excluding overseas occurrences", () => {
  const runDir = resolve(
    tmpdir(),
    `event-normalizer-eligibility-${process.pid}-${Date.now()}`,
  );
  mkdirSync(join(runDir, "raw/fever/details"), { recursive: true });
  const records = [
    {
      sourceId: "a",
      title: "Images of Singapore by Madame Tussauds",
      dateText: "18 Jul 2026",
      venue: "Madame Tussauds Singapore",
    },
    {
      sourceId: "b",
      title: "Guided Cycling Food Tour",
      dateText: "daily",
      venue: "Tour Office",
    },
    {
      sourceId: "c",
      title: "Special Concert",
      dateText: "18 Jul 2026",
      venue: "Various Venues",
    },
    {
      sourceId: "d",
      title: "Weekend Festival",
      dateText: "18 Jul 2026",
      venue: "Johor Bahru, Malaysia",
    },
    {
      sourceId: "e",
      title: "One Night Only",
      dateText: "18 Jul 2026",
      venue: "The Arts House",
    },
  ].map((record) => ({
    adapterVersion: "1.0",
    listingPage: 1,
    detailUrl: `https://example.com/${record.sourceId}`,
    mode: "physical",
    timeText: null,
    performances: [],
    ...record,
  }));
  writeFileSync(
    join(runDir, "raw/fever/details/all.json"),
    JSON.stringify({ schemaVersion: "1.0", runId: "run-a", records }),
  );
  const refs = records.map(
    (_, index) => `raw/fever/details/all.json#/records/${index}`,
  );
  try {
    const result = normalizeRun({
      runDir,
      state: {
        sources: {
          Fever: {
            status: "success",
            invalidSourceRecordRefs: [],
            processedSourceRecordRefs: refs,
          },
        },
      },
      run: { runId: "run-a", window: singaporeWindow("2026-07-17") },
    });
    assert.equal(result.counts.acceptedPostDedup, 4);
    const events = JSON.parse(
      readFileSync(join(runDir, "normalized/events.json"), "utf8"),
    ).records;
    const cyclingTour = events.find((event) =>
      event.sourceEventId.startsWith("b#"),
    );
    assert.deepEqual(
      [
        cyclingTour.publicPlacement,
        cyclingTour.mappingStatus,
        cyclingTour.offMapSubtype,
      ],
      ["off_map", "not_required", "mobile_route"],
      "an authoritative no-address cycling tour bypasses building resolution",
    );
    assert.equal(
      result.venueBranches.some((branch) => branch.venue === "Tour Office"),
      false,
    );
    assert.deepEqual(
      JSON.parse(
        readFileSync(join(runDir, "normalized/excluded.json"), "utf8"),
      ).records.map((item) => item.reasonCode),
      ["outside_singapore"],
    );
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("normalizer upgrades legacy optional-field invalid records without refetching them", () => {
  const runDir = resolve(
    tmpdir(),
    `event-normalizer-upgrade-${process.pid}-${Date.now()}`,
  );
  mkdirSync(join(runDir, "raw/catch/details"), { recursive: true });
  const recordRef = "raw/catch/details/partial.json#/records/0";
  writeFileSync(
    join(runDir, "raw/catch/details/partial.json"),
    JSON.stringify({
      schemaVersion: "1.0",
      runId: "run-a",
      counts: { records: 1 },
      records: [
        {
          sourceId: "/event/partial",
          title: "Partial event",
          detailUrl: "https://example.com/event/partial",
          mode: "unknown",
          dateText: null,
          venue: "Venue A",
          performances: [],
        },
      ],
    }),
  );
  const state = {
    sources: {
      Catch: {
        status: "success",
        invalidSourceRecordRefs: [recordRef],
        processedSourceRecordRefs: [],
        invalidReasonCodes: { [recordRef]: "invalid_mode" },
      },
    },
  };
  try {
    const result = normalizeRun({
      runDir,
      state,
      run: { runId: "run-a", window: singaporeWindow("2026-07-11") },
    });
    assert.deepEqual(result.sourceReclassifications, { Catch: [recordRef] });
    assert.equal(result.counts.acceptedPostDedup, 1);
    assert.equal(
      JSON.parse(readFileSync(join(runDir, "normalized/invalid.json"), "utf8"))
        .counts.records,
      0,
    );
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("normalization checkpoints preserve unchanged venue stages and reset changed branches", () => {
  const completed = {
    venue: "Hall A",
    eventIds: ["event-a"],
    stages: { resolve: { status: "success" } },
  };
  const previous = {
    "venue-a": completed,
    "venue-removed": {
      venue: "Offer Venue",
      eventIds: ["offer"],
      stages: { resolve: { status: "unresolved" } },
    },
  };
  const unchanged = reconcileNormalizedVenueBranches(previous, [
    { id: "venue-a", venue: "HALL A", eventIds: ["event-a"] },
  ]);
  assert.equal(unchanged.changedBranch, false);
  assert.equal(unchanged.venues["venue-a"], completed);
  assert.equal(unchanged.venues["venue-removed"], undefined);
  const changed = reconcileNormalizedVenueBranches(previous, [
    { id: "venue-a", venue: "Hall A", eventIds: ["event-a", "event-b"] },
  ]);
  assert.equal(changed.changedBranch, true);
  assert.equal(changed.venues["venue-a"].stages.resolve.status, "pending");
});

test("normalization retains future events, rejects unexplained expired events, and rejects mixed venue branches", () => {
  const window = singaporeWindow("2026-07-11");
  const base = {
    counts: { acceptedPrimary: 1 },
    venueBranches: [{ id: "venue-a", venue: "Venue A", eventIds: ["event-a"] }],
  };
  assert.doesNotThrow(() =>
    validateNormalizedSemantics(
      "",
      {
        records: [
          {
            id: "event-a",
            venue: "Venue A",
            isOnline: false,
            dateText: "27 Oct 2026",
          },
        ],
      },
      base,
      window,
    ),
  );
  assert.throws(
    () =>
      validateNormalizedSemantics(
        "",
        {
          records: [
            {
              id: "event-a",
              venue: "Venue A",
              isOnline: false,
              dateText: "1 Jan 2026",
              lifecycleState: "active",
            },
          ],
        },
        base,
        window,
      ),
    /ended before the run/,
  );
  assert.doesNotThrow(
    () =>
      validateNormalizedSemantics(
        "",
        {
          records: [
            {
              id: "event-a",
              venue: "Venue A",
              isOnline: false,
              dateText: "gates open in 1 June 2026",
              schedule: {
                kind: "selectable",
                start: null,
                end: null,
                finalKnownOccurrence: null,
              },
              lifecycleState: "active",
            },
          ],
        },
        base,
        window,
      ),
    "an opening date is not a selectable activity final date",
  );
  assert.doesNotThrow(() =>
    validateNormalizedSemantics(
      "",
      {
        records: [
          { id: "undated", venue: "Venue A", isOnline: false, dateText: null },
        ],
      },
      {
        counts: { acceptedPrimary: 1 },
        venueBranches: [
          { id: "venue-a", venue: "Venue A", eventIds: ["undated"] },
        ],
      },
      window,
    ),
  );
  assert.throws(
    () =>
      validateNormalizedSemantics(
        "",
        {
          records: [
            {
              id: "event-a",
              venue: "Venue A",
              isOnline: false,
              dateText: "11 Jul 2026",
            },
            {
              id: "event-b",
              venue: "Venue B",
              isOnline: false,
              dateText: "12 Jul 2026",
            },
          ],
        },
        {
          counts: { acceptedPrimary: 2 },
          venueBranches: [
            { id: "mixed", venue: "Venue A", eventIds: ["event-a", "event-b"] },
          ],
        },
        window,
      ),
    /mixes events from different venues/,
  );
  assert.doesNotThrow(() =>
    validateNormalizedSemantics(
      "",
      {
        records: [
          {
            id: "event-a",
            venue: "SINGAPORE CHINESE CULTURAL CENTRE",
            isOnline: false,
            dateText: "11 Jul 2026",
          },
          {
            id: "event-b",
            venue: "Singapore Chinese Cultural Centre",
            isOnline: false,
            dateText: "12 Jul 2026",
          },
        ],
      },
      {
        counts: { acceptedPrimary: 2 },
        venueBranches: [
          {
            id: "same-normalized-venue",
            venue: "SINGAPORE CHINESE CULTURAL CENTRE",
            eventIds: ["event-a", "event-b"],
          },
        ],
      },
      window,
    ),
  );
});

test("every stage must preserve its complete venue event set", () => {
  assert.doesNotThrow(() =>
    validateStageEventIds("pill", ["a", "b"], {
      result: { inputEventIds: ["b", "a"] },
    }),
  );
  assert.throws(
    () =>
      validateStageEventIds("panel", ["a", "b"], {
        result: { inputEventIds: ["a"] },
      }),
    /preserve every event/,
  );
});

test("highlight success requires a tileset and every referenced tile on disk", () => {
  const root = mkdirSync(
    join(tmpdir(), `highlight-artifacts-${process.pid}-${Date.now()}`),
    { recursive: true },
  );
  const tilesetDir = join(root, "public/poi-tiles/venue");
  mkdirSync(tilesetDir, { recursive: true });
  writeFileSync(
    join(tilesetDir, "tileset.json"),
    JSON.stringify({ root: { content: { uri: "tile.b3dm" } } }),
  );
  writeFileSync(
    join(tilesetDir, "extraction-manifest.json"),
    JSON.stringify({ poiId: "venue", tiles: [{ poiFile: "tile.b3dm" }] }),
  );
  const result = {
    stage: "highlight",
    status: "success",
    result: {
      poiId: "venue",
      poiTilesetUrl: "public/poi-tiles/venue/tileset.json",
      extractionManifestUrl: "public/poi-tiles/venue/extraction-manifest.json",
    },
  };
  assert.throws(
    () => validateHighlightArtifacts(result, root),
    /tile does not exist/,
  );
  writeFileSync(join(tilesetDir, "tile.b3dm"), "tile");
  assert.doesNotThrow(() => validateHighlightArtifacts(result, root));
  rmSync(root, { recursive: true, force: true });
});

test("POI extractor preserves exact GML identities when source tiles share a basename", async () => {
  const fixtureRoot = resolve(
      tmpdir(),
      `poi-extractor-fixture-${process.pid}-${Date.now()}`,
    ),
    sourceCache = join(fixtureRoot, "source");
  const sourceTiles = ["tiles/1/0/0.b3dm", "tiles/2/0/0.b3dm"],
    publishRoot = join(fixtureRoot, "publish");
  const document = new Document(),
    buffer = document.createBuffer();
  const primitive = document
    .createPrimitive()
    .setAttribute(
      "POSITION",
      document
        .createAccessor()
        .setType(Accessor.Type.VEC3)
        .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
        .setBuffer(buffer),
    )
    .setAttribute(
      "_BATCHID",
      document
        .createAccessor()
        .setType(Accessor.Type.SCALAR)
        .setArray(new Float32Array([0, 0, 0]))
        .setBuffer(buffer),
    )
    .setIndices(
      document
        .createAccessor()
        .setType(Accessor.Type.SCALAR)
        .setArray(new Uint16Array([0, 1, 2]))
        .setBuffer(buffer),
    );
  document
    .createScene()
    .addChild(
      document
        .createNode()
        .setMesh(document.createMesh().addPrimitive(primitive)),
    );
  const glb = Buffer.from(await new NodeIO().writeBinary(document));
  const padded = (value) => {
    let json = JSON.stringify(value);
    while (json.length % 8) json += " ";
    return Buffer.from(json);
  };
  const writeSourceTile = (sourceTile, gmlId) => {
    const sourcePath = join(sourceCache, sourceTile.replace(/^tiles\//, ""));
    mkdirSync(dirname(sourcePath), { recursive: true });
    const feature = padded({ BATCH_LENGTH: 1 }),
      batch = padded({ "gml:id": [gmlId], "gml:name": ["HALL"] });
    const header = Buffer.alloc(28);
    header.write("b3dm");
    header.writeUInt32LE(1, 4);
    header.writeUInt32LE(28 + feature.length + batch.length + glb.length, 8);
    header.writeUInt32LE(feature.length, 12);
    header.writeUInt32LE(0, 16);
    header.writeUInt32LE(batch.length, 20);
    header.writeUInt32LE(0, 24);
    writeFileSync(sourcePath, Buffer.concat([header, feature, batch, glb]));
  };
  writeSourceTile(sourceTiles[0], "gml-1");
  writeSourceTile(sourceTiles[1], "gml-2");
  const tilesetPath = join(fixtureRoot, "tileset.json"),
    registryPath = join(fixtureRoot, "registry.json");
  writeFileSync(
    tilesetPath,
    JSON.stringify({
      asset: { version: "1.0" },
      root: {
        boundingVolume: { region: [0, 0, 1, 1, 0, 1] },
        geometricError: 1,
        children: sourceTiles.map((sourceTile) => ({
          boundingVolume: { region: [0, 0, 1, 1, 0, 1] },
          geometricError: 0,
          content: { uri: sourceTile.replace(/^tiles\//, "") },
        })),
      },
    }),
  );
  writeFileSync(
    registryPath,
    JSON.stringify({
      records: [
        {
          id: "hall",
          label: "HALL",
          data: "poi-tiles/hall/tileset.json",
          names: ["HALL"],
          tiles: Object.fromEntries(
            sourceTiles.map((sourceTile) => [sourceTile, [0]]),
          ),
        },
      ],
    }),
  );
  try {
    const extracted = spawnSync(
      process.execPath,
      [
        "scripts/extract-cbd-poi-tilesets.mjs",
        "--registry",
        registryPath,
        "--source-cache",
        sourceCache,
        "--source-tileset",
        tilesetPath,
        "--publish-root",
        publishRoot,
        "--work-root",
        join(fixtureRoot, "work"),
      ],
      { cwd: ROOT, encoding: "utf8", timeout: 30000 },
    );
    assert.equal(extracted.status, 0, extracted.stderr);
    const verified = spawnSync(
      process.execPath,
      [
        "scripts/verify-poi-background-separation.mjs",
        "--registry",
        registryPath,
        "--root",
        publishRoot,
        "--source-cache",
        sourceCache,
      ],
      { cwd: ROOT, encoding: "utf8" },
    );
    assert.equal(verified.status, 0, verified.stderr);
    const manifest = JSON.parse(
      readFileSync(
        join(publishRoot, "public/poi-tiles/hall/extraction-manifest.json"),
        "utf8",
      ),
    );
    assert.deepEqual(manifest.tiles.flatMap(({ gmlIds }) => gmlIds).sort(), [
      "gml-1",
      "gml-2",
    ]);
    assert.equal(new Set(manifest.tiles.map(({ poiFile }) => poiFile)).size, 2);
    assert.ok(manifest.tiles.every(({ poiTriangles }) => poiTriangles > 0));
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("unresolved venue outcomes are cached without repeated recovery passes", () => {
  const result = {
    stage: "resolve",
    status: "unresolved",
    result: {
      resolutionStatus: "needs_review",
      inputEventIds: ["event-a"],
      evidenceInspected: [
        "official venue page",
        "two competing OneMap footprints",
      ],
      finalReason: "Two buildings remain plausible",
      cacheKey: "venue-a",
      evidenceHash: "hash-a",
      webResearch: [
        {
          sourceType: "venue_official",
          query: "Venue A official address",
          checkedAt: "2026-07-11T12:00:00Z",
          outcome: "Official page omits a street address",
          resultUrls: ["https://venue.example/contact"],
        },
        {
          sourceType: "host_or_authority",
          query: "Venue A host building Singapore",
          checkedAt: "2026-07-11T12:02:00Z",
          outcome: "Authority page names two possible buildings",
          resultUrls: ["https://authority.example/venue-a"],
        },
      ],
      localLookupEvidence: [
        {
          tool: "venue-index:resolve",
          query: "Venue A",
          outcome: "Two nearby footprints",
        },
        {
          tool: "find-poi-tile-candidates",
          query: "Venue A",
          outcome: "Two equally plausible clean candidates",
        },
      ],
      recoveryAttempts: [
        {
          attempt: 1,
          approach: "Official venue identity and address",
          outcome: "No unique building",
        },
        {
          attempt: 2,
          approach: "Host authority and local geometry cross-check",
          outcome: "Ambiguity remains",
        },
      ],
      competingCandidates: [{ gmlId: "one" }, { gmlId: "two" }],
    },
  };
  assert.doesNotThrow(() =>
    validateResolveRecoveryEvidence(
      "/unused",
      "run-a",
      "venue-a",
      ["event-a"],
      result,
    ),
  );
  assert.throws(
    () =>
      validateResolveRecoveryEvidence(
        "/unused",
        "run-a",
        "venue-a",
        ["event-a"],
        {
          ...result,
          result: { ...result.result, evidenceHash: null },
        },
      ),
    /cacheKey and evidenceHash/,
  );
  assert.throws(
    () =>
      validateResolveRecoveryEvidence(
        "/unused",
        "run-a",
        "venue-a",
        ["event-a"],
        {
          ...result,
          result: {
            ...result.result,
            evidenceInspected: [
              { url: "https://www.google.com/search?q=venue+a" },
            ],
          },
        },
      ),
    /Search-result URLs/,
  );
  assert.throws(
    () =>
      validateResolveRecoveryEvidence(
        "/unused",
        "run-a",
        "venue-a",
        ["event-a"],
        {
          stage: "resolve",
          status: "unresolved",
          result: {
            resolutionStatus: "needs_review",
            inputEventIds: ["event-a"],
            evidenceInspected: ["local files"],
            finalReason: "No local candidates",
            cacheKey: "shortcut",
            evidenceHash: "shortcut-hash",
          },
        },
      ),
    /web research attempts/,
  );

  const notMappable = {
    stage: "resolve",
    status: "unresolved",
    result: {
      resolutionStatus: "not_mappable",
      inputEventIds: ["event-a"],
      evidenceInspected: ["official venue schedule"],
      finalReason: "The event moves between venues",
      cacheKey: "mobile-a",
      evidenceHash: "mobile-hash",
      notMappableEvidence: {
        reasonCode: "mobile_venue",
        sourceUrls: ["https://venue.example/schedule"],
      },
    },
  };
  assert.doesNotThrow(() =>
    validateResolveRecoveryEvidence(
      "/unused",
      "run-a",
      "venue-a",
      ["event-a"],
      notMappable,
    ),
  );
  assert.throws(
    () =>
      validateResolveRecoveryEvidence(
        "/unused",
        "run-a",
        "venue-a",
        ["event-a"],
        {
          ...notMappable,
          result: {
            ...notMappable.result,
            notMappableEvidence: undefined,
            finalReason: "No local match",
          },
        },
      ),
    /affirmative classification evidence/,
  );

  const runDir = resolve(
    tmpdir(),
    `event-pipeline-review-candidates-${process.pid}-${Date.now()}`,
  );
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, "local-venue-resolution.json"),
    JSON.stringify({
      results: [
        {
          venueId: "venue-a",
          alternatives: [{ gmlIds: ["one"] }, { gmlIds: ["two"] }],
        },
      ],
    }),
  );
  try {
    assert.doesNotThrow(() =>
      validateResolveRecoveryEvidence(
        runDir,
        "run-a",
        "venue-a",
        ["event-a"],
        result,
      ),
    );
    assert.throws(
      () =>
        validateResolveRecoveryEvidence(
          runDir,
          "run-a",
          "venue-a",
          ["event-a"],
          {
            ...result,
            result: { ...result.result, competingCandidates: [] },
          },
        ),
      /carry every local OneMap alternative/,
    );
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("resolution cache reuses an exact stable event set when enrichment changes its evidence hash", () => {
  const entry = {
    normalizedVenue: "various venues",
    evidenceHash: "old-hash",
    result: {
      inputEventIds: ["event-a"],
      resolutionStatus: "not_mappable",
      notMappableEvidence: { reasonCode: "outside_singapore" },
    },
  };
  assert.equal(
    reusableResolutionEntry(
      { entries: [entry] },
      "various venues",
      "new-hash",
      ["event-a"],
    ),
    entry,
  );
  assert.equal(
    reusableResolutionEntry(
      { entries: [entry] },
      "various venues",
      "new-hash",
      ["event-b"],
    ),
    null,
  );
});

test("needs-review cache is not reused when current OneMap alternatives are missing", () => {
  const entry = {
    normalizedVenue: "hall",
    evidenceHash: "same-hash",
    result: {
      inputEventIds: ["event-a"],
      resolutionStatus: "needs_review",
      competingCandidates: [{ gmlId: "one" }],
    },
  };
  assert.equal(
    reusableResolutionEntry(
      { entries: [entry] },
      "hall",
      "same-hash",
      ["event-a"],
      ["one"],
    ),
    entry,
  );
  assert.equal(
    reusableResolutionEntry(
      { entries: [entry] },
      "hall",
      "same-hash",
      ["event-a"],
      ["one", "two"],
    ),
    null,
  );
});

test("not-mappable recovery cannot override an exact local OneMap building candidate", () => {
  const localRow = {
    alternatives: [
      {
        name: "MARINA SOUTH PIER",
        gmlIds: ["SLA_BLDG2_570fa5cd-4d81-4ea6-b9d2-46675367d5b0"],
      },
    ],
  };
  assert.throws(
    () =>
      validateNotMappableAgainstLocalCandidates(
        {
          notMappableEvidence: {
            reasonCode: "no_target_building",
            sourceUrls: ["https://host.example/event"],
          },
        },
        "Marina South Pier (Meeting Point)",
        localRow,
      ),
    /exact building candidate MARINA SOUTH PIER/,
  );
  assert.doesNotThrow(() =>
    validateNotMappableAgainstLocalCandidates(
      {
        notMappableEvidence: {
          reasonCode: "mobile_venue",
          sourceUrls: ["https://host.example/event"],
        },
      },
      "Island heritage route",
      localRow,
    ),
  );
});

test("approved venue resolution requires exact GML, clean tiles, batches, coordinates, and evidence", () => {
  const root = resolve(
    tmpdir(),
    `approved-resolution-${process.pid}-${Date.now()}`,
  );
  const tilePath = join(root, "public/poi-tiles/source/1/2/3.b3dm");
  mkdirSync(dirname(tilePath), { recursive: true });
  const padded = (value) => {
    let json = JSON.stringify(value);
    while (json.length % 8) json += " ";
    return Buffer.from(json);
  };
  const feature = padded({ BATCH_LENGTH: 2 }),
    batch = padded({
      "gml:id": ["gml-1", "gml-2"],
      "gml:name": ["HALL", "HALL"],
    });
  const header = Buffer.alloc(28);
  header.write("b3dm");
  header.writeUInt32LE(1, 4);
  header.writeUInt32LE(28 + feature.length + batch.length, 8);
  header.writeUInt32LE(feature.length, 12);
  header.writeUInt32LE(batch.length, 20);
  writeFileSync(tilePath, Buffer.concat([header, feature, batch]));
  const valid = {
    stage: "resolve",
    status: "success",
    result: {
      resolutionStatus: "approved",
      poiId: "hall",
      canonicalVenue: "Hall",
      gmlId: "gml-1",
      acceptedGmlNames: ["HALL"],
      coordinates: { lng: 103.8, lat: 1.3 },
      sourceTiles: [{ path: "tiles/1/2/3.b3dm", batchIds: [0] }],
      evidence: [{ type: "local" }],
    },
  };
  try {
    assert.doesNotThrow(() => validateApprovedResolution(valid, root));
    assert.doesNotThrow(() =>
      validateApprovedResolution(
        {
          ...valid,
          result: {
            ...valid.result,
            gmlId: null,
            gmlIds: ["gml-1", "gml-2"],
            sourceTiles: [{ path: "tiles/1/2/3.b3dm", batchIds: [0, 1] }],
          },
        },
        root,
      ),
    );
    assert.throws(
      () =>
        validateApprovedResolution(
          { ...valid, result: { ...valid.result, gmlId: null } },
          root,
        ),
      /exact GML/,
    );
    assert.throws(
      () =>
        validateApprovedResolution(
          { ...valid, result: { ...valid.result, sourceTiles: [] } },
          root,
        ),
      /clean source tiles/,
    );
    assert.throws(
      () =>
        validateApprovedResolution(
          { ...valid, result: { ...valid.result, gmlId: "wrong-gml" } },
          root,
        ),
      /GML identity/,
    );
    assert.throws(
      () =>
        validateApprovedResolution(
          {
            ...valid,
            result: { ...valid.result, acceptedGmlNames: ["WRONG HALL"] },
          },
          root,
        ),
      /accepted GML name/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("authoritative building name combines complete nearby same-name GML parts", () => {
  const buildings = [
    {
      key: "a",
      name: "NATIONAL LIBRARY BUILDING",
      gmlIds: ["gml-a"],
      latitude: 1.29755,
      longitude: 103.85425,
      distanceMeters: 7,
      sourceTiles: [{ tilePath: "tiles/a.b3dm", batchIds: [1] }],
    },
    {
      key: "b",
      name: "NATIONAL LIBRARY BUILDING",
      gmlIds: ["gml-b"],
      latitude: 1.29777,
      longitude: 103.85457,
      distanceMeters: 25,
      sourceTiles: [{ tilePath: "tiles/b.b3dm", batchIds: [2] }],
    },
  ];
  const selected = selectAddressNamedBuilding(
    ["Drama Centre is inside the National Library Building"],
    buildings,
  );
  assert.deepEqual(selected.gmlIds, ["gml-a", "gml-b"]);
  assert.equal(selected.geometryGroup, true);
  assert.equal(
    selectAddressNamedBuilding(["54 Burnfoot Terrace"], buildings),
    null,
  );
});

test("unresolved-only rerun reopens only newly safe local candidates", () => {
  const stages = (status) =>
    Object.fromEntries(
      ["resolve", "highlight", "pill", "panel"].map((stage) => [
        stage,
        { status, outputRef: `${stage}.json`, error: "old" },
      ]),
    );
  const state = {
    overallStatus: "partial",
    finalizedAt: "2026-07-13T00:00:00Z",
    resolutionPreparation: { status: "success", localCandidateCount: 0 },
    verification: { status: "success" },
    venues: {
      promoted: { stages: stages("unresolved") },
      retained: { stages: stages("unresolved") },
      existing: { stages: stages("success") },
    },
  };
  assert.deepEqual(
    reopenImprovedLocalCandidates(state, [
      { venueId: "promoted", status: "candidate_matched" },
      { venueId: "retained", status: "needs_review" },
      { venueId: "existing", status: "candidate_matched" },
    ]),
    ["promoted"],
  );
  assert.equal(state.venues.promoted.stages.resolve.status, "pending");
  assert.equal(state.venues.retained.stages.resolve.status, "unresolved");
  assert.equal(state.venues.existing.stages.resolve.status, "success");
  assert.equal(state.finalizedAt, null);
  assert.equal(state.verification.status, "pending");
});

test("source accounting rejects incomplete reconciliation", () => {
  assert.throws(
    () =>
      validateSourceResult({
        status: "success",
        artifactRefs: ["raw/catch/listings/page-0001.dom.md"],
        counts: {
          pages: 1,
          sourceRecordsReceived: 3,
          invalidSourceRecords: 1,
          processedSourceRecords: 1,
          occurrencesEmitted: 1,
          excludedOccurrences: 0,
          eligiblePreDedup: 1,
        },
      }),
    /does not reconcile/,
  );
});

test("numeric-only invalid records cannot complete a source", () => {
  assert.throws(
    () =>
      validateSourceResult({
        status: "success",
        counts: {
          pages: 1,
          sourceRecordsReceived: 1,
          invalidSourceRecords: 1,
          processedSourceRecords: 0,
          occurrencesEmitted: 0,
          excludedOccurrences: 0,
          eligiblePreDedup: 0,
        },
        artifactRefs: ["raw/source/listings/page-0001.dom.md"],
      }),
    /completion\.paginationComplete/,
  );
});

test("a representative subset cannot replace provider-reported cardinality", () => {
  assert.throws(
    () =>
      validateSourceResult({
        status: "success",
        counts: {
          pages: 1,
          sourceRecordsReceived: 1,
          invalidSourceRecords: 1,
          processedSourceRecords: 0,
          occurrencesEmitted: 0,
          excludedOccurrences: 0,
          eligiblePreDedup: 0,
        },
        completion: {
          paginationComplete: true,
          pagesVisited: ["page"],
          sourceRecordsDiscovered: 1,
          providerReportedTotal: 156,
          pageRecordCounts: [1],
          detailPagesCaptured: 1,
          detailUrlsDiscovered: 1,
        },
        sourceRecordRefs: ["raw/source/details/a.json#/records/0"],
        invalidSourceRecordRefs: ["raw/source/details/a.json#/records/0"],
        processedSourceRecordRefs: [],
        artifactRefs: ["page", "raw/source/details/a.json"],
      }),
    /providerReportedTotal must match/,
  );
});

test("provider totals are read from raw response evidence", () => {
  assert.equal(
    jsonPointer({ response: { total: 156 } }, "/response/total"),
    156,
  );
  assert.throws(
    () => jsonPointer({ response: {} }, "/response/total"),
    /does not resolve/,
  );
});

test("listing-shell JSON cannot masquerade as a source record", () => {
  const runDir = resolve(tmpdir(), `event-pipeline-evidence-${process.pid}`);
  mkdirSync(resolve(runDir, "raw/source/listings"), { recursive: true });
  writeFileSync(
    resolve(runDir, "raw/source/listings/page-0001.json"),
    JSON.stringify({ records: [{ title: "listing shell" }] }),
  );
  const result = {
    status: "success",
    completion: {
      pagesVisited: ["raw/source/listings/page-0001.json"],
      detailPagesCaptured: 1,
      detailUrlsDiscovered: 1,
      providerReportedTotal: 1,
      providerTotalEvidence: {
        artifactRef: "raw/source/listings/page-0001.json",
        jsonPointer: "/records/0/total",
      },
    },
    artifactRefs: ["raw/source/listings/page-0001.json"],
    sourceRecordRefs: ["raw/source/listings/page-0001.json#/records/0"],
  };
  writeFileSync(
    resolve(runDir, "raw/source/listings/page-0001.json"),
    JSON.stringify({ records: [{ title: "listing shell", total: 1 }] }),
  );
  try {
    assert.throws(
      () => validateSourceEvidence(runDir, { runId: "test" }, result),
      /must target a detail fixture/,
    );
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("detail fixture refs cannot invent per-occurrence filenames", () => {
  const runDir = resolve(tmpdir(), `event-pipeline-detail-name-${process.pid}`);
  mkdirSync(resolve(runDir, "raw/source/listings"), { recursive: true });
  mkdirSync(resolve(runDir, "raw/source/details"), { recursive: true });
  writeFileSync(
    resolve(runDir, "raw/source/listings/page-0001.json"),
    JSON.stringify({ total: 1 }),
  );
  writeFileSync(
    resolve(runDir, "raw/source/details/occurrence-2.json"),
    JSON.stringify({
      schemaVersion: "1.0",
      runId: "test",
      createdAt: new Date().toISOString(),
      counts: { records: 1 },
      records: [
        {
          adapterVersion: "v1",
          listingPage: 1,
          sourceId: "event",
          detailUrl: "https://example.com/event",
        },
      ],
    }),
  );
  const result = {
    status: "success",
    completion: {
      pagesVisited: ["raw/source/listings/page-0001.json"],
      detailPagesCaptured: 1,
      detailUrlsDiscovered: 1,
      providerReportedTotal: 1,
      providerTotalEvidence: {
        artifactRef: "raw/source/listings/page-0001.json",
        jsonPointer: "/total",
      },
    },
    artifactRefs: [
      "raw/source/listings/page-0001.json",
      "raw/source/details/occurrence-2.json",
    ],
    sourceRecordRefs: ["raw/source/details/occurrence-2.json#/records/0"],
  };
  try {
    assert.throws(
      () => validateSourceEvidence(runDir, { runId: "test" }, result),
      /filename mismatch/,
    );
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("a listing record with no detail URL can be accounted for as invalid", () => {
  const runDir = resolve(
    tmpdir(),
    `event-pipeline-invalid-listing-${process.pid}`,
  );
  mkdirSync(resolve(runDir, "raw/source/listings"), { recursive: true });
  writeFileSync(
    resolve(runDir, "raw/source/listings/page-0001.json"),
    JSON.stringify({ total: 1, items: [{ title: "No URL", url: null }] }),
  );
  const ref = "raw/source/listings/page-0001.json#/items/0";
  const result = {
    status: "success",
    completion: {
      pagesVisited: ["raw/source/listings/page-0001.json"],
      detailPagesCaptured: 0,
      detailUrlsDiscovered: 0,
      providerReportedTotal: 1,
      providerTotalEvidence: {
        artifactRef: "raw/source/listings/page-0001.json",
        jsonPointer: "/total",
      },
    },
    artifactRefs: ["raw/source/listings/page-0001.json"],
    sourceRecordRefs: [ref],
    invalidSourceRecordRefs: [ref],
    processedSourceRecordRefs: [],
  };
  try {
    assert.doesNotThrow(() =>
      validateSourceEvidence(runDir, { runId: "test" }, result),
    );
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("source counters derive from the shared activity policy, dates, and modes", () => {
  const runDir = resolve(
    tmpdir(),
    `event-pipeline-source-semantics-${process.pid}`,
  );
  mkdirSync(resolve(runDir, "raw/source/details"), { recursive: true });
  writeFileSync(
    resolve(runDir, "run.json"),
    JSON.stringify({ window: singaporeWindow("2026-07-11") }),
  );
  const refs = [
    "physical",
    "online",
    "unknown",
    "membership",
    "undated",
    "promotion",
    "ordinary-attraction",
  ].map((name, index) => {
    const path = `raw/source/details/${name}.json`;
    writeFileSync(
      resolve(runDir, path),
      JSON.stringify({
        records: [
          {
            title: `Test ${name}`,
            mode: [
              "membership",
              "undated",
              "promotion",
              "ordinary-attraction",
            ].includes(name)
              ? "physical"
              : name,
            venue: [
              "physical",
              "membership",
              "undated",
              "promotion",
              "ordinary-attraction",
            ].includes(name)
              ? "Venue"
              : null,
            recordType: name === "membership" ? "membership_offer" : "event",
            dateText:
              name === "undated"
                ? null
                : index === 0
                  ? "12 Jul 2026"
                  : "13 Jul 2026",
            purePromotion: name === "promotion",
            generalAdmission: name === "ordinary-attraction",
            continuouslyAvailable: name === "ordinary-attraction",
            permanentFixedAttraction: name === "ordinary-attraction",
            performances: [],
          },
        ],
      }),
    );
    return `${path}#/records/0`;
  });
  const result = {
    status: "success",
    processedSourceRecordRefs: refs,
    counts: {
      occurrencesEmitted: 7,
      excludedOccurrences: 5,
      eligiblePreDedup: 2,
    },
  };
  try {
    assert.doesNotThrow(() => validateSourceSemantics(runDir, {}, result));
    assert.throws(
      () =>
        validateSourceSemantics(
          runDir,
          {},
          { ...result, counts: { ...result.counts, eligiblePreDedup: 3 } },
        ),
      /eligiblePreDedup must equal 2/,
    );
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("reachable but incomplete extraction remains pending", () => {
  assert.doesNotThrow(() =>
    validateSourceResult({
      status: "pending",
      message: "Listing is reachable; detail extraction is still in progress.",
    }),
  );
  assert.throws(
    () =>
      validateSourceResult({
        status: "blocked",
        error: "Listing is reachable, but extraction was not completed.",
      }),
    /genuine external blockerReasonCode/,
  );
});

test("blocked sources require an approved external cause", () => {
  assert.doesNotThrow(() =>
    validateSourceResult({
      status: "blocked",
      blockerReasonCode: "authentication_or_captcha",
      error: "CAPTCHA prevents listing access.",
    }),
  );
});

test("next action and blockers retain unfinished work", () => {
  const state = {
    sources: { Catch: { status: "success" }, SISTIC: { status: "pending" } },
    normalization: { status: "pending" },
    venues: {},
    verification: { status: "pending" },
  };
  assert.deepEqual(nextAction(state), {
    action: "collect-source",
    source: "SISTIC",
  });
  assert.deepEqual(terminalProblems(state), [
    "source SISTIC is pending",
    "normalization is pending",
  ]);
});

test("venue recovery preparation is mandatory before resolve stages", () => {
  const state = {
    sources: { Catch: { status: "success" } },
    normalization: { status: "success" },
    resolutionPreparation: { status: "pending" },
    venues: {
      "venue-a": {
        stages: {
          resolve: { status: "pending" },
          highlight: { status: "pending" },
          pill: { status: "pending" },
          panel: { status: "pending" },
        },
      },
    },
    verification: { status: "pending" },
  };
  assert.deepEqual(nextAction(state), { action: "prepare-venues" });
  state.resolutionPreparation.status = "success";
  assert.deepEqual(nextAction(state), {
    action: "record-stage",
    venue: "venue-a",
    stage: "resolve",
  });
  state.resolutionPreparation.localCandidateCount = 1;
  assert.deepEqual(nextAction(state), { action: "resolve-local" });
});

test("every venue resolve finishes before the integrated frontend stage", () => {
  const state = {
    sources: { Catch: { status: "success" } },
    normalization: { status: "success" },
    resolutionPreparation: { status: "success", localCandidateCount: 0 },
    venues: {
      "venue-approved": {
        stages: {
          resolve: { status: "success" },
          highlight: { status: "pending" },
          pill: { status: "pending" },
          panel: { status: "pending" },
        },
      },
      "venue-pending": {
        stages: {
          resolve: { status: "pending" },
          highlight: { status: "pending" },
          pill: { status: "pending" },
          panel: { status: "pending" },
        },
      },
    },
    verification: { status: "pending" },
  };
  assert.deepEqual(nextAction(state), {
    action: "record-stage",
    venue: "venue-pending",
    stage: "resolve",
  });
});

test("successful resolver branches advance to deterministic staged frontend work", () => {
  const state = {
    sources: { Catch: { status: "success" } },
    normalization: { status: "success" },
    resolutionPreparation: { status: "success" },
    venues: {
      "venue-a": {
        stages: {
          resolve: { status: "success" },
          highlight: { status: "pending" },
          pill: { status: "pending" },
          panel: { status: "pending" },
        },
      },
    },
    verification: { status: "pending" },
  };
  assert.deepEqual(nextAction(state), { action: "stage-frontend" });
});

test("nonterminal responses require autonomous continuation", () => {
  const response = progressResponse({
    runId: "run",
    overallStatus: "pending",
    finalizedAt: null,
    sources: { Catch: { status: "pending" } },
    normalization: { status: "pending" },
    venues: {},
    verification: { status: "pending" },
  });
  assert.equal(response.complete, false);
  assert.equal(response.mustContinue, true);
  assert.equal(response.mayAskUserToContinue, false);
  assert.equal(
    response.continueCommand,
    "npm run event-pipeline -- advance --run run",
  );
  assert.deepEqual(response.next, {
    action: "run-command",
    command: response.continueCommand,
  });
  assert.match(response.instruction, /Run next\.command exactly/);
});

test("status report includes contract accounting, reconciliation, errors, and next steps", () => {
  const state = {
    runId: "run",
    overallStatus: "partial",
    sources: {
      Catch: {
        status: "success",
        counts: {
          pages: 1,
          sourceRecordsReceived: 1,
          processedSourceRecords: 1,
          occurrencesEmitted: 1,
          eligiblePreDedup: 1,
          acceptedPrimary: 1,
        },
        artifactRefs: ["raw/page.json"],
      },
    },
    normalization: {
      counts: {
        eligiblePreDedup: 1,
        duplicateCollapsed: 0,
        acceptedPrimary: 1,
      },
    },
    venues: {},
    verification: {
      status: "success",
      build: { status: "success" },
      eventUi: { status: "success" },
    },
  };
  const report = renderStatus(state, {
    window: singaporeWindow("2026-07-11"),
    timezone: "Asia/Singapore",
    manifestSnapshot: { path: "manifest.snapshot.md", sha256: "a" },
    adapterDefinitionsSnapshot: {
      path: "pipeline-config.snapshot.json",
      sha256: "b",
    },
  });
  for (const heading of [
    "Run and window",
    "Reconciled summary",
    "Per-source accounting",
    "Per-venue stages",
    "Build and browser verification",
    "Errors",
    "Ordered next steps",
  ])
    assert.match(report, new RegExp(heading));
});

test("CLI refuses to finalize a newly started incomplete run", () => {
  const outputRoot = resolve(tmpdir(), `event-pipeline-test-${process.pid}`);
  const env = { ...process.env, EVENT_PIPELINE_OUTPUT_ROOT: outputRoot };
  const started = spawnSync(
    process.execPath,
    [SCRIPT, "start", "--date", "2099-01-01"],
    { cwd: ROOT, encoding: "utf8", env },
  );
  assert.equal(started.status, 3, started.stderr);
  const { runId, next, mustContinue, mayAskUserToContinue, continueCommand } =
    JSON.parse(started.stdout);
  assert.deepEqual(next, { action: "run-command", command: continueCommand });
  assert.equal(mustContinue, true);
  assert.equal(
    continueCommand,
    `npm run event-pipeline -- advance --run ${runId}`,
  );
  assert.equal(mayAskUserToContinue, false);
  try {
    const finalized = spawnSync(
      process.execPath,
      [SCRIPT, "finalize", "--run", runId],
      {
        cwd: ROOT,
        encoding: "utf8",
        env,
      },
    );
    assert.equal(finalized.status, 2);
    assert.match(finalized.stderr, /Refusing to finalize an incomplete run/);
    assert.match(finalized.stderr, /source Catch\.sg is pending/);
  } finally {
    rmSync(outputRoot, { recursive: true, force: true });
  }
});

test("CLI normalize command writes and records deterministic artifacts", () => {
  const outputRoot = resolve(
    tmpdir(),
    `event-pipeline-normalize-${process.pid}`,
  );
  const env = { ...process.env, EVENT_PIPELINE_OUTPUT_ROOT: outputRoot };
  const started = spawnSync(
    process.execPath,
    [SCRIPT, "start", "--date", "2099-01-01"],
    { cwd: ROOT, encoding: "utf8", env },
  );
  assert.equal(started.status, 3, started.stderr);
  const { runId } = JSON.parse(started.stdout);
  const statePath = join(outputRoot, runId, "orchestrator-state.json");
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  for (const source of Object.values(state.sources)) {
    source.status = "blocked";
    source.error = "Test-only terminal source";
    source.blockerReasonCode = "source_unavailable";
  }
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  try {
    const normalized = spawnSync(
      process.execPath,
      [SCRIPT, "normalize", "--run", runId],
      { cwd: ROOT, encoding: "utf8", env },
    );
    assert.equal(normalized.status, 3, normalized.stderr);
    assert.equal(JSON.parse(normalized.stdout).next.action, "run-command");
    const normalizedState = JSON.parse(readFileSync(statePath, "utf8"));
    assert.equal(normalizedState.normalization.status, "success");
    assert.deepEqual(
      JSON.parse(
        readFileSync(join(outputRoot, runId, "normalized/events.json"), "utf8"),
      ).records,
      [],
    );
  } finally {
    rmSync(outputRoot, { recursive: true, force: true });
  }
});

test("CLI resume invalidates tampered artifacts and resets downstream state", () => {
  const outputRoot = resolve(tmpdir(), `event-pipeline-resume-${process.pid}`);
  const env = { ...process.env, EVENT_PIPELINE_OUTPUT_ROOT: outputRoot };
  const started = spawnSync(
    process.execPath,
    [SCRIPT, "start", "--date", "2099-01-01"],
    { cwd: ROOT, encoding: "utf8", env },
  );
  const { runId } = JSON.parse(started.stdout);
  const runDir = join(outputRoot, runId),
    statePath = join(runDir, "orchestrator-state.json");
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  for (const source of Object.values(state.sources)) {
    source.status = "blocked";
    source.error = "Test";
    source.blockerReasonCode = "source_unavailable";
  }
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  try {
    const normalized = spawnSync(
      process.execPath,
      [SCRIPT, "normalize", "--run", runId],
      { cwd: ROOT, encoding: "utf8", env },
    );
    assert.equal(normalized.status, 3, normalized.stderr);
    writeFileSync(
      join(runDir, "normalized/events.json"),
      '{"tampered":true}\n',
    );
    const resumed = spawnSync(
      process.execPath,
      [SCRIPT, "resume", "--run", runId],
      { cwd: ROOT, encoding: "utf8", env },
    );
    assert.equal(resumed.status, 3, resumed.stderr);
    const response = JSON.parse(resumed.stdout);
    assert.ok(response.invalidatedArtifacts.includes("normalized/events.json"));
    assert.equal(
      JSON.parse(readFileSync(statePath, "utf8")).normalization.status,
      "pending",
    );
  } finally {
    rmSync(outputRoot, { recursive: true, force: true });
  }
});

test("CLI finalization distinguishes partial and fully blocked outcomes", () => {
  const outputRoot = resolve(
      tmpdir(),
      `event-pipeline-outcomes-${process.pid}`,
    ),
    adminDatabasePath = join(outputRoot, "admin.sqlite");
  const env = {
    ...process.env,
    EVENT_PIPELINE_OUTPUT_ROOT: outputRoot,
    ADMIN_DATABASE_PATH: adminDatabasePath,
  };
  const reviewRepository = new AdminRepository({
    databasePath: adminDatabasePath,
  });
  const staleReview = new AdminService({
    repository: reviewRepository,
  }).createVenueReview({
    venueId: "venue-from-an-older-run",
    evidenceHash: "f".repeat(64),
    evidenceSnapshot: { venue: "Old venue" },
    candidates: [],
  });
  reviewRepository.close();
  let runIndex = 0;
  const makeRun = (sources, normalizationStatus) => {
    runIndex += 1;
    const started = spawnSync(
      process.execPath,
      [SCRIPT, "start", "--date", `2099-01-0${runIndex}`],
      { cwd: ROOT, encoding: "utf8", env },
    );
    const { runId } = JSON.parse(started.stdout),
      statePath = join(outputRoot, runId, "orchestrator-state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    for (const source of Object.values(state.sources))
      source.status = "success";
    Object.assign(state.sources, sources);
    state.normalization = {
      status: normalizationStatus,
      counts: {},
      artifactRefs: [],
      venueBranches: [],
      error: normalizationStatus === "failed" ? "No successful sources" : null,
    };
    state.deduplication = {
      status: "success",
      counts: {},
      artifactRefs: [],
      blockingReviews: [],
      error: null,
    };
    state.resolutionPreparation = {
      status: "success",
      artifactRefs: [],
      error: null,
    };
    state.verification =
      normalizationStatus === "success"
        ? {
            status: "success",
            build: { status: "success" },
            eventUi: { status: "success" },
          }
        : { status: "pending" };
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
    return runId;
  };
  try {
    const partialRun = makeRun(
      {
        "Catch.sg": { status: "success" },
        SISTIC: { status: "blocked", error: "Unavailable" },
      },
      "success",
    );
    const partial = spawnSync(
      process.execPath,
      [SCRIPT, "finalize", "--run", partialRun],
      { cwd: ROOT, encoding: "utf8", env },
    );
    assert.equal(JSON.parse(partial.stdout).status, "partial");
    const reconciled = new AdminRepository({ databasePath: adminDatabasePath });
    assert.equal(
      reconciled.getVenueReview(staleReview.reviewId).status,
      "superseded",
    );
    reconciled.close();
    const partialStatus = JSON.parse(
      readFileSync(join(outputRoot, partialRun, "status.json"), "utf8"),
    );
    assert.deepEqual(partialStatus.adminReviewReconciliation, {
      activeVenueIds: [],
      superseded: 1,
      pending: 0,
      deferred: 0,
      reconciledAt: partialStatus.adminReviewReconciliation.reconciledAt,
    });
    const blockedRun = makeRun(
      {
        "Catch.sg": { status: "blocked", error: "Unavailable" },
        SISTIC: { status: "failed", error: "Failed" },
      },
      "failed",
    );
    const blocked = spawnSync(
      process.execPath,
      [SCRIPT, "finalize", "--run", blockedRun],
      { cwd: ROOT, encoding: "utf8", env },
    );
    assert.equal(JSON.parse(blocked.stdout).status, "failed");
  } finally {
    rmSync(outputRoot, { recursive: true, force: true });
  }
});

test("CLI staged frontend applies expiry even when a successful snapshot has no venues", () => {
  const outputRoot = resolve(tmpdir(), `event-pipeline-expiry-${process.pid}`),
    frontendRoot = join(outputRoot, "frontend-root");
  const currentPoisPath = join(outputRoot, "current-pois.json"),
    currentLandmarksPath = join(outputRoot, "current-landmarks.json");
  mkdirSync(join(frontendRoot, "data"), { recursive: true });
  writeFileSync(currentPoisPath, JSON.stringify({ records: [] }));
  writeFileSync(
    currentLandmarksPath,
    JSON.stringify({
      records: [
        {
          id: "expired",
          label: "Expired",
          anchor: { lng: 103.85, lat: 1.29 },
          events: [{ id: "old", dateText: "1 Jan 2020" }],
        },
      ],
    }),
  );
  writeFileSync(
    join(frontendRoot, "data/approved-pois.js"),
    "export const APPROVED_POIS = [];\n",
  );
  writeFileSync(join(frontendRoot, "data/approved-landmarks.js"), "old\n");
  const env = {
    ...process.env,
    EVENT_PIPELINE_OUTPUT_ROOT: outputRoot,
    EVENT_PIPELINE_FRONTEND_ROOT: frontendRoot,
    EVENT_PIPELINE_CURRENT_POIS: currentPoisPath,
    EVENT_PIPELINE_CURRENT_LANDMARKS: currentLandmarksPath,
  };
  const started = spawnSync(
    process.execPath,
    [SCRIPT, "start", "--date", "2026-07-11"],
    { cwd: ROOT, encoding: "utf8", env },
  );
  const { runId } = JSON.parse(started.stdout),
    runDir = join(outputRoot, runId),
    statePath = join(runDir, "orchestrator-state.json");
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  for (const source of Object.values(state.sources)) source.status = "success";
  state.normalization = {
    status: "success",
    counts: { eligiblePreDedup: 0, duplicateCollapsed: 0, acceptedPrimary: 0 },
    artifactRefs: [],
    venueBranches: [],
    error: null,
  };
  state.resolutionPreparation = {
    status: "success",
    artifactRefs: [],
    error: null,
  };
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  mkdirSync(join(runDir, "normalized"), { recursive: true });
  writeFileSync(
    join(runDir, "normalized/events.json"),
    JSON.stringify({ records: [] }),
  );
  try {
    const staged = spawnSync(
      process.execPath,
      [SCRIPT, "advance", "--run", runId],
      { cwd: ROOT, encoding: "utf8", env, timeout: 180000 },
    );
    assert.equal(staged.status, 0, staged.stderr);
    const response = JSON.parse(staged.stdout);
    assert.equal(response.complete, true);
    const verification = JSON.parse(
      readFileSync(join(runDir, "verification.json"), "utf8"),
    );
    assert.equal(
      response.status,
      "success",
      `${JSON.stringify(verification, null, 2)}\n${staged.stdout}\n${staged.stderr}`,
    );
    const plan = JSON.parse(
      readFileSync(join(runDir, "frontend/plan.json"), "utf8"),
    );
    assert.deepEqual(plan.expiry.removedLandmarkIds, ["expired"]);
    assert.equal(
      readFileSync(join(frontendRoot, "data/approved-landmarks.js"), "utf8"),
      "old\n",
    );
    const active = loadApprovedSnapshot({ root: frontendRoot });
    assert.deepEqual(
      JSON.parse(
        readFileSync(join(active.directory, active.landmarksRef), "utf8"),
      ),
      [],
    );
  } finally {
    rmSync(outputRoot, { recursive: true, force: true });
  }
});

test("CLI frontend planner classifies unchanged geometry and events as no-op", () => {
  const outputRoot = resolve(tmpdir(), `event-pipeline-noop-${process.pid}`);
  const currentPoisPath = join(outputRoot, "current-pois.json"),
    currentLandmarksPath = join(outputRoot, "current-landmarks.json");
  const event = {
    id: "event-a",
    occurrenceId: "event-a",
    identityAnchor: "event-a",
    publishedEventId: "event-a",
    title: "Show",
    venue: "Hall",
    dateText: "12 Jul 2026",
    coordinates: { lng: 103.85, lat: 1.29 },
    venueVerified: true,
    publicPlacement: "mapped",
    mappingStatus: "approved",
    lifecycleState: "active",
    sources: [],
  };
  const poi = {
    id: "hall",
    label: "HALL",
    data: "poi-tiles/hall/tileset.json",
    names: ["HALL"],
    tiles: {},
  };
  const landmark = {
    id: "hall",
    label: "Hall",
    anchor: { lng: 103.85, lat: 1.29 },
    events: [event],
  };
  mkdirSync(outputRoot, { recursive: true });
  writeFileSync(currentPoisPath, JSON.stringify({ records: [poi] }));
  writeFileSync(currentLandmarksPath, JSON.stringify({ records: [landmark] }));
  const env = {
    ...process.env,
    EVENT_PIPELINE_OUTPUT_ROOT: outputRoot,
    EVENT_PIPELINE_CURRENT_POIS: currentPoisPath,
    EVENT_PIPELINE_CURRENT_LANDMARKS: currentLandmarksPath,
  };
  const started = spawnSync(
    process.execPath,
    [SCRIPT, "start", "--date", "2026-07-11"],
    { cwd: ROOT, encoding: "utf8", env },
  );
  const { runId } = JSON.parse(started.stdout),
    runDir = join(outputRoot, runId),
    statePath = join(runDir, "orchestrator-state.json");
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  state.normalization = {
    status: "success",
    counts: { eligiblePreDedup: 1, duplicateCollapsed: 0, acceptedPrimary: 1 },
    artifactRefs: [],
    venueBranches: [],
    error: null,
  };
  state.resolutionPreparation = {
    status: "success",
    artifactRefs: [],
    error: null,
  };
  state.venues = {
    "venue-a": {
      venue: "Hall",
      eventIds: ["event-a"],
      stages: {
        resolve: {
          status: "success",
          outputRef: "stages/venue-a/resolve.json",
        },
        highlight: { status: "pending" },
        pill: { status: "pending" },
        panel: { status: "pending" },
      },
    },
  };
  mkdirSync(join(runDir, "normalized"), { recursive: true });
  mkdirSync(join(runDir, "stages/venue-a"), { recursive: true });
  writeFileSync(
    join(runDir, "normalized/events.json"),
    JSON.stringify({
      records: [{ ...event, coordinates: null, venueVerified: false }],
    }),
  );
  writeFileSync(
    join(runDir, "stages/venue-a/resolve.json"),
    JSON.stringify({
      result: {
        resolutionStatus: "approved",
        poiId: "hall",
        canonicalVenue: "Hall",
        acceptedGmlNames: ["HALL"],
        coordinates: landmark.anchor,
        sourceTiles: [],
        inputEventIds: ["event-a"],
      },
    }),
  );
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  try {
    const planned = spawnSync(
      process.execPath,
      [SCRIPT, "plan-frontend", "--run", runId],
      { cwd: ROOT, encoding: "utf8", env },
    );
    assert.equal(planned.status, 0, planned.stderr);
    assert.deepEqual(JSON.parse(planned.stdout).classifications[0], {
      poiId: "hall",
      venueIds: ["venue-a"],
      eventIds: ["event-a"],
      highlightAction: "noop",
      pillAction: "noop",
      panelAction: "noop",
      canonicalVenue: "Hall",
      anchor: landmark.anchor,
    });
  } finally {
    rmSync(outputRoot, { recursive: true, force: true });
  }
});

test("CLI reuses unchanged unresolved venue evidence without agent research", () => {
  const outputRoot = resolve(tmpdir(), `event-pipeline-cache-${process.pid}`),
    cachePath = join(outputRoot, "resolution-cache.json");
  const env = {
    ...process.env,
    EVENT_PIPELINE_OUTPUT_ROOT: outputRoot,
    EVENT_PIPELINE_RESOLUTION_CACHE: cachePath,
  };
  const started = spawnSync(
    process.execPath,
    [SCRIPT, "start", "--date", "2026-07-11"],
    { cwd: ROOT, encoding: "utf8", env },
  );
  const { runId } = JSON.parse(started.stdout),
    runDir = join(outputRoot, runId),
    statePath = join(runDir, "orchestrator-state.json");
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  for (const source of Object.values(state.sources)) source.status = "success";
  state.normalization = {
    status: "success",
    counts: {},
    artifactRefs: [],
    venueBranches: [],
    error: null,
  };
  state.resolutionPreparation = {
    status: "success",
    artifactRefs: [],
    error: null,
  };
  state.venues = {
    "venue-a": {
      venue: "Moving Venue",
      eventIds: ["event-a"],
      stages: Object.fromEntries(
        ["resolve", "highlight", "pill", "panel"].map((stage) => [
          stage,
          { status: "pending", outputRef: null, error: null },
        ]),
      ),
    },
  };
  mkdirSync(join(runDir, "normalized"), { recursive: true });
  writeFileSync(
    join(runDir, "normalized/events.json"),
    JSON.stringify({
      records: [
        { id: "event-a", address: null, coordinates: null, sources: [] },
      ],
    }),
  );
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  const evidenceHash = branchEvidenceHash(runDir, state.venues["venue-a"]);
  const result = {
    resolutionStatus: "not_mappable",
    inputEventIds: ["old-id"],
    evidenceInspected: ["official schedule"],
    finalReason: "Venue moves",
    cacheKey: "moving venue",
    evidenceHash,
    notMappableEvidence: {
      reasonCode: "mobile_venue",
      sourceUrls: ["https://example.com/official"],
    },
  };
  writeFileSync(
    cachePath,
    JSON.stringify({
      schemaVersion: "1.0",
      entries: [
        {
          normalizedVenue: "moving venue",
          cacheKey: "moving venue",
          evidenceHash,
          status: "not_mappable",
          result,
        },
      ],
    }),
  );
  try {
    const reused = spawnSync(
      process.execPath,
      [SCRIPT, "reuse-resolution-cache", "--run", runId],
      { cwd: ROOT, encoding: "utf8", env },
    );
    assert.equal(reused.status, 3, reused.stderr);
    assert.equal(JSON.parse(reused.stdout).reused, 1);
    const nextState = JSON.parse(readFileSync(statePath, "utf8"));
    assert.equal(
      nextState.venues["venue-a"].stages.resolve.status,
      "unresolved",
    );
    assert.equal(
      nextState.venues["venue-a"].stages.highlight.status,
      "skipped",
    );
  } finally {
    rmSync(outputRoot, { recursive: true, force: true });
  }
});

test("CLI advance consumes a saved venue recovery checkpoint without repeating web research", () => {
  const outputRoot = resolve(
    tmpdir(),
    `event-pipeline-saved-recovery-${process.pid}`,
  );
  const cachePath = join(outputRoot, "resolution-cache.json");
  const aliasPath = join(outputRoot, "alias-registry.json");
  const env = {
    ...process.env,
    EVENT_PIPELINE_OUTPUT_ROOT: outputRoot,
    EVENT_PIPELINE_RESOLUTION_CACHE: cachePath,
    EVENT_PIPELINE_ALIAS_REGISTRY: aliasPath,
  };
  mkdirSync(outputRoot, { recursive: true });
  writeFileSync(
    cachePath,
    JSON.stringify({ schemaVersion: "1.0", entries: [] }),
  );
  writeFileSync(
    aliasPath,
    JSON.stringify({ schemaVersion: "1.0", entries: [] }),
  );
  const started = spawnSync(
    process.execPath,
    [SCRIPT, "start", "--date", "2026-07-11"],
    { cwd: ROOT, encoding: "utf8", env },
  );
  const { runId } = JSON.parse(started.stdout),
    runDir = join(outputRoot, runId),
    statePath = join(runDir, "orchestrator-state.json");
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  for (const source of Object.values(state.sources)) source.status = "success";
  state.normalization = {
    status: "success",
    counts: {},
    artifactRefs: [],
    venueBranches: [],
    error: null,
  };
  state.resolutionPreparation = {
    status: "success",
    artifactRefs: [],
    error: null,
  };
  state.venues = {
    "venue-a": {
      venue: "Ambiguous Hall",
      eventIds: ["event-a"],
      stages: Object.fromEntries(
        ["resolve", "highlight", "pill", "panel"].map((stage) => [
          stage,
          { status: "pending", outputRef: null, error: null },
        ]),
      ),
    },
    "venue-b": {
      venue: "Next Hall",
      eventIds: ["event-b"],
      stages: Object.fromEntries(
        ["resolve", "highlight", "pill", "panel"].map((stage) => [
          stage,
          { status: "pending", outputRef: null, error: null },
        ]),
      ),
    },
  };
  mkdirSync(join(runDir, "normalized"), { recursive: true });
  writeFileSync(
    join(runDir, "normalized/events.json"),
    JSON.stringify({
      records: [
        {
          id: "event-a",
          title: "Show",
          venue: "Ambiguous Hall",
          dateText: null,
          address: null,
          coordinates: null,
          sources: [],
        },
        {
          id: "event-b",
          title: "Next show",
          venue: "Next Hall",
          dateText: null,
          address: null,
          coordinates: null,
          sources: [],
        },
      ],
    }),
  );
  const evidenceInspected = [
    {
      sourceType: "venue_official",
      label: "Official venue",
      url: "https://venue.example/address",
      query: "official address",
      checkedAt: "2026-07-13T00:00:00Z",
      outcome: "Address found but building part is ambiguous",
    },
    {
      sourceType: "host_or_authority",
      label: "Official host",
      url: "https://host.example/event",
      query: "event venue",
      checkedAt: "2026-07-13T00:01:00Z",
      outcome: "Host confirms the same complex",
    },
  ];
  writeFileSync(
    join(runDir, "normalized/venue-recovery-evidence.json"),
    JSON.stringify({
      schemaVersion: "1.0",
      runId,
      records: [
        {
          venueId: "venue-a",
          venue: "Ambiguous Hall",
          addressCandidates: ["1 Test Road, Singapore 123456"],
          postalCodes: ["123456"],
          coordinateCandidates: [],
          evidenceInspected,
        },
      ],
    }),
  );
  writeFileSync(
    join(runDir, "local-venue-resolution.json"),
    JSON.stringify({
      results: [
        {
          venueId: "venue-a",
          venue: "Ambiguous Hall",
          eventIds: ["event-a"],
          status: "needs_review",
          reason: "Two building parts remain",
          alternatives: [],
        },
        {
          venueId: "venue-b",
          venue: "Next Hall",
          eventIds: ["event-b"],
          status: "not_found",
          reason: "No local candidate",
          alternatives: [],
        },
      ],
    }),
  );
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  try {
    const advanced = spawnSync(
      process.execPath,
      [SCRIPT, "advance", "--run", runId],
      { cwd: ROOT, encoding: "utf8", env, timeout: 30000 },
    );
    assert.notEqual(advanced.status, null, advanced.error?.message);
    const response = JSON.parse(advanced.stdout);
    assert.equal(response.intervention.type, "ambiguous_venue");
    assert.equal(response.intervention.venue, "venue-b");
    assert.equal(
      response.intervention.notMappableContract.sourceUrlsRequired,
      true,
    );
    assert.match(
      response.intervention.notMappableContract.sourceUrlsFormat,
      /URL strings/,
    );
    assert.deepEqual(
      Object.keys(response.intervention.recoveryFieldFormats).sort(),
      [
        "addressCandidates",
        "coordinateCandidates",
        "evidenceInspected",
        "notMappableEvidence",
        "postalCodes",
      ],
    );
    assert.deepEqual(
      response.intervention.recoveryFieldFormats.coordinateCandidates[0],
      {
        lat: 1.3,
        lng: 103.8,
        source: "venue_official",
        recordRef: "https://actual-inspected-page.example/path",
        evidenceField: "Published map pin",
      },
    );
    assert.match(
      response.intervention.notMappableContract.selectionRule,
      /fixed building start, pickup, or meeting point/,
    );
    assert.deepEqual(
      Object.keys(response.intervention.notMappableContract.reasons).sort(),
      [
        "mobile_venue",
        "multi_venue",
        "no_target_building",
        "outside_singapore",
      ],
    );
    const recoveryContext = JSON.parse(
      readFileSync(resolve(ROOT, response.intervention.evidenceBundle), "utf8"),
    );
    assert.deepEqual(
      recoveryContext.notMappableContract,
      response.intervention.notMappableContract,
    );
    assert.deepEqual(
      recoveryContext.recoveryFieldFormats,
      response.intervention.recoveryFieldFormats,
    );
    const nextState = JSON.parse(readFileSync(statePath, "utf8"));
    assert.equal(
      nextState.venues["venue-a"].stages.resolve.status,
      "unresolved",
    );
    assert.equal(
      nextState.venues["venue-a"].stages.highlight.status,
      "skipped",
    );
    const result = JSON.parse(
      readFileSync(join(runDir, "stages/venue-a/resolve.json"), "utf8"),
    );
    assert.equal(
      result.result.recoveryEvidenceRef,
      "normalized/venue-recovery-evidence.json#/records/0",
    );
  } finally {
    rmSync(outputRoot, { recursive: true, force: true });
  }
});

test("branch evidence hash changes only when saved source coordinates are added", () => {
  const runDir = resolve(
    tmpdir(),
    `event-pipeline-coordinate-hash-${process.pid}-${Date.now()}`,
  );
  mkdirSync(join(runDir, "normalized"), { recursive: true });
  const venue = { venue: "Hall", eventIds: ["event-a"] };
  writeFileSync(
    join(runDir, "normalized/events.json"),
    JSON.stringify({
      records: [
        {
          id: "event-a",
          address: null,
          coordinates: null,
          sources: [
            {
              source: "SISTIC",
              recordRef: "raw/sistic/details/a.json#/records/0",
            },
          ],
        },
      ],
    }),
  );
  try {
    const withoutCoordinates = branchEvidenceHash(runDir, venue);
    writeFileSync(
      join(runDir, "normalized/location-enrichment.json"),
      JSON.stringify({
        records: [
          {
            eventId: "event-a",
            coordinateCandidates: [],
          },
        ],
      }),
    );
    assert.equal(branchEvidenceHash(runDir, venue), withoutCoordinates);
    writeFileSync(
      join(runDir, "normalized/location-enrichment.json"),
      JSON.stringify({
        records: [
          {
            eventId: "event-a",
            coordinateCandidates: [
              {
                lat: 1.3001,
                lng: 103.8002,
                source: "SISTIC",
                recordRef: "raw/sistic/details/a.json#/records/0",
              },
            ],
          },
        ],
      }),
    );
    const withCoordinates = branchEvidenceHash(runDir, venue);
    assert.notEqual(withCoordinates, withoutCoordinates);
    writeFileSync(
      join(runDir, "normalized/venue-recovery-evidence.json"),
      JSON.stringify({
        records: [
          {
            venueId: "venue-a",
            venue: "Hall",
            addressCandidates: ["1 Test Road, Singapore 123456"],
            postalCodes: ["123456"],
            coordinateCandidates: [],
            evidenceInspected: [
              {
                sourceType: "venue_official",
                label: "Contact",
                url: "https://hall.example/contact",
                checkedAt: "2026-07-13T00:00:00Z",
              },
            ],
          },
        ],
      }),
    );
    const withRecovery = branchEvidenceHash(runDir, venue);
    assert.notEqual(withRecovery, withCoordinates);
    const envelope = JSON.parse(
      readFileSync(
        join(runDir, "normalized/venue-recovery-evidence.json"),
        "utf8",
      ),
    );
    envelope.records[0].evidenceInspected[0].checkedAt = "2026-07-14T00:00:00Z";
    writeFileSync(
      join(runDir, "normalized/venue-recovery-evidence.json"),
      JSON.stringify(envelope),
    );
    assert.equal(branchEvidenceHash(runDir, venue), withRecovery);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("venue recovery checkpoint accepts authoritative location evidence and rejects search pages", () => {
  const evidenceInspected = [
    {
      sourceType: "venue_official",
      label: "Official contact",
      url: "https://hall.example/contact",
      query: "Hall official address",
      checkedAt: "2026-07-13T00:00:00Z",
      outcome: "Address confirmed",
    },
    {
      sourceType: "host_or_authority",
      label: "Host listing",
      url: "https://host.example/hall",
      query: "Hall host address",
      checkedAt: "2026-07-13T00:01:00Z",
      outcome: "Host confirms venue",
    },
  ];
  assert.deepEqual(
    validateVenueRecoveryEvidence(
      {
        schemaVersion: "1.0",
        venue: "Hall",
        addressCandidates: ["1 Test Road, Singapore 123456"],
        postalCodes: ["123456"],
        evidenceInspected,
      },
      "Hall",
    ),
    {
      addressCandidates: ["1 Test Road, Singapore 123456"],
      postalCodes: ["123456"],
      coordinateCandidates: [],
      evidenceInspected,
      notMappableEvidence: null,
    },
  );
  assert.deepEqual(
    validateVenueRecoveryEvidence(
      {
        schemaVersion: "1.0",
        venue: "Hall",
        addressCandidates: [
          {
            address: "1 Test Road, Singapore 123456",
            source: "venue_official",
            url: "https://hall.example/contact",
          },
        ],
        postalCodes: [],
        evidenceInspected,
      },
      "Hall",
    ).addressCandidates,
    ["1 Test Road, Singapore 123456"],
  );
  assert.throws(
    () =>
      validateVenueRecoveryEvidence(
        {
          schemaVersion: "1.0",
          addressCandidates: [],
          postalCodes: [],
          evidenceInspected: [
            {
              ...evidenceInspected[0],
              label: "Search",
              url: "https://www.google.com/search?q=hall",
            },
            evidenceInspected[1],
          ],
        },
        "Hall",
      ),
    /search-result URL/,
  );
  assert.throws(
    () =>
      validateVenueRecoveryEvidence(
        {
          schemaVersion: "1.0",
          addressCandidates: [],
          postalCodes: [],
          evidenceInspected: [
            {
              ...evidenceInspected[0],
              url: "https://www.catch.sg/Event/example",
            },
            evidenceInspected[1],
          ],
        },
        "Hall",
      ),
    /must use sourceType host_or_authority/,
  );
  assert.throws(
    () =>
      validateVenueRecoveryEvidence(
        {
          schemaVersion: "1.0",
          addressCandidates: [],
          postalCodes: [],
          evidenceInspected: [
            {
              ...evidenceInspected[0],
              url: "https://www.sgculturepass.gov.sg/events/example",
            },
            evidenceInspected[1],
          ],
        },
        "Hall",
      ),
    /must use sourceType host_or_authority/,
  );
  assert.throws(
    () =>
      validateVenueRecoveryEvidence(
        {
          schemaVersion: "1.0",
          venue: "Hall",
          addressCandidates: [],
          postalCodes: [],
          evidenceInspected: [
            {
              ...evidenceInspected[0],
              outcome: "The page exposed no map pin.",
            },
            evidenceInspected[1],
          ],
          coordinateCandidates: [
            {
              lat: 1.3,
              lng: 103.8,
              source: "venue_official",
              recordRef: evidenceInspected[0].url,
              evidenceField: "OneMap geocode result",
            },
          ],
        },
        "Hall",
      ),
    /cannot be used as the coordinate recordRef/,
  );
  const officialAddressEvidence = [
    {
      ...evidenceInspected[0],
      outcome: "The official address is 1 Correct Road, Singapore 038981.",
    },
    evidenceInspected[1],
  ];
  assert.throws(
    () =>
      validateVenueRecoveryEvidence(
        {
          schemaVersion: "1.0",
          venue: "Hall",
          addressCandidates: ["100 Wrong Street, Singapore 188064"],
          postalCodes: ["188064"],
          evidenceInspected: officialAddressEvidence,
        },
        "Hall",
      ),
    /conflict with the venue-official evidence \(038981\)/,
  );
  assert.throws(
    () =>
      validateVenueRecoveryEvidence(
        {
          schemaVersion: "1.0",
          addressCandidates: [],
          postalCodes: [],
          evidenceInspected: [evidenceInspected[0]],
        },
        "Hall",
      ),
    /both venue-official and host\/authority/,
  );
  assert.throws(
    () =>
      validateVenueRecoveryEvidence(
        {
          schemaVersion: "1.0",
          venue: "Hall",
          addressCandidates: [],
          postalCodes: [],
          evidenceInspected,
          verifiedAddress: "1 Test Road, Singapore 123456",
        },
        "Hall",
      ),
    /unsupported fields: verifiedAddress/,
  );
  assert.throws(
    () =>
      validateVenueRecoveryEvidence(
        {
          schemaVersion: "1.0",
          venue: "Unknown",
          coordinateCandidates: [{ lat: 0, lng: 0 }],
          evidenceInspected,
        },
        "Unknown",
      ),
    /within Singapore/,
  );
  const outsideSingapore = {
    reasonCode: "outside_singapore",
    sourceUrls: [
      "https://venue.example/malaysia",
      "https://host.example/event",
    ],
  };
  assert.deepEqual(
    validateVenueRecoveryEvidence(
      {
        schemaVersion: "1.0",
        venue: "Tour",
        addressCandidates: [],
        postalCodes: [],
        evidenceInspected,
        notMappableEvidence: {
          reasonCode: "multi_venue",
          sourceUrls: [
            { label: "Official event", url: "https://host.example/tour" },
          ],
        },
      },
      "Tour",
    ).notMappableEvidence,
    {
      reasonCode: "multi_venue",
      sourceUrls: ["https://host.example/tour"],
    },
  );
  assert.deepEqual(
    validateVenueRecoveryEvidence(
      {
        schemaVersion: "1.0",
        venue: "Johor Venue",
        addressCandidates: ["Lotus’s Bukit Indah, Johor Bahru, Malaysia 81200"],
        postalCodes: ["81200"],
        coordinateCandidates: [{ lat: 1.482536, lng: 103.66271 }],
        evidenceInspected,
        notMappableEvidence: outsideSingapore,
      },
      "Johor Venue",
    ),
    {
      addressCandidates: ["Lotus’s Bukit Indah, Johor Bahru, Malaysia 81200"],
      postalCodes: ["81200"],
      coordinateCandidates: [
        {
          lat: 1.482536,
          lng: 103.66271,
          source: "authoritative_web_recovery",
          recordRef: null,
          evidenceField: "authoritative venue recovery evidence",
        },
      ],
      evidenceInspected,
      notMappableEvidence: outsideSingapore,
    },
  );
  assert.deepEqual(
    validateVenueRecoveryEvidence(
      {
        schemaVersion: "1.0",
        venue: "Hall",
        addressCandidates: [],
        postalCodes: [],
        evidenceInspected,
        coordinateCandidates: [
          {
            sourceType: "venue_official",
            label: "Published directions",
            url: "https://maps.google.com/?daddr=1.2831334,103.7882094",
          },
        ],
      },
      "Hall",
    ).coordinateCandidates,
    [
      {
        lat: 1.2831334,
        lng: 103.7882094,
        source: "venue_official",
        recordRef: "https://maps.google.com/?daddr=1.2831334,103.7882094",
        evidenceField: "Published directions",
      },
    ],
  );
  const mapUrl =
    "https://www.google.com/maps/place/Hall/@1.283,103.78/data=!3d1.2831334!4d103.7882094";
  const withSupplemental = validateVenueRecoveryEvidence(
    {
      schemaVersion: "1.0",
      venue: "Hall",
      addressCandidates: [],
      postalCodes: [],
      coordinateCandidates: [
        { lat: 1.2831334, lng: 103.7882094, recordRef: mapUrl },
      ],
      evidenceInspected: [
        ...evidenceInspected,
        {
          sourceType: "venue_official",
          label: "Published map pin",
          url: mapUrl,
          query: "map pin",
          checkedAt: "2026-07-13T00:02:00Z",
          outcome: "Pin inspected",
        },
        {
          sourceType: "onemap_geocode",
          label: "Address lookup",
          url: "https://www.onemap.gov.sg/api/common/elastic/search?searchVal=Hall",
          query: "Hall",
          checkedAt: "2026-07-13T00:03:00Z",
          outcome: "Address matched",
        },
      ],
    },
    "Hall",
  );
  assert.equal(withSupplemental.evidenceInspected.length, 2);
  assert.equal(withSupplemental.supplementalEvidence.length, 2);
  const withAddressLookup = validateVenueRecoveryEvidence(
    {
      schemaVersion: "1.0",
      venue: "Hall",
      addressCandidates: [],
      postalCodes: [],
      coordinateCandidates: [],
      evidenceInspected: [
        ...evidenceInspected,
        {
          sourceType: "address_lookup",
          label: "OneMap lookup",
          url: "https://www.onemap.gov.sg/api/common/elastic/search?searchVal=123456",
          query: "123456",
          checkedAt: "2026-07-13T00:04:00Z",
          outcome: "No unique coordinate was available",
        },
      ],
    },
    "Hall",
  );
  assert.equal(withAddressLookup.supplementalEvidence.length, 1);
  const withAddressAuthority = validateVenueRecoveryEvidence(
    {
      schemaVersion: "1.0",
      venue: "Hall",
      addressCandidates: ["100 Test Street"],
      postalCodes: [],
      coordinateCandidates: [],
      evidenceInspected: [
        ...evidenceInspected,
        {
          sourceType: "address_authority",
          label: "Government address page",
          url: "https://authority.example/building",
          query: "building address",
          checkedAt: "2026-07-13T00:05:00Z",
          outcome: "Address confirmed",
        },
      ],
    },
    "Hall",
  );
  assert.equal(withAddressAuthority.supplementalEvidence.length, 1);
});

test("recovery wording may reject a building footprint without denying the page map pin", () => {
  const evidence = {
    schemaVersion: "1.0",
    venue: "Expo Hall 10",
    addressCandidates: ["1 Expo Drive Singapore 486150"],
    postalCodes: ["486150"],
    coordinateCandidates: [
      {
        lat: 1.333,
        lng: 103.96,
        source: "venue_official_map",
        recordRef: "https://venue.example/map",
        evidenceField: "official map pin",
      },
    ],
    evidenceInspected: [
      {
        sourceType: "venue_official",
        label: "Venue",
        url: "https://venue.example/map",
        query: "hall 10 map",
        outcome:
          "Official pin exists, but no Hall 10 footprint exists at this pin.",
        checkedAt: "2026-07-18T00:00:00Z",
      },
      {
        sourceType: "host_or_authority",
        label: "Host",
        url: "https://host.example/event",
        query: "event venue",
        outcome: "Lists Expo Hall 10 at 1 Expo Drive Singapore 486150.",
        checkedAt: "2026-07-18T00:00:00Z",
      },
    ],
  };
  assert.doesNotThrow(() =>
    validateVenueRecoveryEvidence(evidence, "Expo Hall 10"),
  );
});

test("venue recovery surfaces an address buried late in saved provider HTML", () => {
  const padding = "<li>Workshop material and admission guidance.</li>".repeat(
    40,
  );
  const clues = collectLocationClues(
    `<ul>${padding}<li>My Art Space@Istana Park. Address 31 Orchard Road, Singapore 238888.</li></ul>`,
  );
  assert.equal(clues.length, 1);
  assert.match(clues[0], /31 Orchard Road, Singapore 238888/);
  assert.ok(clues[0].length < 701);
});

test("saved provider starting-point text becomes structured address evidence", () => {
  assert.deepEqual(
    extractAddressEvidence(
      "Location: Fort Canning, Clarke Quay. Starting point: ONALU Bagel Haús: 60 Stamford Rd, #01-11, Singapore 178900 (last session 4:30 p.m.)",
    ),
    {
      postalCodes: ["178900"],
      addressCandidates: [
        "ONALU Bagel Haús: 60 Stamford Rd, #01-11, Singapore 178900",
      ],
      units: ["#01-11"],
    },
  );
});

test("venue recovery surfaces provider-supplied operator and booking pages", () => {
  assert.deepEqual(
    collectOfficialCandidatePages({
      BookingUrl: "https://operator.example/book",
      ContactDetails: { EventWebsite: "https://operator.example/" },
      ImageUrl: "https://cdn.example/image.jpg",
      Description: "https://untrusted.example/",
    }),
    [
      { label: "BookingUrl", url: "https://operator.example/book" },
      {
        label: "ContactDetails.EventWebsite",
        url: "https://operator.example/",
      },
    ],
  );
});

test("bounded web evidence extracts redirect coordinates and targeted content without returning page bodies", () => {
  assert.equal(shouldRetryStatus(429), true);
  assert.equal(shouldRetryStatus(503), true);
  assert.equal(shouldRetryStatus(404), false);
  assert.equal(
    shopifyProductJsonUrl(
      "https://shop.example/collections/games/products/test-item?variant=1",
    ),
    "https://shop.example/products/test-item.js",
  );
  assert.deepEqual(
    extractCoordinates(
      "https://www.google.com/maps/place/Test/@1.3121245,103.7971943,17z",
    ),
    [{ lat: 1.3121245, lng: 103.7971943, source: "map_url" }],
  );
  assert.deepEqual(
    extractCoordinates(
      "https://maps.google.com/?saddr=Current+Location&daddr=1.2831334,103.7882094&mode=driving",
    ),
    [{ lat: 1.2831334, lng: 103.7882094, source: "map_url" }],
  );
  assert.deepEqual(
    extractCoordinates(
      "https://www.google.com/maps/place/Test/@1.3030687,103.8458166,17z/data=!3d1.3030687!4d103.8483915",
    ),
    [{ lat: 1.3030687, lng: 103.8483915, source: "map_place_pin" }],
  );
  const evidence = extractEvidenceFromBody({
    body:
      '<html><head><title>Venue</title><meta property="og:description" content="Starting point: Test Hall, 1 Test Road"></head><body>' +
      "noise ".repeat(5_000) +
      "</body></html>",
    contentType: "text/html",
    finalUrl: "https://example.com/venue/@1.3001,103.8002,17z",
    terms: ["Starting point", "missing"],
  });
  assert.equal(evidence.metadata.title, "Venue");
  assert.equal(evidence.matches.length, 1);
  assert.ok(evidence.matches[0].snippet.length <= 320);
  assert.deepEqual(evidence.coordinates[0], {
    lat: 1.3001,
    lng: 103.8002,
    source: "map_url",
  });
  assert.equal("body" in evidence, false);
  assert.deepEqual(
    extractRelevantLinks(
      '<a href="https://maps.app.goo.gl/test">Starting point</a><a href="/contact">Contact Us</a><a href="/about">About</a>',
      "https://venue.example/event",
    ),
    [
      { label: "Starting point", url: "https://maps.app.goo.gl/test" },
      { label: "Contact Us", url: "https://venue.example/contact" },
    ],
  );
});

test("OneMap geocode adapter returns only bounded location fields", () => {
  assert.deepEqual(searchQueries("44 Jln Merah Saga #01-42 Singapore 278116"), [
    "44 Jln Merah Saga #01-42 Singapore 278116",
    "44 Jln Merah Saga Singapore 278116",
    "278116",
  ]);
  assert.deepEqual(
    normalizeOneMapResults({
      found: 1,
      totalNumPages: 1,
      results: [
        {
          SEARCHVAL: "TEST HALL",
          ADDRESS: "1 TEST ROAD TEST HALL SINGAPORE 123456",
          POSTAL: "123456",
          LATITUDE: "1.3001",
          LONGITUDE: "103.8002",
          UNRELATED: "ignored",
        },
      ],
    }),
    {
      found: 1,
      totalNumPages: 1,
      results: [
        {
          searchValue: "TEST HALL",
          address: "1 TEST ROAD TEST HALL SINGAPORE 123456",
          postalCode: "123456",
          latitude: 1.3001,
          longitude: 103.8002,
        },
      ],
    },
  );
  const school = {
    searchValue: "SINGAPORE MANAGEMENT UNIVERSITY (SCHOOL OF ACCOUNTANCY)",
    address:
      "60 STAMFORD ROAD SINGAPORE MANAGEMENT UNIVERSITY (SCHOOL OF ACCOUNTANCY) SINGAPORE 178900",
    postalCode: "178900",
    latitude: 1.29567,
    longitude: 103.84992,
  };
  assert.equal(
    selectDeterministicOneMapAddress(
      "ONALU Bagel Haús: 60 Stamford Rd, #01-11, Singapore 178900",
      { results: [school] },
    ),
    school,
  );
  assert.equal(
    selectDeterministicOneMapAddress("Tenant, Singapore 178900", {
      results: [
        school,
        {
          ...school,
          searchValue: "OTHER",
          address: "OTHER SINGAPORE 178900",
          latitude: 1.2962,
        },
      ],
    }),
    null,
  );
  const visitorCentre = {
    searchValue: "CHINATOWN VISITOR CENTRE",
    address: "2 BANDA STREET CHINATOWN VISITOR CENTRE SINGAPORE 059962",
    postalCode: "059962",
    latitude: 1.28166,
    longitude: 103.84362,
  };
  const historyCentre = {
    searchValue: "CHINATOWN SINGAPORE: HISTORY & CULTURE",
    address:
      "2 BANDA STREET CHINATOWN SINGAPORE: HISTORY & CULTURE SINGAPORE 059962",
    postalCode: "059962",
    latitude: 1.28179,
    longitude: 103.84381,
  };
  assert.equal(
    selectDeterministicOneMapAddress(
      "Chinatown Visitor Centre, 2 Banda Street, Singapore 059962",
      { results: [historyCentre, visitorCentre] },
    ),
    visitorCentre,
  );
  assert.equal(
    selectDeterministicOneMapAddress(
      "Chinatown Heritage Centre, 2 Banda Street, Singapore 059962",
      { results: [historyCentre, visitorCentre] },
    ),
    null,
  );
  const frankel = {
    searchValue: "FRANKEL ESTATE",
    address: "54 BURNFOOT TERRACE FRANKEL ESTATE SINGAPORE 459839",
    postalCode: "459839",
    latitude: 1.31271337672563,
    longitude: 103.922879517031,
  };
  const kindergarten = {
    searchValue: "ZOO-PHONICS KINDERGARTEN",
    address: "54 BURNFOOT TERRACE ZOO-PHONICS KINDERGARTEN SINGAPORE 459839",
    postalCode: "459839",
    latitude: 1.31271362910669,
    longitude: 103.922879528735,
  };
  assert.equal(
    selectDeterministicOneMapAddress("54 Burnfoot Terrace Singapore 459839", {
      results: [frankel, kindergarten],
    }),
    frankel,
  );
});

test("reviewed recovery evidence replaces contaminated source location clues", () => {
  assert.deepEqual(preferAuthoritativeRecovery(["188064"], [], ["038981"]), [
    "038981",
  ]);
  assert.deepEqual(
    preferAuthoritativeRecovery(["source"], ["deterministic"], []),
    ["deterministic"],
  );
  assert.deepEqual(preferAuthoritativeRecovery(["source"], [], []), ["source"]);
});

test("saved location extraction ignores nearby and recommended carousel records", () => {
  const values = [];
  collectLocationStrings(
    {
      event: { address: "Location: 1 Main Road Singapore 123456" },
      nearbyEvents: [{ address: "KELE, 2 Smith Street Singapore 058917" }],
    },
    values,
  );
  assert.deepEqual(extractAddressEvidence(values).postalCodes, ["123456"]);
});

test("saved location extraction ignores embedded editorial event guides", () => {
  const values = [];
  collectLocationStrings(
    {
      venue_name: { name: "Palawan Green, Sentosa" },
      articles_events: {
        articles: [
          {
            description:
              "Chicken Little at 100 Victoria St, #03-01, Singapore 188064",
          },
        ],
      },
    },
    values,
  );
  assert.deepEqual(values, []);
});

test("saved location extraction truncates flat rendered recommendation carousels", () => {
  const clues = collectLocationClues({
    text: "Location: Pasir Ris Park Carpark A\n\n## Similar experiences\nKELE - 2 Smith Street Singapore 058917",
  });
  assert.doesNotMatch(JSON.stringify(clues), /058917|Smith Street|KELE/i);
});

test("venue recovery fills one unique verified-address host-building coordinate in code", async () => {
  const normalized = {
    addressCandidates: [
      "22 Lock Road #01-34, Gillman Barracks, Singapore 108939",
    ],
    postalCodes: ["108939"],
    coordinateCandidates: [],
    evidenceInspected: [],
    notMappableEvidence: null,
  };
  const result = await enrichRecoveryCoordinates(normalized, async () => ({
    requestUrl: "https://www.onemap.gov.sg/example",
    selectedQuery: "108939",
    results: [
      {
        searchValue: "GILLMAN BARRACKS",
        address: "22 LOCK ROAD GILLMAN BARRACKS SINGAPORE 108939",
        postalCode: "108939",
        latitude: 1.27927637476523,
        longitude: 103.805116656454,
      },
    ],
  }));
  assert.deepEqual(result.coordinateCandidates, [
    {
      lat: 1.27927637476523,
      lng: 103.805116656454,
      source: "onemap_public_exact_address",
      recordRef: "https://www.onemap.gov.sg/example",
      evidenceField: "108939",
    },
  ]);
});

test("an exact OneMap address replaces a conflicting general map pin", async () => {
  const normalized = await enrichRecoveryCoordinates(
    {
      addressCandidates: ["10 Exact Road Singapore 123456"],
      postalCodes: ["123456"],
      coordinateCandidates: [
        { lat: 1.31, lng: 103.81, source: "venue_official_map" },
      ],
      evidenceInspected: [],
      notMappableEvidence: null,
    },
    async () => ({
      requestUrl:
        "https://www.onemap.gov.sg/api/common/elastic/search?searchVal=10%20Exact%20Road",
      selectedQuery: "10 Exact Road Singapore 123456",
      results: [
        {
          address: "10 Exact Road Singapore 123456",
          searchValue: "Exact Building",
          postalCode: "123456",
          latitude: 1.3001,
          longitude: 103.8002,
        },
      ],
    }),
  );
  assert.deepEqual(normalized.coordinateCandidates, [
    {
      lat: 1.3001,
      lng: 103.8002,
      source: "onemap_public_exact_address",
      recordRef:
        "https://www.onemap.gov.sg/api/common/elastic/search?searchVal=10%20Exact%20Road",
      evidenceField: "10 Exact Road Singapore 123456",
    },
  ]);
});

test("venue recovery never turns an MRT exit into a building target", () => {
  const result = classifyNonBuildingRecovery({
    addressCandidates: ["LITTLE INDIA MRT STATION EXIT E"],
    postalCodes: [],
    coordinateCandidates: [{ lat: 1.3074269738977, lng: 103.850319624488 }],
    evidenceInspected: [{ url: "https://host.example/walking-tour" }],
    supplementalEvidence: [
      {
        url: "https://www.onemap.gov.sg/api/common/elastic/search?searchVal=exit",
      },
    ],
    notMappableEvidence: null,
  });
  assert.deepEqual(result.coordinateCandidates, []);
  assert.deepEqual(result.notMappableEvidence, {
    reasonCode: "no_target_building",
    sourceUrls: [
      "https://host.example/walking-tour",
      "https://www.onemap.gov.sg/api/common/elastic/search?searchVal=exit",
    ],
  });
});

test("explicit source Locations lists are deterministic multi-venue evidence", () => {
  const url = "https://host.example/festival";
  assert.deepEqual(
    explicitMultiVenueSourceUrls([
      {
        description:
          "Festival details.<br><br>Locations: CHIJMES Hall, Capitol Theatre, Enabling Village.<br>More details",
        eventUrl: url,
        sources: [{ sourceUrl: url }],
      },
    ]),
    [url],
  );
  assert.deepEqual(
    explicitMultiVenueSourceUrls([
      {
        description: "Location: Enabling Village",
        eventUrl: url,
        sources: [{ sourceUrl: url }],
      },
    ]),
    [],
  );
});

test("provider pin recovery accepts only a clearly nearest OneMap building", () => {
  const providerPlace = { sourceCoordinate: true };
  assert.equal(
    isPreciseProviderPin(
      providerPlace,
      { distanceMeters: 0.4 },
      { distanceMeters: 18.9 },
    ),
    true,
  );
  assert.equal(
    isPreciseProviderPin(
      providerPlace,
      { distanceMeters: 8 },
      { distanceMeters: 68 },
    ),
    true,
  );
  assert.equal(
    isPreciseProviderPin(
      providerPlace,
      { distanceMeters: 1.5 },
      { distanceMeters: 8 },
    ),
    true,
  );
  assert.equal(
    isPreciseProviderPin(
      providerPlace,
      { distanceMeters: 1.5 },
      { distanceMeters: 5.9 },
    ),
    false,
  );
  assert.equal(
    isPreciseProviderPin(
      providerPlace,
      { distanceMeters: 48 },
      { distanceMeters: 59 },
    ),
    false,
  );
  assert.equal(
    isPreciseProviderPin(
      providerPlace,
      { distanceMeters: 56 },
      { distanceMeters: 58 },
    ),
    false,
  );
  assert.equal(
    isPreciseProviderPin({}, { distanceMeters: 8 }, { distanceMeters: 68 }),
    false,
  );
  assert.deepEqual(
    coordinateBuildingChoice(providerPlace, [
      { name: "Name-favored but distant", distanceMeters: 99 },
      { name: "Spatially nearest", distanceMeters: 16 },
      { name: "Adjacent part", distanceMeters: 27 },
    ]),
    {
      building: { name: "Spatially nearest", distanceMeters: 16 },
      precise: false,
    },
  );
  assert.deepEqual(
    consolidateCoordinateCandidates([
      {
        lat: 1.3030551369,
        lng: 103.848506993,
        source: "onemap_public_exact_address",
      },
      { lat: 1.3030687, lng: 103.8483915, source: "venue_official_map_pin" },
    ]),
    [{ lat: 1.3030687, lng: 103.8483915, source: "venue_official_map_pin" }],
  );
  assert.equal(
    consolidateCoordinateCandidates([
      { lat: 1.3, lng: 103.8, source: "venue_official_map_pin" },
      { lat: 1.31, lng: 103.81, source: "onemap_public_exact_address" },
    ]).length,
    2,
  );
});

test("verified address selects one uniquely named nearby host building", () => {
  const claymore = {
    name: "CLAYMORE PLAZA",
    gmlIds: ["claymore"],
    distanceMeters: 24.5,
  };
  const embassy = {
    name: "ROYAL THAI EMBASSY",
    gmlIds: ["embassy"],
    distanceMeters: 42.8,
  };
  assert.equal(
    selectAddressNamedBuilding(
      ["6 Claymore Hill, Claymore Plaza, Singapore 229571"],
      [claymore, embassy],
    ),
    claymore,
  );
  const millenia = {
    name: "MILLENIA WALK",
    gmlIds: ["millenia"],
    distanceMeters: 123.2,
  };
  assert.equal(
    selectAddressNamedBuilding(
      ["Official site lists the cafe at Millenia Walk, 9 Raffles Boulevard."],
      [millenia],
    ),
    millenia,
  );
  const commerze = {
    name: "THE COMMERZE@IRVING",
    gmlIds: ["commerze"],
    distanceMeters: 24,
  };
  assert.equal(
    selectAddressNamedBuilding(
      ["1 Irving Place, Commerze@Irving #05-03, Singapore 369546"],
      [
        commerze,
        { name: "TAI SENG CENTRE", gmlIds: ["tai-seng"], distanceMeters: 62 },
      ],
    ),
    commerze,
  );
  assert.equal(
    selectAddressNamedBuilding(
      ["Sembawang Park, Singapore"],
      [
        { name: "SEMBAWANG PARK", gmlIds: ["a"], distanceMeters: 5 },
        { name: "SEMBAWANG PARK", gmlIds: ["b"], distanceMeters: 8 },
      ],
    ),
    null,
  );
  assert.equal(
    selectAddressNamedBuilding(
      ["Claymore Plaza"],
      [{ ...claymore, distanceMeters: 180 }],
    ),
    null,
  );
});

test("multiple exact-name OneMap identities remain explicit review candidates", () => {
  const candidates = groupExactOneMapRows(
    [
      {
        name: "CENTRE",
        gml_id: "gml-a",
        latitude: 1.3,
        longitude: 103.8,
        tile_path: "public/poi-tiles/source/1_0.b3dm",
        batch_id: 4,
      },
      {
        name: "CENTRE",
        gml_id: "gml-a",
        latitude: 1.3,
        longitude: 103.8,
        tile_path: "tiles/1_1.b3dm",
        batch_id: 4,
      },
      {
        name: "CENTRE",
        gml_id: "gml-b",
        latitude: 1.3001,
        longitude: 103.8001,
        tile_path: "tiles/1_0.b3dm",
        batch_id: 7,
      },
    ],
    (value) => value.replace(/^public\/poi-tiles\/source\//, "tiles/"),
  );
  assert.deepEqual(
    candidates.map((candidate) => candidate.gmlIds),
    [["gml-a"], ["gml-b"]],
  );
  assert.deepEqual(candidates[0].sourceTiles, [
    { tilePath: "tiles/1_0.b3dm", batchIds: [4] },
    { tilePath: "tiles/1_1.b3dm", batchIds: [4] },
  ]);
});

test("stable mobile and multi-venue classifications survive added location evidence", () => {
  const mobile = {
    normalizedVenue: "ship",
    evidenceHash: "old",
    result: { notMappableEvidence: { reasonCode: "mobile_venue" } },
  };
  const multi = {
    normalizedVenue: "tour",
    evidenceHash: "old",
    result: { notMappableEvidence: { reasonCode: "multi_venue" } },
  };
  const ordinary = {
    normalizedVenue: "hall",
    evidenceHash: "old",
    result: { resolutionStatus: "needs_review" },
  };
  const cache = { entries: [mobile, multi, ordinary] };
  assert.equal(reusableResolutionEntry(cache, "ship", "new"), mobile);
  assert.equal(reusableResolutionEntry(cache, "tour", "new"), multi);
  assert.equal(reusableResolutionEntry(cache, "hall", "new"), null);
  assert.equal(reusableResolutionEntry(cache, "hall", "old"), ordinary);
});
