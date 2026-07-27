import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

import {
  activateStagedSnapshot,
  hashFile,
  loadApprovedSnapshot,
  stageImmutableSnapshot,
} from "../approved-snapshot.mjs";
import { assessEventDateQuality } from "./date-quality-audit.mjs";
import { normalizeSchedule } from "../event-sources/activity-policy.mjs";
import {
  parseEnumeratedSchedule,
} from "../event-sources/schedule-semantics.mjs";
import { projectEventActivities } from "./activity-projection.mjs";

const require = createRequire(import.meta.url);
const {
  projectPublicActivityCatalogue,
  projectPublicLandmarks,
} = require("../public-event-catalogue.cjs");

const REPAIR_VERSION = "schedule-semantics-v10";
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const strictTimedStart = (value) =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
    String(value ?? ""),
  );
const singaporeDay = (value) =>
  String(value ?? "").match(/^(\d{4}-\d{2}-\d{2})(?:T|$)/)?.[1] ?? null;

export function recoveredDateReviewEvents(root, snapshotId) {
  const reviewPath = path.join(
    root,
    "outputs/event-pipeline",
    snapshotId,
    "normalized/date-reviews.json",
  );
  if (!fs.existsSync(reviewPath)) return [];
  const reviewArtifact = read(reviewPath);
  return (reviewArtifact.records ?? [])
    .filter(
      (review) =>
        review.event &&
        review.reasonCodes?.length > 0 &&
        review.reasonCodes.every(
          (reasonCode) => reasonCode === "conflicting_start_fields",
        ) &&
        review.event.schedule?.kind === "exact" &&
        review.event.schedule?.evidenceReasonCode ===
          "enumerated_dates_parsed" &&
        assessEventDateQuality(review.event, {
          asOf: review.asOf,
        }).status === "plausible",
    )
    .map((review) => {
      const event = structuredClone(review.event);
      event.reviewStatus = "eligible";
      event.lifecycleState = "active";
      delete event.dateReviewReasonCodes;
      return event;
    });
}

export function reuseApprovedVenueEvidence(events) {
  const approvedByVenueOccurrence = new Map();
  for (const event of events)
    for (const occurrence of event.venueOccurrences ?? [])
      if (
        occurrence.venueOccurrenceId &&
        (event.publicPlacement ?? occurrence.publicPlacement) === "mapped" &&
        (event.mappingStatus ?? occurrence.mappingStatus) === "approved" &&
        (event.approvedLocationId ?? occurrence.approvedLocationId)
      )
        approvedByVenueOccurrence.set(occurrence.venueOccurrenceId, {
          event,
          occurrence,
        });
  let reused = 0;
  const repaired = events.map((event) => {
    const match = (event.venueOccurrences ?? [])
      .map((occurrence) =>
        approvedByVenueOccurrence.get(occurrence.venueOccurrenceId),
      )
      .find(Boolean);
    if (!match || event.publicPlacement === "mapped") return event;
    reused += 1;
    const approvedLocationId =
      match.event.approvedLocationId ?? match.occurrence.approvedLocationId;
    const publishedVenueName =
      match.occurrence.publishedVenueName ??
      match.event.venue ??
      match.event.venueName;
    return {
      ...event,
      venue: publishedVenueName ?? event.venue,
      venueName: publishedVenueName ?? event.venueName,
      address:
        match.occurrence.address ?? match.event.address ?? event.address,
      coordinates: match.event.coordinates ?? event.coordinates,
      publicPlacement: "mapped",
      mappingStatus: "approved",
      approvedLocationId,
      venueOccurrences: (event.venueOccurrences ?? []).map((occurrence) =>
        occurrence.venueOccurrenceId ===
        match.occurrence.venueOccurrenceId
          ? {
              ...occurrence,
              publishedVenueName:
                publishedVenueName ?? occurrence.publishedVenueName,
              address:
                match.occurrence.address ??
                match.event.address ??
                occurrence.address,
              publicPlacement: "mapped",
              mappingStatus: "approved",
              approvedLocationId,
            }
          : occurrence,
      ),
    };
  });
  return { events: repaired, reused };
}

