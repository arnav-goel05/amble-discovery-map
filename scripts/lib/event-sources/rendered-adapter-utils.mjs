import { createHash } from "node:crypto";
import { canonicalRenderedUrl } from "./tinyfish-fetch.mjs";
import { normalizeSchedule } from "./activity-policy.mjs";

export const sha = (value) => createHash("sha256").update(value).digest("hex");
export const clean = (value) =>
  typeof value === "string" && value.trim()
    ? value.replace(/\s+/g, " ").trim()
    : null;
export const array = (value) => (Array.isArray(value) ? value : []);
export const normalized = (value) =>
  clean(value)?.normalize("NFKC").toLocaleLowerCase("en-SG") ?? "";

export function decodeHtml(value) {
  return value.replace(
    /&#(x?[0-9a-f]+);|&([a-z]+);/gi,
    (_match, numeric, named) => {
      if (numeric)
        return String.fromCodePoint(
          Number.parseInt(
            numeric.replace(/^x/i, ""),
            /^x/i.test(numeric) ? 16 : 10,
          ),
        );
      return (
        { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"' }[
          named.toLowerCase()
        ] ?? _match
      );
    },
  );
}

export function readableText(value) {
  if (typeof value !== "string") return "";
  const withStructure = /<[^>]+>/.test(value)
    ? value
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "\n")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "\n")
        .replace(/<\/(?:p|li|h[1-6]|div|section|article)>|<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
    : value;
  return decodeHtml(withStructure)
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function markdownLinks(text) {
  const links = [];
  for (const match of text.matchAll(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]+)\)/g,
  ))
    links.push({ url: match[2], text: clean(match[1]) });
  return links;
}

export function renderedDocument(result) {
  const document =
    result?.document ?? result?.data ?? result?.content ?? result ?? {};
  if (typeof document === "string")
    return { title: null, text: document, links: [] };
  const text = readableText(
    document.markdown ??
      document.text ??
      document.content ??
      result?.markdown ??
      result?.text,
  );
  const links = [
    ...markdownLinks(text),
    ...array(document.links ?? result?.links).map((link) =>
      typeof link === "string"
        ? { url: link, text: null }
        : { url: link.url ?? link.href, text: clean(link.text ?? link.label) },
    ),
  ].filter(({ url }) => url);
  const dedupedLinks = [
    ...new Map(
      links.map((link) => [`${link.url}\u0000${link.text ?? ""}`, link]),
    ).values(),
  ];
  return {
    title: clean(document.title ?? result?.title),
    text,
    links: dedupedLinks,
    jsonLd: array(document.jsonLd ?? document.json_ld ?? result?.jsonLd),
    fields: document.fields ?? result?.fields ?? {},
    finalUrl: result?.final_url ?? result?.finalUrl ?? result?.url ?? null,
  };
}

export function splitBoundedEntries(result) {
  const document = renderedDocument(result);
  const headings = [...document.text.matchAll(/^##\s+(.+)$/gm)];
  if (headings.length < 2) return [];
  return headings
    .map((heading, index) => {
      const start = heading.index + heading[0].length;
      const end = headings[index + 1]?.index ?? document.text.length;
      const title = clean(heading[1]);
      const text = document.text.slice(start, end).trim();
      const itemKey = `${normalized(title)
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 60)}-${sha(`${title}\n${text}`).slice(0, 10)}`;
      return {
        itemKey,
        result: { url: document.finalUrl, title, text, links: document.links },
      };
    })
    .filter(({ result: entry }) => entry.title && entry.text);
}

export function canonicalLinks(
  result,
  { baseUrl, pathPattern, sameHost = true },
) {
  const base = new URL(baseUrl),
    pattern = new RegExp(pathPattern);
  return [
    ...new Set(
      renderedDocument(result).links.flatMap(({ url }) => {
        try {
          const value = canonicalRenderedUrl(new URL(url, base).href);
          const parsed = new URL(value);
          if (
            /%(?:5b|7b)|%(?:5d|7d)/i.test(parsed.pathname) ||
            /\[(?:[^\]]+)\]|\{(?:[^}]+)\}/.test(
              decodeURIComponent(parsed.pathname),
            )
          )
            return [];
          return (!sameHost || parsed.hostname === base.hostname) &&
            pattern.test(parsed.pathname)
            ? [value]
            : [];
        } catch {
          return [];
        }
      }),
    ),
  ].sort();
}

