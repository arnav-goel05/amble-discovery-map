import assert from "node:assert/strict";
import test from "node:test";

import {
  InterfaceContextError,
  createInterfaceContext,
  resolveInterfaceReference,
} from "../activity-scenes/assistant/interface-context.js";

const targets = [
  { targetId: "area:marina-south", type: "area", label: "Marina South" },
  { targetId: "area:city-hall", type: "area", label: "City Hall" },
  {
    targetId: "restaurant:osm-node-42",
    type: "restaurant",
    label: "Fixture Café",
  },
];

function initialContext(overrides = {}) {
  return {
    viewport: {
      bounds: [103.8, 1.25, 103.9, 1.35],
      zoom: 11,
      bearing: 0,
    },
    visibleTargets: targets,
    focusedTargetId: null,
    selectedTargetIds: [],
    activeOverlayId: null,
    activeFilters: {},
    locationState: { permission: "prompt", status: "idle", coarseAreaId: null },
    transitVisible: true,
    transitConstraintActive: false,
    availableActionIds: ["map.focus_area", "restaurant.open"],
    ...overrides,
  };
}

test("snapshot preserves visible order and assigns current one-based ordinals", () => {
  const context = createInterfaceContext(initialContext());
  const first = context.snapshot();

  assert.equal(first.revision, 0);
  assert.deepEqual(first.visibleTargets, [
    { ...targets[0], ordinal: 1 },
    { ...targets[1], ordinal: 2 },
    { ...targets[2], ordinal: 3 },
  ]);

  const reordered = context.update({
    visibleTargets: [targets[2], targets[0], targets[1]],
  });
  assert.equal(reordered.revision, 1);
  assert.deepEqual(
    reordered.visibleTargets.map(({ targetId, ordinal }) => [
      targetId,
      ordinal,
    ]),
    [
      ["restaurant:osm-node-42", 1],
      ["area:marina-south", 2],
      ["area:city-hall", 3],
    ],
  );
  assert.equal(
    first.visibleTargets[0].ordinal,
    1,
    "prior snapshots remain immutable",
  );
});

test("focus, selection, and active overlay are revisioned semantic state", () => {
  const context = createInterfaceContext(initialContext());
  const focused = context.update({ focusedTargetId: "area:city-hall" });
  assert.equal(focused.revision, 1);
  assert.equal(focused.focusedTargetId, "area:city-hall");

  const selected = context.update({
    selectedTargetIds: ["area:city-hall", "restaurant:osm-node-42"],
    activeOverlayId: "restaurant-results",
  });
  assert.equal(selected.revision, 2);
  assert.deepEqual(selected.selectedTargetIds, [
    "area:city-hall",
    "restaurant:osm-node-42",
  ]);
  assert.equal(selected.activeOverlayId, "restaurant-results");

  assert.throws(
    () => context.update({ focusedTargetId: "model-invented-target" }),
    (error) =>
      error instanceof InterfaceContextError &&
      error.code === "context_target_unknown",
  );
});

test("ordinal references resolve only against the supplied context revision", () => {
  const context = createInterfaceContext(initialContext());
  const revision = context.snapshot().revision;
  assert.deepEqual(
    context.resolve(
      { kind: "ordinal", ordinal: 2 },
      { expectedRevision: revision },
    ),
    {
      status: "resolved",
      targetId: "area:city-hall",
      contextRevision: revision,
    },
  );

  assert.deepEqual(
    context.resolve(
      { kind: "ordinal", ordinal: 8 },
      { expectedRevision: revision },
    ),
    {
      status: "clarification_required",
      reason: "reference_target_missing",
      candidateTargetIds: [],
      contextRevision: revision,
    },
  );
});

test("a reordered interface makes an earlier ordinal revision stale", () => {
  const context = createInterfaceContext(initialContext());
  const staleRevision = context.snapshot().revision;
  context.update({ visibleTargets: [targets[2], targets[0], targets[1]] });

  assert.deepEqual(
    context.resolve(
      { kind: "ordinal", ordinal: 2 },
      { expectedRevision: staleRevision },
    ),
    {
      status: "clarification_required",
      reason: "context_revision_stale",
      candidateTargetIds: [],
      contextRevision: 1,
    },
  );
});

test("deictic references prefer focus, use one selection, and clarify ambiguity", () => {
  const focused = createInterfaceContext(
    initialContext({
      focusedTargetId: "area:city-hall",
      selectedTargetIds: ["area:marina-south", "restaurant:osm-node-42"],
    }),
  ).snapshot();
  assert.deepEqual(
    resolveInterfaceReference(
      focused,
      { kind: "deictic" },
      {
        expectedRevision: focused.revision,
      },
    ),
    {
      status: "resolved",
      targetId: "area:city-hall",
      contextRevision: focused.revision,
    },
  );

  const oneSelected = createInterfaceContext(
    initialContext({
      selectedTargetIds: ["restaurant:osm-node-42"],
    }),
  ).snapshot();
  assert.equal(
    resolveInterfaceReference(oneSelected, { kind: "deictic" }).targetId,
    "restaurant:osm-node-42",
  );

  const ambiguous = createInterfaceContext(
    initialContext({
      selectedTargetIds: ["restaurant:osm-node-42", "area:marina-south"],
    }),
  ).snapshot();
  assert.deepEqual(resolveInterfaceReference(ambiguous, { kind: "deictic" }), {
    status: "clarification_required",
    reason: "ambiguous_reference",
    candidateTargetIds: ["area:marina-south", "restaurant:osm-node-42"],
    contextRevision: ambiguous.revision,
  });
});

test("an active overlay is exposed without becoming an invented target", () => {
  const context = createInterfaceContext(
    initialContext({
      activeOverlayId: "restaurant-results",
      visibleTargets: [targets[2]],
    }),
  );
  const snapshot = context.snapshot();

  assert.equal(snapshot.activeOverlayId, "restaurant-results");
  assert.deepEqual(context.resolve({ kind: "active_overlay" }), {
    status: "resolved",
    overlayId: "restaurant-results",
    contextRevision: snapshot.revision,
  });

  const closed = context.update({ activeOverlayId: null });
  assert.equal(closed.revision, 1);
  assert.deepEqual(context.resolve({ kind: "active_overlay" }), {
    status: "clarification_required",
    reason: "reference_target_missing",
    candidateTargetIds: [],
    contextRevision: closed.revision,
  });
});