function existingStage(root, snapshotId, sourceSnapshotId) {
  const snapshotDirectory = path.join(root, "data/snapshots", snapshotId);
  const manifestPath = path.join(snapshotDirectory, "manifest.json");
  if (!fs.existsSync(manifestPath)) return null;
  const manifest = read(manifestPath);
  const repair = manifest.eventPipelineProvenance?.scheduleSemanticsRepair;
  if (
    repair?.version !== REPAIR_VERSION ||
    repair?.sourceSnapshotId !== sourceSnapshotId
  )
    throw new Error(`schedule_semantics_repair_snapshot_collision:${snapshotId}`);
  return {
    snapshotId,
    snapshotDirectory,
    manifestPath,
    manifestHash: hashFile(manifestPath),
    commitEligibility: { eligible: true },
  };
}

function attachApprovedParent(event, activityId) {
  const approvedParent = {
    source: "approved-snapshot",
    parentActivityId: activityId,
    parentListingId: null,
  };
  return {
    ...event,
    authorityRefs: [
      ...new Set([
        ...(event.authorityRefs ?? []),
        `approved-activity:${activityId}`,
      ]),
    ].sort(),
    sourceParentActivities: [
      ...(event.sourceParentActivities ?? []),
      approvedParent,
    ],
  };
}

function exactOccurrence(event, performance, activityId, split) {
  const start = performance.startDateTime;
  const repairedId = split
    ? `${event.occurrenceId ?? event.id}#schedule:${start}`
    : event.occurrenceId ?? event.id;
  const schedule = {
    kind: "exact",
    start,
    end: performance.endDateTime ?? null,
    recurrence: null,
    sessionRefs: [],
    displayText:
      [performance.dateText, performance.timeText].filter(Boolean).join(" · ") ||
      (event.schedule?.displayText ?? event.dateText ?? start),
    finalKnownOccurrence: start,
    evidenceReasonCode:
      performance.schedule?.evidenceReasonCode ?? "enumerated_dates_parsed",
  };
  return attachApprovedParent(
    {
      ...event,
      id: repairedId,
      occurrenceId: repairedId,
      identityAnchor: repairedId,
      publishedEventId: repairedId,
      sourceOccurrenceIds: [repairedId],
      parentActivityId: activityId,
      dateText: performance.dateText ?? singaporeDay(start),
      timeText: performance.timeText ?? event.timeText ?? null,
      startDateTime: start,
      endDateTime: performance.endDateTime ?? null,
      startsAt: start,
      endsAt: performance.endDateTime ?? null,
      schedule,
      sessions: [
        {
          sessionId: `source-session:${repairedId}`,
          schedule,
          venueKey: event.venue ?? event.venueName ?? null,
          evidenceRefs: event.provenanceRefs ?? [],
        },
      ],
      repairSourceOccurrenceId: event.occurrenceId ?? event.id,
    },
    activityId,
  );
}

function normalizeRepairedEvent(event) {
  const displayText = event.schedule?.displayText ?? event.dateText ?? null;
  let supplied = event.schedule ?? {};
  const concreteStart =
    event.schedule?.start ?? event.startDateTime ?? event.startsAt ?? null;
  if (
    supplied.kind === "selectable" &&
    strictTimedStart(concreteStart)
  )
    supplied = {
      ...supplied,
      kind: "exact",
      evidenceReasonCode: "structured_performance_exact",
    };
  if (
    /\b(?:any day|any time|anytime|24\/7|choose (?:a |your )?date)\b/i.test(
      displayText ?? "",
    )
  )
    supplied = { ...supplied, kind: "anytime" };
  else if (
    /^(?:coming soon|tba|tbc|to be (?:confirmed|announced))\W*$/i.test(
      displayText ?? "",
    )
  )
    supplied = { ...supplied, kind: "unverified" };
  const schedule = normalizeSchedule(supplied, {
    ...event,
    _concretePerformance: supplied.kind === "exact",
  });
  if (schedule.kind === "exact" && !schedule.start)
    Object.assign(
      schedule,
      normalizeSchedule(
        {
          ...supplied,
          kind: "unverified",
          evidenceReasonCode: "schedule_boundary_not_normalized",
        },
        event,
      ),
    );
  if (
    schedule.kind === "range" &&
    (!schedule.start || !schedule.end)
  )
    Object.assign(
      schedule,
      normalizeSchedule(
        {
          ...supplied,
          kind: "unverified",
          evidenceReasonCode: "schedule_boundary_not_normalized",
        },
        event,
      ),
    );
  return {
    ...event,
    schedule,
    startsAt: schedule.start,
    endsAt: schedule.end,
    startDateTime: schedule.start,
    endDateTime: schedule.end,
  };
}

