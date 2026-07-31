import assert from "node:assert/strict";
import test from "node:test";

import {
  ApprovedCatalogConnectorError,
  createApprovedCatalogConnector,
} from "../activity-scenes/assistant/connectors/approved-catalog-connector.js";
import { createAppInspectQuery } from "../activity-scenes/assistant/queries/app-inspect.js";
import {
  CatalogSearchError,
  searchCatalog,
} from "../activity-scenes/assistant/queries/catalog-search.js";
import {
  CatalogGetError,
  getCatalogItems,
} from "../activity-scenes/assistant/queries/catalog-get.js";

function provider(connectorId, revision, items) {
  let state = { revision, items: structuredClone(items) };
  const listeners = new Set();
  return {
    connectorId,
    snapshot: () => structuredClone(state),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update(nextRevision, nextItems = state.items) {
      state = { revision: nextRevision, items: structuredClone(nextItems) };
      for (const listener of listeners) listener();
    },
    listenerCount: () => listeners.size,
  };
}

const eventItem = (index) => ({
  candidateId: `event:${String(index).padStart(2, "0")}`,
  candidateType: "event",
  sourceSnapshotId: "events-v1",
  areaId: "ura-subzone:city-hall",
  coordinates: [103.85 + index / 10_000, 1.29],
  attributes: {
    name: `Music event ${String(index).padStart(2, "0")}`,
    venue: "Fixture Hall",
    category: "Music",
    price: index === 0 ? "Free" : "$20",
    startDate: "2026-08-01",
    eventUrl: "https://example.invalid/raw",
    privateNotes: "omit",
  },
  evidenceRefs: ["approved-source:event"],
  description: "Tickets at https://example.invalid/raw",
  rawHtml: "<p>omit</p>",
});

const restaurantItem = {
  candidateId: "restaurant:42",
  candidateType: "restaurant",
  sourceSnapshotId: "restaurants-v2",
  areaId: "ura-subzone:city-hall",
  coordinates: [103.852, 1.293],
  attributes: {
    name: "Fixture Café",
    cuisine: "Cafe",
    category: "food",
    dealCount: 2,
    website: "https://example.invalid/raw",
  },
  evidenceRefs: ["approved-source:restaurant"],
};

test("approved catalogue composes ordered provenance and stable projection", async () => {
  const events = provider(
    "events",
    "events-v1",
    Array.from({ length: 25 }, (_, index) => eventItem(index)),
  );
  const restaurants = provider("restaurants", "restaurants-v2", [
    restaurantItem,
  ]);
  const connector = createApprovedCatalogConnector({
    providers: [restaurants, events],
  });

  const snapshot = await connector.snapshot();
  assert.deepEqual(snapshot.sources, [
    { connectorId: "events", revision: "events-v1" },
    { connectorId: "restaurants", revision: "restaurants-v2" },
  ]);
  assert.match(snapshot.catalogRevision, /^fnv1a64:[0-9a-f]{16}$/);
  assert.equal(snapshot.items.length, 26);
  assert.equal(snapshot.items[0].targetId, "event:00");
  assert.deepEqual(snapshot.items.at(-1), {
    targetId: "restaurant:42",
    type: "restaurant",
    label: "Fixture Café",
    summary: null,
    attributes: {
      areaId: "ura-subzone:city-hall",
      category: "food",
      cuisine: "Cafe",
      dealCount: 2,
    },
  });
  assert.equal(JSON.stringify(snapshot).includes("coordinates"), false);
  assert.equal(JSON.stringify(snapshot).includes("https://"), false);
  assert.equal(JSON.stringify(snapshot).includes("rawHtml"), false);
  assert.equal(snapshot.items[0].summary, null);

  const reverseRegistration = createApprovedCatalogConnector({
    providers: [events, restaurants],
  });
  const reverseSnapshot = await reverseRegistration.snapshot();
  assert.equal(reverseSnapshot.catalogRevision, snapshot.catalogRevision);
  reverseRegistration.destroy();
  connector.destroy();
});

