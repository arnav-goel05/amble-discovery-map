import { createHash } from "node:crypto";
import { normalizeText } from "../../event-normalizer.mjs";

export function venueEvidencePayload({ venue, eventIds, events = [], enrichmentRecords = [], recoveryRecords = [], deterministicRecoveryRecords = [] }) {
  const byId = new Map(events.map((event) => [event.id, event]));
  const enrichmentByEvent = new Map(enrichmentRecords.map((record) => [record.eventId, record]));
  const payload = {
    venue: normalizeText(venue),
    events: eventIds.map((id) => {
      const event = byId.get(id) ?? {};
      return { id, address: event.address ?? null, coordinates: event.coordinates ?? null, sources: event.sources ?? [] };
    }),
  };
  const sourceCoordinates = eventIds.flatMap((id) => enrichmentByEvent.get(id)?.coordinateCandidates ?? [])
    .map((candidate) => ({ lat: Number(candidate.lat), lng: Number(candidate.lng), source: candidate.source ?? null, recordRef: candidate.recordRef ?? null }))
    .filter((candidate) => Number.isFinite(candidate.lat) && Number.isFinite(candidate.lng))
    .sort((left, right) => left.lat - right.lat || left.lng - right.lng || String(left.recordRef).localeCompare(String(right.recordRef)));
  if (sourceCoordinates.length) payload.sourceCoordinates = sourceCoordinates;
  const recovery = recoveryRecords.find((record) => normalizeText(record.venue) === normalizeText(venue));
  if (recovery) payload.recoveryEvidence = {
    addressCandidates: recovery.addressCandidates ?? [],
    postalCodes: recovery.postalCodes ?? [],
    coordinateCandidates: recovery.coordinateCandidates ?? [],
    evidenceInspected: (recovery.evidenceInspected ?? []).map(({ sourceType, label, url }) => ({ sourceType, label, url })),
  };
  const deterministicRecovery = deterministicRecoveryRecords.find((record) => normalizeText(record.venue) === normalizeText(venue));
  if (deterministicRecovery) payload.deterministicRecovery = {
    method: deterministicRecovery.method,
    verifiedAddress: deterministicRecovery.verifiedAddress,
    coordinateCandidates: deterministicRecovery.coordinateCandidates ?? [],
  };
  return payload;
}

export function computeVenueEvidenceHash(input) {
  return createHash("sha256").update(JSON.stringify(venueEvidencePayload(input))).digest("hex");
}
