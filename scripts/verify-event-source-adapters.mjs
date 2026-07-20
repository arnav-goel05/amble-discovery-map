#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEventAuthorityRegistry } from "./lib/provider-policy.mjs";
import { validateSourcePolicy } from "./event-source-collector.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = path.join(ROOT, "data/event-pipeline-config.json");
const AUTHORITY_PATH = path.join(ROOT, "data/event-authority-registry.json");
const ROLES = new Set(["direct", "editorial", "unavailable"]);
const STATES = new Set(["enabled", "disabled"]);

export function migrateSourceDefinition(source) {
  const evidenceRole =
    source.evidenceRole ??
    (source.operatingMode === "disabled"
      ? "unavailable"
      : source.sourceRole === "discovery"
        ? "editorial"
        : "direct");
  const operatingState =
    source.operatingState ??
    (source.enabled === false || source.operatingMode === "disabled"
      ? "disabled"
      : "enabled");
  const editorialPolicy =
    evidenceRole === "editorial"
      ? (source.editorialPolicy ?? {
          version: "2.0",
          corroborateFirst: true,
          allowSufficientEditorialOnly: true,
          ...(source.confirmation?.outboundLabels
            ? { outboundLabels: source.confirmation.outboundLabels }
            : {}),
        })
      : null;
  return {
    ...source,
    evidenceRole,
    operatingState,
    editorialPolicy,
    enabled: operatingState === "enabled",
    // Runtime compatibility aliases are derived, never authoritative config.
    sourceRole: evidenceRole === "editorial" ? "discovery" : "authoritative",
    operatingMode: operatingState === "disabled" ? "disabled" : "required",
    confirmation: editorialPolicy
      ? {
          policyVersion: editorialPolicy.version,
          outboundLabels: editorialPolicy.outboundLabels ?? [],
        }
      : source.confirmation,
  };
}

export function validateEventSourceDefinitions(
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")),
) {
  if (
    !["1.0", "2.0"].includes(config.schemaVersion) ||
    config.timezone !== "Asia/Singapore" ||
    !Array.isArray(config.sources)
  )
    throw new Error("Unsupported event source configuration");
  const ids = new Set(),
    names = new Set(),
    orders = new Set(),
    precedences = new Set();
  const sources = config.sources
    .map(migrateSourceDefinition)
    .toSorted((a, b) => a.collectionOrder - b.collectionOrder);
  for (const source of sources) {
    if (
      !source.name ||
      names.has(source.name) ||
      !source.adapterId ||
      ids.has(source.adapterId)
    )
      throw new Error("Source names and adapter IDs must be unique");
    if (!ROLES.has(source.evidenceRole) || !STATES.has(source.operatingState))
      throw new Error(
        `${source.name} has invalid evidence role or operating state`,
      );
    if (source.enabled !== (source.operatingState === "enabled"))
      throw new Error(
        `${source.name} enabled flag conflicts with operating state`,
      );
    if (
      source.evidenceRole === "unavailable" &&
      (source.operatingState !== "disabled" || !source.unavailableReason)
    )
      throw new Error(
        `${source.name} unavailable source must be disabled with a reason`,
      );
    if (
      source.operatingState === "disabled" &&
      source.evidenceRole !== "unavailable"
    )
      throw new Error(
        `${source.name} disabled source must use the unavailable role`,
      );
    if (
      !Number.isInteger(source.collectionOrder) ||
      orders.has(source.collectionOrder)
    )
      throw new Error(`${source.name} requires unique collection order`);
    if (
      source.evidenceRole === "direct" ||
      source.evidenceRole === "unavailable"
    ) {
      if (
        !Number.isInteger(source.precedence) ||
        precedences.has(source.precedence)
      )
        throw new Error(`${source.name} requires unique anchor precedence`);
      precedences.add(source.precedence);
    } else {
      if (
        source.precedence !== null ||
        source.editorialPolicy?.version !== "2.0" ||
        source.editorialPolicy.corroborateFirst !== true ||
        source.editorialPolicy.allowSufficientEditorialOnly !== true
      ) {
        throw new Error(
          `${source.name} editorial source cannot supply anchor precedence and requires policy v2`,
        );
      }
    }
    if (source.retrieval) {
      const bounds = source.retrieval;
      if (
        bounds.providerId !== "tinyfish-fetch" ||
        bounds.batchSize < 1 ||
        bounds.batchSize > 10 ||
        bounds.maximumUrlsPerMinute >= 150 ||
        bounds.maxAttempts < 1 ||
        bounds.maxAttempts > 5 ||
        bounds.timeoutMs > 110_000 ||
        bounds.maximumResponseBytes < 1
      )
        throw new Error(`${source.name} has invalid rendered retrieval bounds`);
      if (
        !["html", "json", "markdown"].includes(bounds.format ?? "markdown") ||
        (bounds.ttl !== undefined &&
          (!Number.isInteger(bounds.ttl) || bounds.ttl < 0))
      )
        throw new Error(
          `${source.name} has invalid rendered retrieval format or freshness`,
        );
      for (const selectors of [
        bounds.includeSelectors ?? [],
        bounds.excludeSelectors ?? [],
      ]) {
        if (
          !Array.isArray(selectors) ||
          selectors.length > 20 ||
          selectors.some(
            (selector) =>
              typeof selector !== "string" ||
              selector.length < 1 ||
              selector.length > 1000,
          )
        )
          throw new Error(`${source.name} has invalid rendered selector scope`);
      }
      const listingBounds = source.listing?.retrieval;
      if (listingBounds) {
        if (
          !["html", "json", "markdown"].includes(
            listingBounds.format ?? bounds.format ?? "markdown",
          ) ||
          (listingBounds.ttl !== undefined &&
            (!Number.isInteger(listingBounds.ttl) || listingBounds.ttl < 0))
        )
          throw new Error(
            `${source.name} has invalid listing retrieval format or freshness`,
          );
        for (const selectors of [
          listingBounds.includeSelectors ?? [],
          listingBounds.excludeSelectors ?? [],
        ]) {
          if (
            !Array.isArray(selectors) ||
            selectors.length > 20 ||
            selectors.some(
              (selector) =>
                typeof selector !== "string" ||
                selector.length < 1 ||
                selector.length > 1000,
            )
          )
            throw new Error(
              `${source.name} has invalid listing selector scope`,
            );
        }
      }
    }
    if (source.listing?.urls !== undefined) {
      if (!Array.isArray(source.listing.urls) || source.listing.urls.length > source.listing.paginationCeiling - 1) throw new Error(`${source.name} has invalid bounded listing surfaces`);
      const canonical = source.listing.urls.map((url) => new URL(url).href);
      if (new Set(canonical).size !== canonical.length || canonical.includes(new URL(source.listing.url).href)) throw new Error(`${source.name} has duplicate listing surfaces`);
    }
    validateSourcePolicy(source);
    names.add(source.name);
    ids.add(source.adapterId);
    orders.add(source.collectionOrder);
  }
  loadEventAuthorityRegistry(AUTHORITY_PATH);
  return {
    schemaVersion: "2.0",
    timezone: config.timezone,
    sources: sources.map(
      ({
        name,
        adapterId,
        evidenceRole,
        operatingState,
        collectionOrder,
        precedence,
      }) => ({
        name,
        adapterId,
        evidenceRole,
        operatingState,
        collectionOrder,
        precedence,
      }),
    ),
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const report = validateEventSourceDefinitions();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
