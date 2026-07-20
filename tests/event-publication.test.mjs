import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { activateStagedSnapshot, assembleCandidateSnapshot, loadApprovedSnapshot, migrateApprovedSnapshotV2, stageImmutableSnapshot } from "../scripts/lib/approved-snapshot.mjs";
import { approvedSnapshot, temporaryState } from "./helpers/baseline-fixtures.mjs";
import { deriveTerminalStatus, evaluateCommitEligibility } from "../scripts/lib/event-pipeline/run-state.mjs";
import { reconcileSourceAvailability } from "../scripts/reconcile-event-content.mjs";

const artifacts = { "landmarks.json": "[]\n", "pois.json": "[]\n", "tileset.json": "{}\n" };

test("v2 activity state migrates deterministically into independent v3 dimensions", () => {
  const migrated = migrateApprovedSnapshotV2({
    schemaVersion: "2.0", snapshotId: "legacy", events: [
      { id: "mapped", status: "approved", locationStatus: "approved", stale: false },
      { id: "off-map", status: "approved", locationStatus: "not_mappable", stale: true, staleReason: "source_unavailable" },
      { id: "review", status: "review", locationStatus: "needs_review", stale: false },
    ],
  });
  assert.equal(migrated.schemaVersion, "3.0");
  assert.deepEqual(migrated.events.map(({ id, lifecycleState, publicPlacement, mappingStatus, freshness }) => ({ id, lifecycleState, publicPlacement, mappingStatus, freshness })), [
    { id: "mapped", lifecycleState: "active", publicPlacement: "mapped", mappingStatus: "approved", freshness: "current" },
    { id: "off-map", lifecycleState: "active", publicPlacement: "off_map", mappingStatus: "not_required", freshness: "stale" },
    { id: "review", lifecycleState: "held", publicPlacement: "none", mappingStatus: "pending_review", freshness: "current" },
  ]);
  assert.equal(migrated.events[0].publishedEventId, "mapped");
  assert.deepEqual(migrateApprovedSnapshotV2(migrated), migrated);
});

test("partial, source-outage, and pending-review candidates cannot stage or activate", () => {
  const state = temporaryState();
  try {
    for (const reason of ["source_outage", "needs_review", "partial_accounting"]) {
      assert.throws(() => stageImmutableSnapshot({ root: state.root, snapshot: approvedSnapshot({ snapshotId: `candidate-${reason}` }), artifacts, commitEligibility: { eligible: false, reason } }), new RegExp(reason));
    }
    assert.equal(fs.existsSync(path.join(state.root, "data/approved-snapshot.json")), false);
  } finally { state.cleanup(); }
});

test("staging is immutable and a crash before activation preserves the previous pointer", () => {
  const state = temporaryState();
  try {
    const first = stageImmutableSnapshot({ root: state.root, snapshot: approvedSnapshot({ snapshotId: "first" }), artifacts, commitEligibility: { eligible: true } });
    activateStagedSnapshot({ root: state.root, staged: first });
    const second = stageImmutableSnapshot({ root: state.root, snapshot: approvedSnapshot({ snapshotId: "second", previousSnapshotId: "first" }), artifacts, commitEligibility: { eligible: true } });
    assert.equal(loadApprovedSnapshot({ root: state.root }).snapshotId, "first");
    assert.throws(() => stageImmutableSnapshot({ root: state.root, snapshot: approvedSnapshot({ snapshotId: "second" }), artifacts, commitEligibility: { eligible: true } }), /already exists/i);
    activateStagedSnapshot({ root: state.root, staged: second });
    assert.equal(loadApprovedSnapshot({ root: state.root }).snapshotId, "second");
  } finally { state.cleanup(); }
});

test("not-mappable accounting may publish when all other gates pass", () => {
  const state = temporaryState();
  try {
    const staged = stageImmutableSnapshot({ root: state.root, snapshot: approvedSnapshot({ snapshotId: "safe-not-mappable" }), artifacts, commitEligibility: { eligible: true, notMappableCount: 1 } });
    activateStagedSnapshot({ root: state.root, staged });
    assert.equal(loadApprovedSnapshot({ root: state.root }).snapshotId, "safe-not-mappable");
  } finally { state.cleanup(); }
});

test("active snapshots expose stale metadata without changing the approved pointer", () => {
  const state = temporaryState();
  try {
    const staged = stageImmutableSnapshot({ root: state.root, snapshot: approvedSnapshot({ snapshotId: "stale" }), artifacts, commitEligibility: { eligible: true } });
    activateStagedSnapshot({ root: state.root, staged });
    const active = loadApprovedSnapshot({ root: state.root, now: new Date("2026-07-22T00:00:00.000Z") });
    assert.equal(active.snapshotId, "stale");
    assert.equal(active.stale, true);
    assert.equal(active.freshness, "potentially_outdated");
    assert.match(active.warning, /potentially outdated/i);
  } finally { state.cleanup(); }
});

