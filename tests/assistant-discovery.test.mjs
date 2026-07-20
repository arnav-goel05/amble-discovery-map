import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createDiscoveryIntent,
  refineDiscoveryIntent,
} from "../activity-scenes/assistant/conversation-model.js";
import {
  DiscoveryValidationError,
  orderSuggestedAreas,
  validateDiscoveryResult,
} from "../activity-scenes/assistant/discovery-model.js";
import { matchLocalDiscovery } from "../activity-scenes/assistant/local-discovery.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = (name) =>
  JSON.parse(
    fs.readFileSync(path.join(root, "tests/fixtures/voice", name), "utf8"),
  );
const clone = (value) => structuredClone(value);
const candidates = fixture("approved-candidates.json");
const expectedResult = fixture("vague-discovery.json").expectedResult;

const rejectsWith = (callback, code) =>
  assert.throws(
    callback,
    (error) => error instanceof DiscoveryValidationError && error.code === code,
  );

test("approved area-first result satisfies the closed discovery schema", () => {
  const result = validateDiscoveryResult(expectedResult, candidates);

  assert.deepEqual(result, expectedResult);
  assert.notEqual(result, expectedResult);
  assert.equal(result.areas.length, 2);
  assert.deepEqual(
    result.areas.map(({ areaId, rank }) => ({ areaId, rank })),
    [
      { areaId: "ura-subzone:marina-south", rank: 1 },
      { areaId: "ura-subzone:city-hall", rank: 2 },
    ],
  );

  rejectsWith(
    () =>
      validateDiscoveryResult(
        { ...clone(expectedResult), generatedSummary: "not in contract" },
        candidates,
      ),
    "discovery_schema_invalid",
  );
});

test("unknown area and candidate identities fail closed", () => {
  const unknownCandidate = clone(expectedResult);
  unknownCandidate.areas[0].candidateIds = ["candidate:model-invented"];
  unknownCandidate.areas[0].reasons[0].candidateIds = [
    "candidate:model-invented",
  ];
  rejectsWith(
    () => validateDiscoveryResult(unknownCandidate, candidates),
    "discovery_candidate_unknown",
  );

  const unknownArea = clone(expectedResult);
  unknownArea.areas[0].areaId = "ura-subzone:model-invented";
  rejectsWith(
    () => validateDiscoveryResult(unknownArea, candidates),
    "discovery_area_unknown",
  );

  const wrongArea = clone(expectedResult);
  wrongArea.areas[0].candidateIds = ["candidate:national-gallery"];
  wrongArea.areas[0].reasons[0].candidateIds = ["candidate:national-gallery"];
  rejectsWith(
    () => validateDiscoveryResult(wrongArea, candidates),
    "discovery_candidate_area_mismatch",
  );
});

test("reason claims may cite only supplied attributes on cited candidates", () => {
  const unsupported = clone(expectedResult);
  unsupported.areas[0].reasons[0].attributeKeys = ["currentCrowdLevel"];

  rejectsWith(
    () => validateDiscoveryResult(unsupported, candidates),
    "discovery_claim_unsupported",
  );

  const unsupportedCandidateReference = clone(expectedResult);
  unsupportedCandidateReference.areas[0].reasons[0].candidateIds = [
    "candidate:national-gallery",
  ];
  rejectsWith(
    () => validateDiscoveryResult(unsupportedCandidateReference, candidates),
    "discovery_reason_candidate_invalid",
  );
});