export function field(document, names) {
  const usable = (value) => {
    const parsed = clean(value == null ? null : String(value));
    if (!parsed || !/[\p{L}\p{N}]/u.test(parsed)) return null;
    if (/^[\p{L}][\p{L} ]{1,30}:\*{0,2}(?:\s|$)/u.test(parsed)) return null;
    return parsed;
  };
  for (const name of names) {
    const direct =
      document.fields?.[name] ?? document.fields?.[name.toLowerCase()];
    const directValue = usable(direct);
    if (directValue) return directValue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = document.text.match(
      new RegExp(
        `(?:^|\\n)[^\\p{L}\\p{N}\\n]{0,12}${escaped}(?:\\s*(?:&|and)\\s*(?:time|date))?[^\\p{L}\\p{N}\\n]{1,12}([^\\n]+)`,
        "iu",
      ),
    );
    const matchedValue = usable(match?.[1]);
    if (matchedValue) return matchedValue;
  }
  return null;
}

function jsonLdEvent(document) {
  const queue = [...document.jsonLd];
  while (queue.length) {
    const value = queue.shift();
    if (Array.isArray(value)) {
      queue.push(...value);
      continue;
    }
    if (!value || typeof value !== "object") continue;
    if (value["@graph"]) queue.push(...array(value["@graph"]));
    const type = array(value["@type"])
      .concat(value["@type"] ?? [])
      .map(String);
    if (type.some((item) => /event/i.test(item))) return value;
  }
  return null;
}

const locationFields = (event) => {
  const location = Array.isArray(event?.location)
    ? event.location[0]
    : event?.location;
  const address =
    typeof location?.address === "string"
      ? location.address
      : [
          location?.address?.streetAddress,
          location?.address?.addressLocality,
          location?.address?.postalCode,
        ]
          .filter(Boolean)
          .join(", ");
  return { venue: clean(location?.name), address: clean(address) };
};

function inferredVenue(document) {
  if (
    /\b(?:secret (?:venue|location)|venue (?:tba|to be announced)|location (?:tba|to be announced))\b/i.test(
      document.text,
    )
  )
    return "Venue to be announced";
  if (
    /(?:^|\n)Locations?\s*\n\s*[-*]\s*[^\n]+\n\s*[-*]\s*[^\n]+/i.test(
      document.text,
    )
  )
    return "Multiple locations";
  return clean(
    document.text.match(
      /(?:^|\n)[^\p{L}\p{N}\n]{0,12}Starting point[^\p{L}\p{N}\n]{1,12}([^\n]+)/iu,
    )?.[1],
  );
}

