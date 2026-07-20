import assert from "node:assert/strict";
import test from "node:test";

import { reconcileEventMap } from "../activity-scenes/events/event-map-reconciliation.js";
import { assessLocationState } from "../scripts/lib/event-sources/activity-policy.mjs";

const landmark = (id, title = "Event", contentHash) => ({
  id,
  label: `Venue ${id}`,
  anchor: { lng: 103.85, lat: 1.29 },
  events: [{ id: `${id}:occurrence-1`, title, dateText: "14 Jul 2026" }],
  ...(contentHash ? { contentHash } : {}),
});

test("stable landmark reconciliation classifies create, update, noop, and remove", () => {
  const previous = [
    landmark("same"),
    landmark("changed", "Old"),
    landmark("removed"),
  ];
  const next = [
    structuredClone(previous[0]),
    landmark("changed", "New"),
    landmark("created"),
  ];
  const result = reconcileEventMap(previous, next);
  assert.deepEqual(
    result.actions.map(({ id, action }) => [id, action]),
    [
      ["same", "noop"],
      ["changed", "update"],
      ["created", "create"],
      ["removed", "remove"],
    ],
  );
  assert.strictEqual(
    result.landmarks[0],
    previous[0],
    "no-op keeps the existing object and avoids downstream writes",
  );
});

test("explicit unchanged hashes short-circuit deep reconciliation", () => {
  const previous = [
    landmark("venue", "Old local representation", "a".repeat(64)),
  ];
  const next = [
    landmark("venue", "New ignored representation", "a".repeat(64)),
  ];
  const result = reconcileEventMap(previous, next);
  assert.equal(result.actions[0].action, "noop");
  assert.strictEqual(result.landmarks[0], previous[0]);
});

test("duplicate landmark and occurrence identities fail before rendering", () => {
  assert.throws(
    () => reconcileEventMap([], [landmark("duplicate"), landmark("duplicate")]),
    /duplicate landmark identity/i,
  );
  const duplicateOccurrence = landmark("venue");
  duplicateOccurrence.events.push({ ...duplicateOccurrence.events[0] });
  assert.throws(
    () => reconcileEventMap([], [duplicateOccurrence]),
    /duplicate event identity/i,
  );
});

test("frontend reconciliation emits one logical activity while preserving sessions and venue occurrences", () => {
  const next = landmark("venue");
  next.events = [
    {
      id: "source-a",
      publishedEventId: "published-one",
      title: "Shared",
      sessions: [{ sessionId: "one" }],
      venueOccurrences: [{ venueOccurrenceId: "venue-one" }],
    },
    {
      id: "source-b",
      publishedEventId: "published-one",
      title: "Shared",
      sessions: [{ sessionId: "two" }],
      venueOccurrences: [{ venueOccurrenceId: "venue-two" }],
    },
  ];
  const [projected] = reconcileEventMap([], [next]).landmarks;
  assert.equal(projected.events.length, 1);
  assert.deepEqual(
    projected.events[0].sessions.map(({ sessionId }) => sessionId),
    ["one", "two"],
  );
  assert.deepEqual(
    projected.events[0].venueOccurrences.map(
      ({ venueOccurrenceId }) => venueOccurrenceId,
    ),
    ["venue-one", "venue-two"],
  );
});

test("location policy separates mapped approval, intentional off-map, reviewable ambiguity, and held conflicts", () => {
  assert.deepEqual(
    assessLocationState({
      approvedLocationId: "poi:funan",
      geometryApproved: true,
    }),
    {
      publicPlacement: "mapped",
      mappingStatus: "approved",
      offMapSubtype: null,
      lifecycleState: "active",
      reasonCode: "building_approved",
    },
  );
  for (const subtype of [
    "secret_tba",
    "multiple_locations",
    "mobile_route",
    "broad_area",
    "geometry_unavailable",
  ]) {
    const result = assessLocationState({ offMapSubtype: subtype });
    assert.deepEqual(
      [result.publicPlacement, result.mappingStatus, result.lifecycleState],
      ["off_map", "not_required", "active"],
      subtype,
    );
  }
  assert.deepEqual(
    assessLocationState({
      singaporeScopeReliable: true,
      generalLocationUsable: true,
    }),
    {
      publicPlacement: "off_map",
      mappingStatus: "pending_review",
      offMapSubtype: "geometry_unavailable",
      lifecycleState: "active",
      reasonCode: "location_conflict",
    },
  );
  assert.deepEqual(
    assessLocationState({
      singaporeScopeReliable: false,
      generalLocationUsable: false,
    }),
    {
      publicPlacement: "none",
      mappingStatus: "pending_review",
      offMapSubtype: null,
      lifecycleState: "held",
      reasonCode: "location_conflict",
    },
  );
  assert.deepEqual(
    assessLocationState({
      approvedLocationId: "poi:funan",
      geometryApproved: true,
      venueText: "Funan #03-30",
    }),
    {
      publicPlacement: "mapped",
      mappingStatus: "approved",
      offMapSubtype: null,
      lifecycleState: "active",
      reasonCode: "building_approved",
    },
    "a unit address maps to its geometry-approved parent building without inventing separate geometry",
  );
});
