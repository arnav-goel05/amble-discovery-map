import test from "node:test";
import assert from "node:assert/strict";
import {
  projectEventActivities,
  validateActivityProjection,
} from "../scripts/lib/event-pipeline/activity-projection.mjs";

const occurrence = ({
  id,
  parent = "activity:show",
  listing = "SISTIC:show",
  source = "SISTIC",
  date = "2026-08-01",
  venue = "Victoria Theatre",
  url = "https://www.sistic.com.sg/events/show",
  title = "Example Show",
  sources,
  sourceParents,
  approvedLocationId = "victoria-theatre",
  organizer = null,
  schedule,
  authorityRefs = [],
  publicPlacement = "mapped",
  mappingStatus = "approved",
  allDay = false,
  venueOccurrenceId = null,
} = {}) => ({
  id,
  occurrenceId: id,
  identityAnchor: id,
  parentActivityId: parent,
  parentListingId: listing,
  sourceParentActivities: sourceParents ?? [
    { source, parentActivityId: parent, parentListingId: listing },
  ],
  title,
  authorityRefs,
  venue,
  organizer,
  schedule: schedule ?? {
    kind: "exact",
    start: date,
    end: date,
    displayText: date,
    finalKnownOccurrence: date,
  },
  sessions: [
    {
      sessionId: `source-session:${id}`,
      schedule: schedule ?? { kind: "exact", start: date, end: date },
      venueKey: venue,
    },
  ],
  sources: sources ?? [
    { source, sourceId: id, sourceUrl: url, recordRef: `raw/${id}` },
  ],
  lifecycleState: "active",
  publicPlacement,
  mappingStatus,
  allDay,
  approvedLocationId,
  venueOccurrences: [
    {
      ...(venueOccurrenceId ? { venueOccurrenceId } : {}),
      approvedLocationId,
      publishedVenueName: venue,
      publicPlacement,
      mappingStatus,
    },
  ],
});

test("authority-linked exact evidence suppresses a redundant coarse offsite projection", () => {
  const authorityRefs = ["sistic:palacews0826"];
  const exact = (id, date) =>
    occurrence({
      id,
      parent: "activity:catch-memory",
      listing: "Catch.sg:memory",
      source: "Catch.sg",
      title: "Memory Palace",
      date,
      venue: "Offsite",
      approvedLocationId: null,
      authorityRefs,
      publicPlacement: "off_map",
      mappingStatus: "not_required",
      schedule: {
        kind: "exact",
        start: `${date}T09:00:00+08:00`,
        end: `${date}T10:30:00+08:00`,
        displayText: date,
      },
    });
  const mapped = (id, date) =>
    occurrence({
      id,
      parent: "activity:sistic-memory",
      listing: "SISTIC:palacews0826",
      source: "SISTIC",
      title: "Memory Palace",
      date,
      venue: "National Museum of Singapore",
      approvedLocationId: "national-museum",
      authorityRefs,
      schedule: {
        kind: "exact",
        start: `${date}T09:00:00+08:00`,
        end: `${date}T10:30:00+08:00`,
        displayText: date,
      },
    });
  const result = projectEventActivities({
    runId: "schedule-authority",
    events: [
      exact("catch-26", "2026-07-26"),
      exact("catch-02", "2026-08-02"),
      mapped("sistic-26", "2026-07-26"),
      mapped("sistic-02", "2026-08-02"),
    ],
  });
  assert.equal(result.activities.records.length, 1);
  const activity = result.activities.records[0];
  assert.equal(activity.sessions.length, 2);
  assert.equal(activity.venueGroups.length, 1);
  assert.equal(activity.venueGroups[0].approvedLocationId, "national-museum");
  assert.equal(activity.sourceOffers.length, 2);
  assert.equal(
    activity.sessions.every((session) => session.occurrenceIds.length === 2),
    true,
  );
  assert.equal(result.activities.counts.coarseEnvelopesSuppressed, 0);
});

