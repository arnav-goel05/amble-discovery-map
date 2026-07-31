import assert from "node:assert/strict";
import test from "node:test";

import { clusterEventLocations } from "../activity-scenes/landmark-event-clusters.js";

const location = (id, x, y, lng = x, lat = y) => ({
  id,
  label: id.toUpperCase(),
  lat,
  lng,
  x,
  y,
});

test("clusters each valid location exactly once with deterministic keys", () => {
  const input = [
    location("charlie", 140, 100),
    location("alpha", 10, 10),
    location("bravo", 50, 10),
  ];

  const forward = clusterEventLocations(input, { radius: 72 });
  const reversed = clusterEventLocations([...input].reverse(), { radius: 72 });

  assert.deepEqual(forward, reversed);
  assert.equal(forward.length, 2);
  assert.deepEqual(
    forward.map(({ key, count, memberIds }) => ({
      count,
      key,
      memberIds,
    })),
    [
      {
        count: 2,
        key: "alpha\u001fbravo",
        memberIds: ["alpha", "bravo"],
      },
      {
        count: 1,
        key: "charlie",
        memberIds: ["charlie"],
      },
    ],
  );
  assert.equal(
    forward.reduce((total, cluster) => total + cluster.count, 0),
    3,
  );
});

test("connects locations across adjacent spatial hash cells", () => {
  const clusters = clusterEventLocations(
    [location("west", 71, 30), location("east", 73, 30)],
    { radius: 72 },
  );

  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].count, 2);
  assert.equal(clusters[0].x, 72);
  assert.equal(clusters[0].y, 30);
});

test("uses transitive proximity while keeping distant locations separate", () => {
  const clusters = clusterEventLocations(
    [
      location("one", 0, 0),
      location("two", 60, 0),
      location("three", 120, 0),
      location("far", 240, 0),
    ],
    { radius: 72 },
  );

  assert.deepEqual(
    clusters.map(({ memberIds }) => memberIds),
    [["far"], ["one", "three", "two"]],
  );
});

test("greater projected separation splits a previously merged group", () => {
  const near = clusterEventLocations(
    [location("one", 10, 10), location("two", 70, 10)],
    { radius: 72 },
  );
  const zoomed = clusterEventLocations(
    [location("one", 10, 10), location("two", 150, 10)],
    { radius: 72 },
  );

  assert.equal(near.length, 1);
  assert.equal(zoomed.length, 2);
  assert.equal(
    zoomed.reduce((total, cluster) => total + cluster.count, 0),
    2,
  );
});

test("deduplicates stable identities and ignores malformed locations", () => {
  const clusters = clusterEventLocations(
    [
      location("valid", 20, 30, 103.8, 1.3),
      location("valid", 21, 31, 103.81, 1.31),
      location("", 20, 30),
      { id: "bad-x", x: Number.NaN, y: 1, lng: 1, lat: 1 },
      { id: "bad-anchor", x: 1, y: 1, lng: null, lat: 1 },
      null,
    ],
    { radius: 72 },
  );

  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].count, 1);
  assert.deepEqual(clusters[0].memberIds, ["valid"]);
  assert.deepEqual(clusters[0].bounds, {
    east: 103.8,
    north: 1.3,
    south: 1.3,
    west: 103.8,
  });
});

test("returns no clusters for empty input or an invalid radius", () => {
  assert.deepEqual(clusterEventLocations([]), []);
  assert.deepEqual(clusterEventLocations(null), []);
  assert.throws(
    () => clusterEventLocations([location("one", 0, 0)], { radius: 0 }),
    /radius must be a positive finite number/i,
  );
});
