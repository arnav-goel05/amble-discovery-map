import assert from "node:assert/strict";
import test from "node:test";

import { createContextCoordinator } from "../activity-scenes/assistant/context-coordinator.js";
import {
  LocationConnectorError,
  createLocationConnector,
} from "../activity-scenes/assistant/connectors/location-connector.js";

function locationOwnerFixture(
  initial = {
    permission: "prompt",
    status: "idle",
    coordinates: null,
    accuracyMeters: null,
    observedAt: null,
    coarseAreaId: null,
  },
) {
  let state = structuredClone(initial);
  const calls = [];
  const listeners = new Set();
  const emit = () => {
    for (const listener of listeners) listener(structuredClone(state));
  };
  return {
    calls,
    snapshot: () => structuredClone(state),
    subscribe(listener, { emitCurrent = true } = {}) {
      listeners.add(listener);
      if (emitCurrent) listener(structuredClone(state));
      return () => listeners.delete(listener);
    },
    async requestLocation() {
      calls.push(["requestLocation"]);
      state = {
        permission: "granted",
        status: "fresh",
        coordinates: [103.851, 1.293],
        accuracyMeters: 8,
        observedAt: 1_721_280_000_000,
        coarseAreaId: "ura-subzone:downtown-core",
      };
      emit();
      return structuredClone(state);
    },
    replace(next) {
      state = { ...state, ...structuredClone(next) };
      emit();
    },
  };
}

function layerFixture(initialVisible = true) {
  let visible = initialVisible;
  const calls = [];
  return {
    calls,
    setVisible(nextVisible) {
      calls.push(["setVisible", nextVisible]);
      const changed = visible !== nextVisible;
      visible = nextVisible;
      return changed;
    },
    focusLocation() {
      calls.push(["focusLocation"]);
      return visible;
    },
  };
}

test("location snapshot exposes only coarse permission and freshness state", () => {
  const owner = locationOwnerFixture({
    permission: "granted",
    status: "fresh",
    coordinates: [103.851, 1.293],
    accuracyMeters: 4,
    observedAt: 1_721_280_000_000,
    coarseAreaId: `ura-subzone:${"x".repeat(400)}`,
  });
  const connector = createLocationConnector({
    locationController: owner,
    locationLayerManager: layerFixture(),
  });

  const snapshot = connector.snapshot();
  assert.equal(connector.connectorId, "location");
  assert.equal(connector.availability(), "available");
  assert.deepEqual(snapshot.availableCapabilityIds, [
    "plan.uselocation",
    "plan.focuslocation",
  ]);
  assert.equal(snapshot.location.coarseAreaId.length, 256);
  assert.doesNotMatch(
    JSON.stringify(snapshot),
    /coordinates|accuracyMeters|observedAt|103\\.851|1\\.293/,
  );
});

test("assistant location commands delegate to the same shared owners as direct controls", async () => {
  const owner = locationOwnerFixture();
  const layers = layerFixture();
  const connector = createLocationConnector({
    locationController: owner,
    locationLayerManager: layers,
  });

  const located = await connector.execute("plan.uselocation", {});
  assert.equal(located.changed, true);
  assert.deepEqual(located.affectedTargetIds, ["location:current"]);
  assert.deepEqual(located.data.location, {
    permission: "granted",
    status: "fresh",
    coarseAreaId: "ura-subzone:downtown-core",
  });
  assert.deepEqual(located.contextPatch, {
    location: located.data.location,
    availableCapabilityIds: ["plan.uselocation", "plan.focuslocation"],
  });
  assert.doesNotMatch(JSON.stringify(located), /coordinates|accuracyMeters/);

  layers.focusLocation();
  const focused = await connector.execute("plan.focuslocation", {});
  assert.equal(focused.changed, true);
  assert.deepEqual(layers.calls, [["focusLocation"], ["focusLocation"]]);
  assert.deepEqual(owner.calls, [["requestLocation"]]);
});

test("permission and freshness changes update eligibility without leaking exact state", async () => {
  const owner = locationOwnerFixture();
  const connector = createLocationConnector({
    locationController: owner,
    locationLayerManager: layerFixture(),
  });
  const coordinator = createContextCoordinator({ connectors: [connector] });
  const initial = await coordinator.start();

  owner.replace({
    permission: "denied",
    status: "error",
    coordinates: null,
    coarseAreaId: null,
  });
  const denied = await coordinator.waitForPublication(initial.revision + 1);
  assert.deepEqual(denied.location, {
    permission: "denied",
    status: "error",
    coarseAreaId: null,
  });
  assert.deepEqual(connector.snapshot().availableCapabilityIds, []);
  await assert.rejects(
    connector.execute("plan.uselocation", {}),
    (error) =>
      error instanceof LocationConnectorError &&
      error.code === "location_unavailable",
  );

  owner.replace({
    permission: "granted",
    status: "stale",
    coordinates: [103.8, 1.3],
    coarseAreaId: "ura-subzone:orchard",
  });
  assert.equal(connector.isEligible("plan.focuslocation"), true);
  assert.doesNotMatch(JSON.stringify(connector.snapshot()), /103\\.8|1\\.3/);
  coordinator.destroy();
});

test("location visibility delegates both directions and publishes bounded state", () => {
  const layers = layerFixture(false);
  const connector = createLocationConnector({
    locationController: locationOwnerFixture(),
    locationLayerManager: layers,
    initialVisible: false,
  });
  const changes = [];
  connector.subscribe((snapshot) => changes.push(snapshot));

  assert.equal(connector.setVisible(true), true);
  assert.equal(connector.snapshot().visible, true);
  assert.equal(connector.setVisible(false), true);
  assert.equal(connector.snapshot().visible, false);
  assert.equal(connector.setVisible(false), false);
  assert.deepEqual(layers.calls, [
    ["setVisible", true],
    ["setVisible", false],
    ["setVisible", false],
  ]);
  assert.equal(changes.length, 2);
});

test("location connector validates ownership and cleans up subscriptions", () => {
  assert.throws(
    () => createLocationConnector(),
    (error) =>
      error instanceof LocationConnectorError &&
      error.code === "location_owner_invalid",
  );
  const owner = locationOwnerFixture();
  const connector = createLocationConnector({
    locationController: owner,
    locationLayerManager: layerFixture(),
  });
  connector.destroy();
  assert.equal(connector.availability(), "disabled");
  assert.throws(
    () => connector.snapshot(),
    (error) =>
      error instanceof LocationConnectorError &&
      error.code === "location_connector_destroyed",
  );
});
