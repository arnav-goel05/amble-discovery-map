import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { field, renderedDocument } from "./rendered-adapter-utils.mjs";
import { assessActivityInclusion } from "./activity-policy.mjs";
import {
  canonicalRenderedUrl,
  createTinyfishFetchClient,
} from "./tinyfish-fetch.mjs";

const OVERLAY_REF = "normalized/missing-venue-recovery.json";
const RECOVERY_POLICY_VERSION = "1.3";
const BLOCKED_CANDIDATE_HOSTS = [
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "tiktok.com",
  "youtube.com",
  "tripadvisor.",
  "carousell.",
  "eventbrite.",
  "peatix.",
  "allevents.",
  "yelp.",
  "google.",
  "bing.com",
  "yahoo.com",
];
const GENERIC_VENUES =
  /^(?:singapore|venue|location|event venue|to be announced|tba)$/i;

const sha = (value) => createHash("sha256").update(String(value)).digest("hex");
const clean = (value) =>
  typeof value === "string" && value.trim()
    ? value.replace(/\s+/g, " ").trim()
    : null;
const normalize = (value) =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLocaleLowerCase("en-SG")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");

export function validateMissingVenueRecoveryConfig(config) {
  if (!config || config.enabled !== true)
    throw new Error("Missing-venue recovery must be explicitly enabled");
  if (
    !Number.isInteger(config.maxCandidates) ||
    config.maxCandidates < 1 ||
    config.maxCandidates > 3
  )
    throw new Error(
      "Missing-venue recovery maxCandidates must be between 1 and 3",
    );
  if (
    config.search?.providerId !== "tinyfish-search" ||
    config.search?.endpoint !== "https://api.search.tinyfish.ai" ||
    config.search?.location !== "SG" ||
    config.search?.language !== "en" ||
    !Number.isInteger(config.search?.timeoutMs) ||
    config.search.timeoutMs < 100 ||
    config.search.timeoutMs > 20_000 ||
    !Number.isInteger(config.search?.maximumResponseBytes) ||
    config.search.maximumResponseBytes < 1 ||
    config.search.maximumResponseBytes > 524_288
  )
    throw new Error("Missing-venue TinyFish Search bounds are invalid");
  if (
    config.fetch?.providerId !== "tinyfish-fetch" ||
    config.fetch?.endpoint !== "https://api.fetch.tinyfish.ai" ||
    config.fetch?.format !== "markdown" ||
    config.fetch?.batchSize !== config.maxCandidates ||
    config.fetch?.maximumUrlsPerMinute < 1 ||
    config.fetch?.maximumUrlsPerMinute >= 150 ||
    config.fetch?.maxAttempts < 1 ||
    config.fetch?.maxAttempts > 3 ||
    config.fetch?.timeoutMs > 110_000 ||
    config.fetch?.maximumResponseBytes < 1
  )
    throw new Error("Missing-venue TinyFish Fetch bounds are invalid");
  return config;
}

function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, path);
}

function boundedError(error, fallback = "venue_search_failed") {
  return {
    reasonCode:
      typeof error?.code === "string" && error.code.length <= 80
        ? error.code
        : fallback,
    ...(Number.isInteger(error?.status) ? { httpStatus: error.status } : {}),
  };
}

function occurrenceKey(sourceName, recordRef, occurrenceIndex) {
  return sha(`${sourceName}\n${recordRef}\n${occurrenceIndex}`);
}

function occurrenceInputHash(sourceName, record, occurrence, occurrenceIndex) {
  return sha(
    JSON.stringify({
      recoveryPolicyVersion: RECOVERY_POLICY_VERSION,
      sourceName,
      sourceId: record.sourceId ?? record.sourceRecordId ?? null,
      occurrenceIndex,
      title: occurrence.title ?? record.title ?? null,
      organizer: occurrence.organizer ?? record.organizer ?? null,
      dateText: occurrence.dateText ?? record.dateText ?? null,
      startDateTime: occurrence.startDateTime ?? record.startDateTime ?? null,
      detailUrl: occurrence.detailUrl ?? record.detailUrl ?? null,
    }),
  );
}

