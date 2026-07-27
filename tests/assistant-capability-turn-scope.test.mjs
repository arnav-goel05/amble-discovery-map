import assert from "node:assert/strict";
import test from "node:test";

import { selectCapabilityTurnScope } from "../activity-scenes/assistant/capability-turn-scope.js";

const availableCapabilityIds = [
  "map.zoomin",
  "map.zoomout",
  "map.pan",
  "map.setlayervisibility",
  "event.applyquery",
  "event.select",
  "restaurant.search",
  "restaurant.open",
  "plan.addstop",
  "plan.removeitem",
  "tour.start",
  "navigation.closeoverlay",
  "navigation.openexternal",
  "location.show",
  "location.hide",
  "transit.showlines",
  "transit.hidelines",
  "discovery.presentareas",
  "discovery.selectarea",
];

const capabilityFamilies = {
  "map.zoomin": "map",
  "map.zoomout": "map",
  "map.pan": "map",
  "map.setlayervisibility": "map",
  "event.applyquery": "event",
  "event.select": "event",
  "restaurant.search": "restaurant",
  "restaurant.open": "restaurant",
  "plan.addstop": "plan",
  "plan.removeitem": "plan",
  "tour.start": "tour",
  "navigation.closeoverlay": "navigation",
  "navigation.openexternal": "navigation",
  "location.show": "location",
  "location.hide": "location",
  "transit.showlines": "transit",
  "transit.hidelines": "transit",
  "discovery.presentareas": "discovery-areas",
  "discovery.selectarea": "discovery-areas",
};

test("scopes an obvious command to its connector family and removes the locally routed tool", () => {
  const scope = selectCapabilityTurnScope({
    utterance: "zoom in",
    availableCapabilityIds,
    activeOverlayId: null,
  });

  assert.deepEqual(scope.families, ["map"]);
  assert.equal(scope.deterministicCapabilityId, "map.zoomin");
  assert.deepEqual(scope.capabilityIds, [
    "map.zoomout",
    "map.pan",
    "map.setlayervisibility",
  ]);
});

test("scopes requests to relevant connector families instead of the full registry", () => {
  assert.deepEqual(
    selectCapabilityTurnScope({
      utterance: "find a restaurant deal",
      availableCapabilityIds,
    }),
    {
      families: ["restaurant"],
      capabilityIds: ["restaurant.search", "restaurant.open"],
      deterministicCapabilityId: null,
    },
  );
  assert.deepEqual(
    selectCapabilityTurnScope({
      utterance: "find free events",
      availableCapabilityIds,
    }),
    {
      families: ["event"],
      capabilityIds: ["event.select"],
      deterministicCapabilityId: "event.applyquery",
    },
  );
});

test("uses current interface state for an otherwise unclassified turn", () => {
  assert.deepEqual(
    selectCapabilityTurnScope({
      utterance: "remove that one",
      availableCapabilityIds,
      activeOverlayId: "plan-builder",
    }),
    {
      families: ["plan"],
      capabilityIds: ["plan.addstop", "plan.removeitem"],
      deterministicCapabilityId: null,
    },
  );
});

test("uses connector metadata to expose overlay-navigation capabilities", () => {
  assert.deepEqual(
    selectCapabilityTurnScope({
      utterance: "open the official reference",
      availableCapabilityIds,
      capabilityFamilies,
      activeOverlayId: "event-panel",
    }),
    {
      families: ["navigation"],
      capabilityIds: ["navigation.closeoverlay", "navigation.openexternal"],
      deterministicCapabilityId: null,
    },
  );
  assert.deepEqual(
    selectCapabilityTurnScope({
      utterance: "close this",
      availableCapabilityIds,
      capabilityFamilies,
      activeOverlayId: "map-attribution",
    }),
    {
      families: ["navigation"],
      capabilityIds: ["navigation.closeoverlay", "navigation.openexternal"],
      deterministicCapabilityId: null,
    },
  );
});

test("unknown turns receive no unrelated command families", () => {
  assert.deepEqual(
    selectCapabilityTurnScope({
      utterance: "hello",
      availableCapabilityIds,
      activeOverlayId: null,
    }),
    {
      families: [],
      capabilityIds: [],
      deterministicCapabilityId: null,
    },
  );
});

test("every non-foundational connector family is reachable without exposing unrelated families", () => {
  for (const [utterance, family] of [
    ["show me restaurants", "restaurant"],
    ["what events are on", "event"],
    ["update my itinerary", "plan"],
    ["which MRT stations are visible", "transit"],
    ["where am i", "location"],
    ["start the tutorial", "tour"],
    ["recommend somewhere calm", "discovery"],
    ["open the attribution", "navigation"],
    ["pan the map", "map"],
  ]) {
    const scope = selectCapabilityTurnScope({
      utterance,
      availableCapabilityIds,
      capabilityFamilies,
    });
    assert.ok(scope.families.includes(family), `${utterance}: ${family}`);
    assert.ok(
      scope.capabilityIds.every(
        (capabilityId) =>
          capabilityFamilies[capabilityId] === family ||
          (family === "discovery" &&
            capabilityFamilies[capabilityId] === "discovery-areas"),
      ),
      `${utterance}: unrelated capability`,
    );
  }
});
