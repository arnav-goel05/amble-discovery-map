import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertProviderAllowed,
  loadProviderPolicy,
} from "./lib/provider-policy.mjs";
import {
  createTinyfishFetchClient,
  canonicalRenderedUrl,
} from "./lib/event-sources/tinyfish-fetch.mjs";
import { renderedAdapterFor } from "./lib/event-sources/index.mjs";
import { createAuthorityCaptureIndex } from "./lib/event-sources/authority-capture.mjs";
import { confirmDiscoveryRecord } from "./lib/event-sources/authority-confirmation.mjs";
import { parseAuthorityDetail } from "./lib/event-sources/rendered-adapter-utils.mjs";
import {
  assertAuthorityUrlAllowed,
  loadEventAuthorityRegistry,
} from "./lib/provider-policy.mjs";
import {
  assessActivityInclusion,
  normalizeSchedule,
} from "./lib/event-sources/activity-policy.mjs";

const sha = (value) => createHash("sha256").update(value).digest("hex");

function atomicWrite(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, value);
  renameSync(temporary, path);
}

const writeJson = (path, value) =>
  atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`);
const pointer = (value, path) =>
  path === ""
    ? value
    : path
        .slice(1)
        .split("/")
        .reduce(
          (current, token) =>
            current?.[token.replaceAll("~1", "/").replaceAll("~0", "~")],
          value,
        );
const first = (value, paths) =>
  paths
    .map((path) => pointer(value, path))
    .find((item) => item !== undefined && item !== null && item !== "");
const text = (value) =>
  typeof value === "string" && value.trim() ? value.trim() : null;
const asArray = (value) => (Array.isArray(value) ? value : []);
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const DEFAULT_PROVIDER_POLICY = fileURLToPath(
  new URL("../data/provider-policy.json", import.meta.url),
);
const DEFAULT_AUTHORITY_REGISTRY = fileURLToPath(
  new URL("../data/event-authority-registry.json", import.meta.url),
);

export async function requestWithRetry(
  transport,
  request,
  {
    maxAttempts = 3,
    timeoutMs = 15_000,
    initialBackoffMs = 500,
    maximumBackoffMs = 4_000,
    sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
  } = {},
) {
  let lastError = null;
  let response = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      let timeout;
      response = await Promise.race([
        Promise.resolve().then(() => transport(request)),
        new Promise((_, reject) => {
          timeout = setTimeout(
            () =>
              reject(
                Object.assign(new Error("request timed out"), {
                  code: "request_timeout",
                }),
              ),
            timeoutMs,
          );
        }),
      ]).finally(() => clearTimeout(timeout));
      if (
        response?.ok ||
        !RETRYABLE_STATUSES.has(response?.status) ||
        attempt === maxAttempts
      )
        return { response, attempts: attempt };
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts)
        throw Object.assign(
          new Error(
            `Request failed after ${attempt} attempts: ${error.message}`,
          ),
          { code: error.code ?? "request_failed", attempts: attempt },
        );
    }
    await sleep(
      Math.min(maximumBackoffMs, initialBackoffMs * 2 ** (attempt - 1)),
    );
  }
  if (response) return { response, attempts: maxAttempts };
  throw lastError ?? new Error("Request failed");
}

export function validateOfficialReference(source, requestedUrl, response) {
  if (!response?.ok)
    throw new Error(
      `Official event reference returned status ${response?.status ?? "unknown"}`,
    );
  const domains = source?.officialDomains ?? [];
  const requested = new URL(requestedUrl);
  const destination = new URL(response.url || requestedUrl);
  const approved = (hostname) =>
    domains.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
    );
  if (!approved(requested.hostname.toLowerCase()))
    throw new Error(
      `Official event reference uses unapproved domain ${requested.hostname}`,
    );
  if (!approved(destination.hostname.toLowerCase()))
    throw new Error(
      `Official event reference redirect uses unapproved domain ${destination.hostname}`,
    );
  return {
    requestedUrl: requested.href,
    finalUrl: destination.href,
    status: response.status,
  };
}

export function validateAuthoritativeListingOutboundReference(
  requestedUrl,
  response,
) {
  if (!response?.ok)
    throw new Error(
      `Authoritative listing outbound reference returned status ${response?.status ?? "unknown"}`,
    );
  const requested = new URL(canonicalRenderedUrl(requestedUrl));
  const destination = new URL(
    canonicalRenderedUrl(response.url || requestedUrl),
  );
  const requestedHost = requested.hostname.toLowerCase(),
    destinationHost = destination.hostname.toLowerCase();
  const sameDomainFamily =
    requestedHost === destinationHost ||
    requestedHost.endsWith(`.${destinationHost}`) ||
    destinationHost.endsWith(`.${requestedHost}`);
  if (!sameDomainFamily)
    throw new Error(
      `Authoritative listing outbound redirect changed domain from ${requestedHost} to ${destinationHost}`,
    );
  return {
    requestedUrl: requested.href,
    finalUrl: destination.href,
    status: response.status,
  };
}

export function validateSourcePolicy(
  source,
  policy = loadProviderPolicy(DEFAULT_PROVIDER_POLICY),
) {
  if (
    !source?.providerId ||
    !source?.owner ||
    !source?.adapterId ||
    !source?.version
  ) {
    throw new Error(
      `${source?.name ?? "Source"} has incomplete provider or adapter identity`,
    );
  }
  const provider = assertProviderAllowed(policy, source.providerId);
  if (
    source.costClass !== provider.costClass ||
    source.owner !== provider.owner
  ) {
    throw new Error(
      `${source.name} provider ownership or cost classification does not match approved policy`,
    );
  }
  if (
    !Array.isArray(source.officialDomains) ||
    !source.officialDomains.length
  ) {
    throw new Error(`${source.name} has no approved official domains`);
  }
  for (const domain of source.officialDomains) {
    assertProviderAllowed(policy, source.providerId, {
      url: `https://${domain}/`,
    });
  }
  for (const url of [
    source.listing?.url,
    ...asArray(source.listing?.urls),
    source.detail?.url,
  ]) {
    assertProviderAllowed(policy, source.providerId, { url });
  }
  if (source.retrieval) {
    const retrieval = assertProviderAllowed(
      policy,
      source.retrieval.providerId,
      { url: "https://api.fetch.tinyfish.ai" },
    );
    if (retrieval.costClass !== "free")
      throw new Error(`${source.name} retrieval provider must remain free`);
  }
  return provider;
}

export function sourceRecordProvenance({
  run,
  source,
  retrievedAt,
  listingRef,
  responseRef,
  officialReferenceRef = null,
  officialReference = null,
  detailUrl,
}) {
  return {
    adapterId: source.adapterId,
    adapterVersion: source.version,
    adapterDefinitionHash: sha(
      JSON.stringify({
        adapterId: source.adapterId,
        version: source.version,
        listing: source.listing,
        detail: source.detail,
      }),
    ),
    providerId: source.providerId,
    providerOwner: source.owner,
    providerCostClass: source.costClass,
    sourceRole: source.sourceRole ?? "authoritative",
    operatingMode:
      source.operatingMode ??
      (source.enabled === false ? "disabled" : "required"),
    retrievalProviderId: source.retrieval?.providerId ?? source.providerId,
    sourceName: source.name,
    sourceUrl: detailUrl,
    retrievedAt,
    requestedWindow: { ...run.window, timezone: "Asia/Singapore" },
    provenance: {
      method: "GET",
      parentListingRef: listingRef,
      responseRef,
      officialReferenceRef,
      officialReference,
    },
  };
}

export function canonicalDetailUrl(value, base) {
  const url = new URL(value, base);
  url.hash = "";
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  if (
    (url.protocol === "https:" && url.port === "443") ||
    (url.protocol === "http:" && url.port === "80")
  )
    url.port = "";
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  const retained = [...url.searchParams].filter(
    ([key]) => !/^utm_/i.test(key) && !/^(?:gclid|fbclid)$/i.test(key),
  );
  retained.sort(([ak, av], [bk, bv]) =>
    ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0,
  );
  url.search = "";
  for (const [key, item] of retained) url.searchParams.append(key, item);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error(`Unsupported detail URL protocol: ${url.protocol}`);
  return url.href;
}

function modeFrom(value, venue) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized.includes("hybrid")) return "hybrid";
  if (normalized === "online" || normalized.includes("online only"))
    return "online";
  if (normalized.includes("physical") || normalized.includes("onsite") || venue)
    return "physical";
  return "unknown";
}

