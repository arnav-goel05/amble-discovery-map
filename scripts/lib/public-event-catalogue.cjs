"use strict";

const INTERNAL_PUBLIC_KEYS = new Set([
  "evidence",
  "evidenceRefs",
  "fieldCompleteness",
  "fieldCompletenessByOccurrence",
  "groupingDecision",
  "memberOccurrenceIds",
  "occurrenceIds",
  "provenance",
  "provenanceRefs",
  "recordRef",
  "reconciliation",
  "sourceOccurrenceIds",
  "sourceParentActivityIds",
  "sourceParentListingIds",
  "sourceSessionIds",
]);

function publicSchedule(schedule) {
  if (!schedule || typeof schedule !== "object" || Array.isArray(schedule))
    return null;
  return {
    kind: schedule.kind ?? "unverified",
    start: schedule.start ?? null,
    end: schedule.end ?? null,
    recurrence: schedule.recurrence ?? null,
    displayText: schedule.displayText ?? null,
    finalKnownOccurrence: schedule.finalKnownOccurrence ?? null,
  };
}

function publicSession(session) {
  return {
    sessionId: session.sessionId,
    schedule: publicSchedule(session.schedule),
    availability: session.availability ?? "unknown",
    venueGroupIds: [...new Set(session.venueGroupIds ?? [])].sort(),
  };
}

function publicVenueGroup(group) {
  const mapped =
    group.publicPlacement === "mapped" && group.mappingStatus === "approved";
  return {
    venueGroupId: group.venueGroupId,
    activityId: group.activityId,
    label: group.label || "Location TBA",
    address: group.address ?? null,
    publicPlacement: group.publicPlacement ?? "off_map",
    mappingStatus: group.mappingStatus ?? "not_required",
    approvedLocationId: mapped ? (group.approvedLocationId ?? null) : null,
    coordinates: mapped ? (group.coordinates ?? null) : null,
    sessionIds: [...new Set(group.sessionIds ?? [])].sort(),
    ...(group.offMapSubtype ? { offMapSubtype: group.offMapSubtype } : {}),
  };
}

function publicOffer(offer, activityId) {
  const url = new URL(offer.url);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error(`public_activity_offer_url_invalid:${offer.offerId}`);
  return {
    offerId: `${activityId}::${offer.offerId}`,
    source: offer.source,
    url: url.href,
    scope: offer.scope,
    sessionIds:
      offer.scope === "sessions"
        ? [...new Set(offer.sessionIds ?? [])].sort()
        : [],
  };
}

function publicActivity(activity) {
  return {
    schemaVersion: "1.0",
    activityId: activity.activityId,
    title: activity.title,
    description: activity.description ?? null,
    category: activity.category ?? null,
    organizer: activity.organizer ?? null,
    price: activity.price ?? null,
    lifecycleState: activity.lifecycleState ?? "active",
    freshness: activity.freshness ?? "current",
    sources: [...new Set(activity.sources ?? [])].sort(),
    sessions: (activity.sessions ?? []).map(publicSession),
    venueGroups: (activity.venueGroups ?? []).map(publicVenueGroup),
    sourceOffers: (activity.sourceOffers ?? []).map((offer) =>
      publicOffer(offer, activity.activityId),
    ),
    scheduleSummary: activity.scheduleSummary ?? {
      kind: "unverified",
      label: "Schedule unavailable",
      sessionCount: (activity.sessions ?? []).length,
    },
  };
}