test("failed activation rolls the pointer back to the previous approved snapshot", () => {
  const state = temporaryState();
  try {
    const first = stageImmutableSnapshot({ root: state.root, snapshot: approvedSnapshot({ snapshotId: "rollback-first" }), artifacts, commitEligibility: { eligible: true } });
    activateStagedSnapshot({ root: state.root, staged: first });
    const broken = stageImmutableSnapshot({ root: state.root, snapshot: approvedSnapshot({ snapshotId: "rollback-broken", previousSnapshotId: "rollback-first" }), artifacts, commitEligibility: { eligible: true } });
    fs.rmSync(path.join(broken.snapshotDirectory, "landmarks.json"));
    assert.throws(() => activateStagedSnapshot({ root: state.root, staged: broken }), /artifact is missing/i);
    assert.equal(loadApprovedSnapshot({ root: state.root }).snapshotId, "rollback-first");
  } finally { state.cleanup(); }
});

test("the initial snapshot can be the previous version without changing landmark or POI identities", () => {
  const state = temporaryState();
  try {
    const stableArtifacts = {
      "landmarks.json": `${JSON.stringify([{ id: "stable-hall", events: [] }])}\n`,
      "pois.json": `${JSON.stringify([{ id: "stable-hall", data: "poi-tiles/stable-hall/tileset.json" }])}\n`,
      "tileset.json": "{}\n",
    };
    const initial = stageImmutableSnapshot({ root: state.root, snapshot: approvedSnapshot({ snapshotId: "initial" }), artifacts: stableArtifacts, commitEligibility: { eligible: true } });
    activateStagedSnapshot({ root: state.root, staged: initial });
    const next = stageImmutableSnapshot({ root: state.root, snapshot: approvedSnapshot({ snapshotId: "weekly-next", previousSnapshotId: "initial" }), artifacts: stableArtifacts, commitEligibility: { eligible: true } });
    activateStagedSnapshot({ root: state.root, staged: next });
    const active = loadApprovedSnapshot({ root: state.root });
    assert.equal(active.previousSnapshotId, "initial");
    assert.equal(JSON.parse(fs.readFileSync(path.join(active.directory, active.landmarksRef), "utf8"))[0].id, "stable-hall");
    assert.equal(JSON.parse(fs.readFileSync(path.join(active.directory, active.poisRef), "utf8"))[0].id, "stable-hall");
  } finally { state.cleanup(); }
});

test("commit eligibility and terminal status distinguish finalization from publication", () => {
  const verification = { status: "success", poiSeparation: { status: "success" }, build: { status: "success" }, eventUi: { status: "success" }, browser: { status: "success" } };
  const base = {
    sources: { Catch: { status: "success" }, SISTIC: { status: "success" } },
    normalization: { status: "success" }, resolutionPreparation: { status: "success" }, verification,
    venues: { hall: { stages: { resolve: { status: "success", resolutionStatus: "approved" } } } },
  };
  assert.deepEqual(evaluateCommitEligibility(base), { eligible: true, reasons: [] });
  assert.equal(deriveTerminalStatus(base), "success");
  const review = structuredClone(base);
  review.venues.hall.stages.resolve = { status: "unresolved", resolutionStatus: "needs_review" };
  assert.equal(evaluateCommitEligibility(review).eligible, true);
  assert.equal(deriveTerminalStatus(review), "success");
  const sourceOutage = structuredClone(base);
  sourceOutage.sources.SISTIC.status = "blocked";
  assert.equal(deriveTerminalStatus(sourceOutage), "partial");
});

test("source reconciliation carries stale contributions per identity, accepts compatible current fields, and archives complete-source removals", () => {
  const previous = [
    { id: "mixed", identityAnchor: "mixed", publishedEventId: "mixed", title: "Old title", schedule: { kind: "anytime" }, lifecycleState: "active", publicPlacement: "off_map", mappingStatus: "not_required", sourceContributions: [{ sourceRecordId: "Catch:one", sourceName: "Catch", freshness: "current", fields: ["title", "schedule"] }, { sourceRecordId: "SISTIC:two", sourceName: "SISTIC", freshness: "current", fields: ["location"] }] },
    { id: "removed", identityAnchor: "removed", publishedEventId: "removed", title: "Removed", schedule: { kind: "anytime" }, sourceContributions: [{ sourceRecordId: "Catch:removed", sourceName: "Catch", freshness: "current", fields: ["title"] }] },
  ];
  const current = [{ ...previous[0], title: "Current title", sources: [{ source: "Catch", sourceId: "one" }], sourceContributions: [previous[0].sourceContributions[0]] }];
  const result = reconcileSourceAvailability({ previousEvents: previous, currentEvents: current, sourceStatuses: { Catch: "success", SISTIC: "blocked" }, asOf: "2026-07-18T00:00:00+08:00" });
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].title, "Current title");
  assert.equal(result.events[0].sourceContributions.find(({ sourceName }) => sourceName === "SISTIC").freshness, "stale");
  assert.equal(result.events[0].fieldFreshness.location, "stale");
  assert.deepEqual(result.counts, { current: 1, carriedForwardStale: 1, archived: 1 });
  assert.equal(reconcileSourceAvailability({ previousEvents: [], currentEvents: [], sourceStatuses: { SISTIC: "blocked" } }).events.length, 0, "first-run outages cannot fabricate history");
});

