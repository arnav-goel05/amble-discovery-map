import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { confirmDiscoveryRecord } from "../scripts/lib/event-sources/authority-confirmation.mjs";
import { loadEventAuthorityRegistry } from "../scripts/lib/provider-policy.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registry = loadEventAuthorityRegistry(
  path.join(root, "data/event-authority-registry.json"),
);
const discovery = (url, claims = {}) => ({
  discoveryRecordId: "honeycombers:item-1",
  evidenceRefs: ["raw/discovery.json"],
  claims: {
    title: "Night at the Museum",
    dateText: "17 July 2026",
    timeText: "19:00",
    venue: "National Gallery Singapore",
    scope: "Singapore",
    ...claims,
  },
  outboundLinks: url ? [{ url, text: "Visit Website" }] : [],
});
const authority = {
  authorityRecordId: "peatix:event-1",
  canonicalUrl: "https://peatix.com/event/example",
  title: "Night at the Museum",
  dateText: "17 July 2026",
  venue: "National Gallery Singapore",
  performances: [{ authorityOccurrenceId: "peatix:event-1#2026-07-17T19:00" }],
};

test("confirmation accepts compatible reviewed authority evidence occurrence by occurrence", async () => {
  const decision = await confirmDiscoveryRecord({
    discovery: discovery("https://peatix.com/event/example"),
    registry,
    fetchAuthority: async () => authority,
  });
  assert.equal(decision.decision, "authority_confirmed");
  assert.deepEqual(decision.mappedAuthorityOccurrenceIds, [
    "peatix:event-1#2026-07-17T19:00",
  ]);
  assert.equal(decision.compatibility.title, "compatible");
});

test("confirmation rejects or reviews links without fetching unapproved content", async () => {
  let fetches = 0;
  const fetchAuthority = async () => {
    fetches += 1;
    return authority;
  };
  assert.equal(
    (
      await confirmDiscoveryRecord({
        discovery: discovery(null),
        registry,
        fetchAuthority,
      })
    ).decision,
    "editorial_sufficient",
  );
  assert.equal(
    (
      await confirmDiscoveryRecord({
        discovery: discovery("https://peatix.com/"),
        registry,
        fetchAuthority,
      })
    ).corroborationFailureReason,
    "generic_authority_page",
  );
  assert.equal(
    (
      await confirmDiscoveryRecord({
        discovery: discovery("https://instagram.com/example/event"),
        registry,
        fetchAuthority,
      })
    ).corroborationFailureReason,
    "invalid_authority_link",
  );
  assert.equal(
    (
      await confirmDiscoveryRecord({
        discovery: discovery("https://unknown.example/events/one"),
        registry,
        fetchAuthority,
      })
    ).corroborationFailureReason,
    "authority_domain_review",
  );
  assert.equal(fetches, 0);
});

test("direct reuse wins before outbound fetch and preserves evidence upgrades", async () => {
  let fetches = 0;
  const decision = await confirmDiscoveryRecord({
    discovery: discovery("https://peatix.com/event/example"),
    registry,
    directRecords: [{ sourceRecordId: "catch:event-1" }],
    priorAssessment: { evidenceLevel: "editorial_authoritative" },
    fetchAuthority: async () => {
      fetches += 1;
      return authority;
    },
  });
  assert.equal(decision.decision, "direct_reused");
  assert.equal(decision.evidenceLevel, "direct_corroborated");
  assert.equal(decision.primaryEvidenceId, "catch:event-1");
  assert.equal(decision.upgradedFrom, "editorial_authoritative");
  assert.equal(fetches, 0);
});

test("sufficient editorial-only and corroborating editorial evidence publish, while incomplete and conflicting claims review", async () => {
  const sufficient = await confirmDiscoveryRecord({
    discovery: discovery(null),
    registry,
    fetchAuthority: async () => authority,
    editorialPeers: [{ discoveryRecordId: "timeout:item-2" }],
  });
  assert.equal(sufficient.evidenceLevel, "editorial_authoritative");
  assert.deepEqual(sufficient.corroboratingEditorialIds, ["timeout:item-2"]);
  const incomplete = await confirmDiscoveryRecord({
    discovery: discovery(null, { dateText: null }),
    registry,
    fetchAuthority: async () => authority,
  });
  assert.equal(incomplete.decision, "editorial_evidence_incomplete");
  const conflictDiscovery = { ...discovery(null), conflict: true };
  const conflict = await confirmDiscoveryRecord({
    discovery: conflictDiscovery,
    registry,
    fetchAuthority: async () => authority,
  });
  assert.equal(conflict.decision, "evidence_conflict");
  const unverified = await confirmDiscoveryRecord({
    discovery: discovery(null, { dateText: "Coming soon" }),
    registry,
    fetchAuthority: async () => authority,
  });
  assert.equal(unverified.decision, "schedule_unverified");
});

test("authority conflicts and ambiguous siblings cannot publish a discovery", async () => {
  const conflict = await confirmDiscoveryRecord({
    discovery: discovery("https://peatix.com/event/example", {
      venue: "Other Hall",
    }),
    registry,
    fetchAuthority: async () => authority,
  });
  assert.equal(conflict.decision, "authority_details_conflict");
  const ambiguous = await confirmDiscoveryRecord({
    discovery: discovery("https://peatix.com/event/example", {
      timeText: null,
    }),
    registry,
    fetchAuthority: async () => ({
      ...authority,
      performances: [
        { authorityOccurrenceId: "one" },
        { authorityOccurrenceId: "two" },
      ],
    }),
  });
  assert.equal(ambiguous.decision, "authority_occurrence_ambiguous");
});

test("directly collected authority is reused without changing authority identity", async () => {
  const decision = await confirmDiscoveryRecord({
    discovery: discovery("https://peatix.com/event/example"),
    registry,
    fetchAuthority: async () => ({ ...authority, alreadyCollected: true }),
  });
  assert.equal(decision.decision, "already_collected_authority");
  assert.equal(decision.authorityRecordId, authority.authorityRecordId);
});
