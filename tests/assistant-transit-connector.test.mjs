import assert from "node:assert/strict";
import test from "node:test";

import { createContextCoordinator } from "../activity-scenes/assistant/context-coordinator.js";
import {
  TransitConnectorError,
  createTransitConnector,
} from "../activity-scenes/assistant/connectors/transit-connector.js";

function transitOwnerFixture({
  visibility = { mrtStations: true, mrtLines: true },
  constraintActive = false,
  assetStatus = "approved",
} = {}) {
  const state = {
    visibility: { ...visibility },
    constraintActive,
    assetStatus,
    stationCount: 172,
    lineCount: 9,
  };
  const calls = [];
  const listeners = new Set();
  const emit = () => {
    for (const listener of listeners) listener(structuredClone(state));
  };
  return {
    calls,
    snapshot: () => structuredClone(state),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setLayerVisibility(layer, visible) {
      calls.push(["setLayerVisibility", layer, visible]);
      const changed = state.visibility[layer] !== visible;
      state.visibility[layer] = visible;
      if (changed) emit();
      return changed;
    },
    setConstraintActive(active, metadata) {
      calls.push(["setConstraintActive", active, metadata]);
      const changed = state.constraintActive !== active;
      state.constraintActive = active;
      if (changed) emit();
      return changed;
    },
  };
}

test("transit snapshot reports bounded approved asset and presentation state", () => {
  const connector = createTransitConnector({
    transitController: transitOwnerFixture(),
  });
  const snapshot = connector.snapshot();

  assert.equal(connector.connectorId, "transit");
  assert.equal(connector.availability(), "available");
  assert.deepEqual(connector.capabilityIds, []);
  assert.equal(snapshot.assetStatus, "approved");
  assert.equal(snapshot.stationCount, 172);
  assert.equal(snapshot.lineCount, 9);
  assert.deepEqual(snapshot.visibility, {
    mrtStations: true,
    mrtLines: true,
  });
  assert.deepEqual(snapshot.transit, {
    visible: true,
    constraintActive: false,
  });
  assert.equal(Object.hasOwn(snapshot, "stations"), false);
  assert.equal(Object.hasOwn(snapshot, "lines"), false);
});

test("station and line visibility delegate show and hide independently", async () => {
  const owner = transitOwnerFixture();
  const connector = createTransitConnector({ transitController: owner });

  assert.equal(await connector.setLayerVisibility("mrtStations", false), true);
  assert.equal(await connector.setLayerVisibility("mrtStations", true), true);
  assert.equal(await connector.setLayerVisibility("mrtLines", false), true);
  assert.equal(await connector.setLayerVisibility("mrtLines", true), true);
  assert.deepEqual(owner.calls, [
    ["setLayerVisibility", "mrtStations", false],
    ["setLayerVisibility", "mrtStations", true],
    ["setLayerVisibility", "mrtLines", false],
    ["setLayerVisibility", "mrtLines", true],
  ]);
});

test("presentation visibility never activates the ranking constraint", async () => {
  const owner = transitOwnerFixture();
  const connector = createTransitConnector({ transitController: owner });

  await connector.setVisible(false);
  assert.deepEqual(connector.snapshot().visibility, {
    mrtStations: false,
    mrtLines: false,
  });
  assert.equal(connector.snapshot().constraintActive, false);
  await connector.setVisible(true);
  assert.equal(connector.snapshot().transit.visible, true);
  assert.equal(connector.snapshot().constraintActive, false);

  await assert.rejects(
    connector.setConstraintActive(true),
    (error) =>
      error instanceof TransitConnectorError &&
      error.code === "transit_constraint_not_explicit",
  );
  assert.equal(
    await connector.setConstraintActive(true, {
      explicitlyRequested: true,
    }),
    true,
  );
  await connector.setLayerVisibility("mrtStations", false);
  assert.equal(connector.snapshot().constraintActive, true);
  assert.equal(await connector.setConstraintActive(false), true);
  assert.equal(connector.snapshot().constraintActive, false);
});

test("direct and assistant-originated changes share one transit owner and context", async () => {
  const owner = transitOwnerFixture();
  const connector = createTransitConnector({ transitController: owner });
  const coordinator = createContextCoordinator({ connectors: [connector] });
  const initial = await coordinator.start();

  owner.setLayerVisibility("mrtLines", false);
  assert.deepEqual(connector.snapshot().visibility, {
    mrtStations: true,
    mrtLines: false,
  });

  await connector.setLayerVisibility("mrtStations", false);
  const assistant = await coordinator.waitForPublication(initial.revision + 1);
  assert.deepEqual(assistant.transit, {
    visible: false,
    constraintActive: false,
  });
  assert.deepEqual(owner.calls, [
    ["setLayerVisibility", "mrtLines", false],
    ["setLayerVisibility", "mrtStations", false],
  ]);
  coordinator.destroy();
});

test("whole-layer fallback remains honest when the shared owner is all-or-none", async () => {
  let visible = true;
  const calls = [];
  const connector = createTransitConnector({
    transitLayerManager: {
      getStations: () => [{ properties: { stationId: "mrt:one" } }],
      setVisible(nextVisible) {
        calls.push(nextVisible);
        const changed = visible !== nextVisible;
        visible = nextVisible;
        return changed;
      },
    },
  });

  assert.equal(await connector.setLayerVisibility("mrtStations", false), true);
  assert.deepEqual(connector.snapshot().visibility, {
    mrtStations: false,
    mrtLines: false,
  });
  assert.deepEqual(calls, [false]);
});

test("unapproved assets, invalid layers, and destruction fail closed", async () => {
  const connector = createTransitConnector({
    transitController: transitOwnerFixture({ assetStatus: "review" }),
  });
  assert.equal(connector.availability(), "unavailable");
  await assert.rejects(
    connector.setLayerVisibility("privateRail", true),
    (error) =>
      error instanceof TransitConnectorError &&
      error.code === "transit_layer_invalid",
  );
  connector.destroy();
  assert.equal(connector.availability(), "disabled");
  assert.throws(
    () => connector.snapshot(),
    (error) =>
      error instanceof TransitConnectorError &&
      error.code === "transit_connector_destroyed",
  );
});
