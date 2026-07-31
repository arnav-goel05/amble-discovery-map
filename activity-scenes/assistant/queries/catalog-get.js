import {
  projectCatalogItem,
  validateCatalogSnapshot,
} from "./catalog-search.js";

export class CatalogGetError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CatalogGetError";
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new CatalogGetError(code, message);
};

function normalizeArguments(argumentsValue) {
  if (
    !argumentsValue ||
    typeof argumentsValue !== "object" ||
    Array.isArray(argumentsValue) ||
    Object.keys(argumentsValue).some((key) => key !== "targetIds") ||
    !Array.isArray(argumentsValue.targetIds) ||
    argumentsValue.targetIds.length < 1 ||
    argumentsValue.targetIds.length > 10 ||
    new Set(argumentsValue.targetIds).size !==
      argumentsValue.targetIds.length ||
    argumentsValue.targetIds.some(
      (targetId) =>
        typeof targetId !== "string" ||
        !targetId ||
        targetId.length > 256 ||
        !/^[a-z][a-z0-9_-]*:.+/.test(targetId),
    )
  )
    fail(
      "catalog_get_arguments_invalid",
      "catalog.get requires one to ten unique stable target IDs",
    );
  return [...argumentsValue.targetIds];
}

export function getCatalogItems(catalogValue, argumentsValue) {
  let catalog;
  try {
    catalog = validateCatalogSnapshot(catalogValue);
  } catch (error) {
    fail(error.code || "catalog_snapshot_invalid", error.message);
  }
  const targetIds = normalizeArguments(argumentsValue);
  const byId = new Map(
    catalog.items
      .map((item) => projectCatalogItem(item, { summaryMaximum: 1_000 }))
      .filter(Boolean)
      .map((item) => [item.targetId, item]),
  );
  const items = [];
  const missingTargetIds = [];
  for (const targetId of targetIds) {
    const item = byId.get(targetId);
    if (item) items.push(item);
    else missingTargetIds.push(targetId);
  }
  return {
    catalogRevision: catalog.catalogRevision,
    sources: structuredClone(catalog.sources),
    items,
    missingTargetIds,
  };
}