function validatePublicActivityCatalogue(catalogue) {
  if (catalogue?.schemaVersion !== "1.0" || !Array.isArray(catalogue.records))
    throw new Error("public_activity_catalogue_schema_invalid");
  const activityIds = new Set();
  const sessionIds = new Set();
  const venueGroupIds = new Set();
  const offerIds = new Set();
  let mappedActivities = 0;
  let offMapActivities = 0;
  for (const activity of catalogue.records) {
    if (!activity.activityId || activityIds.has(activity.activityId))
      throw new Error("public_activity_identity_invalid");
    activityIds.add(activity.activityId);
    const localSessions = new Set();
    const localGroups = new Set();
    let mapped = false;
    let offMap = false;
    for (const session of activity.sessions ?? []) {
      if (
        !session.sessionId ||
        sessionIds.has(session.sessionId) ||
        localSessions.has(session.sessionId)
      )
        throw new Error("public_activity_session_identity_invalid");
      sessionIds.add(session.sessionId);
      localSessions.add(session.sessionId);
    }
    for (const group of activity.venueGroups ?? []) {
      if (
        !group.venueGroupId ||
        venueGroupIds.has(group.venueGroupId) ||
        localGroups.has(group.venueGroupId) ||
        group.activityId !== activity.activityId
      )
        throw new Error("public_activity_venue_identity_invalid");
      venueGroupIds.add(group.venueGroupId);
      localGroups.add(group.venueGroupId);
      if ((group.sessionIds ?? []).some((id) => !localSessions.has(id)))
        throw new Error("public_activity_venue_session_invalid");
      if (group.publicPlacement === "mapped") {
        mapped = true;
        const longitude = Number(
          Array.isArray(group.coordinates)
            ? group.coordinates[0]
            : group.coordinates?.lng,
        );
        const latitude = Number(
          Array.isArray(group.coordinates)
            ? group.coordinates[1]
            : group.coordinates?.lat,
        );
        if (
          group.mappingStatus !== "approved" ||
          !group.approvedLocationId ||
          !Number.isFinite(longitude) ||
          !Number.isFinite(latitude)
        )
          throw new Error(
            `public_activity_mapped_geometry_invalid:${JSON.stringify({
              activityId: activity.activityId,
              venueGroupId: group.venueGroupId,
              mappingStatus: group.mappingStatus ?? null,
              approvedLocationId: group.approvedLocationId ?? null,
              coordinates: group.coordinates ?? null,
            })}`,
          );
      } else offMap = true;
    }
    for (const session of activity.sessions ?? [])
      if ((session.venueGroupIds ?? []).some((id) => !localGroups.has(id)))
        throw new Error("public_activity_session_venue_invalid");
    for (const offer of activity.sourceOffers ?? []) {
      if (!offer.offerId || offerIds.has(offer.offerId))
        throw new Error("public_activity_offer_identity_invalid");
      offerIds.add(offer.offerId);
      if (
        offer.scope === "sessions" &&
        (offer.sessionIds ?? []).some((id) => !localSessions.has(id))
      )
        throw new Error("public_activity_offer_session_invalid");
    }
    if (mapped) mappedActivities += 1;
    if (offMap || !mapped) offMapActivities += 1;
  }
  const expected = {
    activities: activityIds.size,
    sessions: sessionIds.size,
    venueGroups: venueGroupIds.size,
    sourceOffers: offerIds.size,
    mappedActivities,
    offMapActivities,
  };
  for (const [key, value] of Object.entries(expected))
    if (catalogue.counts?.[key] !== value)
      throw new Error(`public_activity_count_invalid:${key}`);
  const forbidden = (value) => {
    if (Array.isArray(value)) return value.some(forbidden);
    if (!value || typeof value !== "object") return false;
    return Object.entries(value).some(
      ([key, child]) => INTERNAL_PUBLIC_KEYS.has(key) || forbidden(child),
    );
  };
  if (forbidden(catalogue))
    throw new Error("public_activity_internal_audit_present");
  return catalogue;
}

function projectPublicActivityCatalogue(activities, { snapshotId = null } = {}) {
  const records = (activities?.records ?? []).map(publicActivity);
  const counts = {
    activities: records.length,
    sessions: records.reduce((sum, item) => sum + item.sessions.length, 0),
    venueGroups: records.reduce((sum, item) => sum + item.venueGroups.length, 0),
    sourceOffers: records.reduce(
      (sum, item) => sum + item.sourceOffers.length,
      0,
    ),
    mappedActivities: records.filter((item) =>
      item.venueGroups.some((group) => group.publicPlacement === "mapped"),
    ).length,
    offMapActivities: records.filter(
      (item) =>
        !item.venueGroups.some(
          (group) => group.publicPlacement === "mapped",
        ) ||
        item.venueGroups.some((group) => group.publicPlacement !== "mapped"),
    ).length,
  };
  return validatePublicActivityCatalogue({
    schemaVersion: "1.0",
    snapshotId: snapshotId ?? activities?.runId ?? null,
    generatedAt: activities?.generatedAt ?? null,
    counts,
    records,
  });
}

