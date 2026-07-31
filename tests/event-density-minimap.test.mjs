import assert from "node:assert/strict";
import test from "node:test";

import {
  coordinateFromMinimapPoint,
  densityPointsFromDiscoveryResult,
  eventDensityCells,
  minimapViewportRectangle,
  singaporeGeometryBounds,
} from "../activity-scenes/event-density-minimap.js";

test("minimap points convert to Singapore coordinates and clamp to its bounds", () => {
  const bounds = {
    minLongitude: 103.6,
    maxLongitude: 104,
    minLatitude: 1.2,
    maxLatitude: 1.5,
  };
  assert.deepEqual(
    coordinateFromMinimapPoint(50, 30, bounds, 100, 60),
    [103.8, 1.35],
  );
  assert.deepEqual(
    coordinateFromMinimapPoint(-20, 80, bounds, 100, 60),
    [103.6, 1.2],
  );
});

test("filtered activities produce one density point per activity and venue", () => {
  const result = {
    events: [
      {
        activityId: "activity:a",
        matchingOccurrences: [
          {
            activityId: "activity:a",
            candidateCoordinates: [103.85, 1.29],
          },
          {
            activityId: "activity:a",
            candidateCoordinates: [103.85, 1.29],
          },
          {
            activityId: "activity:a",
            candidateCoordinates: [103.93, 1.35],
          },
        ],
      },
      {
        activityId: "activity:off-map",
        matchingOccurrences: [{ activityId: "activity:off-map" }],
      },
    ],
  };
  assert.deepEqual(densityPointsFromDiscoveryResult(result), [
    { activityId: "activity:a", coordinate: [103.85, 1.29] },
    { activityId: "activity:a", coordinate: [103.93, 1.35] },
  ]);
});

test("event density cells count filtered mapped points only", () => {
  const bounds = {
    minLongitude: 103.6,
    maxLongitude: 104,
    minLatitude: 1.2,
    maxLatitude: 1.5,
  };
  assert.deepEqual(
    eventDensityCells(
      [
        { activityId: "a", coordinate: [103.8, 1.35] },
        { activityId: "b", coordinate: [103.81, 1.35] },
        { activityId: "outside", coordinate: [104.2, 1.7] },
      ],
      bounds,
      4,
      3,
    ),
    [{ x: 2, y: 1, count: 2 }],
  );
});

test("Singapore geometry bounds include padding around every polygon", () => {
  const bounds = singaporeGeometryBounds({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [103.7, 1.2],
              [104, 1.2],
              [104, 1.45],
              [103.7, 1.45],
              [103.7, 1.2],
            ],
          ],
        },
      },
    ],
  });
  assert.ok(bounds.minLongitude < 103.7);
  assert.ok(bounds.maxLongitude > 104);
  assert.ok(bounds.minLatitude < 1.2);
  assert.ok(bounds.maxLatitude > 1.45);
});

test("the viewport rectangle grows as the main map view expands", () => {
  const singaporeBounds = {
    minLongitude: 103.6,
    maxLongitude: 104,
    minLatitude: 1.2,
    maxLatitude: 1.5,
  };
  const closeView = minimapViewportRectangle(
    { west: 103.8, east: 103.82, south: 1.3, north: 1.32 },
    singaporeBounds,
    100,
    60,
  );
  const wideView = minimapViewportRectangle(
    { west: 103.7, east: 103.9, south: 1.25, north: 1.4 },
    singaporeBounds,
    100,
    60,
  );
  assert.ok(closeView.width >= 2);
  assert.ok(closeView.height >= 2);
  assert.ok(wideView.width > closeView.width);
  assert.ok(wideView.height > closeView.height);
});
