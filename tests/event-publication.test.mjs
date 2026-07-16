import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { activateStagedSnapshot, loadApprovedSnapshot, stageImmutableSnapshot } from "../scripts/lib/approved-snapshot.mjs";
import { approvedSnapshot, temporaryState } from "./helpers/baseline-fixtures.mjs";
import { deriveTerminalStatus, evaluateCommitEligibility } from "../scripts/lib/event-pipeline/run-state.mjs";

const artifacts = { "landmarks.json": "[]\n", "pois.json": "[]\n", "tileset.json": "{}\n" };

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
  assert.equal(evaluateCommitEligibility(review).eligible, false);
  assert.equal(deriveTerminalStatus(review), "partial");
  const sourceOutage = structuredClone(base);
  sourceOutage.sources.SISTIC.status = "blocked";
  assert.equal(deriveTerminalStatus(sourceOutage), "partial");
});
