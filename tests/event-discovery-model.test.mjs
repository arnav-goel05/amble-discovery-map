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

test("weekend filtering uses the bounded Saturday and Sunday local window", () => {
  const model = createEventDiscoveryModel(
    [
      {
        id: "calendar",
        label: "Calendar Hall",
        anchor: { lng: 103.85, lat: 1.29 },
        events: [
          {
            id: "friday",
            title: "Friday",
            startDateTime: "2026-07-31T20:00:00+08:00",
          },
          {
            id: "saturday",
            title: "Saturday",
            startDateTime: "2026-08-01T10:00:00+08:00",
          },
          {
            id: "sunday",
            title: "Sunday",
            startDateTime: "2026-08-02T22:00:00+08:00",
          },
          {
            id: "monday",
            title: "Monday",
            startDateTime: "2026-08-03T10:00:00+08:00",
          },
        ],
      },
    ],
    { now: () => new Date("2026-07-29T12:00:00+08:00") },
  );
  assert.deepEqual(
    model
      .filter({ dateRange: "this-weekend" })
      .events.map(({ eventId }) => eventId),
    ["saturday", "sunday"],
  );
});

test("source-backed geographic filters compose with existing dimensions", () => {
  const model = createEventDiscoveryModel([
    {
      id: "library",
      label: "National Library",
      areaId: "ura-subzone:city-hall",
      anchor: { lng: 103.854, lat: 1.298 },
      events: [
        {
          id: "talk",
          title: "Architecture Talk",
          venue: "Drama Centre",
          category: "Workshops & Classes",
        },
      ],
    },
    {
      id: "museum",
      label: "National Museum",
      areaId: "ura-subzone:museum",
      anchor: { lng: 103.848, lat: 1.296 },
      events: [
        {
          id: "show",
          title: "Gallery Show",
          venue: "Gallery One",
          category: "Exhibitions",
        },
      ],
    },
  ]);

  assert.deepEqual(
    model
      .filter({ where: { kind: "landmark", landmarkId: "library" } })
      .events.map(({ eventId }) => eventId),
    ["talk"],
  );
  assert.deepEqual(
    model
      .filter({ where: { kind: "venue", venueKey: "drama centre" } })
      .events.map(({ eventId }) => eventId),
    ["talk"],
  );
  assert.deepEqual(
    model
      .filter({ where: { kind: "area", areaId: "ura-subzone:museum" } })
      .events.map(({ eventId }) => eventId),
    ["show"],
  );
  assert.deepEqual(
    model
      .filter({
        where: {
          kind: "bounds",
          west: 103.85,
          south: 1.297,
          east: 103.86,
          north: 1.3,
        },
      })
      .events.map(({ eventId }) => eventId),
    ["talk"],
  );
  assert.deepEqual(
    model
      .filter({
        where: {
          kind: "radius",
          center: [103.854, 1.298],
          radiusKm: 0.3,
        },
      })
      .events.map(({ eventId }) => eventId),
    ["talk"],
  );
  assert.deepEqual(
    model.filter({
      categories: ["Exhibitions"],
      where: { kind: "landmark", landmarkId: "library" },
    }).events,
    [],
  );
});

