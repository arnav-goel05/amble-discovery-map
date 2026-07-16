import assert from "node:assert/strict";
import test from "node:test";

import { reconcileEventMap } from "../activity-scenes/events/event-map-reconciliation.js";

const landmark = (id, title = "Event", contentHash) => ({
  id, label: `Venue ${id}`, anchor: { lng: 103.85, lat: 1.29 },
  events: [{ id: `${id}:occurrence-1`, title, dateText: "14 Jul 2026" }],
  ...(contentHash ? { contentHash } : {}),
});

test("stable landmark reconciliation classifies create, update, noop, and remove", () => {
  const previous = [landmark("same"), landmark("changed", "Old"), landmark("removed")];
  const next = [structuredClone(previous[0]), landmark("changed", "New"), landmark("created")];
  const result = reconcileEventMap(previous, next);
  assert.deepEqual(result.actions.map(({ id, action }) => [id, action]), [
    ["same", "noop"], ["changed", "update"], ["created", "create"], ["removed", "remove"],
  ]);
  assert.strictEqual(result.landmarks[0], previous[0], "no-op keeps the existing object and avoids downstream writes");
});

test("explicit unchanged hashes short-circuit deep reconciliation", () => {
  const previous = [landmark("venue", "Old local representation", "a".repeat(64))];
  const next = [landmark("venue", "New ignored representation", "a".repeat(64))];
  const result = reconcileEventMap(previous, next);
  assert.equal(result.actions[0].action, "noop");
  assert.strictEqual(result.landmarks[0], previous[0]);
});

test("duplicate landmark and occurrence identities fail before rendering", () => {
  assert.throws(() => reconcileEventMap([], [landmark("duplicate"), landmark("duplicate")]), /duplicate landmark identity/i);
  const duplicateOccurrence = landmark("venue");
  duplicateOccurrence.events.push({ ...duplicateOccurrence.events[0] });
  assert.throws(() => reconcileEventMap([], [duplicateOccurrence]), /duplicate event identity/i);
});
