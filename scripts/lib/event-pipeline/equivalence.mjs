import { createHash } from "node:crypto";

const VOLATILE_KEYS = new Set([
  "runId",
  "createdAt",
  "updatedAt",
  "startedAt",
  "finishedAt",
  "completedAt",
  "finalizedAt",
  "publishedAt",
  "verifiedAt",
  "reconciledAt",
  "lastUsedAt",
  "requestId",
]);

const SET_ARRAY_KEYS = new Set([
  "records",
  "mapped",
  "offMap",
  "excluded",
  "sources",
  "sourceContributions",
  "evidenceRefs",
]);

const ORDERED_ARRAY_KEYS = new Set([
  "sessions",
  "schedule",
  "priorityEvidence",
  "children",
]);

const IDENTITY_KEYS = [
  "sourceRecordId",
  "sourceContributionId",
  "occurrenceId",
  "eventId",
  "parentActivityId",
  "venueOccurrenceId",
  "venueGroupId",
  "poiId",
  "gmlId",
  "id",
  "source",
  "name",
];

const stableStringify = (value) => JSON.stringify(value) ?? "undefined";
const sha256 = (value) =>
  createHash("sha256").update(stableStringify(value)).digest("hex");

function stableIdentity(value) {
  if (value === null || typeof value !== "object")
    return stableStringify(value);
  for (const key of IDENTITY_KEYS)
    if (value[key] !== undefined && value[key] !== null)
      return `${key}:${String(value[key])}`;
  return stableStringify(value);
}

export function canonicalizePipelineValue(
  value,
  { volatileKeys = VOLATILE_KEYS, path = [], sortSetArrays = true } = {},
) {
  if (Array.isArray(value)) {
    const canonical = value.map((item, index) =>
      canonicalizePipelineValue(item, {
        volatileKeys,
        path: [...path, String(index)],
        sortSetArrays,
      }),
    );
    const key = path.at(-1);
    if (
      sortSetArrays &&
      SET_ARRAY_KEYS.has(key) &&
      !ORDERED_ARRAY_KEYS.has(key)
    )
      canonical.sort((left, right) =>
        stableIdentity(left).localeCompare(stableIdentity(right)),
      );
    return canonical;
  }
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => !volatileKeys.has(key))
      .sort()
      .map((key) => [
        key,
        canonicalizePipelineValue(value[key], {
          volatileKeys,
          path: [...path, key],
          sortSetArrays,
        }),
      ]),
  );
}

export function hashCanonicalSurface(_name, value, options) {
  return sha256(canonicalizePipelineValue(value, options));
}

function collectDifferences(before, after, path = "$", differences = []) {
  if (Object.is(before, after)) return differences;
  if (
    before === null ||
    after === null ||
    typeof before !== "object" ||
    typeof after !== "object"
  ) {
    differences.push({ path, before, after });
    return differences;
  }
  if (Array.isArray(before) || Array.isArray(after)) {
    if (!Array.isArray(before) || !Array.isArray(after)) {
      differences.push({ path, before, after });
      return differences;
    }
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1)
      collectDifferences(
        before[index],
        after[index],
        `${path}[${index}]`,
        differences,
      );
    return differences;
  }
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)]))
    collectDifferences(before[key], after[key], `${path}.${key}`, differences);
  return differences;
}

export function compareCanonicalSurfaces(before, after, options = {}) {
  const surfaces = {};
  for (const name of [
    ...new Set([...Object.keys(before), ...Object.keys(after)]),
  ].sort()) {
    const left = canonicalizePipelineValue(before[name], options);
    const right = canonicalizePipelineValue(after[name], options);
    const differences = collectDifferences(left, right).slice(
      0,
      options.maxDifferences ?? 100,
    );
    surfaces[name] = {
      equivalent: differences.length === 0,
      beforeHash: sha256(left),
      afterHash: sha256(right),
      differences,
    };
  }
  return {
    equivalent: Object.values(surfaces).every(({ equivalent }) => equivalent),
    surfaces,
  };
}

export const EQUIVALENCE_VOLATILE_KEYS = VOLATILE_KEYS;
