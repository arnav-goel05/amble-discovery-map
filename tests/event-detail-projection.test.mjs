import assert from "node:assert/strict";
import test from "node:test";

import { projectEventDetails } from "../activity-scenes/event-detail-projection.js";

const landmark = {
  id: "marina-square",
  label: "MARINA SQUARE",
  anchor: { lng: 103.8577, lat: 1.2915 },
};

const canonicalActivity = {
  schemaVersion: "1.0",
  activityId: "activity:funvee",
  title: "FunVee Singapore: Day Tour by Open-Top Bus",
  description: "See Singapore from an open-top bus.",
  category: "Tours & Experiences",
  organizer: "City Tours",
  price: "SGD 22",
  lifecycleState: "active",
  freshness: "current",
  sources: ["Fever Singapore"],
  sessions: [
    {
      sessionId: "session:morning",
      schedule: {
        kind: "exact",
        start: "2026-07-26T00:00:00+08:00",
        end: "2026-07-26T02:00:00+08:00",
        displayText: "2026-07-26",
      },
      availability: "available",
      venueGroupIds: ["venue-group:marina"],
    },
    {
      sessionId: "session:evening",
      schedule: {
        kind: "exact",
        start: "2026-07-27T18:30:00+08:00",
        end: "2026-07-27T20:30:00+08:00",
        displayText: "2026-07-27",
      },
      availability: "available",
      venueGroupIds: ["venue-group:promenade"],
    },
  ],
  venueGroups: [
    {
      venueGroupId: "venue-group:marina",
      activityId: "activity:funvee",
      label: "MARINA SQUARE",
      address: "6 Raffles Boulevard",
      publicPlacement: "mapped",
      mappingStatus: "approved",
      approvedLocationId: "marina-square",
      coordinates: { lng: 103.8577, lat: 1.2915 },
      sessionIds: ["session:morning"],
    },
    {
      venueGroupId: "venue-group:promenade",
      activityId: "activity:funvee",
      label: "PROMENADE",
      address: "Temasek Avenue",
      publicPlacement: "mapped",
      mappingStatus: "approved",
      approvedLocationId: "promenade",
      coordinates: { lng: 103.861, lat: 1.293 },
      sessionIds: ["session:evening"],
    },
  ],
  sourceOffers: [
    {
      offerId: "offer:fever",
      source: "Fever Singapore",
      url: "https://feverup.com/m/137694",
      scope: "activity",
      sessionIds: [],
    },
    {
      offerId: "offer:fever",
      source: "Fever Singapore",
      url: "https://feverup.com/m/137694",
      scope: "activity",
      sessionIds: [],
    },
    {
      offerId: "offer:evening",
      source: "Evening tickets",
      url: "https://tickets.example/evening",
      scope: "sessions",
      sessionIds: ["session:evening"],
    },
    {
      offerId: "offer:unsafe",
      source: "Unsafe",
      url: "javascript:alert(1)",
      scope: "activity",
      sessionIds: [],
    },
  ],
  scheduleSummary: {
    kind: "multiple",
    label: "2 sessions",
    sessionCount: 2,
  },
};

test("projects canonical sessions, venues, approved fields, and safe offer coverage", () => {
  const [activity] = projectEventDetails({
    landmark,
    sourceEvents: [canonicalActivity],
  });

  assert.equal(activity.activityId, "activity:funvee");
  assert.equal(activity.sessionCount, 2);
  assert.equal(activity.occurrences.length, 2);
  assert.deepEqual(
    activity.occurrences.map(({ occurrenceId }) => occurrenceId),
    ["session:morning", "session:evening"],
  );
  assert.deepEqual(
    activity.venueGroups.map(({ label }) => label),
    ["MARINA SQUARE", "PROMENADE"],
  );
  assert.equal(activity.description, "See Singapore from an open-top bus.");
  assert.equal(activity.category, "Tours & Experiences");
  assert.equal(activity.organizer, "City Tours");
  assert.equal(activity.price, "SGD 22");

  const [morning, evening] = activity.occurrences;
  assert.equal(morning.date, "2026-07-26");
  assert.match(morning.time, /12:00|00:00/);
  assert.equal(morning.venue, "MARINA SQUARE");
  assert.equal(morning.address, "6 Raffles Boulevard");
  assert.equal(evening.date, "2026-07-27");
  assert.match(evening.time, /6:30|18:30/);
  assert.equal(evening.venue, "PROMENADE");

  assert.deepEqual(
    morning.references.map(({ referenceId }) => referenceId),
    ["offer:fever"],
  );
  assert.deepEqual(
    evening.references.map(({ referenceId }) => referenceId),
    ["offer:fever", "offer:evening"],
  );
  assert.deepEqual(
    activity.sourceOffers.map(
      ({ referenceId, label, url, scope, occurrenceIds }) => ({
        referenceId,
        label,
        url,
        scope,
        occurrenceIds,
      }),
    ),
    [
      {
        referenceId: "offer:fever",
        label: "Fever Singapore",
        url: "https://feverup.com/m/137694",
        scope: "activity",
        occurrenceIds: ["session:morning", "session:evening"],
      },
      {
        referenceId: "offer:evening",
        label: "Evening tickets",
        url: "https://tickets.example/evening",
        scope: "sessions",
        occurrenceIds: ["session:evening"],
      },
    ],
  );
});

test("uses selected canonical discovery activity without changing its approved identities", () => {
  const [activity] = projectEventDetails({
    landmark,
    sourceEvents: [],
    activity: {
      ...canonicalActivity,
      identity: canonicalActivity.activityId,
      eventId: canonicalActivity.activityId,
      matchingOccurrences: [{ occurrenceId: "session:evening" }],
    },
  });

  assert.equal(activity.activityId, canonicalActivity.activityId);
  assert.equal(activity.occurrences[1].occurrenceId, "session:evening");
  assert.equal(
    activity.sourceOffers[1].referenceId,
    canonicalActivity.sourceOffers[2].offerId,
  );
});

test("keeps absent optional fields unavailable without fabricating values", () => {
  const [activity] = projectEventDetails({
    landmark,
    sourceEvents: [
      {
        ...canonicalActivity,
        activityId: "activity:missing",
        description: null,
        category: null,
        organizer: null,
        price: null,
        sessions: [],
        venueGroups: [],
        sourceOffers: [],
      },
    ],
  });

  assert.equal(activity.description, null);
  assert.equal(activity.category, null);
  assert.equal(activity.organizer, null);
  assert.equal(activity.price, null);
  assert.equal(activity.sessionCount, 1);
  assert.equal(activity.occurrences[0].date, null);
  assert.equal(activity.occurrences[0].time, null);
  assert.deepEqual(activity.sourceOffers, []);
});

test("retains validated legacy event inputs", () => {
  const [activity] = projectEventDetails({
    landmark,
    sourceEvents: [
      {
        id: "legacy",
        title: "Legacy event",
        dateText: "29 Jul 2026",
        timeText: "7pm",
        venue: "Legacy Hall",
        eventUrl: "https://example.com/legacy",
        sources: [
          {
            source: "Official",
            sourceUrl: "https://example.com/legacy",
          },
        ],
      },
    ],
  });

  assert.equal(activity.occurrences[0].date, "29 Jul 2026");
  assert.equal(activity.occurrences[0].time, "7pm");
  assert.equal(activity.occurrences[0].venue, "Legacy Hall");
  assert.deepEqual(
    activity.sourceOffers.map(({ label, url }) => ({ label, url })),
    [{ label: "Official", url: "https://example.com/legacy" }],
  );
});