function performancesFrom(detail, fallback = {}) {
  const candidates = first(detail, [
    "/performances",
    "/schedules",
    "/event_dates",
    "/EventDates",
    "/PerformanceDates",
  ]);
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  return candidates.map((item) => ({
    startDateTime: text(
      first(item, [
        "/startDateTime",
        "/start_datetime",
        "/start_date",
        "/StartDateTime",
        "/StartDate",
      ]),
    ),
    endDateTime: text(
      first(item, [
        "/endDateTime",
        "/end_datetime",
        "/end_date",
        "/EndDateTime",
        "/EndDate",
      ]),
    ),
    dateText:
      text(
        first(item, ["/dateText", "/date", "/event_date", "/DisplayDate"]),
      ) ??
      fallback.dateText ??
      null,
    timeText:
      text(
        first(item, ["/timeText", "/time", "/event_time", "/DisplayTime"]),
      ) ??
      fallback.timeText ??
      null,
  }));
}

const MONTHS = new Map(
  [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
  ].map((month, index) => [month, index + 1]),
);
const WEEKDAYS = new Map([
  ["sun", 0],
  ["sunday", 0],
  ["mon", 1],
  ["monday", 1],
  ["tue", 2],
  ["tues", 2],
  ["tuesday", 2],
  ["wed", 3],
  ["wednesday", 3],
  ["thu", 4],
  ["thur", 4],
  ["thurs", 4],
  ["thursday", 4],
  ["fri", 5],
  ["friday", 5],
  ["sat", 6],
  ["saturday", 6],
]);

function catchDate(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const iso = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const named = value.trim().match(/^(\d{1,2})[\s/]([A-Za-z]{3})[\s/](\d{4})/);
  if (!named) return null;
  const month = MONTHS.get(named[2].toLowerCase());
  return month
    ? `${named[3]}-${String(month).padStart(2, "0")}-${String(Number(named[1])).padStart(2, "0")}`
    : null;
}

function catchTime(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const iso = value.trim().match(/T(\d{2}):(\d{2})/);
  if (iso) return `${iso[1]}:${iso[2]}`;
  const match = value.trim().match(/(\d{1,2}):(\d{2})(?:\s*([ap]m))?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  if (match[3]) {
    if (hour === 12) hour = 0;
    if (match[3].toLowerCase() === "pm") hour += 12;
  }
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

function catchDateTime(dateValue, timeValue) {
  const date = catchDate(dateValue);
  const time = catchTime(timeValue) ?? "00:00";
  return date ? `${date}T${time}:00+08:00` : null;
}

function catchCalendarDate(value) {
  return new Date(`${value}T00:00:00Z`);
}

function catchDateString(value) {
  return value.toISOString().slice(0, 10);
}

function catchScheduleDates(rangeStart, rangeEnd, dayValues, window) {
  const normalizedDays = asArray(dayValues)
    .map((value) => String(value).trim().toLowerCase())
    .filter(Boolean);
  if (!normalizedDays.length) return [];
  const daily = normalizedDays.some(
    (value) => value === "daily" || value === "every day",
  );
  const weekdays = new Set(
    normalizedDays
      .map((value) => WEEKDAYS.get(value))
      .filter((value) => value !== undefined),
  );
  if (!daily && !weekdays.size) return [];
  const windowStart = catchDate(window?.start) ?? rangeStart;
  const windowEnd = catchDate(window?.end) ?? rangeEnd;
  const start = catchCalendarDate(
    rangeStart > windowStart ? rangeStart : windowStart,
  );
  const end = catchCalendarDate(rangeEnd < windowEnd ? rangeEnd : windowEnd);
  const dates = [];
  for (
    const date = start;
    date <= end;
    date.setUTCDate(date.getUTCDate() + 1)
  ) {
    if (daily || weekdays.has(date.getUTCDay()))
      dates.push(catchDateString(date));
    if (dates.length >= 1000) break;
  }
  return dates;
}

function catchOccurrence(date, startClock, endClock, fullDay = false) {
  if (fullDay)
    return {
      startDateTime: null,
      endDateTime: null,
      dateText: date,
      timeText: "Full day",
    };
  return {
    startDateTime: catchDateTime(date, startClock),
    endDateTime: catchDateTime(date, endClock ?? startClock),
    dateText: date,
    timeText: [startClock, endClock].filter(Boolean).join(" - ") || null,
  };
}

function catchPerformances(detail, window) {
  const rangeStart = catchDate(detail.EventStartDate);
  const rangeEnd = catchDate(detail.EventEndDate) ?? rangeStart;
  const schedules = asArray(detail.LstDateTime);
  const performances = schedules.flatMap((item) => {
    const explicitStartDate =
      catchDate(item.StartTime) ?? catchDate(item.SetDate);
    const explicitEndDate = catchDate(item.EndTime) ?? explicitStartDate;
    if (explicitStartDate) {
      const startClock = catchTime(item.StartTime) ?? catchTime(item.StartHour);
      const endClock = catchTime(item.EndTime) ?? catchTime(item.EndHour);
      if (item.IsFullDayEvent && explicitStartDate === explicitEndDate)
        return [catchOccurrence(explicitStartDate, null, null, true)];
      return [
        {
          startDateTime: catchDateTime(explicitStartDate, startClock),
          endDateTime: catchDateTime(explicitEndDate, endClock ?? startClock),
          dateText:
            explicitStartDate === explicitEndDate
              ? explicitStartDate
              : `${explicitStartDate} to ${explicitEndDate}`,
          timeText: [startClock, endClock].filter(Boolean).join(" - ") || null,
        },
      ];
    }
    if (!rangeStart) return [];
    const startClock = catchTime(item.StartHour);
    const endClock = catchTime(item.EndHour);
    const recurringDates = catchScheduleDates(
      rangeStart,
      rangeEnd,
      item.SetDayArr,
      window,
    );
    if (recurringDates.length)
      return recurringDates.map((date) =>
        catchOccurrence(date, startClock, endClock, item.IsFullDayEvent),
      );
    return [
      {
        startDateTime: catchDateTime(rangeStart, startClock),
        endDateTime: catchDateTime(rangeEnd, endClock ?? startClock),
        dateText:
          rangeStart === rangeEnd ? rangeStart : `${rangeStart} to ${rangeEnd}`,
        timeText:
          [startClock, endClock].filter(Boolean).join(" - ") ||
          (item.IsFullDayEvent ? "Full day" : null),
      },
    ];
  });
  if (performances.length) {
    const datesWithTimedOccurrences = new Set(
      performances
        .filter((performance) => performance.startDateTime)
        .map((performance) => performance.dateText),
    );
    return performances.filter(
      (performance) =>
        performance.timeText !== "Full day" ||
        !datesWithTimedOccurrences.has(performance.dateText),
    );
  }
  if (!rangeStart) return [];
  const startClock = catchTime(detail.EventStartDate);
  const endClock = catchTime(detail.EventEndDate);
  return [
    {
      startDateTime: catchDateTime(rangeStart, startClock),
      endDateTime: catchDateTime(rangeEnd, endClock ?? startClock),
      dateText:
        rangeStart === rangeEnd ? rangeStart : `${rangeStart} to ${rangeEnd}`,
      timeText: [startClock, endClock].filter(Boolean).join(" - ") || null,
    },
  ];
}

function detailUrlForListing(source, listing) {
  if (source.adapterId === "sistic-official-listing-v1") {
    const alias = text(listing.alias);
    if (!alias) return { invalid: "missing_detail_url" };
    return {
      publicUrl: canonicalDetailUrl(
        `/event-details/${alias}`,
        "https://www.sistic.com.sg",
      ),
    };
  }
  const rawPath = text(listing.Url) ?? text(listing.URL) ?? text(listing.Link);
  if (!rawPath) return { invalid: "missing_detail_url" };
  return { publicUrl: canonicalDetailUrl(rawPath, "https://www.catch.sg") };
}

export function mapSisticDetail(detail, listing, detailUrl, listingPage) {
  const venueValue =
    first(detail, ["/venue_name/name", "/venue_name", "/venue/name"]) ??
    first(listing, ["/venue_name/name", "/venue_name"]);
  const venue = text(
    typeof venueValue === "object" ? venueValue.name : venueValue,
  );
  const sourceLatitude = Number(
    first(detail, ["/venue_name/latitude", "/venue/latitude", "/latitude"]),
  );
  const sourceLongitude = Number(
    first(detail, ["/venue_name/longitude", "/venue/longitude", "/longitude"]),
  );
  const sourceCoordinates =
    Number.isFinite(sourceLatitude) && Number.isFinite(sourceLongitude)
      ? { lat: sourceLatitude, lng: sourceLongitude }
      : null;
  const dateText =
    text(first(detail, ["/event_date", "/date_text"])) ??
    text(first(listing, ["/event_date"]));
  const fixture = {
    adapterVersion: "1.0",
    listingPage,
    detailUrl,
    sourceId: text(detail.alias) ?? text(listing.alias),
    title: text(detail.title) ?? text(listing.title),
    mode: modeFrom(first(detail, ["/event_format", "/format", "/mode"]), venue),
    dateText,
    timeText: text(first(detail, ["/event_time", "/time_text"])),
    venue,
    address: text(
      first(detail, ["/venue_name/address", "/venue_address", "/address"]),
    ),
    sourceCoordinates,
    category: text(first(detail, ["/category/name", "/category", "/genre"])),
    price: text(first(detail, ["/price", "/price_range", "/ticket_price"])),
    description: text(first(detail, ["/description", "/synopsis"])),
    organizer: text(first(detail, ["/organizer", "/promoter", "/presenter"])),
    performances: [],
  };
  fixture.performances = performancesFrom(detail, fixture);
  if (/^various venues$/i.test(fixture.venue ?? "")) {
    const description = String(fixture.description ?? "")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, " ");
    const year = fixture.dateText?.match(/\b(20\d{2})\b/)?.[1];
    const monthNumbers = {
      jan: "01",
      feb: "02",
      mar: "03",
      apr: "04",
      may: "05",
      jun: "06",
      jul: "07",
      aug: "08",
      sep: "09",
      oct: "10",
      nov: "11",
      dec: "12",
    };
    const occurrences = [
      ...description.matchAll(
        /(?:^|\n)\s*([^\n]+?)\s*\n\s*Date:\s*(\d{1,2})\s+([A-Za-z]+)[^\n]*\n\s*Time:\s*(\d{1,2})(?::?(\d{2}))?h?\s*\n\s*Venue:\s*([^\n]+)/gi,
      ),
    ]
      .map((match) => {
        const month = monthNumbers[match[3].slice(0, 3).toLowerCase()];
        if (!year || !month) return null;
        const hour = match[4].padStart(2, "0"),
          minute = (match[5] ?? "00").padStart(2, "0");
        const date = `${year}-${month}-${match[2].padStart(2, "0")}`;
        return {
          title: text(match[1]),
          venue: text(match[6]),
          startDateTime: `${date}T${hour}:${minute}:00+08:00`,
          endDateTime: null,
          dateText: date,
          timeText: `${hour}:${minute}`,
        };
      })
      .filter(Boolean);
    if (occurrences.length >= 2) fixture.performances = occurrences;
  }
  if (!fixture.performances.length)
    fixture.performances = [
      {
        startDateTime: text(detail.start_date) ?? text(listing.start_date),
        endDateTime: text(detail.end_date) ?? text(listing.end_date),
        dateText: fixture.dateText,
        timeText: fixture.timeText,
      },
    ];
  return fixture;
}

export function mapCatchDetail(
  detail,
  listing,
  detailUrl,
  listingPage,
  window = null,
) {
  const venue =
    text(
      first(detail, [
        "/Location",
        "/Venue",
        "/EventVenue",
        "/Address/Location",
      ]),
    ) ?? text(first(listing, ["/Info/Location", "/Location"]));
  const startDate = catchDate(detail.EventStartDate);
  const endDate = catchDate(detail.EventEndDate) ?? startDate;
  const dateText =
    text(first(detail, ["/DisplayEventDate", "/EventDate", "/DateText"])) ??
    (startDate
      ? startDate === endDate
        ? startDate
        : `${startDate} to ${endDate}`
      : null) ??
    text(first(listing, ["/Info/EventDate", "/EventDate"]));
  const fixture = {
    adapterVersion: "1.0",
    listingPage,
    detailUrl,
    sourceId: new URL(detailUrl).pathname,
    recordType:
      detail.MembershipExclusivesPromo &&
      /^\s*(?:[•*-]\s*)?offer\b/i.test(
        String(detail.AdmissionRule ?? "")
          .replace(/<[^>]+>/g, " ")
          .trim(),
      )
        ? "membership_offer"
        : "event",
    title:
      text(first(detail, ["/DisplayEventTitle", "/Title"])) ??
      text(first(listing, ["/Title", "/Name"])),
    mode: modeFrom(
      first(detail, ["/EventFormat", "/Format"]) ??
        first(listing, ["/Info/EventFormat"]),
      venue,
    ),
    dateText,
    timeText: text(
      first(detail, ["/DisplayEventTime", "/EventTime", "/TimeText"]),
    ),
    venue,
    address: text(
      first(detail, ["/Address", "/VenueAddress", "/LocationAddress"]),
    ),
    category:
      text(first(detail, ["/Category", "/EventCategory"])) ??
      text(first(listing, ["/Info/Category"])),
    price:
      text(first(detail, ["/Price", "/DisplayPrice"])) ??
      text(first(listing, ["/Info/Price"])),
    description: text(
      first(detail, ["/Description", "/Synopsis", "/EventDescription"]),
    ),
    organizer: text(
      first(detail, ["/Organizer", "/Presenter", "/PresentedBy"]),
    ),
    performances: [],
  };
  fixture.performances = catchPerformances(detail, window);
  return fixture;
}

function interval(record) {
  const start = Date.parse(record.startDateTime ?? record.dateText ?? "");
  const end = Date.parse(
    record.endDateTime ?? record.startDateTime ?? record.dateText ?? "",
  );
  return Number.isFinite(start)
    ? { start, end: Number.isFinite(end) ? end : start }
    : null;
}

export function classifyFixture(fixture, window) {
  if (!fixture.sourceId) return "missing_source_id";
  if (!fixture.title) return "missing_title";
  if (!fixture.detailUrl) return "missing_detail_url";
  return null;
}

async function defaultTransport(request) {
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
  });
  const rawText = await response.text();
  let body;
  try {
    body = JSON.parse(rawText);
  } catch {
    body = null;
  }
  return {
    status: response.status,
    ok: response.ok,
    url: response.url,
    body,
    text: rawText,
  };
}