export function repairScheduleEvents({ events, previousActivities }) {
  const byId = new Map(
    events.map((event) => [event.occurrenceId ?? event.id, event]),
  );
  const repaired = [];
  const consumed = new Set();
  const audit = {
    activitiesInspected: 0,
    enumeratedActivities: 0,
    occurrencesExpanded: 0,
    coarseOccurrencesEnriched: 0,
  };
  for (const activity of previousActivities ?? []) {
    const members = (activity.occurrenceIds ?? [])
      .map((id) => byId.get(id))
      .filter(Boolean);
    if (!members.length) continue;
    audit.activitiesInspected += 1;
    const parsedCandidates = members
      .map((event) => ({
        event,
        parsed: parseEnumeratedSchedule(
          event.schedule?.displayText ?? event.dateText,
        ),
      }))
      .filter(({ parsed }) => parsed.performances.length > 1)
      .sort(
        (a, b) =>
          b.parsed.performances.length - a.parsed.performances.length ||
          String(a.event.occurrenceId ?? a.event.id).localeCompare(
            String(b.event.occurrenceId ?? b.event.id),
          ),
      );
    if (!parsedCandidates.length) continue;
    audit.enumeratedActivities += 1;
    const authoritative = parsedCandidates[0];
    const performanceByDay = new Map(
      authoritative.parsed.performances.map((performance) => [
        singaporeDay(performance.startDateTime),
        performance,
      ]),
    );
    for (const event of members) {
      const id = event.occurrenceId ?? event.id;
      consumed.add(id);
      if (event === authoritative.event) {
        repaired.push(
          ...authoritative.parsed.performances.map((performance) =>
            exactOccurrence(event, performance, activity.activityId, true),
          ),
        );
        audit.occurrencesExpanded +=
          authoritative.parsed.performances.length - 1;
        continue;
      }
      const currentStart =
        event.schedule?.start ?? event.startDateTime ?? event.startsAt;
      const matching = performanceByDay.get(singaporeDay(currentStart));
      if (matching && !strictTimedStart(currentStart)) {
        repaired.push(exactOccurrence(event, matching, activity.activityId, false));
        audit.coarseOccurrencesEnriched += 1;
      } else repaired.push(attachApprovedParent(event, activity.activityId));
    }
  }
  for (const event of events) {
    const id = event.occurrenceId ?? event.id;
    if (!consumed.has(id)) repaired.push(event);
  }
  const concreteSchedulesExactified = repaired.filter((event) => {
    const start =
      event.schedule?.start ?? event.startDateTime ?? event.startsAt;
    return (
      event.schedule?.kind === "selectable" &&
      strictTimedStart(start)
    );
  }).length;
  const normalizedEvents = repaired.map(normalizeRepairedEvent);
  const unsupportedBoundariesHeld = normalizedEvents.filter(
    (event, index) =>
      ["exact", "range"].includes(repaired[index]?.schedule?.kind) &&
      event.schedule?.kind === "unverified",
  ).length;
  audit.concreteSchedulesExactified = concreteSchedulesExactified;
  audit.unsupportedBoundariesHeld = unsupportedBoundariesHeld;
  return {
    events: normalizedEvents
      .sort((a, b) =>
        String(a.occurrenceId ?? a.id).localeCompare(
          String(b.occurrenceId ?? b.id),
        ),
      ),
    audit,
  };
}