test("collected-shape authority evidence reconciles Memory Palace to two timed sessions and one specific reviewable venue", () => {
  const authorityRefs = ["sistic:palacews0826"];
  const title =
    "Esplanade Presents | The Studios Walking Tour: Memory Palace – The Worlds & Words of Bukit Larangan By Ng Yi-Sheng";
  const catchEvent = (day, index) =>
    occurrence({
      id: `Catch.sg:memory-palace#${day}#${index}`,
      parent: "activity:catch-memory-palace",
      listing: "Catch.sg:memory-palace",
      source: "Catch.sg",
      title,
      date: day,
      venue: "Offsite",
      approvedLocationId: null,
      authorityRefs,
      publicPlacement: "off_map",
      mappingStatus: "not_required",
      allDay: true,
      schedule: {
        kind: "exact",
        start: `${day}T00:00:00+08:00`,
        end: `${day}T00:00:00+08:00`,
        displayText: day,
      },
    });
  const sisticEvent = (day) =>
    occurrence({
      id: `SISTIC:palacews0826#${day}T09:00:00+08:00`,
      parent: "activity:sistic-memory-palace",
      listing: "SISTIC:palacews0826",
      source: "SISTIC",
      title,
      date: day,
      venue:
        "Fort Canning Hill (Meeting point: Entrance of National Museum of Singapore)",
      approvedLocationId: null,
      authorityRefs,
      publicPlacement: "none",
      mappingStatus: "pending_review",
      schedule: {
        kind: "exact",
        start: `${day}T09:00:00+08:00`,
        end: `${day}T09:00:00+08:00`,
        displayText: day === "2026-07-26" ? "26 Jul" : "2 Aug 2026",
        evidenceReasonCode: "enumerated_dates_parsed",
      },
    });
  const result = projectEventActivities({
    runId: "memory-palace-collected-shape",
    events: [
      catchEvent("2026-07-26", 1),
      catchEvent("2026-08-02", 2),
      sisticEvent("2026-07-26"),
      sisticEvent("2026-08-02"),
    ],
  });
  assert.equal(result.activities.records.length, 1);
  const activity = result.activities.records[0];
  assert.deepEqual(
    activity.sessions.map(({ schedule }) => schedule.start).sort(),
    ["2026-07-26T09:00:00+08:00", "2026-08-02T09:00:00+08:00"],
  );
  assert.equal(
    activity.sessions.some(({ schedule }) =>
      String(schedule.start).startsWith("2026-07-27"),
    ),
    false,
  );
  assert.equal(
    activity.sessions.every(({ occurrenceIds }) => occurrenceIds.length === 2),
    true,
  );
  assert.equal(activity.venueGroups.length, 1);
  assert.equal(
    activity.venueGroups[0].label,
    "Fort Canning Hill (Meeting point: Entrance of National Museum of Singapore)",
  );
  assert.equal(activity.venueGroups[0].publicPlacement, "none");
  assert.equal(activity.venueGroups[0].mappingStatus, "pending_review");
  assert.equal(activity.venueGroups[0].approvedLocationId, null);
});