function candidateUrl(value, authorityDomains = []) {
  try {
    const url = new URL(canonicalRenderedUrl(value));
    const hostname = url.hostname.toLowerCase();
    if (
      BLOCKED_CANDIDATE_HOSTS.some((blocked) => hostname.includes(blocked)) ||
      /(?:^|[.-])(?:directory|listings?|social)(?:[.-]|$)/i.test(hostname) ||
      url.pathname === "/"
    )
      return null;
    const sourceAuthoritative = authorityDomains.some(
      (domain) =>
        hostname === domain.toLowerCase() ||
        hostname.endsWith(`.${domain.toLowerCase()}`),
    );
    const singaporeLocal = hostname.endsWith(".sg");
    if (!sourceAuthoritative && !singaporeLocal) return null;
    return url.href;
  } catch {
    return null;
  }
}

function titleMatches(title, document) {
  const terms = normalize(title)
    .split(" ")
    .filter(
      (term) =>
        term.length > 2 && !["the", "and", "for", "with"].includes(term),
    );
  if (!terms.length) return false;
  const evidence = normalize(
    `${document.title ?? ""} ${document.text.slice(0, 12_000)}`,
  );
  const matches = terms.filter((term) => evidence.includes(term)).length;
  return matches / terms.length >= 0.8;
}