test("candidate assembly keeps lifecycle, placement, mapping, and freshness orthogonal and rejects unsafe release geometry", () => {
  const candidate = assembleCandidateSnapshot({ previousSnapshotId: "prior", events: [
    { id: "mapped", lifecycleState: "active", publicPlacement: "mapped", mappingStatus: "approved", freshness: "current" },
    { id: "offmap", lifecycleState: "active", publicPlacement: "off_map", mappingStatus: "pending_review", freshness: "stale" },
    { id: "held", lifecycleState: "held", publicPlacement: "none", mappingStatus: "pending_review", freshness: "current" },
  ] });
  assert.deepEqual(candidate.counts, { active: 2, held: 1, archived: 0, excluded: 0 });
  assert.equal(candidate.previousSnapshotId, "prior");
  assert.throws(() => assembleCandidateSnapshot({ events: [{ id: "unsafe", lifecycleState: "active", publicPlacement: "mapped", mappingStatus: "pending_review" }] }), /approved geometry/i);
  assert.throws(() => assembleCandidateSnapshot({ events: [{ id: "dup", lifecycleState: "held", publicPlacement: "none" }, { id: "dup", lifecycleState: "held", publicPlacement: "none" }] }), /duplicated/i);
});

test("accounted source outages and isolated location reviews can publish safe updates while release gates remain atomic", () => {
  const verification = { status: "success", poiSeparation: { status: "success" }, build: { status: "success" }, eventUi: { status: "success" }, browser: { status: "success" } };
  const state = { sources: { Catch: { status: "success" }, SISTIC: { status: "blocked" } }, normalization: { status: "success", sourceReconciliation: { accounted: true } }, deduplication: { status: "success", isolatedReviewEventIds: ["held"] }, resolutionPreparation: { status: "success" }, verification, venues: { review: { stages: { resolve: { status: "unresolved", resolutionStatus: "needs_review" } } } } };
  assert.deepEqual(evaluateCommitEligibility(state), { eligible: true, reasons: [] });
  assert.equal(deriveTerminalStatus(state), "success");
  const malformed = structuredClone(state); malformed.verification.browser.status = "failed";
  assert.ok(evaluateCommitEligibility(malformed).reasons.includes("browser_failed"));
});

test("pilot failures are visible but non-blocking while required discovery and dedup gaps block", () => {
  const verification = { status: "success", poiSeparation: { status: "success" }, build: { status: "success" }, eventUi: { status: "success" }, browser: { status: "success" } };
  const base = {
    sources: {
      Catch: { status: "success", sourceRole: "authoritative", operatingMode: "required" },
      Honeycombers: { status: "pilot_failed", sourceRole: "discovery", operatingMode: "pilot" },
    },
    normalization: { status: "success" }, deduplication: { status: "success" }, resolutionPreparation: { status: "success" }, verification, venues: {},
  };
  assert.deepEqual(evaluateCommitEligibility(base), { eligible: true, reasons: [] });
  assert.equal(deriveTerminalStatus(base), "success");
  const promoted = structuredClone(base); promoted.sources.Honeycombers.operatingMode = "required";
  assert.ok(evaluateCommitEligibility(promoted).reasons.includes("required_source_incomplete"));
  const dedupBlocked = structuredClone(base); dedupBlocked.deduplication = { status: "blocked" };
  assert.ok(evaluateCommitEligibility(dedupBlocked).reasons.includes("deduplication_incomplete"));
});

test("explicitly disabled source remains accounted without blocking publication", () => {
  const verification = { status: "success", poiSeparation: { status: "success" }, build: { status: "success" }, eventUi: { status: "success" }, browser: { status: "success" } };
  const state = {
    sources: {
      Catch: { status: "success", operatingMode: "required" },
      "Roots HAN": { status: "disabled", operatingMode: "disabled", blockerReasonCode: "layout_contract_changed" },
    },
    normalization: { status: "success" }, deduplication: { status: "success" },
    resolutionPreparation: { status: "success" }, verification, venues: {},
  };
  assert.deepEqual(evaluateCommitEligibility(state), { eligible: true, reasons: [] });
  assert.equal(deriveTerminalStatus(state), "success");
});