test("stable venue-occurrence evidence reuses a sibling approved location across exact dates", () => {
  const authorityRefs = ["sistic:palacews0826"];
  const venueOccurrenceId = "venue-occurrence:memory-palace-meeting-point";
  const pending = occurrence({
    id: "SISTIC:palacews0826#2026-07-26T09:00:00+08:00",
    parent: "activity:sistic-memory-palace",
    listing: "SISTIC:palacews0826",
    source: "SISTIC",
    title: "Memory Palace",
    venue:
      "Fort Canning Hill (Meeting point: Entrance of National Museum of Singapore)",
    approvedLocationId: null,
    authorityRefs,
    publicPlacement: "none",
    mappingStatus: "pending_review",
    venueOccurrenceId,
    schedule: {
      kind: "exact",
      start: "2026-07-26T09:00:00+08:00",
      end: "2026-07-26T09:00:00+08:00",
      displayText: "26 Jul",
    },
  });
  const approved = occurrence({
    id: "SISTIC:palacews0826#2026-08-02T09:00:00+08:00",
    parent: "activity:sistic-memory-palace",
    listing: "SISTIC:palacews0826",
    source: "SISTIC",
    title: "Memory Palace",
    venue: "National Museum of Singapore",
    approvedLocationId: "national-museum-of-singapore",
    authorityRefs,
    publicPlacement: "mapped",
    mappingStatus: "approved",
    venueOccurrenceId,
    schedule: {
      kind: "exact",
      start: "2026-08-02T09:00:00+08:00",
      end: "2026-08-02T09:00:00+08:00",
      displayText: "2 Aug 2026",
    },
  });
  const activity = projectEventActivities({
    runId: "stable-venue-occurrence",
    events: [pending, approved],
  }).activities.records[0];
  assert.equal(activity.sessions.length, 2);
  assert.equal(activity.venueGroups.length, 1);
  assert.equal(
    activity.venueGroups[0].approvedLocationId,
    "national-museum-of-singapore",
  );
  assert.equal(activity.venueGroups[0].mappingStatus, "approved");
});

test("groups sibling occurrences into one activity without losing sessions", () => {
  const result = projectEventActivities({
    runId: "run-1",
    generatedAt: "2026-07-22T00:00:00.000Z",
    events: [
      occurrence({ id: "show-1", date: "2026-08-01" }),
      occurrence({ id: "show-2", date: "2026-08-02" }),
    ],
  });
  assert.equal(result.activities.records.length, 1);
  assert.equal(result.activities.records[0].sessions.length, 2);
  assert.deepEqual(result.activities.records[0].occurrenceIds, [
    "show-1",
    "show-2",
  ]);
  assert.equal(result.activities.counts.occurrences, 2);
  assert.equal(result.activities.counts.activities, 1);
  assert.equal(result.reviews.records.length, 0);
  assert.equal(result.decisions.counts.create, 5);
  assert.equal(
    result.activities.records[0].groupingDecision.strategy,
    "source_parent_activity",
  );
  assert.doesNotThrow(() =>
    validateActivityProjection(result.activities, result.reviews),
  );
});

test("schedule summary derives a Singapore clock when display text is date-only", () => {
  const result = projectEventActivities({
    runId: "timed-summary",
    events: [
      occurrence({
        id: "timed-summary-1",
        schedule: {
          kind: "exact",
          start: "2026-08-01T20:00:00+08:00",
          end: "2026-08-01T22:00:00+08:00",
          displayText: "1 August 2026",
        },
      }),
    ],
  });
  assert.equal(
    result.activities.records[0].scheduleSummary.label,
    "Sat, 1 August 2026, 8pm",
  );
});

test("classifies no-op, update, expire, and review outcomes deterministically", () => {
  const baseline = projectEventActivities({
    runId: "run-before",
    generatedAt: "2026-07-22T00:00:00.000Z",
    events: [occurrence({ id: "show-1" })],
  });
  const unchanged = projectEventActivities({
    runId: "run-after",
    generatedAt: "2026-07-23T00:00:00.000Z",
    events: [occurrence({ id: "show-1" })],
    previousActivities: baseline.activities.records,
  });
  assert.equal(unchanged.decisions.counts["no-op"], 4);

  const expired = projectEventActivities({
    runId: "run-expired",
    generatedAt: "2026-07-24T00:00:00.000Z",
    events: [],
    previousActivities: baseline.activities.records,
  });
  assert.equal(expired.decisions.counts.expire, 4);

  const conflicted = projectEventActivities({
    runId: "run-review",
    generatedAt: "2026-07-25T00:00:00.000Z",
    events: [
      occurrence({ id: "show-1", date: "2026-08-01" }),
      occurrence({ id: "show-1", date: "2026-08-02" }),
    ],
  });
  assert.equal(conflicted.decisions.counts.review, 1);
  assert.equal(
    conflicted.decisions.records.find(({ action }) => action === "review")
      .reasonCode,
    "contradictory_session_schedule",
  );
});

