import assert from "node:assert/strict";
import test from "node:test";

import {
  ContextCoordinatorError,
  createContextCoordinator,
} from "../activity-scenes/assistant/context-coordinator.js";
import {
  createApplicationStateConnector,
  projectApplicationStateSnapshot,
} from "../activity-scenes/assistant/connectors/application-state-connector.js";

function createSource(connectorId, initial) {
  let state = structuredClone(initial);
  const listeners = new Set();
  return {
    connectorId,
    snapshot: () => structuredClone(state),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next) {
      state = structuredClone(next);
      for (const listener of listeners) listener();
    },
    listenerCount: () => listeners.size,
  };
}

const mapState = () => ({
  viewport: { zoom: 11, bearing: 0 },
  visibleTargets: [
    {
      targetId: "area:city-hall",
      type: "area",
      label: "City Hall",
    },
  ],
  focusedTargetId: null,
  selectedTargetIds: [],
  activeOverlayId: null,
  activeFilters: {},
});

const planningState = () => ({
  plan: {
    stopIds: [],
    travelMode: "walking",
    routeAvailable: false,
  },
  location: {
    permission: "granted",
    status: "fresh",
    coarseAreaId: "ura-subzone:city-hall",
    coordinates: [103.852, 1.293],
    accuracyMeters: 8,
  },
  transit: { visible: true, constraintActive: false },
  availableCapabilityIds: ["map.focustarget", "app.inspect"],
});

test("coordinator creates an immutable canonical snapshot and deterministic digest", async () => {
  const map = createSource("map", mapState());
  const planning = createSource("planning", planningState());
  const coordinator = createContextCoordinator({
    connectors: [map, planning],
  });

  const snapshot = await coordinator.start();
  assert.equal(snapshot.revision, 0);
  assert.match(snapshot.stateDigest, /^fnv1a64:[0-9a-f]{16}$/);
  assert.deepEqual(snapshot.visibleTargets, [
    {
      targetId: "area:city-hall",
      type: "area",
      label: "City Hall",
      ordinal: 1,
    },
  ]);
  assert.deepEqual(snapshot.availableCapabilityIds, [
    "app.inspect",
    "map.focustarget",
  ]);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.visibleTargets[0]), true);

  const sameStateDifferentConnectorOrder = createContextCoordinator({
    connectors: [planning, map],
  });
  const reordered = await sameStateDifferentConnectorOrder.start();
  assert.equal(reordered.stateDigest, snapshot.stateDigest);

  sameStateDifferentConnectorOrder.destroy();
  coordinator.destroy();
});

test("coordinator projects a bounded event facet catalogue", async () => {
  const source = createSource("events", {
    ...mapState(),
    eventFacetCatalog: {
      catalogRevision: "events:v4",
      what: ["Exhibitions", "Concerts"],
      when: ["Today"],
      where: ["Marina Bay"],
      price: ["Free"],
    },
  });
  const coordinator = createContextCoordinator({ connectors: [source] });

  const snapshot = await coordinator.start();

  assert.deepEqual(snapshot.eventFacetCatalog, {
    catalogRevision: "events:v4",
    what: ["Exhibitions", "Concerts"],
    when: ["Today"],
    where: ["Marina Bay"],
    price: ["Free"],
  });
  source.set({
    ...source.snapshot(),
    eventFacetCatalog: {
      ...source.snapshot().eventFacetCatalog,
      catalogRevision: "events:v5",
      where: ["Marina Bay", "Orchard"],
    },
  });
  const updated = await coordinator.waitForIdle();
  assert.equal(updated.revision, snapshot.revision + 1);
  assert.equal(updated.eventFacetCatalog.catalogRevision, "events:v5");
  assert.deepEqual(updated.eventFacetCatalog.where, ["Marina Bay", "Orchard"]);
  coordinator.destroy();
});

test("connector emissions publish only semantic changes with monotonic revisions", async () => {
  const map = createSource("map", mapState());
  const coordinator = createContextCoordinator({ connectors: [map] });
  await coordinator.start();
  const published = [];
  const unsubscribe = coordinator.subscribe((snapshot) =>
    published.push(snapshot.revision),
  );

  map.set(mapState());
  await coordinator.waitForIdle();
  assert.equal(coordinator.snapshot().revision, 0);
  assert.deepEqual(published, []);

  map.set({
    ...mapState(),
    viewport: { zoom: 12, bearing: 0 },
  });
  await coordinator.waitForIdle();
  assert.equal(coordinator.snapshot().revision, 1);
  assert.deepEqual(published, [1]);

  map.set({
    ...mapState(),
    viewport: { zoom: 13, bearing: 0 },
  });
  await coordinator.waitForIdle();
  assert.equal(coordinator.snapshot().revision, 2);
  assert.deepEqual(published, [1, 2]);

  unsubscribe();
  coordinator.destroy();
  assert.equal(map.listenerCount(), 0);
});