function requestForListing(source, window, pageIndex) {
  if (source.adapterId === "catch-official-listing-v1") {
    return {
      url: source.listing.url,
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        "filter[pageIndex]": String(pageIndex),
        "filter[PageSize]": String(source.listing.pageSize),
        pathUrl: "https://www.catch.sg/Event",
      }).toString(),
    };
  }
  const url = new URL(source.listing.url);
  Object.entries({
    first: (pageIndex - 1) * source.listing.pageSize,
    limit: source.listing.pageSize,
    sort_type: "date",
    sort_order: "ASC",
    index: "global",
    client: 1,
  }).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  return { url: url.href, method: "GET" };
}

async function requestDetail(source, listing, transport, publicUrl) {
  if (source.adapterId === "sistic-official-listing-v1") {
    const alias = text(listing.alias);
    if (!alias) return { invalid: "missing_detail_url" };
    const url = new URL(source.detail.url);
    url.searchParams.set("client", "1");
    url.searchParams.set("code", alias);
    publicUrl =
      publicUrl ??
      canonicalDetailUrl(
        `/event-details/${alias}`,
        "https://www.sistic.com.sg",
      );
    const response = await transport({ url: url.href, method: "GET" });
    if (!response.ok) return { publicUrl, response };
    const officialResponse = await transport({ url: publicUrl, method: "GET" });
    return { publicUrl, response, officialResponse };
  }
  if (!publicUrl) {
    const rawPath =
      text(listing.Url) ?? text(listing.URL) ?? text(listing.Link);
    if (!rawPath) return { invalid: "missing_detail_url" };
    publicUrl = canonicalDetailUrl(rawPath, "https://www.catch.sg");
  }
  const bootstrap = await transport({ url: publicUrl, method: "GET" });
  if (!bootstrap.ok)
    return {
      blocked: `Catch detail bootstrap returned HTTP ${bootstrap.status}`,
    };
  const eventPageID = bootstrap.text.match(
    /event-detail-page-id=["']([^"']+)["']/i,
  )?.[1];
  if (!eventPageID)
    return {
      blocked: "Catch detail bootstrap no longer exposes event-detail-page-id",
    };
  const body = new URLSearchParams({
    pathUrl: publicUrl,
    eventPageID,
    articlePageSize: "6",
    photosPageSize: "8",
    isPhotosPaginated: "false",
    articlePageIndex: "1",
    photosPageIndex: "1",
  });
  return {
    publicUrl,
    officialResponse: bootstrap,
    response: await transport({
      url: source.detail.url,
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    }),
  };
}