export function parseAuthorityDetail(
  result,
  {
    source,
    detailUrl,
    classify = () => null,
    performanceBuilder = null,
    listingRecord = null,
  },
) {
  const document = renderedDocument(result),
    event = jsonLdEvent(document),
    location = locationFields(event);
  const calendarLine = document.text.match(
    /^(?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+)?(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}(?:[^\n]*)$/im,
  )?.[0];
  const scheduleVenue = calendarLine
    ? document.text.match(
        new RegExp(
          `${calendarLine.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\n([^\\n]+)`,
        ),
      )?.[1]
    : null;
  const listingFallbackFields = [];
  const withListingFallback = (value, key) => {
    const parsed = clean(value == null ? null : String(value));
    if (parsed) return parsed;
    const fallback = clean(
      listingRecord?.[key] == null ? null : String(listingRecord[key]),
    );
    if (fallback) listingFallbackFields.push(key);
    return fallback;
  };
  const title = withListingFallback(
    event?.name ?? document.title ?? field(document, ["Event", "Title"]),
    "title",
  );
  const dateText = withListingFallback(
    event?.startDate ??
      field(document, ["Date", "Dates", "When"]) ??
      calendarLine,
    "dateText",
  );
  const timeText = withListingFallback(
    field(document, ["Time", "Times"]),
    "timeText",
  );
  const venue = withListingFallback(
    location.venue ??
      field(document, [
        "Venue",
        "Location",
        "Meeting point",
        "Starting point",
      ]) ??
      scheduleVenue ??
      inferredVenue(document),
    "venue",
  );
  const address = withListingFallback(
    location.address ?? field(document, ["Address"]),
    "address",
  );
  const organizerValue =
    typeof event?.organizer === "object"
      ? event.organizer.name
      : event?.organizer;
  const modeText = normalized(
    event?.eventAttendanceMode ?? field(document, ["Mode", "Format"]),
  );
  const mode =
    modeText.includes("online") &&
    !modeText.includes("mixed") &&
    !modeText.includes("hybrid")
      ? "online"
      : modeText.includes("mixed") || modeText.includes("hybrid")
        ? "hybrid"
        : venue
          ? "physical"
          : "unknown";
  const basePerformance =
    event?.startDate || event?.endDate
      ? [
          {
            startDateTime: clean(event.startDate),
            endDateTime: clean(event.endDate),
            dateText,
            timeText,
          },
        ]
      : [];
  const performances = performanceBuilder
    ? performanceBuilder({
        document,
        event,
        dateText,
        timeText,
        basePerformance,
      })
    : basePerformance;
  const scheduleText = clean([dateText, timeText].filter(Boolean).join(" · "));
  const selectorText = normalized(`${dateText ?? ""} ${document.text}`);
  const scheduleKind =
    /\b(?:select|choose) (?:a |your )?(?:date|dates|time)|ticket selector\b/.test(
      selectorText,
    )
      ? "selectable"
      : /\b(?:anytime|by appointment|open[ -]ended)\b/.test(selectorText)
        ? "anytime"
        : performances.length > 1
          ? "selectable"
          : dateText
            ? /\b(?:every|weekly|monthly|daily)\b/i.test(dateText)
              ? "recurring"
              : /\bto\b|\s[-–]\s/.test(dateText)
                ? "range"
                : "exact"
            : "unverified";
  const schedule = normalizeSchedule({
    kind: scheduleKind,
    start: clean(event?.startDate),
    end: clean(event?.endDate),
    sessionRefs: performances.map(
      (_, index) => `${detailUrl}#session-${index + 1}`,
    ),
    displayText: scheduleText,
  });
  const availability = /\bwaitlist\b/.test(selectorText)
    ? "waitlist"
    : /\bsold out\b/.test(selectorText)
      ? "sold_out"
      : "unknown";
  const accessRestriction = /\bmembers? only\b|\bmembership required\b/.test(
    selectorText,
  )
    ? "members_only"
    : null;
  const reasonCode = classify({
    title,
    dateText,
    timeText,
    venue,
    address,
    mode,
    document,
    event,
    performances,
    schedule,
    availability,
    accessRestriction,
  });
  const category = withListingFallback(
    event?.eventType ?? field(document, ["Category", "Type"]),
    "category",
  );
  const price = withListingFallback(
    event?.offers?.price ?? field(document, ["Price", "Admission"]),
    "price",
  );
  const description = withListingFallback(
    event?.description ?? field(document, ["Description"]),
    "description",
  );
  const organizer = withListingFallback(
    organizerValue ?? field(document, ["Organizer", "Presented by"]),
    "organizer",
  );
  return {
    adapterVersion: source.version,
    listingPage: 1,
    detailUrl,
    sourceId: clean(event?.identifier ?? new URL(detailUrl).pathname),
    title,
    mode,
    dateText,
    timeText,
    venue,
    address,
    sourceCoordinates: null,
    category,
    price,
    description,
    organizer,
    performances,
    schedule,
    availability,
    accessRestriction,
    recordType: "event",
    reasonCode,
    rawDocumentHash: sha(JSON.stringify(document)),
    listingFallbackFields: listingFallbackFields.sort(),
  };
}

export function terminalPagination(
  result,
  { baseUrl, nextLabels = ["next", "load more"] } = {},
) {
  const document = renderedDocument(result);
  const next = document.links.find((link) =>
    nextLabels.some((label) => normalized(link.text).includes(label)),
  );
  const zeroResultConfirmed =
    /(?:no|zero) (?:upcoming )?(?:events?|programmes?|screenings?) (?:were |are )?found|there are (?:currently )?no (?:events?|programmes?|screenings?)/i.test(
      document.text,
    );
  if (!next?.url)
    return {
      complete: true,
      nextUrl: null,
      evidence: zeroResultConfirmed ? "explicit_zero_results" : "no_next_link",
      zeroResultConfirmed,
    };
  try {
    return {
      complete: false,
      nextUrl: canonicalRenderedUrl(new URL(next.url, baseUrl).href),
      evidence: "visible_next_link",
    };
  } catch {
    return { complete: false, nextUrl: null, evidence: "invalid_next_link" };
  }
}