test("an accepted occurrence bridge links source parents but unrelated titles remain separate", () => {
  const bridgeParents = [
    {
      source: "SISTIC",
      parentActivityId: "activity:sistic-show",
      parentListingId: "SISTIC:show",
    },
    {
      source: "Fever Singapore",
      parentActivityId: "activity:fever-show",
      parentListingId: "Fever:show",
    },
  ];
  const result = projectEventActivities({
    runId: "run-2",
    generatedAt: "2026-07-22T00:00:00.000Z",
    events: [
      occurrence({
        id: "merged-1",
        parent: "activity:sistic-show",
        sourceParents: bridgeParents,
      }),
      occurrence({
        id: "fever-2",
        parent: "activity:fever-show",
        listing: "Fever:show",
        source: "Fever Singapore",
        date: "2026-08-02",
      }),
      occurrence({
        id: "other",
        parent: "activity:other",
        title: "Example Show: Youth Edition",
      }),
    ],
  });
  assert.equal(result.activities.records.length, 2);
  assert.equal(
    result.activities.records.find((item) =>
      item.occurrenceIds.includes("merged-1"),
    ).occurrenceIds.length,
    2,
  );
});

test("projection is input-order independent", () => {
  const events = [
    occurrence({ id: "show-2", date: "2026-08-02" }),
    occurrence({ id: "show-1", date: "2026-08-01" }),
  ];
  const first = projectEventActivities({
    runId: "run",
    generatedAt: "2026-07-22T00:00:00.000Z",
    events,
  });
  const second = projectEventActivities({
    runId: "run",
    generatedAt: "2026-07-22T00:00:00.000Z",
    events: [...events].reverse(),
  });
  assert.deepEqual(first, second);
});

test("direct contradictions isolate the affected occurrence in review", () => {
  const first = occurrence({ id: "same", date: "2026-08-01" });
  const conflict = occurrence({ id: "same", date: "2026-08-02" });
  const safe = occurrence({ id: "safe", date: "2026-08-03" });
  const result = projectEventActivities({
    runId: "run",
    generatedAt: "2026-07-22T00:00:00.000Z",
    events: [first, conflict, safe],
  });
  assert.equal(result.reviews.records.length, 1);
  assert.equal(
    result.reviews.records[0].reasonCode,
    "contradictory_session_schedule",
  );
  assert.deepEqual(result.activities.records[0].occurrenceIds, ["safe"]);
});

test("deduplicates safe offers and scopes partial coverage to sessions", () => {
  const result = projectEventActivities({
    runId: "run",
    generatedAt: "2026-07-22T00:00:00.000Z",
    events: [
      occurrence({
        id: "show-1",
        sources: [
          {
            source: "SISTIC",
            sourceId: "1",
            sourceUrl: "https://www.sistic.com.sg/events/show?utm_source=x",
            recordRef: "raw/1",
          },
        ],
      }),
      occurrence({
        id: "show-2",
        date: "2026-08-02",
        url: "javascript:alert(1)",
      }),
    ],
  });
  const activity = result.activities.records[0];
  assert.equal(activity.sourceOffers.length, 1);
  assert.equal(
    activity.sourceOffers[0].url,
    "https://www.sistic.com.sg/events/show",
  );
  assert.equal(activity.sourceOffers[0].scope, "sessions");
  assert.equal(activity.sourceOffers[0].sessionIds.length, 1);
});