function repairLandmarks(activeLandmarks, internalActivities, publicActivities) {
  const activitiesByLandmark = new Map();
  for (const activity of internalActivities.records)
    for (const group of activity.venueGroups ?? []) {
      if (
        group.publicPlacement !== "mapped" ||
        group.mappingStatus !== "approved" ||
        !group.approvedLocationId
      )
        continue;
      const ids = activitiesByLandmark.get(group.approvedLocationId) ?? [];
      ids.push(activity.activityId);
      activitiesByLandmark.set(group.approvedLocationId, ids);
    }
  const referenced = activeLandmarks.map((landmark) => ({
    ...landmark,
    events: [...new Set(activitiesByLandmark.get(landmark.id) ?? [])].map(
      (activityId) => ({ activityId }),
    ),
  }));
  return projectPublicLandmarks(referenced, publicActivities);
}

function validateScheduleIntegrity(activities) {
  const strict =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
  for (const activity of activities.records ?? [])
    for (const session of activity.sessions ?? []) {
      const schedule = session.schedule ?? {};
      if (
        schedule.kind === "exact" &&
        (!strict.test(schedule.start ?? "") ||
          (schedule.end != null && !strict.test(schedule.end)))
      )
        throw new Error(
          `schedule_semantics_repair_exact_boundary_invalid:${session.sessionId}`,
        );
      if (
        schedule.kind === "range" &&
        (!strict.test(schedule.start ?? "") ||
          !strict.test(schedule.end ?? ""))
      )
        throw new Error(
          `schedule_semantics_repair_range_boundary_invalid:${session.sessionId}`,
        );
      if (
        schedule.kind === "range" &&
        parseEnumeratedSchedule(schedule.displayText).performances.length > 1
      )
        throw new Error(
          `schedule_semantics_repair_enumerated_range:${session.sessionId}`,
        );
    }
}

