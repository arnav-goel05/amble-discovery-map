import assert from "node:assert/strict";
import test from "node:test";

import {
  createEventDiscoveryModel,
  eventCandidateIdentity,
  reconcileEventSelection,
} from "../activity-scenes/events/event-discovery-model.js";

const landmarks = [
  {
    id: "library",
    label: "National Library",
    anchor: { lng: 103.854, lat: 1.298 },
    events: [
      {
        id: "late",
        title: "Journey to the West",
        venue: "Drama Centre",
        dateText: "15 Jul 2026",
        startDateTime: "2026-07-15T19:00:00+08:00",
        category: "Performances",
        price: "S$35-S$60",
      },
      {
        id: "early",
        title: "Architecture Talk",
        venue: "Drama Centre",
        dateText: "14 Jul 2026",
        startDateTime: "2026-07-14T10:00:00+08:00",
        category: "Workshops & Classes",
        price: "Free",
      },
    ],
  },
  {
    id: "museum",
    label: "National Museum",
    anchor: { lng: 103.848, lat: 1.296 },
    events: [
      {
        id: "exhibition",
        title: "História Café",
        venue: "Gallery One",
        dateText: "14-21 Jul 2026",
        category: "Exhibitions",
      },
    ],
  },
];

test("normalized search matches title, venue, landmark, and represented date", () => {
  const model = createEventDiscoveryModel(landmarks);
  assert.deepEqual(
    model.filter({ query: "journey" }).events.map(({ eventId }) => eventId),
    ["late"],
  );
  assert.deepEqual(
    model
      .filter({ query: "drama centre" })
      .events.map(({ eventId }) => eventId),
    ["early", "late"],
  );
  assert.deepEqual(
    model
      .filter({ query: "national museum" })
      .events.map(({ eventId }) => eventId),
    ["exhibition"],
  );
  assert.deepEqual(
    model
      .filter({ query: "historia cafe" })
      .events.map(({ eventId }) => eventId),
    ["exhibition"],
  );
  assert.deepEqual(
    model.filter({ query: "15 jul" }).events.map(({ eventId }) => eventId),
    ["late"],
  );
});

test("categories compose with search and results keep canonical multiple-event order", () => {
  const model = createEventDiscoveryModel(landmarks);
  assert.deepEqual(model.categories(), [
    "Exhibitions",
    "Performances",
    "Workshops & Classes",
  ]);
  assert.deepEqual(
    model
      .filter({ query: "drama", categories: ["Performances"] })
      .events.map(({ eventId }) => eventId),
    ["late"],
  );
  assert.deepEqual(
    model.filter().events.map(({ eventId }) => eventId),
    ["early", "late", "exhibition"],
  );
});

test("date and price ranges compose with the existing filters", () => {
  const model = createEventDiscoveryModel(landmarks, {
    now: () => new Date("2026-07-14T08:00:00+08:00"),
  });
  assert.deepEqual(
    model
      .filter({ dateRange: "today", priceRange: "free" })
      .events.map(({ eventId }) => eventId),
    ["early"],
  );
  assert.deepEqual(
    model
      .filter({ dateRange: "7-days", priceRange: "25-50" })
      .events.map(({ eventId }) => eventId),
    ["late"],
  );
  assert.deepEqual(
    model
      .filter({ dateStart: "2026-07-15", dateEnd: "2026-07-15" })
      .events.map(({ eventId }) => eventId),
    ["late"],
  );
  assert.deepEqual(model.filter({ priceRange: "100-plus" }).events, []);
});

test("selection reconciliation preserves visible identity and clears filtered or removed identity", () => {
  const model = createEventDiscoveryModel(landmarks);
  const selection = { landmarkId: "library", eventId: "late" };
  assert.deepEqual(
    reconcileEventSelection(selection, model.filter({ query: "journey" })),
    selection,
  );
  assert.equal(
    reconcileEventSelection(selection, model.filter({ query: "architecture" })),
    null,
  );
  assert.equal(
    reconcileEventSelection(selection, createEventDiscoveryModel([]).filter()),
    null,
  );
});

test("duplicate event identities remain distinct across landmarks but not within one landmark", () => {
  const model = createEventDiscoveryModel([
    {
      id: "a",
      label: "A",
      events: [{ id: "shared", title: "One", dateText: "14 Jul" }],
    },
    {
      id: "b",
      label: "B",
      events: [{ id: "shared", title: "Two", dateText: "14 Jul" }],
    },
  ]);
  assert.equal(model.filter().events.length, 2);
  assert.throws(
    () =>
      createEventDiscoveryModel([
        {
          id: "a",
          label: "A",
          events: [
            { id: "same", title: "One" },
            { id: "same", title: "Two" },
          ],
        },
      ]),
    /duplicate event identity/i,
  );
});