test("groups source parents before matching a broad range to individual sessions", () => {
  const result = projectEventActivities({
    runId: "parent-range",
    generatedAt: "2026-07-26T00:00:00.000Z",
    events: [
      occurrence({
        id: "catch-1",
        parent: "activity:catch-show",
        listing: "Catch:show",
        source: "Catch.sg",
        date: "2026-07-29",
        url: "https://www.catch.sg/Event/show",
      }),
      occurrence({
        id: "catch-2",
        parent: "activity:catch-show",
        listing: "Catch:show",
        source: "Catch.sg",
        date: "2026-07-30",
        url: "https://www.catch.sg/Event/show",
      }),
      occurrence({
        id: "sistic-range",
        parent: "activity:sistic-show",
        listing: "SISTIC:show",
        source: "SISTIC",
        url: "https://www.sistic.com.sg/event-details/show",
        schedule: {
          kind: "range",
          start: "Tue, 28 Jul 2026",
          end: "Sun, 16 Aug 2026",
          displayText: "From Wed, 29 Jul 2026",
        },
      }),
    ],
  });

  assert.equal(result.activities.records.length, 1);
  assert.equal(result.activities.records[0].occurrenceIds.length, 3);
  assert.equal(result.activities.records[0].sourceOffers.length, 2);
  assert.equal(result.parentGrouping.counts.mergedParents, 1);
});

test("treats ISO and human-readable date-only values as the same Singapore day", () => {
  const result = projectEventActivities({
    runId: "timezone-day",
    generatedAt: "2026-07-26T00:00:00.000Z",
    events: [
      occurrence({
        id: "catch-two-worlds",
        parent: "activity:catch-two-worlds",
        listing: "Catch:two-worlds",
        source: "Catch.sg",
        date: "2026-10-03",
        title: "Two Worlds in One",
        url: "https://www.catch.sg/Event/two-worlds",
      }),
      occurrence({
        id: "sistic-two-worlds",
        parent: "activity:sistic-two-worlds",
        listing: "SISTIC:two-worlds",
        source: "SISTIC",
        date: "Sat, 03 Oct 2026",
        title: "Two Worlds in One",
        url: "https://www.sistic.com.sg/event-details/two-worlds",
      }),
    ],
  });

  assert.equal(result.activities.records.length, 1);
  assert.deepEqual(result.activities.records[0].sources, [
    "Catch.sg",
    "SISTIC",
  ]);
  assert.equal(result.activities.records[0].sessions.length, 1);
  assert.deepEqual(result.activities.records[0].sessions[0].occurrenceIds, [
    "catch-two-worlds",
    "sistic-two-worlds",
  ]);
  assert.equal(result.activities.records[0].sourceOffers.length, 2);
});

test("date-only source evidence yields to a single richer timed session deterministically", () => {
  const coarse = occurrence({
    id: "catch-chloe",
    parent: "activity:catch-chloe",
    listing: "Catch:chloe",
    source: "Catch.sg",
    title: "Chloe Chua & Hannu Lintu – Jewel and Titan",
    url: "https://www.catch.sg/Event/chloe",
    schedule: {
      kind: "exact",
      start: "2026-10-08",
      end: "2026-10-08",
      displayText: "2026-10-08",
    },
  });
  const precise = occurrence({
    id: "sistic-chloe",
    parent: "activity:sistic-chloe",
    listing: "SISTIC:chloe",
    source: "SISTIC",
    title: "Chloe Chua & Hannu Lintu – Jewel and Titan",
    url: "https://www.sistic.com.sg/event-details/chloe",
    schedule: {
      kind: "exact",
      start: "2026-10-08T19:30:00+08:00",
      end: "2026-10-08T21:30:00+08:00",
      displayText: "Thu, 8 October 2026, 7.30pm",
    },
  });
  const project = (events) =>
    projectEventActivities({
      runId: "richer-schedule",
      generatedAt: "2026-07-26T00:00:00.000Z",
      events,
    }).activities.records[0];
  const forward = project([coarse, precise]);
  const reverse = project([precise, coarse]);
  assert.equal(forward.sessions.length, 1);
  assert.deepEqual(forward.sessions[0].occurrenceIds, [
    "catch-chloe",
    "sistic-chloe",
  ]);
  assert.equal(forward.sessions[0].schedule.start, "2026-10-08T19:30:00+08:00");
  assert.equal(forward.scheduleSummary.label, "Thu, 8 October 2026, 7.30pm");
  assert.deepEqual(forward.sessions, reverse.sessions);
  assert.deepEqual(forward.scheduleSummary, reverse.scheduleSummary);
});

