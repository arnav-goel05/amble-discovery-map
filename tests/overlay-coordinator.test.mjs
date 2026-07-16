import assert from "node:assert/strict";
import test from "node:test";

import { createOverlayCoordinator } from "../activity-scenes/overlay-coordinator.js";

test("event, restaurant, and plan overlays are mutually exclusive", () => {
  const coordinator = createOverlayCoordinator();
  const closed = [];
  const unregisterEvent = coordinator.register("event-details", () => closed.push("event"));
  const unregisterRestaurant = coordinator.register("restaurant-details", () => closed.push("restaurant"));
  coordinator.register("plan", () => closed.push("plan"));
  coordinator.open("event-details");
  assert.deepEqual(closed, []);
  coordinator.open("restaurant-details");
  assert.deepEqual(closed, ["event"]);
  coordinator.open("plan");
  assert.deepEqual(closed, ["event", "restaurant"]);
  coordinator.dismiss();
  assert.deepEqual(closed, ["event", "restaurant", "plan"]);
  unregisterEvent(); unregisterRestaurant();
});

test("reopening the active overlay is a no-op and unregister is idempotent", () => {
  const coordinator = createOverlayCoordinator();
  let closes = 0;
  const unregister = coordinator.register("event", () => { closes += 1; });
  coordinator.open("event"); coordinator.open("event");
  assert.equal(closes, 0);
  unregister(); unregister(); coordinator.dismiss();
  assert.equal(closes, 0);
});

test("an overlay can report that it closed without closing a newer active overlay", () => {
  const coordinator = createOverlayCoordinator();
  coordinator.open("restaurants");
  assert.equal(coordinator.closed("restaurants"), true);
  assert.equal(coordinator.active(), null);

  coordinator.open("event-details");
  assert.equal(coordinator.closed("restaurants"), false);
  assert.equal(coordinator.active(), "event-details");
});

test("handled map clicks preserve the overlay once; ordinary clicks dismiss it", () => {
  const coordinator = createOverlayCoordinator();
  let closes = 0;
  coordinator.register("event", () => { closes += 1; });
  coordinator.open("event");
  const event = {};
  coordinator.keepOpenForMapClick(event);
  assert.equal(coordinator.dismissFromMapClick(event), false);
  assert.equal(closes, 0);
  assert.equal(coordinator.dismissFromMapClick({}), true);
  assert.equal(closes, 1);
});