test("discovery exposes deduplicated source-backed location options", () => {
  const model = createEventDiscoveryModel(landmarks);
  const locations = model.filterOptions().locations;
  assert.ok(
    locations.some(
      ({ id, label }) =>
        id === "landmark:library" && label === "National Library",
    ),
  );
  assert.ok(
    locations.some(
      ({ id, label }) =>
        id === "venue:drama-centre" && label === "Drama Centre",
    ),
  );
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

test("repeated occurrences become one activity result while filters remain occurrence-aware", () => {
  const model = createEventDiscoveryModel([
    {
      id: "theatre",
      label: "Victoria Theatre",
      anchor: { lng: 103.851, lat: 1.288 },
      events: [
        {
          id: "show-1",
          parentActivityId: "activity:show",
          title: "Example Show",
          venue: "Victoria Theatre",
          startDateTime: "2026-08-01T20:00:00+08:00",
          dateText: "1 Aug 2026",
          sources: [
            { source: "SISTIC", sourceUrl: "https://www.sistic.com.sg/show" },
          ],
        },
        {
          id: "show-2",
          parentActivityId: "activity:show",
          title: "Example Show",
          venue: "Victoria Theatre",
          startDateTime: "2026-08-02T20:00:00+08:00",
          dateText: "2 Aug 2026",
          sources: [
            { source: "SISTIC", sourceUrl: "https://www.sistic.com.sg/show" },
          ],
        },
      ],
    },
  ]);
  const all = model.filter();
  assert.equal(all.events.length, 1);
  assert.equal(all.matchedActivities, 1);
  assert.equal(all.matchedOccurrences, 2);
  assert.equal(all.events[0].activityId, "activity:show");
  assert.equal(all.events[0].occurrences.length, 2);
  assert.equal(all.events[0].sessionCount, 2);
  assert.match(all.events[0].scheduleSummary, /2 upcoming sessions/i);
  const oneDay = model.filter({
    dateStart: "2026-08-02",
    dateEnd: "2026-08-02",
  });
  assert.equal(oneDay.events.length, 1);
  assert.equal(oneDay.events[0].matchingOccurrences.length, 1);
});

test("canonical activities match only exact sessions in the projected venue group", () => {
  const activity = {
    id: "activity:memory-palace",
    activityId: "activity:memory-palace",
    title: "Memory Palace",
    projectedVenueGroupId: "venue-group:museum",
    projectedSessionIds: ["session:26-jul", "session:2-aug"],
    sessions: [
      {
        sessionId: "session:26-jul",
        schedule: {
          kind: "exact",
          start: "2026-07-26T09:00:00+08:00",
          end: "2026-07-26T10:30:00+08:00",
        },
        venueGroupIds: ["venue-group:museum"],
      },
      {
        sessionId: "session:2-aug",
        schedule: {
          kind: "exact",
          start: "2026-08-02T09:00:00+08:00",
          end: "2026-08-02T10:30:00+08:00",
        },
        venueGroupIds: ["venue-group:museum"],
      },
      {
        sessionId: "session:other-venue",
        schedule: {
          kind: "exact",
          start: "2026-08-02T14:00:00+08:00",
          end: "2026-08-02T15:00:00+08:00",
        },
        venueGroupIds: ["venue-group:other"],
      },
    ],
    venueGroups: [
      {
        venueGroupId: "venue-group:museum",
        approvedLocationId: "museum",
        label: "National Museum of Singapore",
        sessionIds: ["session:26-jul", "session:2-aug"],
        publicPlacement: "mapped",
        mappingStatus: "approved",
      },
      {
        venueGroupId: "venue-group:other",
        approvedLocationId: "other",
        label: "Other Venue",
        sessionIds: ["session:other-venue"],
        publicPlacement: "mapped",
        mappingStatus: "approved",
      },
    ],
    sourceOffers: [],
  };
  const model = createEventDiscoveryModel([
    {
      id: "museum",
      label: "National Museum of Singapore",
      anchor: { lng: 103.848, lat: 1.296 },
      events: [activity],
    },
  ]);
  assert.equal(
    model.filter({ dateStart: "2026-07-27", dateEnd: "2026-07-27" }).events
      .length,
    0,
  );
  const filtered = model.filter({
    dateStart: "2026-08-02",
    dateEnd: "2026-08-02",
  });
  const result = filtered.events[0];
  assert.deepEqual(
    result.matchingSessions.map((session) => session.sessionId),
    ["session:2-aug"],
  );
  assert.equal(
    result.matchingSessions.some(
      (item) => item.sessionId === "session:other-venue",
    ),
    false,
  );
  assert.equal(
    filtered.scheduleDiagnostics.projected_session_not_applicable,
    1,
  );
});

test("non-ISO schedule boundaries never match browser date filters", () => {
  const model = createEventDiscoveryModel([
    {
      id: "museum",
      label: "Museum",
      events: [
        {
          id: "bad-date",
          title: "Bad Date",
          sessions: [
            {
              sessionId: "bad",
              schedule: { kind: "exact", start: "2 Aug 2026 9am" },
            },
          ],
        },
      ],
    },
  ]);
  const filtered = model.filter({
    dateStart: "2026-08-02",
    dateEnd: "2026-08-02",
  });
  assert.equal(filtered.events.length, 0);
  assert.equal(filtered.scheduleDiagnostics.non_iso_boundary_rejected, 1);
});

test("one activity can retain distinct venue groups and deduplicated source offers", () => {
  const model = createEventDiscoveryModel([
    {
      id: "a",
      label: "Venue A",
      events: [
        {
          id: "a1",
          parentActivityId: "activity:tour",
          title: "Tour",
          venue: "Venue A",
          dateText: "1 Aug",
          sources: [
            { source: "Official", sourceUrl: "https://example.com/tour" },
          ],
        },
      ],
    },
    {
      id: "b",
      label: "Venue B",
      events: [
        {
          id: "b1",
          parentActivityId: "activity:tour",
          title: "Tour",
          venue: "Venue B",
          dateText: "2 Aug",
          sources: [
            { source: "Official", sourceUrl: "https://example.com/tour" },
          ],
        },
      ],
    },
  ]);
  const [activity] = model.filter().events;
  assert.equal(activity.venueGroups.length, 2);
  assert.equal(activity.sourceOffers.length, 1);
  assert.deepEqual(
    new Set(activity.occurrences.map((item) => item.landmarkId)),
    new Set(["a", "b"]),
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