test("catalog.search has deterministic bounded pages, totals, and cursor semantics", async () => {
  const connector = createApprovedCatalogConnector({
    providers: [
      provider(
        "events",
        "events-v1",
        Array.from({ length: 25 }, (_, index) => eventItem(index)),
      ),
      provider("restaurants", "restaurants-v2", [restaurantItem]),
    ],
  });
  const catalog = await connector.snapshot();

  const first = searchCatalog(catalog, {
    query: "music",
    types: ["event"],
    limit: 20,
  });
  assert.equal(first.total, 25);
  assert.equal(first.items.length, 20);
  assert.equal(first.truncated, true);
  assert.match(first.nextCursor, /^v1:[0-9a-f]{16}:20$/);
  assert.deepEqual(first.types, ["event"]);

  const second = searchCatalog(catalog, {
    query: "music",
    types: ["event"],
    limit: 20,
    cursor: first.nextCursor,
  });
  assert.equal(second.total, 5);
  assert.equal(second.items.length, 5);
  assert.equal(second.truncated, false);
  assert.equal(second.nextCursor, null);
  assert.equal(second.truncated, second.total > second.items.length);
  assert.deepEqual(
    [...first.items, ...second.items].map(({ targetId }) => targetId),
    Array.from(
      { length: 25 },
      (_, index) => `event:${String(index).padStart(2, "0")}`,
    ),
  );

  assert.throws(
    () =>
      searchCatalog(catalog, {
        query: "different",
        types: ["event"],
        cursor: first.nextCursor,
      }),
    (error) =>
      error instanceof CatalogSearchError &&
      error.code === "catalog_cursor_invalid",
  );
  assert.throws(
    () => searchCatalog(catalog, { limit: 21 }),
    (error) =>
      error instanceof CatalogSearchError &&
      error.code === "catalog_search_arguments_invalid",
  );
  connector.destroy();
});

test("catalog.get returns requested known IDs and reports unknown IDs", async () => {
  const connector = createApprovedCatalogConnector({
    providers: [
      provider("events", "events-v1", [eventItem(0)]),
      provider("restaurants", "restaurants-v2", [restaurantItem]),
    ],
  });
  const catalog = await connector.snapshot();
  const result = getCatalogItems(catalog, {
    targetIds: ["restaurant:42", "event:missing", "event:00"],
  });

  assert.deepEqual(
    result.items.map(({ targetId }) => targetId),
    ["restaurant:42", "event:00"],
  );
  assert.deepEqual(result.missingTargetIds, ["event:missing"]);
  assert.equal(result.catalogRevision, catalog.catalogRevision);
  assert.deepEqual(result.sources, catalog.sources);

  assert.throws(
    () =>
      getCatalogItems(catalog, {
        targetIds: Array.from({ length: 11 }, (_, index) => `event:${index}`),
      }),
    (error) =>
      error instanceof CatalogGetError &&
      error.code === "catalog_get_arguments_invalid",
  );
  connector.destroy();
});

test("provider lifecycle invalidates catalogue state and fails closed on duplicate IDs", async () => {
  const events = provider("events", "events-v1", [eventItem(0)]);
  const connector = createApprovedCatalogConnector({ providers: [events] });
  const revisions = [];
  connector.subscribe((change) => revisions.push(change));

  const first = await connector.snapshot();
  events.update("events-v2", [eventItem(0), eventItem(1)]);
  assert.equal(revisions.length, 1);
  const second = await connector.snapshot();
  assert.notEqual(second.catalogRevision, first.catalogRevision);

  const duplicate = provider("restaurants", "restaurants-v1", [
    {
      ...restaurantItem,
      candidateId: "event:00",
    },
  ]);
  const unregister = connector.registerProvider(duplicate);
  await assert.rejects(
    connector.snapshot(),
    (error) =>
      error instanceof ApprovedCatalogConnectorError &&
      error.code === "catalog_target_duplicate",
  );
  unregister();
  assert.equal(duplicate.listenerCount(), 0);

  connector.destroy();
  assert.equal(events.listenerCount(), 0);
});

test("app.inspect delegates closed arguments to the application-state owner", async () => {
  const expected = {
    revision: 4,
    stateDigest: "fnv1a64:0123456789abcdef",
  };
  const calls = [];
  const query = createAppInspectQuery({
    applicationStateConnector: {
      query: async (capabilityId, args) => {
        calls.push({ capabilityId, args });
        return expected;
      },
    },
  });

  assert.equal(await query({}), expected);
  assert.deepEqual(calls, [{ capabilityId: "app.inspect", args: {} }]);
  await assert.rejects(
    query({ extra: true }),
    (error) => error.code === "app_inspect_arguments_invalid",
  );
});
