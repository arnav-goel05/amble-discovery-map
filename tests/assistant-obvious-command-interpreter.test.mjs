import assert from "node:assert/strict";
import test from "node:test";

import { interpretObviousCommand } from "../activity-scenes/assistant/interpreters/obvious-command-interpreter.js";

const interpret = (text) =>
  interpretObviousCommand({
    text,
    baseContextRevision: 12,
    catalogRevision: "events:v7",
  });

test("routes obvious map camera commands deterministically", () => {
  assert.deepEqual(interpret("zoom in"), {
    family: "map",
    capabilityId: "map.zoomin",
    arguments: {},
  });
  assert.deepEqual(interpret("Please zoom out."), {
    family: "map",
    capabilityId: "map.zoomout",
    arguments: {},
  });
});

test("routes obvious MRT visibility commands deterministically", () => {
  assert.deepEqual(interpret("show MRT lines"), {
    family: "map",
    capabilityId: "map.setlayervisibility",
    arguments: { layer: "mrtLines", visible: true },
  });
  assert.deepEqual(interpret("hide the MRT stations"), {
    family: "map",
    capabilityId: "map.setlayervisibility",
    arguments: { layer: "mrtStations", visible: false },
  });
});

test("routes bounded map, tour, plan, event, restaurant, and navigation actions", () => {
  const cases = [
    ["pan left", "map", "map.pan", { direction: "left", amount: 1 }],
    ["turn north", "map", "map.rotate", {}],
    ["reset the map", "map", "map.resetview", {}],
    [
      "show recommendations",
      "map",
      "map.setlayervisibility",
      { layer: "recommendations", visible: true },
    ],
    ["start the tour", "tour", "tour.start", {}],
    ["next tour step", "tour", "tour.next", {}],
    ["finish the tour", "tour", "tour.finish", {}],
    ["clear event filters", "event", "event.clearfilters", {}],
    ["next event", "event", "event.nextevent", {}],
    ["close event details", "event", "event.closedetail", {}],
    ["clear restaurant filters", "restaurant", "restaurant.clearfilters", {}],
    ["close restaurant results", "restaurant", "restaurant.closeresults", {}],
    ["open my plan", "plan", "plan.open", {}],
    [
      "set travel mode to walking",
      "plan",
      "plan.settravelmode",
      { mode: "walking" },
    ],
    ["open the assistant", "navigation", "navigation.openassistant", {}],
    ["open the attribution", "navigation", "navigation.openattribution", {}],
  ];

  for (const [text, family, capabilityId, argumentsValue] of cases)
    assert.deepEqual(interpret(text), {
      family,
      capabilityId,
      arguments: argumentsValue,
    });
});

test("routes a free-events request through the atomic event interpreter boundary", () => {
  assert.deepEqual(interpret("find free events"), {
    family: "event",
    capabilityId: "event.applyquery",
    arguments: {
      text: "find free events",
      mode: "replace",
      baseContextRevision: 12,
      catalogRevision: "events:v7",
    },
  });
});

test("does not guess for conversational, ambiguous, or out-of-scope language", () => {
  for (const text of [
    "",
    "could you help?",
    "show me something interesting",
    "find events",
    "zoom into Marina Bay",
    "show MRT routes near a hotel",
  ])
    assert.equal(interpret(text), null);
});