function tinyfishResult(batch, requestedUrl) {
  const canonical = canonicalRenderedUrl(requestedUrl);
  const result =
    batch.results.find((item) => {
      try {
        return (
          canonicalRenderedUrl(
            item.url ?? item.requested_url ?? item.requestedUrl,
          ) === canonical
        );
      } catch {
        return false;
      }
    }) ?? (batch.results.length === 1 ? batch.results[0] : null);
  const error = batch.errors.find((item) => {
    try {
      return (
        canonicalRenderedUrl(
          item.url ?? item.requested_url ?? item.requestedUrl,
        ) === canonical
      );
    } catch {
      return false;
    }
  });
  return { result, error };
}

function validateRenderedResult(source, requestedUrl, result) {
  const finalUrl = canonicalRenderedUrl(
    result?.final_url ?? result?.finalUrl ?? result?.url ?? requestedUrl,
  );
  return validateOfficialReference(source, requestedUrl, {
    ok: true,
    status: 200,
    url: finalUrl,
  });
}

async function collectDiscoveryDetails({
  runDir,
  run,
  source,
  adapter,
  client,
  pages,
  detailUrls,
  detailListingRecords = new Map(),
  artifactRefs,
  now,
  logger = () => {},
  corroborationRecords = [],
}) {
  const registry = loadEventAuthorityRegistry(DEFAULT_AUTHORITY_REGISTRY);
  const retrievalDefinitionHash = sha(JSON.stringify(source.retrieval));
  const captureIndex = createAuthorityCaptureIndex({
    runDir,
    runId: run.runId,
    window: run.window,
    retrievalDefinitionHash,
  });
  const sourceRecordRefs = [],
    processedSourceRecordRefs = [],
    invalidSourceRecordRefs = [],
    invalidReasonCodes = {},
    confirmationOutcomeCounts = {};
  const confirmationRefs = [],
    authorityRefs = [];
  for (const detailUrl of [...detailUrls].sort()) {
    let batch;
    try {
      batch = await client.fetchBatch([detailUrl], {
        sourceName: source.name,
        stage: "discovery_detail",
        entityId: detailUrl,
      });
    } catch (error) {
      return {
        status: source.operatingMode === "pilot" ? "pilot_failed" : "blocked",
        blockerReasonCode: error.code ?? "source_unavailable",
        error: error.message,
      };
    }
    const { result, error } = tinyfishResult(batch, detailUrl);
    if (error || !result)
      return {
        status: source.operatingMode === "pilot" ? "pilot_failed" : "blocked",
        blockerReasonCode: "source_unavailable",
        error:
          error?.message ??
          `${source.name} discovery detail returned no result`,
      };
    let finalUrl;
    try {
      finalUrl = validateRenderedResult(source, detailUrl, result).finalUrl;
    } catch (validationError) {
      return {
        status: "blocked",
        blockerReasonCode: "official_reference_invalid",
        error: validationError.message,
      };
    }
    const listingRecord =
      detailListingRecords.get(detailUrl)?.record ??
      detailListingRecords.get(finalUrl)?.record ??
      null;
    const discovery = adapter.detail(result, source, finalUrl, {
        listingRecord,
      }),
      hash = sha(discovery.discoveryRecordId),
      retrievedAt = now();
    logger({
      action: "discovery_detail_parsed",
      sourceName: source.name,
      entityId: discovery.discoveryRecordId,
      hasTitle: Boolean(discovery.claims?.title),
      hasSchedule: Boolean(discovery.claims?.dateText),
      hasVenue: Boolean(discovery.claims?.venue),
      outboundLinks: discovery.outboundLinks?.length ?? 0,
      adapterReasonCode: discovery.reasonCode ?? null,
    });
    const responseRef = `raw/${source.adapterId}/discoveries/${hash}.response.json`,
      fixtureRef = `raw/${source.adapterId}/discoveries/${hash}.json`;
    discovery.evidenceRefs = [responseRef];
    writeJson(join(runDir, responseRef), {
      schemaVersion: "1.0",
      result,
      payloadHash: batch.payloadHash,
      retrievedAt,
    });
    const decision = await confirmDiscoveryRecord({
      discovery,
      registry,
      sourceMode: source.operatingMode,
      policyVersion: source.confirmation.policyVersion,
      directRecords: corroborationRecords.filter(
        (record) => record.sourceRole !== "discovery",
      ),
      editorialPeers: corroborationRecords.filter(
        (record) => record.sourceRole === "discovery",
      ),
      fetchAuthority: async (approved) => {
        const existing = captureIndex.reusable(approved.url);
        let authorityResult,
          alreadyCollected = Boolean(existing);
        if (existing)
          authorityResult = JSON.parse(
            readFileSync(join(runDir, existing.captureRef), "utf8"),
          );
        else {
          captureIndex.reserve(approved.url);
          const authorityBatch = await client.fetchBatch([approved.url], {
            sourceName: source.name,
            stage: "authority_confirmation",
            entityId: discovery.discoveryRecordId,
          });
          const selected = tinyfishResult(authorityBatch, approved.url);
          if (selected.error || !selected.result)
            throw new Error("Authority retrieval failed");
          const authorityFinalUrl = canonicalRenderedUrl(
            selected.result.final_url ??
              selected.result.finalUrl ??
              selected.result.url ??
              approved.url,
          );
          assertAuthorityUrlAllowed(registry, authorityFinalUrl);
          const completed = captureIndex.complete(approved.url, {
            payload: selected.result,
            payloadHash: authorityBatch.payloadHash,
            finalUrl: authorityFinalUrl,
          });
          authorityResult = selected.result;
          authorityRefs.push(completed.captureRef);
          alreadyCollected = false;
        }
        const canonicalUrl = canonicalRenderedUrl(
          authorityResult.final_url ??
            authorityResult.finalUrl ??
            authorityResult.url ??
            approved.url,
        );
        const parsed = parseAuthorityDetail(authorityResult, {
          source: { version: "1.0" },
          detailUrl: canonicalUrl,
        });
        const performances = parsed.performances.length
          ? parsed.performances
          : parsed.dateText
            ? [
                {
                  authorityOccurrenceId: `${approved.authorityId}:${canonicalUrl}#${parsed.dateText}`,
                  dateText: parsed.dateText,
                  timeText: parsed.timeText,
                },
              ]
            : [];
        return {
          authorityRecordId: `${approved.authorityId}:${canonicalUrl}`,
          canonicalUrl,
          title: parsed.title,
          dateText: parsed.dateText,
          venue: parsed.venue,
          performances: performances.map((performance, index) => ({
            authorityOccurrenceId:
              performance.authorityOccurrenceId ??
              `${approved.authorityId}:${canonicalUrl}#${performance.startDateTime ?? index + 1}`,
            ...performance,
          })),
          alreadyCollected,
        };
      },
    });
    const eligibleDecision = [
      "authority_confirmed",
      "already_collected_authority",
      "direct_reused",
      "editorial_sufficient",
    ].includes(decision.decision);
    logger({
      action: "discovery_confirmation_decided",
      sourceName: source.name,
      entityId: discovery.discoveryRecordId,
      decision: decision.decision,
      evidenceLevel: decision.evidenceLevel ?? null,
      eligible: eligibleDecision,
    });
    const claims = discovery.claims ?? {};
    const venue = claims.venue ?? null;
    const offMapSubtype = /secret|tba|to be announced/i.test(venue ?? "")
      ? "secret_tba"
      : /multiple|various venues|locations/i.test(venue ?? "")
        ? "multiple_locations"
        : "geometry_unavailable";
    Object.assign(discovery, {
      confirmationIds: [decision.confirmationId],
      terminalStatus: eligibleDecision
        ? decision.decision
        : decision.decision === "authority_fetch_failed"
          ? "authority_retrieval_failed"
          : decision.decision === "schedule_unverified" ||
              decision.decision.includes("review") ||
              decision.decision.includes("ambiguous") ||
              decision.decision.includes("conflict") ||
              decision.decision.includes("incomplete")
            ? "review"
            : "rejected",
      evidenceDecision: decision.decision,
      reasonCode: eligibleDecision ? null : decision.decision,
      sourceId: discovery.discoveryRecordId,
      title: claims.title,
      dateText: claims.dateText,
      timeText: claims.timeText,
      venue,
      scope: claims.scope ?? "Singapore",
      schedule: normalizeSchedule({
        kind: claims.dateText
          ? /anytime|choose|select/i.test(claims.dateText)
            ? "anytime"
            : "exact"
          : "unverified",
        displayText: claims.dateText ?? null,
      }),
      publicPlacement: venue ? "off_map" : "none",
      mappingStatus:
        venue && offMapSubtype === "geometry_unavailable"
          ? "pending_review"
          : venue
            ? "not_required"
            : "pending_review",
      offMapSubtype: venue ? offMapSubtype : null,
      lifecycleState: eligibleDecision ? "active" : "held",
      evidenceLevel:
        decision.evidenceLevel ??
        (eligibleDecision
          ? "direct_corroborated"
          : "editorial_evidence_incomplete"),
      primaryEvidenceId:
        decision.primaryEvidenceId ?? discovery.discoveryRecordId,
      sourceContributions: [
        {
          sourceRecordId: discovery.discoveryRecordId,
          sourceName: source.name,
          evidenceLevel: decision.evidenceLevel,
          freshness: "current",
          fields: ["title", "schedule", "location"],
          evidenceRefs: discovery.evidenceRefs,
        },
      ],
    });
    writeJson(join(runDir, fixtureRef), {
      schemaVersion: "1.0",
      runId: run.runId,
      createdAt: retrievedAt,
      source: {
        name: source.name,
        role: source.sourceRole,
        mode: source.operatingMode,
      },
      counts: { records: 1 },
      records: [discovery],
    });
    const decisionRef = `raw/${source.adapterId}/confirmations/${hash}.json`;
    writeJson(join(runDir, decisionRef), decision);
    artifactRefs.push(responseRef, fixtureRef, decisionRef);
    confirmationRefs.push(decisionRef);
    const recordRef = `${fixtureRef}#/records/0`;
    sourceRecordRefs.push(recordRef);
    processedSourceRecordRefs.push(recordRef);
    confirmationOutcomeCounts[decision.decision] =
      (confirmationOutcomeCounts[decision.decision] ?? 0) + 1;
  }
  const indexRef = "raw/authority/index.json";
  if (!artifactRefs.includes(indexRef)) artifactRefs.push(indexRef);
  return {
    status: "success",
    sourceRole: "discovery",
    operatingMode: source.operatingMode,
    counts: {
      pages: pages.length,
      sourceRecordsReceived: detailUrls.size,
      invalidSourceRecords: 0,
      processedSourceRecords: detailUrls.size,
      discoveryRecordsReceived: detailUrls.size,
      occurrencesEmitted: detailUrls.size,
      excludedOccurrences: [...Object.entries(confirmationOutcomeCounts)]
        .filter(
          ([decision]) =>
            ![
              "authority_confirmed",
              "already_collected_authority",
              "direct_reused",
              "editorial_sufficient",
            ].includes(decision),
        )
        .reduce((sum, [, count]) => sum + count, 0),
      eligiblePreDedup: [
        "authority_confirmed",
        "already_collected_authority",
        "direct_reused",
        "editorial_sufficient",
      ].reduce(
        (sum, decision) => sum + (confirmationOutcomeCounts[decision] ?? 0),
        0,
      ),
      confirmationOutcomeCounts,
      authorityCaptures: authorityRefs.length,
    },
    completion: {
      paginationComplete: true,
      pagesVisited: pages.map(({ ref }) => ref),
      sourceRecordsDiscovered: detailUrls.size,
      providerReportedTotal: null,
      derivedTotal: detailUrls.size,
      providerTotalEvidence: null,
      terminalEvidence: pages.at(-1)?.terminalEvidence,
      pageRecordCounts: pages.map(({ count }) => count),
      detailUrlsDiscovered: detailUrls.size,
      detailPagesCaptured: detailUrls.size,
      zeroResultConfirmed: detailUrls.size === 0,
    },
    sourceRecordRefs,
    invalidSourceRecordRefs,
    processedSourceRecordRefs,
    invalidReasonCodes,
    confirmationRefs,
    authorityRefs,
    artifactRefs,
    error: null,
  };
}

