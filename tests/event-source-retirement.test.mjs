import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  loadApprovedSnapshot,
  stageImmutableSnapshot,
  activateStagedSnapshot,
} from "../scripts/lib/approved-snapshot.mjs";
import {
  retireApprovedSnapshotSources,
  stripRetiredEvent,
} from "../scripts/retire-event-sources.mjs";
import { temporaryState } from "./helpers/baseline-fixtures.mjs";

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

test("offline retirement removes retired-only events and preserves mixed contributions", () => {
  const retired = new Set(["Retired Guide"]);
  assert.equal(
    stripRetiredEvent(
      { sources: [{ source: "Retired Guide", sourceId: "one" }] },
      retired,
    ),
    null,
  );
  assert.deepEqual(
    stripRetiredEvent(
      {
        id: "mixed",
        sources: [
          { source: "Catch.sg", sourceId: "one" },
          { source: "Retired Guide", sourceId: "two" },
        ],
      },
      retired,
    ).sources,
    [{ source: "Catch.sg", sourceId: "one" }],
  );
});

test("offline retirement creates a new immutable snapshot without recollection", () => {
  const state = temporaryState();
  const artifacts = {
    "landmarks.json": json([
      {
        id: "place",
        events: [
          { id: "keep", sources: [{ source: "Catch.sg", sourceId: "one" }] },
          {
            id: "drop",
            sources: [{ source: "Retired Guide", sourceId: "two" }],
          },
        ],
      },
    ]),
    "pois.json": json([{ id: "place" }, { id: "unrelated-poi" }]),
    "tileset.json": json({
      root: {
        children: [
          { extras: { poiId: "place" } },
          { extras: { poiId: "unrelated-poi" } },
        ],
      },
    }),
    "events.json": json({
      schemaVersion: "3.1",
      mapped: [],
      offMap: [],
      counts: { active: 0, mapped: 0, offMap: 0 },
    }),
  };
  try {
    const first = stageImmutableSnapshot({
      root: state.root,
      snapshot: {
        schemaVersion: "1.0",
        snapshotId: "before",
        publishedAt: "2026-07-20T00:00:00.000Z",
        coveredWindow: {
          start: "2026-07-20",
          end: "2026-07-27",
          timezone: "Asia/Singapore",
        },
        freshness: "fresh",
        staleAfter: "2026-07-27T00:00:00.000Z",
        sourceHealth: { "Catch.sg": {}, "Retired Guide": {} },
        previousSnapshotId: null,
        landmarksRef: "landmarks.json",
        poisRef: "pois.json",
        tilesetRef: "tileset.json",
        eventsRef: "events.json",
      },
      artifacts,
      commitEligibility: { eligible: true },
    });
    activateStagedSnapshot({ root: state.root, staged: first });
    const result = retireApprovedSnapshotSources({
      root: state.root,
      sourceNames: ["Retired Guide"],
      apply: true,
      now: new Date("2026-07-23T00:00:00.000Z"),
      snapshotId: "after",
    });
    assert.deepEqual(result, {
      removedEvents: 1,
      removedLandmarks: 0,
      landmarks: 1,
      pois: 2,
      snapshotId: "after",
      applied: true,
    });
    const active = loadApprovedSnapshot({ root: state.root });
    assert.equal(active.snapshotId, "after");
    assert.deepEqual(Object.keys(active.sourceHealth), ["Catch.sg"]);
    const landmarks = JSON.parse(
      fs.readFileSync(path.join(active.directory, active.landmarksRef), "utf8"),
    );
    assert.deepEqual(
      landmarks[0].events.map(({ id }) => id),
      ["keep"],
    );
    const pois = JSON.parse(
      fs.readFileSync(path.join(active.directory, active.poisRef), "utf8"),
    );
    assert.deepEqual(
      pois.map(({ id }) => id),
      ["place", "unrelated-poi"],
    );
  } finally {
    state.cleanup();
  }
});
