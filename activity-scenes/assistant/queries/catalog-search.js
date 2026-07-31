const CATALOG_TYPES = new Set([
  "area",
  "event",
  "restaurant",
  "plan_stop",
  "saved_item",
  "game",
]);
const ATTRIBUTE_FIELDS = Object.freeze({
  areaId: { kind: "string", maximum: 256 },
  planningArea: { kind: "string", maximum: 160 },
  venue: { kind: "string", maximum: 200 },
  startDate: { kind: "string", maximum: 40 },
  endDate: { kind: "nullable", maximum: 40 },
  category: { kind: "nullable", maximum: 100 },
  price: { kind: "nullable", maximum: 100 },
  cuisine: { kind: "nullable", maximum: 100 },
  status: { kind: "nullable", maximum: 100 },
  availability: { kind: "nullable", maximum: 100 },
  distanceMeters: { kind: "number" },
  dealCount: { kind: "integer" },
});

export class CatalogSearchError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CatalogSearchError";
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new CatalogSearchError(code, message);
};
const containsRawContent = (value) => /(?:https?:\/\/|<[^>]+>)/i.test(value);
const boundedString = (value, maximum) =>
  typeof value === "string" ? value.trim().slice(0, maximum) : "";
const publicString = (value, maximum) => {
  const bounded = boundedString(value, maximum);
  return containsRawContent(bounded) ? "" : bounded;
};
const nullable = (value, maximum) =>
  value === null ? null : publicString(value, maximum) || null;
const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

function fnv1a64(value) {
  const bytes = new TextEncoder().encode(value);
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function candidateType(item) {
  const value = item?.type ?? item?.candidateType;
  return value === "saved" ? "saved_item" : value;
}

function sourceAttributes(item) {
  const attributes =
    item?.attributes && typeof item.attributes === "object"
      ? item.attributes
      : {};
  return {
    ...attributes,
    areaId: attributes.areaId ?? item?.areaId,
    venue: attributes.venue ?? item?.venue ?? item?.place,
    status: attributes.status ?? item?.status,
    availability: attributes.availability ?? item?.availability,
  };
}

function projectAttributes(item) {
  const source = sourceAttributes(item);
  const projected = {};
  for (const [field, contract] of Object.entries(ATTRIBUTE_FIELDS)) {
    if (source[field] === undefined) continue;
    if (contract.kind === "string") {
      const value = publicString(source[field], contract.maximum);
      if (value) projected[field] = value;
    } else if (contract.kind === "nullable") {
      projected[field] = nullable(source[field], contract.maximum);
    } else if (
      contract.kind === "number" &&
      Number.isFinite(source[field]) &&
      source[field] >= 0
    ) {
      projected[field] = Number(source[field]);
    } else if (
      contract.kind === "integer" &&
      Number.isInteger(source[field]) &&
      source[field] >= 0
    ) {
      projected[field] = source[field];
    }
  }
  return projected;
}

export function projectCatalogItem(item, { summaryMaximum = 1_000 } = {}) {
  const targetId = boundedString(item?.targetId ?? item?.candidateId, 256);
  const type = candidateType(item);
  const source = item?.attributes || {};
  const label = publicString(
    item?.label ?? item?.title ?? item?.name ?? source.name,
    200,
  );
  if (
    !/^[a-z][a-z0-9_-]*:.+/.test(targetId) ||
    !CATALOG_TYPES.has(type) ||
    !label
  )
    return null;
  const summarySource =
    item?.summary ?? item?.description ?? source.summary ?? source.description;
  return {
    targetId,
    type,
    label,
    summary: nullable(summarySource, summaryMaximum),
    attributes: projectAttributes(item),
  };
}

export function validateCatalogSnapshot(catalog) {
  if (
    !catalog ||
    typeof catalog !== "object" ||
    typeof catalog.catalogRevision !== "string" ||
    !catalog.catalogRevision ||
    catalog.catalogRevision.length > 256 ||
    !Array.isArray(catalog.sources) ||
    catalog.sources.length < 1 ||
    catalog.sources.length > 12 ||
    !Array.isArray(catalog.items)
  )
    fail("catalog_snapshot_invalid", "Approved catalogue snapshot is invalid");
  const sourceKeys = new Set();
  for (const source of catalog.sources) {
    if (
      !source ||
      typeof source.connectorId !== "string" ||
      !source.connectorId ||
      source.connectorId.length > 64 ||
      typeof source.revision !== "string" ||
      !source.revision ||
      source.revision.length > 256
    )
      fail("catalog_snapshot_invalid", "Catalogue provenance is invalid");
    const key = `${source.connectorId}\u0000${source.revision}`;
    if (sourceKeys.has(key))
      fail("catalog_snapshot_invalid", "Catalogue provenance is duplicated");
    sourceKeys.add(key);
  }
  const targetIds = new Set();
  for (const item of catalog.items) {
    const projected = projectCatalogItem(item);
    if (!projected || targetIds.has(projected.targetId))
      fail(
        "catalog_snapshot_invalid",
        "Catalogue items must have unique stable projected identities",
      );
    targetIds.add(projected.targetId);
  }
  return catalog;
}

function normalizeArguments(argumentsValue) {
  if (
    !argumentsValue ||
    typeof argumentsValue !== "object" ||
    Array.isArray(argumentsValue) ||
    Object.keys(argumentsValue).some(
      (key) => !["query", "types", "limit", "cursor"].includes(key),
    )
  )
    fail(
      "catalog_search_arguments_invalid",
      "catalog.search arguments are invalid",
    );
  const query = boundedString(argumentsValue.query ?? "", 500).replace(
    /\s+/g,
    " ",
  );
  if (
    argumentsValue.query !== undefined &&
    typeof argumentsValue.query !== "string"
  )
    fail(
      "catalog_search_arguments_invalid",
      "catalog.search query must be text",
    );
  const rawTypes = argumentsValue.types ?? [];
  if (
    !Array.isArray(rawTypes) ||
    rawTypes.some((type) => !CATALOG_TYPES.has(type)) ||
    new Set(rawTypes).size !== rawTypes.length
  )
    fail(
      "catalog_search_arguments_invalid",
      "catalog.search types are invalid",
    );
  const types = [...rawTypes].sort(compare);
  const limit = argumentsValue.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 20)
    fail(
      "catalog_search_arguments_invalid",
      "catalog.search limit must be between 1 and 20",
    );
  if (
    argumentsValue.cursor !== undefined &&
    argumentsValue.cursor !== null &&
    (typeof argumentsValue.cursor !== "string" ||
      argumentsValue.cursor.length > 512)
  )
    fail("catalog_cursor_invalid", "Catalogue cursor is invalid");
  return { query, types, limit, cursor: argumentsValue.cursor ?? null };
}