function validatePublicLandmarks(landmarks, activities) {
  if (!Array.isArray(landmarks))
    throw new Error("public_landmarks_schema_invalid");
  const activityById = new Map(
    (activities?.records ?? []).map((activity) => [
      activity.activityId,
      activity,
    ]),
  );
  const mappedGroupRefs = new Set();
  const landmarkIds = new Set();
  for (const landmark of landmarks) {
    if (
      !landmark?.id ||
      landmarkIds.has(landmark.id) ||
      !Array.isArray(landmark.activityRefs) ||
      "events" in landmark
    )
      throw new Error("public_landmark_contract_invalid");
    landmarkIds.add(landmark.id);
    const activityRefs = new Set();
    for (const reference of landmark.activityRefs) {
      if (
        !reference?.activityId ||
        activityRefs.has(reference.activityId) ||
        !Array.isArray(reference.venueGroupIds) ||
        !reference.venueGroupIds.length ||
        new Set(reference.venueGroupIds).size !== reference.venueGroupIds.length
      )
        throw new Error("public_landmark_reference_invalid");
      activityRefs.add(reference.activityId);
      const activity = activityById.get(reference.activityId);
      if (!activity)
        throw new Error("public_landmark_activity_missing");
      const groups = new Map(
        activity.venueGroups.map((group) => [group.venueGroupId, group]),
      );
      for (const venueGroupId of reference.venueGroupIds) {
        const group = groups.get(venueGroupId);
        if (
          !group ||
          group.publicPlacement !== "mapped" ||
          group.mappingStatus !== "approved" ||
          group.approvedLocationId !== landmark.id
        )
          throw new Error("public_landmark_venue_group_invalid");
        const groupLongitude = Number(
          Array.isArray(group.coordinates)
            ? group.coordinates[0]
            : group.coordinates?.lng,
        );
        const groupLatitude = Number(
          Array.isArray(group.coordinates)
            ? group.coordinates[1]
            : group.coordinates?.lat,
        );
        const landmarkLongitude = Number(
          Array.isArray(landmark.anchor)
            ? landmark.anchor[0]
            : landmark.anchor?.lng,
        );
        const landmarkLatitude = Number(
          Array.isArray(landmark.anchor)
            ? landmark.anchor[1]
            : landmark.anchor?.lat,
        );
        if (
          !Number.isFinite(landmarkLongitude) ||
          !Number.isFinite(landmarkLatitude) ||
          Math.abs(groupLongitude - landmarkLongitude) > 1e-9 ||
          Math.abs(groupLatitude - landmarkLatitude) > 1e-9
        )
          throw new Error("public_landmark_geometry_mismatch");
        mappedGroupRefs.add(`${reference.activityId}\0${venueGroupId}`);
      }
    }
  }
  for (const activity of activities?.records ?? [])
    for (const group of activity.venueGroups ?? [])
      if (
        group.publicPlacement === "mapped" &&
        !mappedGroupRefs.has(`${activity.activityId}\0${group.venueGroupId}`)
      )
        throw new Error(
          `public_landmark_mapped_group_unreferenced:${JSON.stringify({
            activityId: activity.activityId,
            venueGroupId: group.venueGroupId,
            approvedLocationId: group.approvedLocationId,
            coordinates: group.coordinates,
            occurrenceIds: group.occurrenceIds,
            landmarkActivityRefs:
              landmarks.find(
                (landmark) => landmark.id === group.approvedLocationId,
              )?.activityRefs ?? null,
          })}`,
        );
  return landmarks;
}

function projectPublicLandmarks(landmarks, activities) {
  if (!Array.isArray(landmarks)) return landmarks;
  const activityById = new Map(
    (activities?.records ?? []).map((activity) => [
      activity.activityId,
      activity,
    ]),
  );
  const projected = landmarks.map((landmark) => {
    if (!landmark || typeof landmark !== "object" || Array.isArray(landmark))
      return landmark;
    const refs = new Map();
    for (const event of landmark.events ?? []) {
      const activityId =
        event?.activityId ?? event?.parentActivityId ?? event?.parentListingId;
      const activity = activityById.get(activityId);
      if (!activity)
        throw new Error(
          `public_landmark_activity_missing:${landmark.id}:${activityId ?? "missing"}`,
        );
      const venueGroupIds = activity.venueGroups
        .filter(
          (group) =>
            group.publicPlacement === "mapped" &&
            group.approvedLocationId === landmark.id,
        )
        .map((group) => group.venueGroupId);
      if (!venueGroupIds.length)
        throw new Error(
          `public_landmark_venue_group_missing:${landmark.id}:${activityId}`,
        );
      const current = refs.get(activityId) ?? {
        activityId,
        venueGroupIds: [],
      };
      current.venueGroupIds.push(...venueGroupIds);
      current.venueGroupIds = [...new Set(current.venueGroupIds)].sort();
      refs.set(activityId, current);
    }
    const { events: _events, ...publicLandmark } = landmark;
    return {
      ...publicLandmark,
      activityRefs: [...refs.values()].sort((a, b) =>
        a.activityId.localeCompare(b.activityId),
      ),
    };
  });
  return validatePublicLandmarks(projected, activities);
}

module.exports = {
  projectPublicActivityCatalogue,
  projectPublicLandmarks,
  validatePublicActivityCatalogue,
  validatePublicLandmarks,
};
