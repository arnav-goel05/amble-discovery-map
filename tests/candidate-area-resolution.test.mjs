import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveCandidateArea,
  resolveCandidateEnvelopeAreas,
} from "../activity-scenes/assistant/candidate-area-resolution.js";

const areas = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { areaId: "ura-subzone:dtsz02", areaName: "CITY HALL" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [103.84, 1.28],
            [103.86, 1.28],
            [103.86, 1.3],
            [103.84, 1.3],
            [103.84, 1.28],
          ],
        ],
      },
    },
  ],
};

const candidate = (overrides = {}) => ({
  candidateId: "event:gallery:1",
  areaId: null,
  coordinates: [103.851, 1.291],
  ...overrides,
});

test("candidate areas normalize source codes and derive missing IDs from coordinates", () => {
  assert.equal(
    resolveCandidateArea(candidate({ areaId: "DTSZ02" }), areas).areaId,
    "ura-subzone:dtsz02",
  );
  assert.equal(
    resolveCandidateArea(candidate(), areas).areaId,
    "ura-subzone:dtsz02",
  );
});

test("candidate envelopes drop only candidates that cannot map to an approved area", () => {
  const envelope = resolveCandidateEnvelopeAreas(
    {
      schemaVersion: "1.0",
      candidates: [
        candidate(),
        candidate({ candidateId: "event:outside:1", coordinates: [0, 0] }),
      ],
    },
    areas,
  );
  assert.deepEqual(
    envelope.candidates.map(({ candidateId, areaId }) => ({
      candidateId,
      areaId,
    })),
    [
      {
        candidateId: "event:gallery:1",
        areaId: "ura-subzone:dtsz02",
      },
    ],
  );
});