test("intent refinement retains established context and increments revision", () => {
  const initial = createDiscoveryIntent({
    freeTextSummary: "Somewhere calm for an evening walk.",
    interests: ["Garden", "waterfront", "garden"],
    exclusions: ["expensive"],
    timeWindow: "evening",
    priceRange: "free",
    crowdPreference: "calm",
    transitConstraint: null,
    specificity: "area",
  });

  assert.deepEqual(initial, {
    revision: 0,
    freeTextSummary: "Somewhere calm for an evening walk.",
    interests: ["garden", "waterfront"],
    exclusions: ["expensive"],
    timeWindow: "evening",
    priceRange: "free",
    crowdPreference: "calm",
    transitConstraint: null,
    specificity: "area",
  });

  const refined = refineDiscoveryIntent(initial, {
    freeTextSummary: "Keep the evening plan but make it livelier.",
    interests: ["Arts", "waterfront"],
    crowdPreference: "lively",
  });

  assert.deepEqual(refined, {
    revision: 1,
    freeTextSummary: "Keep the evening plan but make it livelier.",
    interests: ["garden", "waterfront", "arts"],
    exclusions: ["expensive"],
    timeWindow: "evening",
    priceRange: "free",
    crowdPreference: "lively",
    transitConstraint: null,
    specificity: "area",
  });
  assert.deepEqual(initial.interests, ["garden", "waterfront"]);
});

test("confidence is finite, bounded, and ordered consistently with rank", () => {
  for (const confidence of [
    -0.01,
    1.01,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ]) {
    const invalid = clone(expectedResult);
    invalid.areas[0].confidence = confidence;
    rejectsWith(
      () => validateDiscoveryResult(invalid, candidates),
      "discovery_confidence_invalid",
    );
  }

  const confidenceContradictsRank = clone(expectedResult);
  confidenceContradictsRank.areas[0].confidence = 0.5;
  confidenceContradictsRank.areas[1].confidence = 0.8;
  rejectsWith(
    () => validateDiscoveryResult(confidenceContradictsRank, candidates),
    "discovery_rank_invalid",
  );
});

test("area ordering is stable across input order and assigns contiguous ranks", () => {
  const unranked = expectedResult.areas.map((area) => ({
    ...clone(area),
    rank: 1,
    confidence: 0.8,
  }));
  const forward = orderSuggestedAreas(unranked);
  const reverse = orderSuggestedAreas([...unranked].reverse());

  assert.deepEqual(forward, reverse);
  assert.deepEqual(
    forward.map(({ areaId, rank }) => ({ areaId, rank })),
    [
      { areaId: "ura-subzone:city-hall", rank: 1 },
      { areaId: "ura-subzone:marina-south", rank: 2 },
    ],
  );
  assert.deepEqual(
    unranked.map(({ rank }) => rank),
    [1, 1],
  );
});

test("MRT affects local ranking only after an explicit transit constraint", () => {
  const baseIntent = createDiscoveryIntent({ specificity: "area" });
  const stations = [
    {
      geometry: {
        type: "Point",
        coordinates: [103.8641, 1.2816],
      },
    },
  ];
  const defaultResult = matchLocalDiscovery(baseIntent, candidates, {
    transitStations: stations,
  });
  const constrainedResult = matchLocalDiscovery(
    refineDiscoveryIntent(baseIntent, {
      transitConstraint: { mode: "mrt", explicitlyRequested: true },
    }),
    candidates,
    { transitStations: stations },
  );

  assert.equal(defaultResult.areas[0].areaId, "ura-subzone:city-hall");
  assert.equal(constrainedResult.areas[0].areaId, "ura-subzone:marina-south");
  assert.match(
    constrainedResult.areas[0].tradeoffs[0],
    /MRT access was explicitly requested/,
  );
});

test("vague requests without an exact saved-fact match still return grounded areas", () => {
  const intent = createDiscoveryIntent({
    freeTextSummary: "somewhere surprising and unhurried",
    interests: ["surprising", "unhurried"],
    specificity: "area",
  });
  const result = matchLocalDiscovery(intent, candidates);

  assert.ok(result.areas.length > 0);
  assert.ok(
    result.areas.every((area) =>
      area.tradeoffs.some((tradeoff) => /No exact saved-fact match/.test(tradeoff)),
    ),
  );
  assert.ok(
    result.areas.every((area) =>
      area.reasons.every((reason) => reason.candidateIds.length > 0),
    ),
  );
});
