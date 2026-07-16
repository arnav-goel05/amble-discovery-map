import assert from "node:assert/strict";
import test from "node:test";

import { createEventDiscoveryModel, reconcileEventSelection } from "../activity-scenes/events/event-discovery-model.js";

const landmarks = [
  {
    id: "library", label: "National Library", anchor: { lng: 103.854, lat: 1.298 }, events: [
      { id: "late", title: "Journey to the West", venue: "Drama Centre", dateText: "15 Jul 2026", startDateTime: "2026-07-15T19:00:00+08:00", category: "Performances", price: "S$35-S$60" },
      { id: "early", title: "Architecture Talk", venue: "Drama Centre", dateText: "14 Jul 2026", startDateTime: "2026-07-14T10:00:00+08:00", category: "Workshops & Classes", price: "Free" },
    ],
  },
  { id: "museum", label: "National Museum", anchor: { lng: 103.848, lat: 1.296 }, events: [
    { id: "exhibition", title: "História Café", venue: "Gallery One", dateText: "14-21 Jul 2026", category: "Exhibitions" },
  ] },
];

test("normalized search matches title, venue, landmark, and represented date", () => {
  const model = createEventDiscoveryModel(landmarks);
  assert.deepEqual(model.filter({ query: "journey" }).events.map(({ eventId }) => eventId), ["late"]);
  assert.deepEqual(model.filter({ query: "drama centre" }).events.map(({ eventId }) => eventId), ["early", "late"]);
  assert.deepEqual(model.filter({ query: "national museum" }).events.map(({ eventId }) => eventId), ["exhibition"]);
  assert.deepEqual(model.filter({ query: "historia cafe" }).events.map(({ eventId }) => eventId), ["exhibition"]);
  assert.deepEqual(model.filter({ query: "15 jul" }).events.map(({ eventId }) => eventId), ["late"]);
});

test("categories compose with search and results keep canonical multiple-event order", () => {
  const model = createEventDiscoveryModel(landmarks);
  assert.deepEqual(model.categories(), ["Exhibitions", "Performances", "Workshops & Classes"]);
  assert.deepEqual(model.filter({ query: "drama", categories: ["Performances"] }).events.map(({ eventId }) => eventId), ["late"]);
  assert.deepEqual(model.filter().events.map(({ eventId }) => eventId), ["early", "late", "exhibition"]);
});

test("date and price ranges compose with the existing filters", () => {
  const model = createEventDiscoveryModel(landmarks, { now: () => new Date("2026-07-14T08:00:00+08:00") });
  assert.deepEqual(model.filter({ dateRange: "today", priceRange: "free" }).events.map(({ eventId }) => eventId), ["early"]);
  assert.deepEqual(model.filter({ dateRange: "7-days", priceRange: "25-50" }).events.map(({ eventId }) => eventId), ["late"]);
  assert.deepEqual(model.filter({ dateStart: "2026-07-15", dateEnd: "2026-07-15" }).events.map(({ eventId }) => eventId), ["late"]);
  assert.deepEqual(model.filter({ priceRange: "100-plus" }).events, []);
});

test("selection reconciliation preserves visible identity and clears filtered or removed identity", () => {
  const model = createEventDiscoveryModel(landmarks);
  const selection = { landmarkId: "library", eventId: "late" };
  assert.deepEqual(reconcileEventSelection(selection, model.filter({ query: "journey" })), selection);
  assert.equal(reconcileEventSelection(selection, model.filter({ query: "architecture" })), null);
  assert.equal(reconcileEventSelection(selection, createEventDiscoveryModel([]).filter()), null);
});

test("duplicate event identities remain distinct across landmarks but not within one landmark", () => {
  const model = createEventDiscoveryModel([
    { id: "a", label: "A", events: [{ id: "shared", title: "One", dateText: "14 Jul" }] },
    { id: "b", label: "B", events: [{ id: "shared", title: "Two", dateText: "14 Jul" }] },
  ]);
  assert.equal(model.filter().events.length, 2);
  assert.throws(() => createEventDiscoveryModel([{ id: "a", label: "A", events: [
    { id: "same", title: "One" }, { id: "same", title: "Two" },
  ] }]), /duplicate event identity/i);
});
