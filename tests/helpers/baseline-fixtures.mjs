import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function deterministicClock(start = "2026-07-14T00:00:00.000Z") {
  let current = new Date(start);
  return {
    now: () => new Date(current),
    advance(milliseconds) {
      current = new Date(current.getTime() + milliseconds);
      return new Date(current);
    },
    set(value) {
      current = new Date(value);
      return new Date(current);
    },
  };
}

export function temporaryState(prefix = "whats-here-") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

export function sourceRecord(overrides = {}) {
  return {
    schemaVersion: "1.0",
    runId: "run-fixture",
    adapterId: "fixture-official-v1",
    adapterVersion: "1.0",
    sourceName: "Fixture Official",
    sourceUrl: "https://example.test/events/fixture",
    retrievedAt: "2026-07-14T00:00:00.000Z",
    requestedWindow: { start: "2026-07-14", end: "2026-07-21", timezone: "Asia/Singapore" },
    recordPointer: "raw/fixture/listing.json#/records/0",
    listingIdentity: "fixture-listing-1",
    payloadHash: "a".repeat(64),
    provenance: { method: "GET", page: 1 },
    ...overrides,
  };
}

export function venueEvidence(overrides = {}) {
  return {
    venueId: "venue-fixture",
    rawNames: ["Fixture Venue"],
    normalizedName: "fixture venue",
    eventIds: ["fixture:occurrence-1"],
    addressCandidates: ["1 Test Street, Singapore 000001"],
    postalCodes: ["000001"],
    coordinateCandidates: [{ lng: 103.85, lat: 1.29, source: "official" }],
    evidenceHash: "b".repeat(64),
    recoveryAttempts: [],
    candidateBuildings: [],
    resolutionStatus: "pending",
    ...overrides,
  };
}

export function approvedSnapshot(overrides = {}) {
  return {
    schemaVersion: "1.0",
    snapshotId: "snapshot-fixture",
    publishedAt: "2026-07-14T00:00:00.000Z",
    coveredWindow: { start: "2026-07-14", end: "2026-07-21", timezone: "Asia/Singapore" },
    freshness: "fresh",
    staleAfter: "2026-07-21T00:00:00.000Z",
    sourceHealth: {},
    landmarksRef: "landmarks.js",
    poisRef: "pois.js",
    tilesetRef: "poi-tiles/tileset.json",
    previousSnapshotId: null,
    contentHash: "c".repeat(64),
    ...overrides,
  };
}

export function anonymousPlan(overrides = {}) {
  return {
    schemaVersion: "1.0",
    title: "Fixture plan",
    travelMode: "walking",
    stops: [{ id: "event-1", type: "event", title: "Fixture event", place: "Fixture Venue", latitude: 1.29, longitude: 103.85 }],
    ...overrides,
  };
}

export function restaurant(overrides = {}) {
  return {
    id: "osm-node-1",
    name: "Fixture Restaurant",
    latitude: 1.29,
    longitude: 103.85,
    source: { id: "openstreetmap", costClass: "open" },
    ...overrides,
  };
}
