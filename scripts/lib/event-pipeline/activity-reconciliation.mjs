import { createHash } from "node:crypto";

const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

function entities(records = []) {
  const result = [];
  for (const activity of records) {
    result.push({
      entityType: "activity",
      entityId: activity.activityId,
      value: activity,
    });
    for (const session of activity.sessions ?? [])
      result.push({
        entityType: "session",
        entityId: session.sessionId,
        value: session,
      });
    for (const venueGroup of activity.venueGroups ?? [])
      result.push({
        entityType: "venue_group",
        entityId: venueGroup.venueGroupId,
        value: venueGroup,
      });
    for (const offer of activity.sourceOffers ?? [])
      result.push({
        entityType: "source_offer",
        entityId: offer.offerId,
        value: offer,
      });
  }
  return result;
}

export function reconcileActivityProjection({
  runId = null,
  records = [],
  previousRecords = [],
  reviews = [],
  generatedAt = null,
} = {}) {
  const current = new Map(
    entities(records).map((entity) => [
      `${entity.entityType}:${entity.entityId}`,
      entity,
    ]),
  );
  const previous = new Map(
    entities(previousRecords).map((entity) => [
      `${entity.entityType}:${entity.entityId}`,
      entity,
    ]),
  );
  const decisions = [];
  for (const [key, entity] of current) {
    const prior = previous.get(key);
    decisions.push({
      entityType: entity.entityType,
      entityId: entity.entityId,
      action: !prior
        ? "create"
        : hash(prior.value) === hash(entity.value)
          ? "no-op"
          : "update",
      previousContentHash: prior ? hash(prior.value) : null,
      contentHash: hash(entity.value),
    });
  }
  for (const [key, entity] of previous)
    if (!current.has(key))
      decisions.push({
        entityType: entity.entityType,
        entityId: entity.entityId,
        action: "expire",
        previousContentHash: hash(entity.value),
        contentHash: null,
      });
  for (const item of reviews)
    decisions.push({
      entityType: "grouping_review",
      entityId: item.reviewId,
      action: "review",
      previousContentHash: null,
      contentHash: hash(item),
      reasonCode: item.reasonCode,
      occurrenceIds: item.occurrenceIds ?? [],
    });
  decisions.sort(
    (a, b) =>
      a.entityType.localeCompare(b.entityType) ||
      a.entityId.localeCompare(b.entityId),
  );
  const counts = Object.fromEntries(
    ["create", "update", "no-op", "expire", "review"].map((action) => [
      action,
      decisions.filter((decision) => decision.action === action).length,
    ]),
  );
  return {
    schemaVersion: "1.0",
    runId,
    generatedAt,
    counts: { records: decisions.length, ...counts },
    records: decisions,
  };
}

export function validateActivityReconciliation(artifact) {
  if (artifact?.schemaVersion !== "1.0")
    throw new Error("activity_reconciliation_schema_invalid");
  const identities = new Set();
  for (const decision of artifact.records ?? []) {
    if (
      !decision.entityId ||
      !["create", "update", "no-op", "expire", "review"].includes(
        decision.action,
      )
    )
      throw new Error("activity_reconciliation_decision_invalid");
    const identity = `${decision.entityType}:${decision.entityId}:${decision.action}`;
    if (identities.has(identity))
      throw new Error("activity_reconciliation_duplicate_decision");
    identities.add(identity);
  }
  if (artifact.counts?.records !== (artifact.records ?? []).length)
    throw new Error("activity_reconciliation_counts_invalid");
  return artifact;
}