test("assistant presentation and individual layer changes publish semantic revisions", async () => {
  const source = createSource("interface", {
    ...mapState(),
    visibleLayers: {
      recommendations: true,
      location: true,
      mrtStations: true,
      mrtLines: true,
    },
    assistantPresentation: null,
  });
  const coordinator = createContextCoordinator({ connectors: [source] });
  const initial = await coordinator.start();

  source.set({
    ...source.snapshot(),
    assistantPresentation: "clarification",
  });
  const clarification = await coordinator.waitForIdle();
  assert.equal(clarification.revision, initial.revision + 1);
  assert.equal(clarification.assistantPresentation, "clarification");

  source.set({
    ...source.snapshot(),
    visibleLayers: {
      ...source.snapshot().visibleLayers,
      mrtLines: false,
    },
  });
  const hiddenLine = await coordinator.waitForIdle();
  assert.equal(hiddenLine.revision, clarification.revision + 1);
  assert.equal(hiddenLine.visibleLayers.mrtStations, true);
  assert.equal(hiddenLine.visibleLayers.mrtLines, false);

  coordinator.destroy();
});

test("waitForPublication blocks a dependent caller until the requested revision exists", async () => {
  const map = createSource("map", mapState());
  const coordinator = createContextCoordinator({ connectors: [map] });
  await coordinator.start();

  let settled = false;
  const waiting = coordinator.waitForPublication(1).then((snapshot) => {
    settled = true;
    return snapshot;
  });
  await Promise.resolve();
  assert.equal(settled, false);

  map.set({
    ...mapState(),
    activeOverlayId: "event-details",
  });
  const published = await waiting;
  assert.equal(published.revision, 1);
  assert.equal(published.activeOverlayId, "event-details");

  coordinator.destroy();
  await assert.rejects(
    coordinator.waitForPublication(2),
    (error) =>
      error instanceof ContextCoordinatorError &&
      error.code === "context_coordinator_destroyed",
  );
});

test("application-state connector returns a bounded app.inspect projection", async () => {
  const visibleTargets = Array.from({ length: 55 }, (_, index) => ({
    targetId: `event:${index}`,
    type: "event",
    label: `Event ${index}`,
    ordinal: index + 1,
    internal: "not public",
  }));
  const source = {
    revision: 7,
    stateDigest: "fnv1a64:0123456789abcdef",
    viewport: {
      zoom: 12,
      bearing: -30,
      bounds: [103.8, 1.2, 103.9, 1.4],
    },
    visibleTargets,
    focusedTargetId: "event:0",
    selectedTargetIds: ["event:0", "event:0", "event:54"],
    activeOverlayId: "event-details",
    activeFilters: {
      eventQuery: "music",
      eventWhat: ["Concert"],
      privateFilter: "omit",
    },
    plan: {
      stopIds: Array.from({ length: 25 }, (_, index) => `stop:${index}`),
      travelMode: "walking",
      routeAvailable: true,
      routeUrl: "https://example.invalid/private",
    },
    location: {
      permission: "granted",
      status: "fresh",
      coarseAreaId: "ura-subzone:city-hall",
      coordinates: [103.852, 1.293],
      accuracyMeters: 8,
    },
    transit: { visible: true, constraintActive: false, nearestStation: "X" },
    availableCapabilityIds: ["map.focustarget", "app.inspect"],
    privateState: "omit",
  };
  const coordinator = {
    snapshot: () => source,
    subscribe: () => () => {},
  };
  const connector = createApplicationStateConnector({ coordinator });

  assert.equal(connector.connectorId, "application-state");
  assert.deepEqual(connector.capabilityIds, ["app.inspect"]);
  assert.equal(connector.availability(), "available");
  const result = await connector.query("app.inspect", {});

  assert.deepEqual(result, projectApplicationStateSnapshot(source));
  assert.equal(result.visibleTargets.length, 50);
  assert.equal(result.plan.stopIds.length, 20);
  assert.deepEqual(result.selectedTargetIds, ["event:0"]);
  assert.equal("coordinates" in result.location, false);
  assert.equal("bounds" in result.viewport, false);
  assert.equal("privateState" in result, false);
  assert.equal("privateFilter" in result.activeFilters, false);

  await assert.rejects(
    connector.query("catalog.search", {}),
    (error) => error.code === "capability_unsupported",
  );
  await assert.rejects(
    connector.query("app.inspect", { extra: true }),
    (error) => error.code === "capability_arguments_invalid",
  );
});