function cursorFingerprint(catalogRevision, query, types) {
  return fnv1a64(
    JSON.stringify({
      catalogRevision,
      query: query.toLowerCase(),
      types,
    }),
  );
}

function cursorOffset(cursor, fingerprint) {
  if (cursor === null) return 0;
  const match = /^v1:([0-9a-f]{16}):([1-9][0-9]*)$/.exec(cursor);
  const offset = match ? Number(match[2]) : Number.NaN;
  if (
    !match ||
    match[1] !== fingerprint ||
    !Number.isSafeInteger(offset) ||
    offset < 1
  )
    fail("catalog_cursor_invalid", "Catalogue cursor is stale or invalid");
  return offset;
}

function searchableText(item) {
  return [
    item.label,
    item.summary,
    ...Object.values(item.attributes || {}).filter(
      (value) => typeof value === "string",
    ),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function searchCatalog(catalogValue, argumentsValue = {}) {
  const catalog = validateCatalogSnapshot(catalogValue);
  const { query, types, limit, cursor } = normalizeArguments(argumentsValue);
  const fingerprint = cursorFingerprint(catalog.catalogRevision, query, types);
  const offset = cursorOffset(cursor, fingerprint);
  const normalizedQuery = query.toLowerCase();
  const selectedTypes = new Set(types);
  const matches = catalog.items
    .map((item) => projectCatalogItem(item, { summaryMaximum: 500 }))
    .filter(Boolean)
    .filter(
      (item) =>
        (!selectedTypes.size || selectedTypes.has(item.type)) &&
        (!normalizedQuery || searchableText(item).includes(normalizedQuery)),
    )
    .sort(
      (left, right) =>
        compare(left.label.toLowerCase(), right.label.toLowerCase()) ||
        compare(left.targetId, right.targetId),
    );
  if (offset > matches.length)
    fail("catalog_cursor_invalid", "Catalogue cursor exceeds result bounds");
  const items = matches.slice(offset, offset + limit);
  const total = matches.length - offset;
  const hasNextPage = total > items.length;
  return {
    query,
    types,
    catalogRevision: catalog.catalogRevision,
    sources: structuredClone(catalog.sources),
    total,
    truncated: hasNextPage,
    items,
    nextCursor: hasNextPage
      ? `v1:${fingerprint}:${offset + items.length}`
      : null,
  };
}