test("ambiguous date-only evidence does not create a third session beside two explicit showtimes", () => {
  const authorityRefs = ["sistic:double-show"];
  const events = [
    occurrence({
      id: "coarse-day",
      source: "Catch.sg",
      title: "Double Show",
      authorityRefs,
      schedule: {
        kind: "exact",
        start: "2026-09-12",
        end: "2026-09-12",
        displayText: "12 September 2026",
      },
    }),
    ...["14:00", "19:30"].map((clock, index) =>
      occurrence({
        id: `timed-${index + 1}`,
        source: "SISTIC",
        title: "Double Show",
        authorityRefs,
        schedule: {
          kind: "exact",
          start: `2026-09-12T${clock}:00+08:00`,
          end: `2026-09-12T${clock === "14:00" ? "16:00" : "21:30"}:00+08:00`,
          displayText: `12 September 2026, ${clock}`,
        },
      }),
    ),
  ];
  const result = projectEventActivities({
    runId: "ambiguous-coarse-day",
    events,
  });
  const activity = result.activities.records[0];
  assert.equal(activity.sessions.length, 2);
  assert.equal(activity.sourceOffers.length, 2);
  assert.equal(result.activities.counts.coarseEnvelopesSuppressed, 1);
  assert.equal(
    activity.sourceOffers.find(({ source }) => source === "Catch.sg").scope,
    "activity",
  );
});

test("groups same-product source surfaces with selectable and exact schedules", () => {
  const productUrl = "https://feverup.com/m/256288";
  const result = projectEventActivities({
    runId: "same-product",
    generatedAt: "2026-07-26T00:00:00.000Z",
    events: [
      occurrence({
        id: "fever-selectable",
        parent: "activity:fever-selectable",
        listing: "Fever:selectable",
        source: "Fever Singapore",
        title: "Magic Show - Tickets | Fever",
        url: productUrl,
        schedule: {
          kind: "selectable",
          start: null,
          end: null,
          displayText: "Choose in the ticket selector",
        },
      }),
      occurrence({
        id: "fever-exact",
        parent: "activity:fever-exact",
        listing: "Fever:exact",
        source: "Fever Singapore",
        title: "Magic Show",
        url: productUrl,
        date: "2026-07-28",
      }),
    ],
  });

  assert.equal(result.activities.records.length, 1);
  assert.equal(result.activities.records[0].sourceOffers.length, 1);
});

test("uses approved venue identity instead of raw venue aliases for same-source parents", () => {
  const result = projectEventActivities({
    runId: "venue-aliases",
    generatedAt: "2026-07-26T00:00:00.000Z",
    events: [
      occurrence({
        id: "catch-a",
        parent: "activity:catch-a",
        listing: "Catch:a",
        source: "Catch.sg",
        title: "Reminiscence III",
        venue: "SINGAPORE CHINESE CULTURAL CENTRE",
        approvedLocationId: "singapore-chinese-cultural-centre",
      }),
      occurrence({
        id: "catch-b",
        parent: "activity:catch-b",
        listing: "Catch:b",
        source: "Catch.sg",
        title: "Reminiscence III",
        venue: "Singapore Chinese Cultural Centre Auditorium, Level 9",
        approvedLocationId: "singapore-chinese-cultural-centre",
      }),
    ],
  });

  assert.equal(result.activities.records.length, 1);
});

test("groups matching specific titles and schedules when venue evidence is absent on one or both sources", () => {
  const result = projectEventActivities({
    runId: "missing-venue-evidence",
    generatedAt: "2026-07-26T00:00:00.000Z",
    events: [
      occurrence({
        id: "catch-show",
        parent: "activity:catch-show",
        listing: "Catch:show",
        source: "Catch.sg",
        title: "Shining Stars Concert 2026",
        approvedLocationId: null,
      }),
      occurrence({
        id: "sistic-show",
        parent: "activity:sistic-show",
        listing: "SISTIC:show",
        source: "SISTIC",
        title: "Shining Stars Concert 2026",
        approvedLocationId: null,
      }),
    ],
  });
  assert.equal(result.activities.records.length, 1);
  assert.equal(result.activities.records[0].sourceOffers.length, 2);
});

