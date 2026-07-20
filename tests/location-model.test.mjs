import assert from "node:assert/strict";
import test from "node:test";

import { createLocationController } from "../activity-scenes/location/location-controller.js";
import { createLocationModel } from "../activity-scenes/location/location-model.js";

const POSITION = {
  coords: { longitude: 103.851, latitude: 1.293, accuracy: 24 },
  timestamp: 1_000,
};

test("location is permission-gated and exact coordinates are minimized by default", () => {
  let now = 1_000;
  const model = createLocationModel({
    now: () => now,
    resolveCoarseArea: ([longitude]) =>
      longitude > 103.85 ? "ura-subzone:city-hall" : null,
  });
  assert.deepEqual(model.snapshot(), {
    permission: "prompt",
    status: "idle",
    accuracyMeters: null,
    observedAt: null,
    coarseAreaId: null,
    errorCode: null,
  });

  model.beginRequest();
  model.receivePosition({
    coordinates: [103.851, 1.293],
    accuracyMeters: 24,
    observedAt: now,
  });
  const coarse = model.snapshot();
  assert.equal(Object.hasOwn(coarse, "coordinates"), false);
  assert.equal(coarse.permission, "granted");
  assert.equal(coarse.status, "fresh");
  assert.equal(coarse.accuracyMeters, 24);
  assert.equal(coarse.coarseAreaId, "ura-subzone:city-hall");
  assert.deepEqual(
    model.snapshot({ includeExact: true }).coordinates,
    [103.851, 1.293],
  );

  now += 1;
  assert.throws(
    () => model.receivePosition({ coordinates: [181, 1.2], accuracyMeters: 4 }),
    TypeError,
  );
});

test("freshness, approximate accuracy, denied, and unavailable states never imply precision", () => {
  let now = 10_000;
  const model = createLocationModel({ now: () => now, staleAfterMs: 5_000 });
  model.receivePosition({
    coordinates: [103.8, 1.3],
    accuracyMeters: 1_500,
    observedAt: now,
  });
  assert.equal(model.snapshot().accuracyMeters, 1_500);
  assert.equal(model.snapshot().status, "fresh");

  now += 5_001;
  assert.equal(model.refresh().status, "stale");
  assert.deepEqual(
    model.snapshot({ includeExact: true }).coordinates,
    [103.8, 1.3],
  );

  model.setPermission("denied");
  assert.equal(model.snapshot().status, "error");
  assert.equal(model.snapshot().errorCode, "denied");
  assert.equal(model.snapshot({ includeExact: true }).coordinates, null);

  model.setPermission("unavailable");
  assert.equal(model.snapshot().permission, "unavailable");
  assert.equal(model.snapshot({ includeExact: true }).coordinates, null);
});

test("subscribers share one in-memory truth and cleanup removes exact state", () => {
  const model = createLocationModel({ now: () => 2_000 });
  const states = [];
  const unsubscribe = model.subscribe((snapshot) => states.push(snapshot));
  model.beginRequest();
  model.receivePosition({
    coordinates: [103.851, 1.293],
    accuracyMeters: 12,
    observedAt: 2_000,
  });
  assert.deepEqual(
    states.map(({ status }) => status),
    ["idle", "locating", "fresh"],
  );
  unsubscribe();
  model.clearExact();
  assert.equal(states.length, 3);
  assert.equal(model.snapshot({ includeExact: true }).coordinates, null);
  model.destroy();
  assert.deepEqual(model.snapshot({ includeExact: true }), {
    permission: "prompt",
    status: "idle",
    accuracyMeters: null,
    observedAt: null,
    coarseAreaId: null,
    errorCode: null,
    coordinates: null,
  });
});

test("controller owns one explicit geolocation request and one shared watch", async () => {
  let requestSuccess;
  let watchSuccess;
  let watchError;
  const cleared = [];
  let watchCalls = 0;
  const geolocation = {
    getCurrentPosition(success) {
      requestSuccess = success;
    },
    watchPosition(success, error) {
      watchCalls += 1;
      watchSuccess = success;
      watchError = error;
      return 17;
    },
    clearWatch(id) {
      cleared.push(id);
    },
  };
  const controller = createLocationController({
    geolocation,
    permissions: null,
    model: createLocationModel({ now: () => 1_000 }),
  });
  const request = controller.requestLocation();
  assert.equal(controller.snapshot().status, "locating");
  requestSuccess(POSITION);
  assert.equal((await request).status, "fresh");

  assert.equal(await controller.startWatch(), true);
  assert.equal(await controller.startWatch(), false);
  assert.equal(watchCalls, 1);
  watchSuccess({ ...POSITION, coords: { ...POSITION.coords, accuracy: 8 } });
  assert.equal(controller.snapshot().accuracyMeters, 8);
  watchError({ code: 2 });
  assert.equal(controller.snapshot().permission, "unavailable");
  assert.equal(controller.stopWatch({ clearExact: true }), true);
  assert.deepEqual(cleared, [17]);
  assert.equal(controller.snapshot({ includeExact: true }).coordinates, null);
});

test("permission denial, missing APIs, and controller destruction clear owned resources", async () => {
  let permissionListener;
  const permissionStatus = {
    state: "prompt",
    addEventListener(_event, listener) {
      permissionListener = listener;
    },
    removeEventListener(_event, listener) {
      assert.equal(listener, permissionListener);
      permissionListener = null;
    },
  };
  let rejectRequest;
  const geolocation = {
    getCurrentPosition(_success, error) {
      rejectRequest = error;
    },
    watchPosition() {
      return 4;
    },
    clearWatch() {},
  };
  const controller = createLocationController({
    geolocation,
    permissions: { query: async () => permissionStatus },
  });
  const request = controller.requestLocation();
  await Promise.resolve();
  rejectRequest({ code: 1 });
  assert.equal((await request).permission, "denied");
  assert.equal(controller.snapshot({ includeExact: true }).coordinates, null);
  controller.destroy();
  assert.equal(permissionListener, null);

  const unavailable = createLocationController({
    geolocation: null,
    permissions: null,
  });
  assert.equal((await unavailable.requestLocation()).permission, "unavailable");
  assert.equal(unavailable.snapshot({ includeExact: true }).coordinates, null);
});
