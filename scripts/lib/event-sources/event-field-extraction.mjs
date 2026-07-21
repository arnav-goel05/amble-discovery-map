import { createHash } from "node:crypto";

export const EVENT_FIELD_CONTRACT_VERSION = "1.0";
export const EVENT_FIELDS = Object.freeze([
  "title",
  "schedule",
  "venue",
  "address",
  "description",
  "category",
  "price",
  "organizer",
  "availability",
  "url",
]);

const sha = (value) => createHash("sha256").update(String(value)).digest("hex");
const clean = (value) => {
  if (value === null || value === undefined) return null;
  const parsed = String(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
  return parsed || null;
};
const values = (value) => (Array.isArray(value) ? value : value == null ? [] : [value]);

function typed(value, name) {
  return values(value?.["@type"])
    .map(String)
    .some((item) => item.toLowerCase().endsWith(name.toLowerCase()));
}

function embeddedJsonLd(html) {
  const output = [];
  for (const match of String(html ?? "").matchAll(
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json[^"']*["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      output.push(JSON.parse(match[1].trim()));
    } catch {
      // A malformed block remains visible through parser warnings; other blocks still apply.
    }
  }
  return output;
}

function allObjects(input) {
  const queue = [...values(input)];
  const output = [];
  while (queue.length) {
    const value = queue.shift();
    if (Array.isArray(value)) {
      queue.push(...value);
      continue;
    }
    if (!value || typeof value !== "object") continue;
    output.push(value);
    if (value["@graph"]) queue.push(...values(value["@graph"]));
  }
  return output;
}

function selectJsonLdEvent(blocks) {
  return allObjects(blocks)
    .filter((item) => typed(item, "Event"))
    .sort(
      (a, b) =>
        [b.name, b.startDate, b.location, b.organizer, b.offers].filter(Boolean).length -
        [a.name, a.startDate, a.location, a.organizer, a.offers].filter(Boolean).length,
    )[0] ?? null;
}

function addressText(address) {
  if (typeof address === "string") return clean(address);
  return clean(
    [
      address?.streetAddress,
      address?.addressLocality,
      address?.addressRegion,
      address?.postalCode,
      address?.addressCountry,
    ]
      .filter(Boolean)
      .join(", "),
  );
}

function named(value) {
  if (typeof value === "string") return clean(value);
  return clean(value?.name);
}

function jsonLdFields(event) {
  if (!event) return {};
  const locations = values(event.location)
    .map((location) => ({
      venue: named(location),
      address: addressText(location?.address),
      coordinates:
        location?.geo?.latitude != null && location?.geo?.longitude != null
          ? {
              latitude: Number(location.geo.latitude),
              longitude: Number(location.geo.longitude),
            }
          : null,
    }))
    .filter(({ venue, address }) => venue || address);
  const location = values(event.location)[0];
  const offer = values(event.offers)[0];
  const price = offer?.price ?? offer?.lowPrice;
  const currency = offer?.priceCurrency;
  const availabilityText = clean(offer?.availability ?? event.eventStatus)?.toLowerCase() ?? "";
  const availability = /soldout|eventcancelled|discontinued/.test(availabilityText)
    ? "sold_out"
    : /preorder|waitlist|limitedavailability/.test(availabilityText)
      ? "waitlist"
      : /instock|eventscheduled|available/.test(availabilityText)
        ? "available"
        : null;
  const category = values(event.keywords ?? event.eventType)
    .flatMap((item) => (typeof item === "string" ? item.split(/\s*,\s*/) : []))
    .map(clean)
    .filter(Boolean);
  return {
    title: clean(event.name),
    schedule:
      event.startDate || event.endDate
        ? { start: clean(event.startDate), end: clean(event.endDate) }
        : null,
    venue: locations.length > 1 ? "Multiple locations" : locations[0]?.venue ?? null,
    address: locations.length > 1 ? null : locations[0]?.address ?? null,
    description: clean(event.description),
    category: category.length ? category : null,
    price: price == null ? null : clean([currency, price].filter(Boolean).join(" ")),
    organizer: named(event.organizer ?? event.performer),
    availability,
    url: clean(event.url ?? offer?.url),
    coordinates:
      locations.length === 1 &&
      location?.geo?.latitude != null &&
      location?.geo?.longitude != null
        ? {
            latitude: Number(location.geo.latitude),
            longitude: Number(location.geo.longitude),
          }
        : null,
    attendanceMode: clean(event.eventAttendanceMode),
    locations,
  };
}

function itemprop(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const meta = html.match(
    new RegExp(`<(?:meta|link|time)\\b[^>]*itemprop=["'][^"']*\\b${escaped}\\b[^"']*["'][^>]*(?:content|href|datetime)=["']([^"']+)["'][^>]*>`, "i"),
  ) ?? html.match(
    new RegExp(`<(?:meta|link|time)\\b[^>]*(?:content|href|datetime)=["']([^"']+)["'][^>]*itemprop=["'][^"']*\\b${escaped}\\b[^"']*["'][^>]*>`, "i"),
  );
  if (meta?.[1]) return clean(meta[1]);
  const element = html.match(
    new RegExp(`<([a-z0-9]+)\\b[^>]*itemprop=["'][^"']*\\b${escaped}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`, "i"),
  );
  return clean(element?.[2]);
}

function microdataFields(html) {
  if (!/itemtype=["'][^"']*schema\.org\/(?:[A-Za-z]*Event)\b/i.test(html)) return {};
  const locationBlock = html.match(
    /<([a-z0-9]+)\b[^>]*itemprop=["'][^"']*\blocation\b[^"']*["'][^>]*>([\s\S]*?)<\/\1>/i,
  )?.[2] ?? "";
  const organizerBlock = html.match(
    /<([a-z0-9]+)\b[^>]*itemprop=["'][^"']*\borganizer\b[^"']*["'][^>]*>([\s\S]*?)<\/\1>/i,
  )?.[2] ?? "";
  const start = itemprop(html, "startDate");
  const end = itemprop(html, "endDate");
  return {
    title: itemprop(html, "name"),
    schedule: start || end ? { start, end } : null,
    venue: itemprop(locationBlock, "name"),
    address: itemprop(locationBlock, "address"),
    description: itemprop(html, "description"),
    category: itemprop(html, "eventType") ?? itemprop(html, "keywords"),
    price: itemprop(html, "price"),
    organizer: itemprop(organizerBlock, "name"),
    availability: itemprop(html, "availability"),
    url: itemprop(html, "url"),
  };
}

function canonicalFromHtml(html, finalUrl) {
  const href = html.match(/<link\b[^>]*rel=["'][^"']*canonical[^"']*["'][^>]*href=["']([^"']+)["']/i)?.[1]
    ?? html.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["'][^"']*canonical[^"']*["']/i)?.[1];
  try {
    return new URL(href ?? finalUrl, finalUrl).href;
  } catch {
    return clean(finalUrl);
  }
}

export function extractEventPageEvidence({ html = "", jsonLd = [], finalUrl = null } = {}) {
  const blocks = [...values(jsonLd), ...embeddedJsonLd(html)];
  const event = selectJsonLdEvent(blocks);
  const json = jsonLdFields(event);
  const micro = microdataFields(String(html ?? ""));
  const fields = {};
  const methods = {};
  const conflicts = [];
  for (const field of EVENT_FIELDS) {
    if (
      json[field] !== null && json[field] !== undefined &&
      micro[field] !== null && micro[field] !== undefined &&
      JSON.stringify(json[field]) !== JSON.stringify(micro[field])
    ) {
      conflicts.push({
        field,
        preferred: { method: "json_ld", value: json[field] },
        alternative: { method: "microdata", value: micro[field] },
      });
    }
    const value = json[field] ?? micro[field] ?? (field === "url" ? canonicalFromHtml(html, finalUrl) : null);
    if (value !== null && value !== undefined && !(Array.isArray(value) && !value.length)) {
      fields[field] = value;
      methods[field] = json[field] != null ? "json_ld" : micro[field] != null ? "microdata" : "canonical";
    } else fields[field] = null;
  }
  return {
    fields,
    methods,
    event,
    jsonLd: blocks,
    coordinates: json.coordinates ?? null,
    attendanceMode: json.attendanceMode ?? null,
    locations: json.locations ?? [],
    conflicts,
    warnings: [
      ...(blocks.length && !event ? ["structured_event_not_found"] : []),
      ...conflicts.map(({ field }) => `structured_conflict:${field}`),
    ],
  };
}

function hasValue(record, field) {
  if (field === "schedule")
    return Boolean(
      record.schedule?.start || record.schedule?.end || record.schedule?.displayText ||
      record.dateText || record.startDateTime || record.performances?.length,
    );
  if (field === "url") return Boolean(record.detailUrl ?? record.eventUrl ?? record.officialUrl);
  const value = record[field];
  if (field === "availability" && (!value || value === "unknown")) return false;
  return value !== null && value !== undefined && value !== "" && (!Array.isArray(value) || value.length > 0);
}

export function applyEventFieldCompleteness(
  record,
  {
    evidenceHash = sha(JSON.stringify(record)),
    methods = {},
    extractionFailed = false,
    evidenceRef = null,
    contractVersion = EVENT_FIELD_CONTRACT_VERSION,
    previousCompleteness = record?.fieldCompleteness ?? null,
  } = {},
) {
  const fieldCompleteness = {};
  for (const field of EVENT_FIELDS) {
    const present = hasValue(record, field);
    const failed = extractionFailed && !present && field !== "url";
    const status = present
      ? "present"
      : failed
        ? "extraction_failed"
        : "not_published_by_source";
    const previous = previousCompleteness?.[field];
    if (
      previous?.status === status &&
      status !== "extraction_failed" &&
      previous.evidenceHash === evidenceHash &&
      previous.contractVersion === contractVersion
    ) {
      fieldCompleteness[field] = previous;
      continue;
    }
    fieldCompleteness[field] = {
      status,
      evidenceHash,
      contractVersion,
      method: present
        ? (methods[field] ?? previous?.method ?? "source_adapter")
        : null,
      evidenceRef: evidenceRef ?? previous?.evidenceRef ?? null,
      reasonCode: present ? null : failed ? "field_extraction_failed" : "field_not_published",
    };
  }
  return { ...record, fieldCompleteness, extractionContractVersion: contractVersion };
}