test("groups a compact source range with dated sessions at the same venue", () => {
  const result = projectEventActivities({
    runId: "unverified-schedule",
    generatedAt: "2026-07-26T00:00:00.000Z",
    events: [
      occurrence({
        id: "visit-listing",
        parent: "activity:visit-listing",
        listing: "Visit:list",
        source: "Visit Singapore All Happenings",
        title: "The Grass That Flowers",
        schedule: {
          kind: "range",
          start: null,
          end: null,
          displayText: "11 - 14 NOV ’26",
        },
        approvedLocationId: "national-library-building",
      }),
      occurrence({
        id: "sistic-listing",
        parent: "activity:sistic-listing",
        listing: "SISTIC:list",
        source: "SISTIC",
        title: "The Grass That Flowers",
        schedule: {
          kind: "range",
          start: "2026-11-11",
          end: "2026-11-14",
          displayText: "11–14 Nov 2026",
        },
        approvedLocationId: "national-library-building",
      }),
    ],
  });
  assert.equal(result.activities.records.length, 1);
});

test("keeps generic repeated titles separate and reviews conflicting approved venues", () => {
  const generic = projectEventActivities({
    runId: "generic",
    generatedAt: "2026-07-26T00:00:00.000Z",
    events: [
      occurrence({
        id: "museum-a",
        parent: "activity:museum-a",
        listing: "Catch:museum-a",
        source: "Catch.sg",
        title: "General Admissions",
        approvedLocationId: "museum-a",
      }),
      occurrence({
        id: "museum-b",
        parent: "activity:museum-b",
        listing: "Catch:museum-b",
        source: "Catch.sg",
        title: "General Admissions",
        approvedLocationId: "museum-b",
      }),
    ],
  });
  assert.equal(generic.activities.records.length, 2);
  assert.equal(generic.parentGrouping.counts.mergedParents, 0);

  const distinctEditions = projectEventActivities({
    runId: "editions",
    generatedAt: "2026-07-26T00:00:00.000Z",
    events: [
      occurrence({
        id: "festival-2026",
        parent: "activity:festival-2026",
        title: "City Festival 2026",
      }),
      occurrence({
        id: "festival-2027",
        parent: "activity:festival-2027",
        title: "City Festival 2027",
      }),
    ],
  });
  assert.equal(distinctEditions.activities.records.length, 2);

  const organizerConflict = projectEventActivities({
    runId: "organizer-conflict",
    generatedAt: "2026-07-26T00:00:00.000Z",
    events: [
      occurrence({
        id: "organizer-a",
        parent: "activity:organizer-a",
        title: "Community Showcase",
        organizer: "Organizer A",
      }),
      occurrence({
        id: "organizer-b",
        parent: "activity:organizer-b",
        title: "Community Showcase",
        organizer: "Organizer B",
      }),
    ],
  });
  assert.equal(organizerConflict.activities.records.length, 2);
  assert.equal(
    organizerConflict.parentGrouping.records[0].reasonCode,
    "parent_organizer_conflict",
  );

  const conflict = projectEventActivities({
    runId: "venue-conflict",
    generatedAt: "2026-07-26T00:00:00.000Z",
    events: [
      occurrence({
        id: "show-a",
        parent: "activity:show-a",
        listing: "Catch:show",
        source: "Catch.sg",
        title: "Bhaskareeyam 2026",
        approvedLocationId: "stamford-arts-centre",
      }),
      occurrence({
        id: "show-b",
        parent: "activity:show-b",
        listing: "SISTIC:show",
        source: "SISTIC",
        title: "Bhaskareeyam 2026",
        approvedLocationId: "skyline",
      }),
    ],
  });
  assert.equal(conflict.activities.records.length, 2);
  assert.equal(
    conflict.reviews.records.some(
      ({ reasonCode }) => reasonCode === "parent_venue_conflict",
    ),
    true,
  );
});
