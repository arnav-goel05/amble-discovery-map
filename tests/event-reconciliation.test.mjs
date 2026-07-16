import assert from "node:assert/strict";
import test from "node:test";

import { pruneExpiredContent, reconcileLandmark, stableEventKey } from "../scripts/reconcile-event-content.mjs";

const occurrence = (sourceId, title, overrides = {}) => ({
  id: `Catch.sg:${sourceId}`, occurrenceId: `Catch.sg:${sourceId}`, parentListingId: "Catch.sg:listing-1",
  mergedEventId: `merged:${title}`, parentEventId: "listing-1", venue: "Hall", title,
  dateText: "16 Jul 2026", sources: [{ source: "Catch.sg", sourceId }], ...overrides,
});

test("sibling occurrences under one listing replace independently", () => {
  const first = occurrence("listing-1#2026-07-16T10:00:00+08:00", "Morning");
  const second = occurrence("listing-1#2026-07-16T19:00:00+08:00", "Evening");
  assert.notEqual(stableEventKey(first), stableEventKey(second));
  const current = { id: "hall", label: "Hall", events: [first, second] };
  const updatedFirst = { ...first, id: "merged:changed-membership", title: "Morning updated" };
  const result = reconcileLandmark(current, { ...current, events: [updatedFirst, second] }, ["Hall"]);
  assert.equal(result.action, "update");
  assert.deepEqual(result.landmark.events.map(({ title }) => title), ["Morning updated", "Evening"]);
});

test("a changed merged membership updates evidence without changing occurrence identity", () => {
  const currentEvent = occurrence("listing-1#one", "Event", { mergedEventId: "merged:one" });
  const nextEvent = {
    ...currentEvent,
    mergedEventId: "merged:two",
    sources: [...currentEvent.sources, { source: "SISTIC", sourceId: "show#one" }],
  };
  const result = reconcileLandmark(
    { id: "hall", events: [currentEvent] },
    { id: "hall", events: [nextEvent] },
    ["Hall"],
  );
  assert.equal(stableEventKey(currentEvent), stableEventKey(nextEvent));
  assert.equal(result.action, "update");
  assert.equal(result.landmark.events[0].occurrenceId, currentEvent.occurrenceId);
});

test("unchanged occurrence content is a no-op even when copied", () => {
  const current = { id: "hall", label: "Hall", events: [occurrence("listing-1#one", "Event")] };
  const result = reconcileLandmark(current, structuredClone(current), ["Hall"]);
  assert.equal(result.action, "noop");
  assert.strictEqual(result.landmark, current);
});

test("expiry preserves undated events and retains locations with any future occurrence", () => {
  const result = pruneExpiredContent({
    asOf: "2026-07-14T00:00:00+08:00",
    landmarks: [
      { id: "mixed", events: [{ id: "old", dateText: "13 Jul 2026" }, { id: "future", dateText: "16 Jul 2026" }] },
      { id: "undated", events: [{ id: "review", dateText: null }] },
      { id: "expired", events: [{ id: "gone", dateText: "12 Jul 2026" }] },
    ],
    pois: [{ id: "mixed" }, { id: "undated" }, { id: "expired" }],
  });
  assert.deepEqual(result.removedLandmarkIds, ["expired"]);
  assert.deepEqual(result.landmarks.map(({ id }) => id), ["mixed", "undated"]);
  assert.deepEqual(result.undatedReviewEventIds, ["review"]);
});
