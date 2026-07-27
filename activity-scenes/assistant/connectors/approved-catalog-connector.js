import { getCatalogItems } from "../queries/catalog-get.js";
import {
  projectCatalogItem,
  searchCatalog,
} from "../queries/catalog-search.js";

export class ApprovedCatalogConnectorError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ApprovedCatalogConnectorError";
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new ApprovedCatalogConnectorError(code, message);
};
const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

function fnv1a64(value) {
  const bytes = new TextEncoder().encode(value);
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}

function validateProvider(provider) {
  if (
    !provider ||
    typeof provider.connectorId !== "string" ||
    !provider.connectorId ||
    provider.connectorId.length > 64 ||
    typeof provider.snapshot !== "function" ||
    (provider.subscribe !== undefined &&
      typeof provider.subscribe !== "function")
  )
    fail(
      "catalog_provider_invalid",
      "Catalogue provider requires connectorId and snapshot",
    );
  return provider;
}

function normalizeProviderSnapshot(provider, snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot))
    fail(
      "catalog_provider_snapshot_invalid",
      `Catalogue provider ${provider.connectorId} returned invalid state`,
    );
  const revision = String(
    snapshot.revision ?? snapshot.sourceSnapshotId ?? "",
  ).slice(0, 256);
  const rawItems = snapshot.items ?? snapshot.candidates;
  if (!revision || !Array.isArray(rawItems))
    fail(
      "catalog_provider_snapshot_invalid",
      `Catalogue provider ${provider.connectorId} requires revision and items`,
    );
  return {
    source: { connectorId: provider.connectorId, revision },
    items: rawItems
      .map((item) => projectCatalogItem(item))
      .filter(Boolean)
      .sort((left, right) => compare(left.targetId, right.targetId)),
  };
}

export function createApprovedCatalogConnector({ providers = [] } = {}) {
  const initialProviders = [...providers].map(validateProvider);
  if (
    new Set(initialProviders.map(({ connectorId }) => connectorId)).size !==
    initialProviders.length
  )
    fail(
      "catalog_provider_duplicate",
      "Initial catalogue provider IDs must be unique",
    );
  const registered = new Map();
  const listeners = new Set();
  let destroyed = false;
  let lifecycleRevision = 0;

  const ensureActive = () => {
    if (destroyed)
      fail(
        "catalog_connector_destroyed",
        "Approved-catalog connector has been destroyed",
      );
  };
  const emit = (reason, providerId) => {
    lifecycleRevision += 1;
    const change = Object.freeze({
      connectorId: "approved-catalog",
      lifecycleRevision,
      reason,
      providerId,
    });
    for (const listener of listeners) listener(change);
  };

  const registerProvider = (providerValue, { silent = false } = {}) => {
    ensureActive();
    const provider = validateProvider(providerValue);
    if (registered.has(provider.connectorId))
      fail(
        "catalog_provider_duplicate",
        `Catalogue provider ${provider.connectorId} is already registered`,
      );
    const unsubscribe =
      provider.subscribe?.(() =>
        emit("provider_changed", provider.connectorId),
      ) || (() => {});
    if (typeof unsubscribe !== "function")
      fail(
        "catalog_provider_subscription_invalid",
        `Catalogue provider ${provider.connectorId} returned invalid cleanup`,
      );
    registered.set(provider.connectorId, { provider, unsubscribe });
    if (!silent) emit("provider_registered", provider.connectorId);
    let active = true;
    return () => {
      if (!active || destroyed) return false;
      active = false;
      const entry = registered.get(provider.connectorId);
      if (entry?.provider !== provider) return false;
      registered.delete(provider.connectorId);
      entry.unsubscribe();
      emit("provider_unregistered", provider.connectorId);
      return true;
    };
  };

  for (const provider of initialProviders)
    registerProvider(provider, { silent: true });

  const snapshot = async () => {
    ensureActive();
    if (!registered.size)
      fail(
        "catalog_unavailable",
        "Approved catalogue has no registered providers",
      );
    const providerStates = [];
    for (const [connectorId, entry] of [...registered.entries()].sort(
      ([left], [right]) => compare(left, right),
    )) {
      const state = await entry.provider.snapshot();
      providerStates.push(
        normalizeProviderSnapshot({ ...entry.provider, connectorId }, state),
      );
    }
    const sources = providerStates.map(({ source }) => source);
    const identities = new Set();
    const items = [];
    for (const state of providerStates) {
      for (const item of state.items) {
        if (identities.has(item.targetId))
          fail(
            "catalog_target_duplicate",
            `Catalogue target ${item.targetId} is registered more than once`,
          );
        identities.add(item.targetId);
        items.push(item);
      }
    }
    items.sort((left, right) => compare(left.targetId, right.targetId));
    return Object.freeze({
      catalogRevision: fnv1a64(JSON.stringify(sources)),
      sources: Object.freeze(
        sources.map((source) => Object.freeze({ ...source })),
      ),
      items: Object.freeze(
        items.map((item) =>
          Object.freeze({
            ...item,
            attributes: Object.freeze({ ...item.attributes }),
          }),
        ),
      ),
    });
  };

  return Object.freeze({
    connectorId: "approved-catalog",
    capabilityIds: Object.freeze(["catalog.get", "catalog.search"]),
    availability: () =>
      destroyed ? "disabled" : registered.size ? "available" : "empty",
    registerProvider,
    snapshot,
    subscribe(listener) {
      ensureActive();
      if (typeof listener !== "function")
        fail(
          "catalog_subscriber_invalid",
          "Catalogue subscriber must be a function",
        );
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async query(capabilityId, argumentsValue = {}) {
      if (!["catalog.search", "catalog.get"].includes(capabilityId))
        fail(
          "capability_unsupported",
          `Approved-catalog connector does not support ${capabilityId}`,
        );
      const catalog = await snapshot();
      return capabilityId === "catalog.search"
        ? searchCatalog(catalog, argumentsValue)
        : getCatalogItems(catalog, argumentsValue);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const { unsubscribe } of registered.values()) unsubscribe();
      registered.clear();
      listeners.clear();
    },
  });
}
