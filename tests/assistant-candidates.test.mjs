import assert from "node:assert/strict";
import test from "node:test";

import {
  CandidateEnvelopeError,
  createApprovedCandidateEnvelope,
} from "../activity-scenes/assistant/discovery-model.js";

const SNAPSHOT_ID = "approved-snapshot-2026-07-18";
const GENERATED_AT = "2026-07-18T12:00:00.000Z";

function candidate(overrides = {}) {
  return {
    candidateId: "event:esplanade:event-1",
    candidateType: "event",
    sourceSnapshotId: SNAPSHOT_ID,
    areaId: "ura-subzone:city-hall",
    coordinates: [103.8554, 1.2898],
    attributes: {
      name: "Waterfront evening programme",
      category: "performance",
      price: "free",
    },
    evidenceRefs: ["approved-event:event-1"],
    ...overrides,
  };
}

function source(sourceId, candidates, overrides = {}) {
  return {
    sourceId,
    sourceSnapshotId: candidates[0]?.sourceSnapshotId ?? SNAPSHOT_ID,
    status: candidates.length ? "fresh" : "empty",
    approved: true,
    candidates,
    ...overrides,
  };
}

function createEnvelope(sources) {
  return createApprovedCandidateEnvelope({
    sourceSnapshotId: SNAPSHOT_ID,
    generatedAt: GENERATED_AT,
    sources,
  });
}

function assertEnvelopeError(code) {
  return (error) =>
    error instanceof CandidateEnvelopeError && error.code === code;
}

test("approved event, restaurant, plan-stop, and game candidates share one grounded envelope", () => {
  const envelope = createEnvelope([
    source("events", [candidate()]),
    source("restaurants", [
      candidate({
        candidateId: "restaurant:osm-node-42",
        candidateType: "restaurant",
        sourceSnapshotId: "restaurant-viewport:1.28,103.84,1.30,103.86",
        areaId: "ura-subzone:downtown-core",
        coordinates: [103.852, 1.284],
        attributes: {
          name: "Fixture Café",
          category: "cafe",
          cuisine: ["local"],
        },
        evidenceRefs: ["approved-restaurant:osm-node-42"],
      }),
    ]),
    source("plans", [
      candidate({
        candidateId: "plan-stop:event:event-1",
        candidateType: "plan_stop",
        attributes: {
          name: "Waterfront evening programme",
          stopType: "event",
          position: 1,
        },
        evidenceRefs: ["plan-state:event:event-1", "approved-event:event-1"],
      }),
    ]),
    source("games", [
      candidate({
        candidateId: "game:city-hunt-1",
        candidateType: "game",
        sourceSnapshotId: "public-game:city-hunt-1:v1",
        areaId: "ura-subzone:fort-canning",
        coordinates: [103.8465, 1.2955],
        attributes: {
          name: "City puzzle hunt",
          theme: "history",
          status: "available",
        },
        evidenceRefs: ["public-game:city-hunt-1:v1"],
      }),
    ]),
  ]);

  assert.equal(envelope.schemaVersion, "1.0");
  assert.equal(envelope.sourceSnapshotId, SNAPSHOT_ID);
  assert.equal(envelope.generatedAt, GENERATED_AT);
  assert.deepEqual(
    envelope.candidates.map(({ candidateType }) => candidateType).sort(),
    ["event", "game", "plan_stop", "restaurant"],
  );
  assert.deepEqual(envelope.sources, [
    { sourceId: "events", status: "fresh", candidateCount: 1 },
    { sourceId: "games", status: "fresh", candidateCount: 1 },
    { sourceId: "plans", status: "fresh", candidateCount: 1 },
    { sourceId: "restaurants", status: "fresh", candidateCount: 1 },
  ]);

  for (const item of envelope.candidates) {
    assert.match(item.candidateId, /^(event|restaurant|plan-stop|game):/);
    assert.ok(item.areaId);
    assert.equal(item.coordinates.length, 2);
    assert.ok(item.evidenceRefs.length > 0);
    assert.equal(typeof item.attributes.name, "string");
  }
});

test("empty sources remain visible while stale and unavailable candidates fail closed", () => {
  const staleCandidate = candidate({ candidateId: "event:stale:event-2" });
  const unavailableCandidate = candidate({
    candidateId: "restaurant:unavailable",
  });
  const envelope = createEnvelope([
    source("events", [staleCandidate], { status: "stale" }),
    source("restaurants", [unavailableCandidate], { status: "unavailable" }),
    source("plans", []),
    source("games", [], { status: "fresh" }),
  ]);

  assert.deepEqual(envelope.candidates, []);
  assert.deepEqual(envelope.sources, [
    { sourceId: "events", status: "stale", candidateCount: 0 },
    { sourceId: "games", status: "empty", candidateCount: 0 },
    { sourceId: "plans", status: "empty", candidateCount: 0 },
    { sourceId: "restaurants", status: "unavailable", candidateCount: 0 },
  ]);
  assert.equal(
    JSON.stringify(envelope).includes(staleCandidate.candidateId),
    false,
  );
  assert.equal(
    JSON.stringify(envelope).includes(unavailableCandidate.candidateId),
    false,
  );
});

test("candidate identities and output order remain stable across source refresh ordering", () => {
  const event = candidate();
  const restaurant = candidate({
    candidateId: "restaurant:osm-node-42",
    candidateType: "restaurant",
    sourceSnapshotId: "restaurant-viewport:fixture",
  });
  const first = createEnvelope([
    source("events", [event]),
    source("restaurants", [restaurant]),
  ]);
  const reordered = createEnvelope([
    source("restaurants", [restaurant]),
    source("events", [event]),
  ]);

  assert.deepEqual(
    first.candidates.map(({ candidateId }) => candidateId),
    reordered.candidates.map(({ candidateId }) => candidateId),
  );
  assert.deepEqual(first.sources, reordered.sources);

  assert.throws(
    () =>
      createEnvelope([
        source("events", [event]),
        source("duplicate", [structuredClone(event)]),
      ]),
    assertEnvelopeError("candidate_identity_duplicate"),
  );
  assert.throws(
    () => createEnvelope([source("events", [candidate({ candidateId: "" })])]),
    assertEnvelopeError("candidate_identity_invalid"),
  );
});

test("unapproved sources and mismatched approved identities are rejected", () => {
  assert.throws(
    () =>
      createEnvelope([
        source("open-web-results", [candidate()], { approved: false }),
      ]),
    assertEnvelopeError("candidate_source_unapproved"),
  );
  assert.throws(
    () =>
      createEnvelope([
        source(
          "events",
          [candidate({ sourceSnapshotId: "unknown-snapshot" })],
          {
            sourceSnapshotId: SNAPSHOT_ID,
          },
        ),
      ]),
    assertEnvelopeError("candidate_snapshot_unapproved"),
  );
  assert.throws(
    () => createEnvelope([source("events", [candidate({ evidenceRefs: [] })])]),
    assertEnvelopeError("candidate_evidence_missing"),
  );
});

test("building a candidate envelope never starts network research", (context) => {
  let networkCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    networkCalls += 1;
    throw new Error("candidate envelope must not fetch");
  };
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const approved = candidate();
  const envelope = createEnvelope([source("events", [approved])]);

  assert.equal(networkCalls, 0);
  assert.deepEqual(
    envelope.candidates.map(({ candidateId }) => candidateId),
    [approved.candidateId],
  );
});