function explicitLocation(result, title, url) {
  const document = renderedDocument(result);
  if (!titleMatches(title, document)) return null;
  const venue = clean(
    field(document, ["Venue", "Location", "Meeting point", "Starting point"]),
  )?.replace(/^(?:[*_#]+\s*)|(?:\s*[*_#]+)$/g, "");
  const address = clean(
    field(document, ["Address", "Venue address", "Location address"]),
  );
  const usableVenue = venue && !GENERIC_VENUES.test(venue) ? venue : null;
  if (!usableVenue && !address) return null;
  const locationEvidence = `${usableVenue ?? ""}\n${address ?? ""}`;
  if (
    /\b(?:Kuala Lumpur|Malaysia|Johor|Yangon|Myanmar|Batam|Bintan|Indonesia|Bangkok|Thailand)\b/i.test(
      locationEvidence,
    )
  )
    return null;
  const parsedUrl = new URL(url);
  const localDomain = parsedUrl.hostname.endsWith(".sg");
  const scopeEvidence = `${document.title ?? ""}\n${document.text.slice(0, 12_000)}\n${locationEvidence}`;
  if (
    !localDomain &&
    !/\bSingapore\b/i.test(scopeEvidence) &&
    !/\b\d{6}\b/.test(locationEvidence)
  )
    return null;
  return { venue: usableVenue ?? address, address };
}

function resultForUrl(batch, url, { allowSoleFallback = false } = {}) {
  const canonical = canonicalRenderedUrl(url);
  return (
    (batch?.results ?? []).find((result) => {
      try {
        return (
          canonicalRenderedUrl(
            result.url ?? result.requested_url ?? result.requestedUrl,
          ) === canonical
        );
      } catch {
        return false;
      }
    }) ??
    (allowSoleFallback && (batch?.results ?? []).length === 1
      ? batch.results[0]
      : null)
  );
}

function errorForUrl(batch, url) {
  const canonical = canonicalRenderedUrl(url);
  return (
    (batch?.errors ?? []).find((error) => {
      try {
        return (
          canonicalRenderedUrl(error.url ?? error.requestedUrl) === canonical
        );
      } catch {
        return false;
      }
    }) ?? null
  );
}

function configuredPartnerDomains(record, occurrence, sourceDefinition) {
  let hostname;
  try {
    hostname = new URL(
      occurrence.detailUrl ?? record.detailUrl ?? record.outboundUrl,
    ).hostname.toLowerCase();
  } catch {
    return [];
  }
  const mapping = sourceDefinition?.venueRecovery?.partnerDomainsByHost;
  if (!mapping || typeof mapping !== "object") return [];
  return [
    ...new Set(
      Object.entries(mapping).flatMap(([host, domains]) => {
        const normalizedHost = String(host).toLowerCase();
        if (
          hostname !== normalizedHost &&
          !hostname.endsWith(`.${normalizedHost}`)
        )
          return [];
        return (Array.isArray(domains) ? domains : [])
          .map((domain) => String(domain).toLowerCase())
          .filter(
            (domain) =>
              /^[a-z0-9.-]+$/.test(domain) &&
              !domain.startsWith(".") &&
              !domain.endsWith("."),
          );
      }),
    ),
  ];
}

export function buildMissingVenueSearchQuery({
  record,
  occurrence,
  sourceDefinition = null,
}) {
  const title = clean(occurrence.title ?? record.title);
  const organizer = clean(occurrence.organizer ?? record.organizer);
  const date = clean(
    occurrence.dateText ??
      occurrence.startDateTime ??
      record.dateText ??
      record.startDateTime,
  );
  const partnerScope = configuredPartnerDomains(
    record,
    occurrence,
    sourceDefinition,
  ).map((domain) => `site:${domain}`);
  if (partnerScope.length)
    return [
      `"${String(title ?? "").replaceAll('"', "")}"`,
      organizer,
      ...partnerScope,
      "Singapore venue official event",
    ]
      .filter(Boolean)
      .join(" ")
      .slice(0, 900);
  return [
    `"${String(title ?? "").replaceAll('"', "")}"`,
    organizer,
    date,
    "Singapore venue address official event",
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 900);
}

export function createTinyfishSearchClient({
  apiKey = process.env.TINYFISH_API_KEY,
  endpoint = "https://api.search.tinyfish.ai",
  fetchImpl = globalThis.fetch,
  timeoutMs = 20_000,
  maximumResponseBytes = 512 * 1024,
} = {}) {
  if (!apiKey)
    throw Object.assign(new Error("TINYFISH_API_KEY is required"), {
      code: "retrieval_credential_missing",
    });
  const endpointUrl = new URL(endpoint);
  if (
    endpointUrl.protocol !== "https:" ||
    endpointUrl.hostname !== "api.search.tinyfish.ai"
  )
    throw Object.assign(new Error("TinyFish Search endpoint is not approved"), {
      code: "provider_policy_invalid",
    });
  return async function search({
    query,
    purpose,
    location = "SG",
    language = "en",
  }) {
    const url = new URL(endpointUrl);
    url.searchParams.set("query", query);
    url.searchParams.set("purpose", purpose);
    url.searchParams.set("location", location);
    url.searchParams.set("language", language);
    url.searchParams.set("domain_type", "web");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url.href, {
        headers: { Accept: "application/json", "X-API-Key": apiKey },
        signal: controller.signal,
      });
      if (!response.ok)
        throw Object.assign(
          new Error(`TinyFish Search HTTP ${response.status}`),
          {
            code:
              response.status === 429
                ? "persistent_rate_limit"
                : response.status >= 400 && response.status < 500
                  ? "provider_policy_invalid"
                  : "source_unavailable",
            status: response.status,
          },
        );
      const declared = Number(response.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > maximumResponseBytes)
        throw Object.assign(
          new Error("TinyFish Search response exceeded size limit"),
          {
            code: "response_too_large",
          },
        );
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength > maximumResponseBytes)
        throw Object.assign(
          new Error("TinyFish Search response exceeded size limit"),
          {
            code: "response_too_large",
          },
        );
      const payload = JSON.parse(buffer.toString("utf8"));
      return { results: Array.isArray(payload.results) ? payload.results : [] };
    } catch (error) {
      if (error?.name === "AbortError")
        throw Object.assign(new Error("TinyFish Search timed out"), {
          code: "source_unavailable",
        });
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  };
}

export async function recoverMissingVenueOccurrence({
  sourceName,
  recordRef,
  record,
  occurrence,
  occurrenceIndex,
  config,
  searchClient,
  renderedClient,
  sourceDefinition = null,
  logger = () => {},
  now = () => new Date().toISOString(),
}) {
  const title = clean(occurrence.title ?? record.title);
  const key = occurrenceKey(sourceName, recordRef, occurrenceIndex);
  const inputHash = occurrenceInputHash(
    sourceName,
    record,
    occurrence,
    occurrenceIndex,
  );
  const base = {
    key,
    inputHash,
    sourceName,
    recordRef,
    sourceId: record.sourceId ?? record.sourceRecordId ?? null,
    occurrenceIndex,
    searchedAt: now(),
  };
  if (!title || occurrence.mode === "online" || record.mode === "online")
    return {
      ...base,
      outcome: "skipped",
      reasonCode: !title ? "missing_title" : "online",
    };
  const query = buildMissingVenueSearchQuery({
    record,
    occurrence,
    sourceDefinition,
  });
  const queryHash = sha(query);
  logger({
    stage: "venue_search_recovery",
    action: "missing_venue_search_started",
    sourceName,
    entityId: key,
    queryHash,
  });
  let search;
  try {
    search = await searchClient({
      query,
      purpose:
        "Find an official event, organizer, host-building, or venue page that states the Singapore location for this exact activity.",
      location: config.search?.location ?? "SG",
      language: config.search?.language ?? "en",
    });
  } catch (error) {
    const failure = boundedError(error);
    logger({
      stage: "venue_search_recovery",
      action: "missing_venue_search_failed",
      sourceName,
      entityId: key,
      queryHash,
      reasonCode: failure.reasonCode,
      httpStatus: failure.httpStatus ?? null,
    });
    return { ...base, queryHash, outcome: "failed", ...failure };
  }
  const limit = Math.min(3, Math.max(1, Number(config.maxCandidates ?? 3)));
  const authorityDomains =
    sourceDefinition?.evidenceRole === "direct"
      ? (sourceDefinition.officialDomains ?? sourceDefinition.domains ?? [])
      : [];
  const candidateUrls = [
    ...new Set(
      (search.results ?? [])
        .map((item) => candidateUrl(item?.url, authorityDomains))
        .filter(Boolean),
    ),
  ].slice(0, limit);
  if (!candidateUrls.length) {
    logger({
      stage: "venue_search_recovery",
      action: "missing_venue_not_found",
      sourceName,
      entityId: key,
      queryHash,
      reasonCode: "no_authoritative_candidate",
    });
    return {
      ...base,
      queryHash,
      outcome: "not_found",
      reasonCode: "no_authoritative_candidate",
      inspectedUrls: [],
    };
  }
  let batch;
  try {
    batch = await renderedClient.fetchBatch(candidateUrls, {
      stage: "venue_search_candidate",
      sourceName,
      entityId: key,
    });
  } catch (error) {
    const failure = boundedError(error);
    logger({
      stage: "venue_search_recovery",
      action: "missing_venue_candidate_fetch_failed",
      sourceName,
      entityId: key,
      queryHash,
      reasonCode: failure.reasonCode,
      httpStatus: failure.httpStatus ?? null,
    });
    return {
      ...base,
      queryHash,
      outcome: "failed",
      inspectedUrls: candidateUrls,
      ...failure,
    };
  }
  const candidateErrors = candidateUrls
    .map((url) => ({ url, error: errorForUrl(batch, url) }))
    .filter(({ error }) => error);
  const verified = candidateUrls.flatMap((url) => {
    const result = resultForUrl(batch, url, {
      allowSoleFallback: candidateUrls.length === 1,
    });
    const location = result ? explicitLocation(result, title, url) : null;
    return location ? [{ url, ...location }] : [];
  });
  const groups = new Map();
  for (const candidate of verified) {
    const signature = normalize(
      `${candidate.venue ?? ""}|${candidate.address ?? ""}`,
    );
    const group = groups.get(signature) ?? { ...candidate, evidenceUrls: [] };
    group.evidenceUrls.push(candidate.url);
    groups.set(signature, group);
  }
  if (groups.size === 1) {
    const recovered = [...groups.values()][0];
    logger({
      stage: "venue_search_recovery",
      action: "missing_venue_recovered",
      sourceName,
      entityId: key,
      queryHash,
      evidenceRef: recovered.evidenceUrls[0],
      counts: { failedCandidates: candidateErrors.length },
    });
    return {
      ...base,
      queryHash,
      outcome: "recovered",
      venue: recovered.venue,
      address: recovered.address,
      evidenceUrls: recovered.evidenceUrls,
      inspectedUrls: candidateUrls,
    };
  }
  if (groups.size === 0 && candidateErrors.length) {
    const first = candidateErrors[0].error;
    const failure = boundedError(
      {
        code: first.code ?? first.error,
        status: first.status ?? first.httpStatus,
      },
      "candidate_fetch_failed",
    );
    logger({
      stage: "venue_search_recovery",
      action: "missing_venue_candidate_fetch_failed",
      sourceName,
      entityId: key,
      queryHash,
      reasonCode: failure.reasonCode,
      httpStatus: failure.httpStatus ?? null,
      counts: { failedCandidates: candidateErrors.length },
    });
    return {
      ...base,
      queryHash,
      outcome: "failed",
      inspectedUrls: candidateUrls,
      ...failure,
    };
  }
  const outcome = groups.size > 1 ? "ambiguous" : "not_found";
  const reasonCode =
    groups.size > 1
      ? "conflicting_authoritative_locations"
      : "no_verified_location";
  logger({
    stage: "venue_search_recovery",
    action:
      outcome === "ambiguous"
        ? "missing_venue_ambiguous"
        : "missing_venue_not_found",
    sourceName,
    entityId: key,
    queryHash,
    reasonCode,
    counts: { verifiedLocations: groups.size },
  });
  return {
    ...base,
    queryHash,
    outcome,
    reasonCode,
    inspectedUrls: candidateUrls,
    evidenceUrls: verified.map(({ url }) => url),
  };
}

function overlayCounts(
  records,
  { candidates = records.length, attempted = records.length, reused = 0 } = {},
) {
  return {
    candidates,
    attempted,
    recovered: records.filter(({ outcome }) => outcome === "recovered").length,
    ambiguous: records.filter(({ outcome }) => outcome === "ambiguous").length,
    notFound: records.filter(({ outcome }) => outcome === "not_found").length,
    skipped: records.filter(({ outcome }) => outcome === "skipped").length,
    failed: records.filter(({ outcome }) => outcome === "failed").length,
    reused,
  };
}

export async function recoverMissingEventVenues({
  runDir,
  state,
  run,
  config,
  sourceDefinitions = [],
  searchClient = null,
  renderedClient = null,
  logger = () => {},
  now = () => new Date().toISOString(),
  force = false,
}) {
  const path = join(runDir, OVERLAY_REF);
  const previous = existsSync(path)
    ? JSON.parse(readFileSync(path, "utf8"))
    : { schemaVersion: "1.0", runId: run.runId, records: [] };
  const previousByKey = new Map(
    (previous.records ?? []).map((item) => [item.key, item]),
  );
  const previousExcludedPath = join(runDir, "normalized/excluded.json");
  const priorMissingOccurrences = existsSync(previousExcludedPath)
    ? new Set(
        (JSON.parse(readFileSync(previousExcludedPath, "utf8")).records ?? [])
          .filter(({ reasonCode }) => reasonCode === "missing_venue")
          .map(
            ({ sourceRecordRef, occurrenceIndex }) =>
              `${sourceRecordRef}\u0000${occurrenceIndex}`,
          ),
      )
    : null;
  let actualSearch = searchClient;
  let actualRendered = renderedClient;
  const candidates = [];
  for (const [sourceName, sourceState] of Object.entries(state.sources ?? {})) {
    if (!sourceState.processedSourceRecordRefs?.length) continue;
    for (const recordRef of sourceState.processedSourceRecordRefs) {
      const [artifact, pointer = ""] = recordRef.split("#");
      if (!existsSync(join(runDir, artifact))) continue;
      const document = JSON.parse(readFileSync(join(runDir, artifact), "utf8"));
      const index = Number(pointer.match(/^\/records\/(\d+)$/)?.[1]);
      const record = document.records?.[index];
      if (!record) continue;
      const occurrences = record.performances?.length
        ? record.performances
        : [record];
      occurrences.forEach((occurrence, occurrenceIndex) => {
        const venue = clean(occurrence.venue ?? record.venue);
        const address = clean(occurrence.address ?? record.address);
        const policy = assessActivityInclusion(
          { ...record, ...occurrence },
          { asOf: run.window.start },
        );
        const exactPriorMissing = priorMissingOccurrences?.has(
          `${recordRef}\u0000${occurrenceIndex}`,
        );
        if (
          !venue &&
          !address &&
          occurrence.mode !== "online" &&
          record.mode !== "online" &&
          (priorMissingOccurrences
            ? exactPriorMissing
            : !record.reasonCode && policy.eligible)
        )
          candidates.push({
            sourceName,
            recordRef,
            record,
            occurrence,
            occurrenceIndex,
          });
      });
    }
  }
  const records = [];
  let attempted = 0;
  let reused = 0;
  for (const candidate of candidates) {
    const key = occurrenceKey(
      candidate.sourceName,
      candidate.recordRef,
      candidate.occurrenceIndex,
    );
    const inputHash = occurrenceInputHash(
      candidate.sourceName,
      candidate.record,
      candidate.occurrence,
      candidate.occurrenceIndex,
    );
    const saved = previousByKey.get(key);
    if (
      !force &&
      saved?.inputHash === inputHash &&
      saved.outcome !== "failed"
    ) {
      records.push(saved);
      reused += 1;
      logger({
        stage: "venue_search_recovery",
        action: "missing_venue_recovery_reused",
        sourceName: candidate.sourceName,
        entityId: key,
        outcome: saved.outcome,
      });
      continue;
    }
    try {
      actualSearch ??= createTinyfishSearchClient({
        apiKey: process.env.TINYFISH_API_KEY,
        ...(config.search ?? {}),
      });
      actualRendered ??= createTinyfishFetchClient({
        apiKey: process.env.TINYFISH_API_KEY,
        ...(config.fetch ?? {}),
        format: config.fetch?.format ?? "markdown",
        logger,
      });
      records.push(
        await recoverMissingVenueOccurrence({
          ...candidate,
          config,
          searchClient: actualSearch,
          renderedClient: actualRendered,
          logger,
          now,
          sourceDefinition: sourceDefinitions.find(
            ({ name }) => name === candidate.sourceName,
          ),
        }),
      );
    } catch (error) {
      records.push({
        key,
        inputHash,
        sourceName: candidate.sourceName,
        recordRef: candidate.recordRef,
        sourceId: candidate.record.sourceId ?? null,
        occurrenceIndex: candidate.occurrenceIndex,
        searchedAt: now(),
        outcome: "failed",
        ...boundedError(error),
      });
    }
    attempted += 1;
  }
  const perSource = Object.fromEntries(
    [...new Set(candidates.map(({ sourceName }) => sourceName))]
      .sort()
      .map((sourceName) => {
        const sourceRecords = records.filter(
          (item) => item.sourceName === sourceName,
        );
        const sourceCandidates = candidates.filter(
          (item) => item.sourceName === sourceName,
        ).length;
        const sourceReused = sourceRecords.filter((item) => {
          const saved = previousByKey.get(item.key);
          return (
            !force &&
            saved?.inputHash === item.inputHash &&
            saved.outcome !== "failed"
          );
        }).length;
        return [
          sourceName,
          overlayCounts(sourceRecords, {
            candidates: sourceCandidates,
            attempted: sourceCandidates - sourceReused,
            reused: sourceReused,
          }),
        ];
      }),
  );
  const overlay = {
    schemaVersion: "1.0",
    recoveryPolicyVersion: RECOVERY_POLICY_VERSION,
    runId: run.runId,
    generatedAt: now(),
    configHash: sha(JSON.stringify(config)),
    counts: overlayCounts(records, {
      candidates: candidates.length,
      attempted,
      reused,
    }),
    perSource,
    records,
  };
  atomicJson(path, overlay);
  return { ...overlay, artifactRef: OVERLAY_REF };
}

export const missingVenueRecoveryArtifactRef = OVERLAY_REF;