export async function collectRenderedSource({
  runDir,
  run,
  source,
  renderedClient = null,
  listingCapture = null,
  detailCaptures = null,
  now = () => new Date().toISOString(),
  logger = () => {},
  corroborationRecords = [],
}) {
  const adapter = renderedAdapterFor(source.adapterId);
  if (!adapter)
    return {
      status: "blocked",
      blockerReasonCode: "adapter_missing",
      error: `No rendered adapter for ${source.adapterId}`,
    };
  let client = renderedClient;
  try {
    client ??= createTinyfishFetchClient({ ...source.retrieval, logger });
  } catch (error) {
    return {
      status: "blocked",
      blockerReasonCode: error.code ?? "retrieval_policy_invalid",
      error: error.message,
    };
  }
  const slug = source.adapterId.replace(/-v\d+$/, ""),
    artifactRefs = [],
    pages = [],
    detailUrls = new Set(),
    detailListingRecords = new Map(),
    listingRecords = [];
  const listingQueue = [
    ...new Map(
      [source.listing.url, ...asArray(source.listing.urls)].map((url) => [
        canonicalRenderedUrl(url),
        url,
      ]),
    ).values(),
  ];
  const queuedListingUrls = new Set(listingQueue.map(canonicalRenderedUrl)),
    visitedListingUrls = new Set();
  for (
    let pageIndex = 1;
    pageIndex <= source.listing.paginationCeiling && listingQueue.length;
    pageIndex += 1
  ) {
    const pageUrl = listingQueue.shift();
    visitedListingUrls.add(canonicalRenderedUrl(pageUrl));
    logger({
      action: "listing_surface_started",
      sourceName: source.name,
      pageIndex,
      listingSurface: pageUrl,
      remainingSurfaces: listingQueue.length,
    });
    let batch;
    try {
      if (pageIndex === 1 && listingCapture?.result) {
        batch = {
          results: [listingCapture.result],
          errors: [],
          payloadHash:
            listingCapture.payloadHash ??
            sha(JSON.stringify(listingCapture.result)),
        };
        logger({
          action: "listing_capture_reused",
          sourceName: source.name,
          pageIndex,
          requestedUrl: pageUrl,
          payloadHash: batch.payloadHash,
        });
      } else {
        batch = await client.fetchBatch([pageUrl], {
          sourceName: source.name,
          stage: "listing",
          pageIndex,
          requestOptions: source.listing.retrieval,
        });
      }
    } catch (error) {
      return {
        status: "blocked",
        blockerReasonCode: error.code ?? "source_unavailable",
        error: error.message,
      };
    }
    const { result, error } = tinyfishResult(batch, pageUrl);
    if (error || !result)
      return {
        status: "blocked",
        blockerReasonCode: "source_unavailable",
        error:
          error?.message ??
          `${source.name} listing retrieval returned no result`,
      };
    try {
      validateRenderedResult(source, pageUrl, result);
    } catch (validationError) {
      return {
        status: "blocked",
        blockerReasonCode: "official_reference_invalid",
        error: validationError.message,
      };
    }
    const pageRef = `raw/${slug}/listings/page-${String(pageIndex).padStart(4, "0")}.json`;
    writeJson(join(runDir, pageRef), {
      schemaVersion: "1.0",
      requestedUrl: pageUrl,
      payloadHash: batch.payloadHash,
      result,
    });
    artifactRefs.push(pageRef);
    const parsed = adapter.listing(result, source, pageUrl);
    for (const detailUrl of parsed.detailUrls) detailUrls.add(detailUrl);
    for (const item of asArray(parsed.detailItems)) {
      const canonicalUrl = canonicalRenderedUrl(item.url);
      detailUrls.add(canonicalUrl);
      const prior = detailListingRecords.get(canonicalUrl);
      detailListingRecords.set(canonicalUrl, {
        record: {
          ...item.record,
          ...Object.fromEntries(
            Object.entries(prior?.record ?? {}).filter(
              ([, value]) => value != null,
            ),
          ),
        },
        referenceKind:
          prior?.referenceKind ?? item.referenceKind ?? "source_detail",
        listingRef: prior?.listingRef ?? pageRef,
      });
    }
    for (const record of asArray(parsed.records))
      listingRecords.push({ record, listingRef: pageRef, listingUrl: pageUrl });
    pages.push({
      ref: pageRef,
      count:
        new Set([
          ...parsed.detailUrls,
          ...asArray(parsed.detailItems).map(({ url }) => url),
        ]).size + asArray(parsed.records).length,
      terminalEvidence: parsed.evidence,
      zeroResultConfirmed: parsed.zeroResultConfirmed === true,
    });
    logger({
      action: "listing_parsed",
      sourceName: source.name,
      pageIndex,
      listingSurface: pageUrl,
      listingAppearances: parsed.appearances ?? parsed.detailUrls.length,
      detailUrls: parsed.detailUrls.length,
      detailItems: asArray(parsed.detailItems).length,
      listingRecords: asArray(parsed.records).length,
      terminalEvidence: parsed.evidence,
    });
    const discoveredListingUrls = [
      ...asArray(parsed.listingUrls),
      ...(!parsed.complete && parsed.nextUrl ? [parsed.nextUrl] : []),
    ];
    if (!parsed.complete && !parsed.nextUrl)
      return {
        status: "blocked",
        blockerReasonCode: "pagination_inaccessible",
        error: `${source.name} listing pagination did not reach a terminal state`,
      };
    for (const discoveredUrl of discoveredListingUrls) {
      let canonicalUrl;
      try {
        canonicalUrl = canonicalRenderedUrl(discoveredUrl);
        validateOfficialReference(source, canonicalUrl, {
          ok: true,
          status: 200,
          url: canonicalUrl,
        });
      } catch (validationError) {
        return {
          status: "blocked",
          blockerReasonCode: "official_reference_invalid",
          error: validationError.message,
        };
      }
      if (
        visitedListingUrls.has(canonicalUrl) ||
        queuedListingUrls.has(canonicalUrl)
      )
        continue;
      listingQueue.push(canonicalUrl);
      queuedListingUrls.add(canonicalUrl);
      logger({
        action: "listing_surface_queued",
        sourceName: source.name,
        pageIndex,
        listingSurface: canonicalUrl,
        discoveredFrom: pageUrl,
      });
    }
  }
  if (listingQueue.length)
    return {
      status: "blocked",
      blockerReasonCode: "pagination_inaccessible",
      error: `${source.name} listing surfaces exceeded the configured ceiling`,
    };
  if (
    detailUrls.size === 0 &&
    listingRecords.length === 0 &&
    pages.at(-1)?.zeroResultConfirmed !== true
  ) {
    return {
      status: "blocked",
      blockerReasonCode: "layout_contract_changed",
      error: `${source.name} listing exposed no detail records and no explicit zero-result evidence`,
    };
  }
  const expansionInvalidRecordRefs = [],
    expansionInvalidReasonCodes = {};
  if (adapter.detailLinks && detailUrls.size > 0) {
    const expanded = new Set();
    for (const seedUrl of [...detailUrls].sort()) {
      let batch;
      try {
        batch = await client.fetchBatch([seedUrl], {
          sourceName: source.name,
          stage: "detail_index",
          entityId: seedUrl,
        });
      } catch (error) {
        return {
          status: "blocked",
          blockerReasonCode: error.code ?? "source_unavailable",
          error: error.message,
        };
      }
      const { result, error } = tinyfishResult(batch, seedUrl);
      const seedRef = `raw/${slug}/detail-index/${sha(seedUrl)}.json`;
      writeJson(join(runDir, seedRef), {
        schemaVersion: "1.0",
        requestedUrl: seedUrl,
        payloadHash: batch.payloadHash,
        seed: { url: seedUrl, result: result ?? null, error: error ?? null },
      });
      artifactRefs.push(seedRef);
      const seedRecordRef = `${seedRef}#/seed`;
      if (error || !result) {
        expansionInvalidRecordRefs.push(seedRecordRef);
        expansionInvalidReasonCodes[seedRecordRef] = "detail_index_unavailable";
        continue;
      }
      try {
        validateRenderedResult(source, seedUrl, result);
      } catch (validationError) {
        return {
          status: "blocked",
          blockerReasonCode: "official_reference_invalid",
          error: validationError.message,
        };
      }
      const occurrenceLinks = adapter.detailLinks(result, source, seedUrl);
      if (!occurrenceLinks.length) {
        expansionInvalidRecordRefs.push(seedRecordRef);
        expansionInvalidReasonCodes[seedRecordRef] = "missing_occurrence_link";
        continue;
      }
      for (const detailUrl of occurrenceLinks) expanded.add(detailUrl);
    }
    if (expanded.size === 0)
      return {
        status: "blocked",
        blockerReasonCode: "layout_contract_changed",
        error: `${source.name} detail indexes exposed no occurrence links`,
      };
    detailUrls.clear();
    for (const detailUrl of expanded) detailUrls.add(detailUrl);
  }
  if (source.sourceRole === "discovery")
    return collectDiscoveryDetails({
      runDir,
      run,
      source,
      adapter,
      client,
      pages,
      detailUrls,
      detailListingRecords,
      artifactRefs,
      now,
      logger,
      corroborationRecords,
    });
  const sourceRecordRefs = [...expansionInvalidRecordRefs],
    invalidSourceRecordRefs = [...expansionInvalidRecordRefs],
    processedSourceRecordRefs = [],
    invalidReasonCodes = { ...expansionInvalidReasonCodes };
  const captureOutboundListingFallback = ({
    detailUrl,
    listingEvidence,
    batch,
    result = null,
    error = null,
    reasonCode,
  }) => {
    const hash = sha(detailUrl),
      retrievedAt = now();
    const responseRef = `raw/${slug}/details/${hash}.outbound-fallback.response.json`;
    const fixtureRef = `raw/${slug}/details/${hash}.json`;
    const officialReferenceRef = `raw/${slug}/details/${hash}.listing-official.json`;
    const listingUrl = canonicalRenderedUrl(source.listing.url);
    writeJson(join(runDir, responseRef), {
      schemaVersion: "1.0",
      requestedUrl: detailUrl,
      result,
      error,
      payloadHash: batch?.payloadHash ?? null,
      reasonCode,
    });
    writeJson(join(runDir, officialReferenceRef), {
      schemaVersion: "1.0",
      requestedUrl: listingUrl,
      finalUrl: listingUrl,
      status: 200,
      contentHash: listingEvidence.record.rawDocumentHash,
      retrievedAt,
    });
    const fixture = {
      ...listingEvidence.record,
      detailUrl,
      ...sourceRecordProvenance({
        run,
        source,
        retrievedAt,
        listingRef: listingEvidence.listingRef,
        responseRef,
        officialReferenceRef,
        officialReference: {
          requestedUrl: listingUrl,
          finalUrl: listingUrl,
          status: 200,
        },
        detailUrl,
      }),
    };
    writeJson(join(runDir, fixtureRef), {
      schemaVersion: "1.0",
      runId: run.runId,
      createdAt: retrievedAt,
      source: {
        name: source.name,
        role: source.sourceRole,
        mode: source.operatingMode,
      },
      counts: { records: 1 },
      records: [fixture],
    });
    artifactRefs.push(responseRef, officialReferenceRef, fixtureRef);
    const recordRef = `${fixtureRef}#/records/0`;
    sourceRecordRefs.push(recordRef);
    processedSourceRecordRefs.push(recordRef);
    logger({
      action: "detail_outbound_fallback_applied",
      sourceName: source.name,
      entityId: detailUrl,
      reasonCode,
      listingRef: listingEvidence.listingRef,
      responseRef,
    });
  };
  if (listingRecords.length) {
    const retrievedAt = now(),
      listingDetailUrl = canonicalRenderedUrl(source.listing.url),
      listingHash = sha(listingDetailUrl);
    const fixtureRef = `raw/${slug}/details/${listingHash}.json`,
      officialReferenceRef = `raw/${slug}/details/${listingHash}.official.json`;
    writeJson(join(runDir, officialReferenceRef), {
      schemaVersion: "1.0",
      requestedUrl: source.listing.url,
      finalUrl: source.listing.url,
      status: 200,
      contentHash: sha(
        JSON.stringify(
          listingRecords.map(({ record }) => record.rawDocumentHash),
        ),
      ),
      retrievedAt,
    });
    artifactRefs.push(officialReferenceRef);
    const fixtures = listingRecords.map(
      ({ record, listingRef, listingUrl }) => ({
        ...record,
        detailUrl: canonicalRenderedUrl(listingUrl),
        ...sourceRecordProvenance({
          run,
          source,
          retrievedAt,
          listingRef,
          responseRef: listingRef,
          officialReferenceRef,
          officialReference: {
            requestedUrl: listingUrl,
            finalUrl: listingUrl,
            status: 200,
          },
          detailUrl: canonicalRenderedUrl(listingUrl),
        }),
      }),
    );
    writeJson(join(runDir, fixtureRef), {
      schemaVersion: "1.0",
      runId: run.runId,
      createdAt: retrievedAt,
      source: {
        name: source.name,
        role: source.sourceRole,
        mode: source.operatingMode,
      },
      counts: { records: fixtures.length },
      records: fixtures,
    });
    artifactRefs.push(fixtureRef);
    fixtures.forEach((fixture, index) => {
      const recordRef = `${fixtureRef}#/records/${index}`;
      sourceRecordRefs.push(recordRef);
      if (!fixture.sourceId || !fixture.title) {
        invalidSourceRecordRefs.push(recordRef);
        invalidReasonCodes[recordRef] = !fixture.sourceId
          ? "missing_stable_identity"
          : "missing_title";
      } else processedSourceRecordRefs.push(recordRef);
    });
    logger({
      action: "listing_records_captured",
      sourceName: source.name,
      records: fixtures.length,
      fixtureRef,
    });
  }
  for (const detailUrl of [...detailUrls].sort()) {
    const listingEvidence = detailListingRecords.get(detailUrl) ?? null;
    let batch;
    try {
      const savedCapture =
        detailCaptures instanceof Map
          ? detailCaptures.get(detailUrl)
          : detailCaptures?.[detailUrl];
      if (savedCapture) {
        batch = {
          results: savedCapture.result ? [savedCapture.result] : [],
          errors: savedCapture.error ? [savedCapture.error] : [],
          payloadHash:
            savedCapture.payloadHash ?? sha(JSON.stringify(savedCapture)),
        };
        logger({
          action: "detail_capture_reused",
          sourceName: source.name,
          entityId: detailUrl,
          payloadHash: batch.payloadHash,
        });
      } else {
        batch = await client.fetchBatch([detailUrl], {
          sourceName: source.name,
          stage: "detail",
          entityId: detailUrl,
        });
      }
    } catch (error) {
      if (listingEvidence?.referenceKind === "authoritative_listing_outbound") {
        captureOutboundListingFallback({
          detailUrl,
          listingEvidence,
          batch: null,
          error: {
            code: error.code ?? "source_unavailable",
            message: error.message,
          },
          reasonCode: error.code ?? "source_unavailable",
        });
        continue;
      }
      return {
        status: "blocked",
        blockerReasonCode: error.code ?? "source_unavailable",
        error: error.message,
      };
    }
    const { result, error } = tinyfishResult(batch, detailUrl);
    if (error || !result) {
      if (listingEvidence?.referenceKind === "authoritative_listing_outbound") {
        captureOutboundListingFallback({
          detailUrl,
          listingEvidence,
          batch,
          result,
          error,
          reasonCode: error?.code ?? "source_unavailable",
        });
        continue;
      }
      return {
        status: "blocked",
        blockerReasonCode: "source_unavailable",
        error:
          error?.message ??
          `${source.name} detail retrieval returned no result`,
      };
    }
    const finalUrl = canonicalRenderedUrl(
      result.final_url ?? result.finalUrl ?? result.url ?? detailUrl,
    );
    try {
      const validator =
        listingEvidence?.referenceKind === "authoritative_listing_outbound"
          ? validateAuthoritativeListingOutboundReference
          : (requestedUrl, response) =>
              validateOfficialReference(source, requestedUrl, response);
      validator(detailUrl, { ok: true, status: 200, url: finalUrl });
    } catch (validationError) {
      if (listingEvidence?.referenceKind === "authoritative_listing_outbound") {
        captureOutboundListingFallback({
          detailUrl,
          listingEvidence,
          batch,
          result,
          reasonCode: "official_reference_invalid",
        });
        continue;
      }
      return {
        status: "blocked",
        blockerReasonCode: "official_reference_invalid",
        error: validationError.message,
      };
    }
    const finalListingEvidence =
      listingEvidence ?? detailListingRecords.get(finalUrl) ?? null;
    const listingRecord = finalListingEvidence?.record ?? null;
    const fixtures = adapter.details
      ? adapter.details(result, source, finalUrl, { listingRecord })
      : [adapter.detail(result, source, finalUrl, { listingRecord })];
    const hash = sha(finalUrl),
      retrievedAt = now();
    const responseRef = `raw/${slug}/details/${hash}.response.json`,
      fixtureRef = `raw/${slug}/details/${hash}.json`,
      officialReferenceRef = `raw/${slug}/details/${hash}.official.json`;
    writeJson(join(runDir, responseRef), {
      schemaVersion: "1.0",
      result,
      payloadHash: batch.payloadHash,
    });
    writeJson(join(runDir, officialReferenceRef), {
      schemaVersion: "1.0",
      requestedUrl: detailUrl,
      finalUrl,
      status: 200,
      contentHash: sha(
        JSON.stringify(fixtures.map(({ rawDocumentHash }) => rawDocumentHash)),
      ),
      retrievedAt,
    });
    for (const fixture of fixtures)
      Object.assign(
        fixture,
        sourceRecordProvenance({
          run,
          source,
          retrievedAt,
          listingRef:
            finalListingEvidence?.listingRef ??
            pages.find(({ ref }) => ref)?.ref,
          responseRef,
          officialReferenceRef,
          officialReference: { requestedUrl: detailUrl, finalUrl, status: 200 },
          detailUrl: finalUrl,
        }),
      );
    writeJson(join(runDir, fixtureRef), {
      schemaVersion: "1.0",
      runId: run.runId,
      createdAt: retrievedAt,
      source: {
        name: source.name,
        role: source.sourceRole,
        mode: source.operatingMode,
      },
      counts: { records: fixtures.length },
      records: fixtures,
    });
    artifactRefs.push(responseRef, officialReferenceRef, fixtureRef);
    fixtures.forEach((fixture, index) => {
      const recordRef = `${fixtureRef}#/records/${index}`;
      sourceRecordRefs.push(recordRef);
      if (fixture.listingFallbackFields?.length)
        logger({
          action: "detail_listing_fallback_applied",
          sourceName: source.name,
          entityId: finalUrl,
          fields: fixture.listingFallbackFields,
        });
      if (!fixture.sourceId || !fixture.title) {
        invalidSourceRecordRefs.push(recordRef);
        invalidReasonCodes[recordRef] = !fixture.sourceId
          ? "missing_stable_identity"
          : "missing_title";
      } else processedSourceRecordRefs.push(recordRef);
    });
  }
  let occurrencesEmitted = 0,
    excludedOccurrences = 0,
    eligiblePreDedup = 0;
  for (const ref of processedSourceRecordRefs) {
    const document = JSON.parse(
      readFileSync(join(runDir, ref.split("#")[0]), "utf8"),
    );
    const fixture =
      document.records[Number(ref.match(/#\/records\/(\d+)$/)?.[1])];
    for (const occurrence of fixture.performances.length
      ? fixture.performances
      : [fixture]) {
      occurrencesEmitted += 1;
      const policy = assessActivityInclusion(
        { ...fixture, ...occurrence },
        { asOf: run.window.start },
      );
      const eligible =
        !fixture.reasonCode &&
        policy.eligible &&
        fixture.mode !== "online" &&
        fixture.venue;
      if (eligible) eligiblePreDedup += 1;
      else excludedOccurrences += 1;
    }
  }
  return {
    status: "success",
    sourceRole: source.sourceRole,
    operatingMode: source.operatingMode,
    counts: {
      pages: pages.length,
      sourceRecordsReceived: sourceRecordRefs.length,
      invalidSourceRecords: invalidSourceRecordRefs.length,
      processedSourceRecords: processedSourceRecordRefs.length,
      occurrencesEmitted,
      excludedOccurrences,
      eligiblePreDedup,
    },
    completion: {
      paginationComplete: true,
      pagesVisited: pages.map(({ ref }) => ref),
      sourceRecordsDiscovered: sourceRecordRefs.length,
      providerReportedTotal: null,
      derivedTotal: sourceRecordRefs.length,
      providerTotalEvidence: null,
      terminalEvidence: pages.at(-1)?.terminalEvidence,
      pageRecordCounts: pages.map(({ count }) => count),
      detailUrlsDiscovered: detailUrls.size + (listingRecords.length ? 1 : 0),
      detailPagesCaptured: new Set(
        processedSourceRecordRefs.map((ref) => ref.split("#")[0]),
      ).size,
      zeroResultConfirmed:
        detailUrls.size === 0 && listingRecords.length === 0
          ? pages.at(-1)?.zeroResultConfirmed === true
          : false,
    },
    sourceRecordRefs,
    invalidSourceRecordRefs,
    processedSourceRecordRefs,
    invalidReasonCodes,
    artifactRefs,
    error: null,
  };
}

export async function collectSource({
  runDir,
  run,
  source,
  transport = defaultTransport,
  renderedClient = null,
  logger = () => {},
  now = () => new Date().toISOString(),
  paginationCeiling = 50,
  requestPolicy = {},
  corroborationRecords = [],
}) {
  try {
    validateSourcePolicy(source);
  } catch (error) {
    return {
      status: "blocked",
      blockerReasonCode: "provider_policy_invalid",
      error: error.message,
    };
  }
  if (source.retrieval?.providerId === "tinyfish-fetch")
    return collectRenderedSource({
      runDir,
      run,
      source,
      renderedClient,
      logger,
      now,
      corroborationRecords,
    });
  const resilientTransport = async (request) =>
    (await requestWithRetry(transport, request, requestPolicy)).response;
  const slug = source.adapterId.split("-")[0];
  const pages = [],
    listings = [];
  let providerTotal = null,
    pageTotal = null;
  for (let pageIndex = 1; pageIndex <= paginationCeiling; pageIndex += 1) {
    const response = await resilientTransport(
      requestForListing(source, run.window, pageIndex),
    );
    if (!response.ok || !response.body)
      return {
        status: "blocked",
        blockerReasonCode: "source_unavailable",
        error: `${source.name} listing returned HTTP ${response.status}`,
      };
    const pageRef = `raw/${slug}/listings/page-${String(pageIndex).padStart(4, "0")}.json`;
    writeJson(join(runDir, pageRef), response.body);
    const records = pointer(response.body, source.listing.recordsPointer);
    const total = pointer(response.body, source.listing.totalPointer);
    if (!Array.isArray(records) || !Number.isInteger(total))
      return {
        status: "blocked",
        blockerReasonCode: "layout_contract_changed",
        error: `${source.name} listing response no longer matches configured pointers`,
      };
    if (providerTotal === null) providerTotal = total;
    else if (providerTotal !== total)
      return {
        status: "blocked",
        blockerReasonCode: "layout_contract_changed",
        error: `${source.name} provider total changed during pagination`,
      };
    pages.push({ ref: pageRef, count: records.length });
    listings.push(
      ...records.map((record, index) => ({
        record,
        pageIndex,
        listingRef: `${pageRef}#${source.listing.recordsPointer}/${index}`,
      })),
    );
    pageTotal = source.listing.pageTotalPointer
      ? pointer(response.body, source.listing.pageTotalPointer)
      : Math.ceil(total / source.listing.pageSize);
    if (pageIndex >= pageTotal || listings.length >= total) break;
  }
  if (listings.length !== providerTotal)
    return {
      status: "blocked",
      blockerReasonCode: "pagination_inaccessible",
      error: `${source.name} pagination returned ${listings.length} of ${providerTotal} records`,
    };

  const artifactRefs = pages.map(({ ref }) => ref),
    sourceRecordRefs = [],
    invalidSourceRecordRefs = [],
    processedSourceRecordRefs = [],
    invalidReasonCodes = {};
  let detailUrlsDiscovered = 0;
  const seenDetailUrls = new Set();
  for (const listing of listings) {
    const detailUrl = detailUrlForListing(source, listing.record);
    if (detailUrl.invalid) {
      sourceRecordRefs.push(listing.listingRef);
      invalidSourceRecordRefs.push(listing.listingRef);
      invalidReasonCodes[listing.listingRef] = detailUrl.invalid;
      continue;
    }
    if (seenDetailUrls.has(detailUrl.publicUrl)) {
      sourceRecordRefs.push(listing.listingRef);
      invalidSourceRecordRefs.push(listing.listingRef);
      invalidReasonCodes[listing.listingRef] = "duplicate_detail_url";
      continue;
    }
    seenDetailUrls.add(detailUrl.publicUrl);
    const detail = await requestDetail(
      source,
      listing.record,
      resilientTransport,
      detailUrl.publicUrl,
    );
    if (detail.blocked)
      return {
        status: "blocked",
        blockerReasonCode: "layout_contract_changed",
        error: detail.blocked,
      };
    if (detail.invalid) {
      sourceRecordRefs.push(listing.listingRef);
      invalidSourceRecordRefs.push(listing.listingRef);
      invalidReasonCodes[listing.listingRef] = detail.invalid;
      continue;
    }
    detailUrlsDiscovered += 1;
    if (!detail.response.ok || !detail.response.body)
      return {
        status: "blocked",
        blockerReasonCode: "source_unavailable",
        error: `${source.name} detail returned HTTP ${detail.response.status}`,
      };
    let officialReference;
    try {
      officialReference = validateOfficialReference(
        source,
        detail.publicUrl,
        detail.officialResponse,
      );
    } catch (error) {
      return {
        status: "blocked",
        blockerReasonCode: "official_reference_invalid",
        error: error.message,
      };
    }
    const rawDetail = pointer(detail.response.body, source.detail.dataPointer);
    if (!rawDetail || typeof rawDetail !== "object")
      return {
        status: "blocked",
        blockerReasonCode: "layout_contract_changed",
        error: `${source.name} detail response no longer matches configured pointer`,
      };
    const fixture =
      source.adapterId === "catch-official-listing-v1"
        ? mapCatchDetail(
            rawDetail,
            listing.record,
            detail.publicUrl,
            listing.pageIndex,
            null,
          )
        : mapSisticDetail(
            rawDetail,
            listing.record,
            detail.publicUrl,
            listing.pageIndex,
          );
    const hash = sha(detail.publicUrl),
      responseRef = `raw/${slug}/details/${hash}.response.json`,
      fixtureRef = `raw/${slug}/details/${hash}.json`;
    const officialReferenceRef = `raw/${slug}/details/${hash}.official.json`;
    const retrievedAt = now();
    Object.assign(
      fixture,
      sourceRecordProvenance({
        run,
        source,
        retrievedAt,
        listingRef: listing.listingRef,
        responseRef,
        officialReferenceRef,
        officialReference,
        detailUrl: detail.publicUrl,
      }),
    );
    writeJson(join(runDir, responseRef), detail.response.body);
    writeJson(join(runDir, officialReferenceRef), {
      schemaVersion: "1.0",
      retrievedAt,
      ...officialReference,
      contentHash: sha(
        detail.officialResponse?.text ??
          JSON.stringify(detail.officialResponse?.body ?? null),
      ),
    });
    writeJson(join(runDir, fixtureRef), {
      schemaVersion: "1.0",
      runId: run.runId,
      createdAt: retrievedAt,
      source: source.name,
      counts: { records: 1 },
      records: [fixture],
    });
    artifactRefs.push(responseRef, officialReferenceRef, fixtureRef);
    const recordRef = `${fixtureRef}#/records/0`,
      reason = classifyFixture(fixture, run.window);
    sourceRecordRefs.push(recordRef);
    if (reason) {
      invalidSourceRecordRefs.push(recordRef);
      invalidReasonCodes[recordRef] = reason;
    } else processedSourceRecordRefs.push(recordRef);
  }
  let occurrencesEmitted = 0,
    excludedOccurrences = 0,
    eligiblePreDedup = 0;
  for (const recordRef of processedSourceRecordRefs) {
    const fixtureRef = recordRef.split("#")[0];
    const fixture = JSON.parse(
      await import("node:fs/promises").then(({ readFile }) =>
        readFile(join(runDir, fixtureRef), "utf8"),
      ),
    ).records[0];
    for (const occurrence of fixture.performances.length
      ? fixture.performances
      : [fixture]) {
      occurrencesEmitted += 1;
      const policy = assessActivityInclusion(
        { ...fixture, ...occurrence },
        { asOf: run.window.start },
      );
      const eligible =
        fixture.recordType !== "membership_offer" &&
        policy.eligible &&
        fixture.mode !== "online" &&
        fixture.venue;
      if (eligible) eligiblePreDedup += 1;
      else excludedOccurrences += 1;
    }
  }
  return {
    status: "success",
    counts: {
      pages: pages.length,
      sourceRecordsReceived: providerTotal,
      invalidSourceRecords: invalidSourceRecordRefs.length,
      processedSourceRecords: processedSourceRecordRefs.length,
      occurrencesEmitted,
      excludedOccurrences,
      eligiblePreDedup,
    },
    completion: {
      paginationComplete: true,
      pagesVisited: pages.map(({ ref }) => ref),
      sourceRecordsDiscovered: providerTotal,
      providerReportedTotal: providerTotal,
      providerTotalEvidence: {
        artifactRef: pages[0].ref,
        jsonPointer: source.listing.totalPointer,
      },
      pageRecordCounts: pages.map(({ count }) => count),
      detailUrlsDiscovered,
      detailPagesCaptured: new Set(
        processedSourceRecordRefs.map((ref) => ref.split("#")[0]),
      ).size,
      zeroResultConfirmed: providerTotal === 0,
    },
    sourceRecordRefs,
    invalidSourceRecordRefs,
    processedSourceRecordRefs,
    invalidReasonCodes,
    artifactRefs,
    error: null,
  };
}