export function repairScheduleSemanticsSnapshot({
  root,
  activate = false,
  generatedAt = new Date().toISOString(),
} = {}) {
  const active = loadApprovedSnapshot({ root });
  const activeManifest = read(path.join(active.directory, "manifest.json"));
  const priorRepair =
    activeManifest.eventPipelineProvenance?.scheduleSemanticsRepair;
  if (priorRepair?.version === REPAIR_VERSION)
    return {
      complete: true,
      changed: false,
      activated: true,
      snapshotId: active.snapshotId,
      previousSnapshotId: activeManifest.previousSnapshotId,
      reason: "schedule_semantics_repair_already_active",
      audit: priorRepair.audit,
    };
  if (!active.internalEventsRef || !active.activitiesRef)
    throw new Error("schedule_semantics_repair_requires_activity_snapshot");

  const internal = read(path.join(active.directory, active.internalEventsRef));
  const activeLandmarks = read(path.join(active.directory, active.landmarksRef));
  const activeEvents = [...(internal.mapped ?? []), ...(internal.offMap ?? [])];
  const recoveredDateReviews = recoveredDateReviewEvents(
    root,
    active.snapshotId,
  );
  const combinedEvents = [
    ...new Map(
      [...activeEvents, ...recoveredDateReviews].map((event) => [
        event.occurrenceId ?? event.id,
        event,
      ]),
    ).values(),
  ];
  const venueReuse = reuseApprovedVenueEvidence(combinedEvents);
  const originalEvents = venueReuse.events;
  const previousActivities = internal.activities?.records ?? [];
  const repaired = repairScheduleEvents({
    events: originalEvents,
    previousActivities,
  });
  const snapshotId = `${active.snapshotId}-${REPAIR_VERSION}`;
  const projection = projectEventActivities({
    events: repaired.events,
    previousActivities,
    runId: snapshotId,
    generatedAt,
  });
  validateScheduleIntegrity(projection.activities);
  const priorReviewCounts = (
    internal.activityGroupingReviews?.records ?? []
  ).reduce((counts, item) => {
    counts[item.reasonCode] = (counts[item.reasonCode] ?? 0) + 1;
    return counts;
  }, {});
  const observedReviewCounts = {};
  const newReviews = projection.reviews.records.filter((item) => {
    observedReviewCounts[item.reasonCode] =
      (observedReviewCounts[item.reasonCode] ?? 0) + 1;
    return (
      observedReviewCounts[item.reasonCode] >
      (priorReviewCounts[item.reasonCode] ?? 0)
    );
  });
  if (newReviews.length)
    throw new Error(
      `schedule_semantics_repair_introduced_reviews:${JSON.stringify(
        newReviews.map(({ reasonCode, occurrenceIds }) => ({
          reasonCode,
          occurrenceIds,
        })),
      )}`,
    );
  const publicActivities = projectPublicActivityCatalogue(
    projection.activities,
    { snapshotId },
  );
  const publicLandmarks = repairLandmarks(
    activeLandmarks,
    projection.activities,
    publicActivities,
  );
  const mapped = repaired.events.filter(
    ({ publicPlacement }) => publicPlacement === "mapped",
  );
  const offMap = repaired.events.filter(
    ({ publicPlacement }) => publicPlacement === "off_map",
  );
  const audit = {
    ...repaired.audit,
    recoveredDateReviewOccurrences: recoveredDateReviews.length,
    reusedApprovedVenueOccurrences: venueReuse.reused,
    enumeratedSchedulesExpanded: repaired.audit.enumeratedActivities,
    inputOccurrences: originalEvents.length,
    outputOccurrences: repaired.events.length,
    sessionsBefore: previousActivities.reduce(
      (sum, activity) => sum + (activity.sessions?.length ?? 0),
      0,
    ),
    sessionsAfter: projection.activities.counts.sessions,
    projectionReviews: projection.reviews.counts.records,
    newProjectionReviews: newReviews.length,
  };
  const repairedInternal = {
    ...internal,
    schemaVersion: "3.3",
    mapped,
    offMap,
    activities: projection.activities,
    activityGroupingReviews: projection.reviews,
    activityGroupingDecisions: projection.decisions,
    parentActivityGrouping: projection.parentGrouping,
    counts: {
      ...(internal.counts ?? {}),
      active: repaired.events.length,
      mapped: mapped.length,
      offMap: offMap.length,
      activities: projection.activities.counts.activities,
      sessions: projection.activities.counts.sessions,
      venueGroups: projection.activities.counts.venueGroups,
      sourceOffers: projection.activities.counts.sourceOffers,
      groupingReviews: projection.reviews.counts.records,
    },
  };
  const snapshot = {
    schemaVersion: "1.0",
    snapshotId,
    publishedAt: activeManifest.publishedAt,
    coveredWindow: activeManifest.coveredWindow,
    freshness: activeManifest.freshness,
    staleAfter: activeManifest.staleAfter,
    sourceHealth: activeManifest.sourceHealth,
    landmarksRef: "landmarks.json",
    poisRef: "pois.json",
    tilesetRef: "tileset.json",
    activitiesRef: "activities.json",
    internalEventsRef: "internal-events.json",
    previousSnapshotId: active.snapshotId,
    eventPipelineProvenance: {
      ...(activeManifest.eventPipelineProvenance ?? {}),
      scheduleSemanticsRepair: {
        version: REPAIR_VERSION,
        sourceSnapshotId: active.snapshotId,
        repairedAt: generatedAt,
        audit,
      },
    },
  };
  const staged =
    existingStage(root, snapshotId, active.snapshotId) ??
    stageImmutableSnapshot({
      root,
      snapshot,
      commitEligibility: { eligible: true },
      artifacts: {
        "landmarks.json": json(publicLandmarks),
        "pois.json": fs.readFileSync(
          path.join(active.directory, active.poisRef),
          "utf8",
        ),
        "tileset.json": fs.readFileSync(
          path.join(active.directory, active.tilesetRef),
          "utf8",
        ),
        "activities.json": json(publicActivities),
        "internal-events.json": json(repairedInternal),
      },
    });
  if (activate) activateStagedSnapshot({ root, staged });
  return {
    complete: true,
    changed: true,
    activated: activate,
    snapshotId,
    previousSnapshotId: active.snapshotId,
    audit,
  };
}