test("approved event candidates expose grounded attributes and stable selection without changing filters", () => {
  const model = createEventDiscoveryModel(
    [
      {
        id: "esplanade",
        label: "Esplanade",
        areaId: "ura-subzone:city-hall",
        anchor: { lng: 103.8554, lat: 1.2898 },
        events: [
          {
            id: "event-1",
            title: "Waterfront evening programme",
            dateText: "18 Jul 2026",
            category: "Performances",
            price: "Free",
            sources: [
              { sourceId: "event-1", recordRef: "approved-event:event-1" },
            ],
          },
        ],
      },
    ],
    { sourceSnapshotId: "approved-snapshot-2026-07-18" },
  );

  assert.deepEqual(model.approvedCandidates(), [
    {
      candidateId: "event:esplanade:event-1",
      candidateType: "event",
      sourceSnapshotId: "approved-snapshot-2026-07-18",
      areaId: "ura-subzone:city-hall",
      coordinates: [103.8554, 1.2898],
      attributes: {
        name: "Waterfront evening programme",
        venue: "Esplanade",
        category: "Performances",
        date: "18 Jul 2026",
        time: "",
        priceKind: "free",
        priceValue: 0,
      },
      evidenceRefs: ["approved-event:event-1", "event-1"],
    },
  ]);
  assert.deepEqual(model.selectionForCandidate("event:esplanade:event-1"), {
    landmarkId: "esplanade",
    eventId: "event-1",
    eventIndex: 0,
  });
  assert.equal(model.selectionForCandidate("event:unknown"), null);
  assert.equal(
    eventCandidateIdentity("esplanade", "event-1"),
    "event:esplanade:event-1",
  );
  assert.deepEqual(
    model
      .filter({ query: "waterfront", categories: ["Performances"] })
      .events.map(({ eventId }) => eventId),
    ["event-1"],
  );
});

test("mapped and off-map activities project once without inventing coordinates", () => {
  const landmarks = [
    {
      id: "mapped-hall",
      label: "Mapped Hall",
      anchor: { lng: 103.8, lat: 1.3 },
      events: [
        {
          id: "mapped",
          title: "Mapped Show",
          publicPlacement: "mapped",
          mappingStatus: "approved",
          schedule: { kind: "exact", start: "2026-07-20T20:00:00+08:00" },
        },
      ],
    },
  ];
  const offMapEvents = [
    {
      id: "secret",
      title: "Secret Supper",
      venue: "Secret location",
      publicPlacement: "off_map",
      mappingStatus: "not_required",
      offMapSubtype: "secret_tba",
      schedule: { kind: "anytime" },
      freshness: "current",
    },
    {
      id: "multi",
      title: "Studio Trail",
      venue: "Various venues",
      publicPlacement: "off_map",
      mappingStatus: "not_required",
      offMapSubtype: "multiple_locations",
      schedule: { kind: "selectable" },
      freshness: "stale",
    },
    {
      id: "route",
      title: "Cycling Route",
      venue: "Marina Bay route",
      publicPlacement: "off_map",
      mappingStatus: "not_required",
      offMapSubtype: "mobile_route",
      schedule: { kind: "exact", start: "2026-07-19T08:00:00+08:00" },
    },
    {
      id: "area",
      title: "Park Picnic",
      venue: "East Coast Park",
      publicPlacement: "off_map",
      mappingStatus: "not_required",
      offMapSubtype: "broad_area",
      schedule: { kind: "anytime" },
    },
  ];
  const model = createEventDiscoveryModel(landmarks, {
    offMapEvents,
    now: () => new Date("2026-07-18T00:00:00+08:00"),
  });
  assert.deepEqual(
    new Set(model.events().map(({ eventId }) => eventId)),
    new Set(["mapped", "secret", "multi", "route", "area"]),
  );
  assert.equal(
    model.events().find(({ eventId }) => eventId === "secret")
      .candidateCoordinates,
    null,
  );
  assert.deepEqual(
    model
      .filter({ placementView: "secret_tba" })
      .events.map(({ eventId }) => eventId),
    ["secret"],
  );
  assert.deepEqual(
    model.filter({ dateRange: "anytime" }).events.map(({ eventId }) => eventId),
    ["secret", "area"],
  );
  assert.equal(
    model.filter({ placementView: "multiple_locations" }).events[0].freshness,
    "stale",
  );
  assert.deepEqual(
    model
      .filter({ placementView: "mobile_route" })
      .events.map(({ eventId }) => eventId),
    ["route"],
  );
  assert.deepEqual(
    model
      .filter({ placementView: "broad_area" })
      .events.map(({ eventId }) => eventId),
    ["area"],
  );
});

test("candidate exposure fails closed while literal event filtering remains available", () => {
  const model = createEventDiscoveryModel(landmarks, {
    sourceSnapshotId: "approved-snapshot-2026-07-18",
  });

  assert.deepEqual(model.approvedCandidates(), []);
  assert.equal(model.selectionForCandidate("event:library:late"), null);
  assert.equal(model.filter({ query: "journey" }).events[0].eventId, "late");
});
