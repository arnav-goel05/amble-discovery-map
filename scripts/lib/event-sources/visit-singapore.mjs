import { canonicalRenderedUrl } from "./tinyfish-fetch.mjs";
import { normalizeSchedule } from "./activity-policy.mjs";
import {
  clean,
  normalized,
  parseAuthorityDetail,
  renderedDocument,
  sha,
  splitBoundedEntries,
} from "./rendered-adapter-utils.mjs";
import { applyEventFieldCompleteness } from "./event-field-extraction.mjs";

const STRUCTURAL_LOCATION =
  /^(?:venue|location|status|event name|event date(?:\s*&\s*time)?|find tickets|venue description|venue\s*&\s*accessibility)$/i;

function layoutLine(value) {
  return clean(
    String(value ?? "")
      .replace(/^\s{0,3}#{1,6}\s*/, "")
      .replace(/^\s*[-*+]\s+/, "")
      .replace(/^\*{1,2}|\*{1,2}$/g, ""),
  );
}

function comparable(value) {
  return normalized(value)
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}

function dateLike(value) {
  return /\b(?:\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2})\b[^\n]*\b20\d{2}\b/i.test(
    value ?? "",
  );
}

const VISIT_MONTHS = new Map([
  ["jan", "01"],
  ["feb", "02"],
  ["mar", "03"],
  ["apr", "04"],
  ["may", "05"],
  ["jun", "06"],
  ["jul", "07"],
  ["aug", "08"],
  ["sep", "09"],
  ["oct", "10"],
  ["nov", "11"],
  ["dec", "12"],
]);

function structuredVisitPerformance(value) {
  const match = clean(value)?.match(
    /\b(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(20\d{2})(?:\s*\([^)]*\))?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i,
  );
  if (!match) return null;
  const month = VISIT_MONTHS.get(match[2].slice(0, 3).toLowerCase());
  const day = match[1].padStart(2, "0");
  let hour = Number(match[4]);
  const minute = Number(match[5] ?? 0);
  const meridiem = match[6].toLowerCase();
  if (!month || hour < 1 || hour > 12 || minute > 59) return null;
  if (hour === 12) hour = 0;
  if (meridiem === "pm") hour += 12;
  const date = `${match[3]}-${month}-${day}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (
    parsed.getUTCFullYear() !== Number(match[3]) ||
    parsed.getUTCMonth() + 1 !== Number(month) ||
    parsed.getUTCDate() !== Number(day)
  )
    return null;
  const timeText = `${Number(match[4])}:${String(minute).padStart(2, "0")} ${meridiem}`;
  return {
    startDateTime: `${date}T${String(hour).padStart(2, "0")}:${String(
      minute,
    ).padStart(2, "0")}:00+08:00`,
    endDateTime: null,
    dateText: `${Number(match[1])} ${match[2]} ${match[3]}`,
    timeText,
  };
}

function usableLayoutVenue(value) {
  const venue = layoutLine(value);
  return venue && !STRUCTURAL_LOCATION.test(venue) ? venue : null;
}

function addressLike(value) {
  const address = layoutLine(value);
  return address &&
    (/\bSingapore\b/i.test(address) || /\b\d{6}\b/.test(address)) &&
    /\d/.test(address)
    ? address
    : null;
}

function structuredVisitLocation(result, detailUrl, listingRecord) {
  const document = renderedDocument(result);
  const lines = document.text.split("\n").map(layoutLine).filter(Boolean);
  const expectedTitle = clean(listingRecord?.title);
  const expected = comparable(expectedTitle);

  // Some authoritative ticket pages expose a labelled table rather than
  // inline `Venue: value` fields. Require the complete ordered header and an
  // exact row-title match so a column label can never become the venue.
  for (let index = 0; index <= lines.length - 8; index += 1) {
    if (
      !/^event date\s*&\s*time$/i.test(lines[index]) ||
      !/^event name$/i.test(lines[index + 1]) ||
      !/^venue$/i.test(lines[index + 2]) ||
      !/^status$/i.test(lines[index + 3])
    )
      continue;
    for (let row = index + 4; row <= lines.length - 3; row += 1) {
      if (!dateLike(lines[row])) continue;
      if (!expected || comparable(lines[row + 1]) !== expected) continue;
      const venue = usableLayoutVenue(lines[row + 2]);
      if (venue)
        return {
          venue,
          address: null,
          dateText: lines[row],
          performance: structuredVisitPerformance(lines[row]),
          layout: "table",
        };
    }
  }

  // VisitSingapore's own event pages commonly render an ordered summary:
  // exact event title, date, venue, then optional Singapore address.
  let isVisitSingapore = false;
  try {
    const hostname = new URL(detailUrl).hostname.toLowerCase();
    isVisitSingapore =
      hostname === "visitsingapore.com" ||
      hostname.endsWith(".visitsingapore.com");
  } catch {
    isVisitSingapore = false;
  }
  if (!isVisitSingapore || !expected) return null;
  for (let index = 0; index <= Math.min(lines.length - 3, 20); index += 1) {
    if (comparable(lines[index]) !== expected || !dateLike(lines[index + 1]))
      continue;
    const venue = usableLayoutVenue(lines[index + 2]);
    if (!venue) continue;
    return {
      venue,
      address: addressLike(lines[index + 3]),
      dateText: lines[index + 1],
      layout: "event_summary",
    };
  }
  return null;
}

function genericDocumentTitle(value) {
  return /^(?:home|events?|what(?:'s| is) happening)(?:\s*[|\-–—].*)?$/i.test(
    clean(value) ?? "",
  );
}

function decodeHtml(value) {
  return String(value ?? "").replace(
    /&#(x?[0-9a-f]+);|&([a-z]+);/gi,
    (match, numeric, named) => {
      if (numeric)
        return String.fromCodePoint(
          Number.parseInt(
            numeric.replace(/^x/i, ""),
            /^x/i.test(numeric) ? 16 : 10,
          ),
        );
      return (
        {
          amp: "&",
          apos: "'",
          gt: ">",
          hellip: "…",
          ldquo: "“",
          lsquo: "‘",
          lt: "<",
          mdash: "—",
          nbsp: " ",
          ndash: "–",
          quot: '"',
          rdquo: "”",
          rsquo: "’",
        }[named.toLowerCase()] ?? match
      );
    },
  );
}

function plainText(value) {
  return clean(
    decodeHtml(
      String(value ?? "")
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " "),
    ),
  );
}

function isoDate(value) {
  const match = clean(value)?.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return match ? `${match[3]}-${match[1]}-${match[2]}` : null;
}

function venueFromCard(title, description) {
  const locationState = `${title ?? ""} ${description ?? ""}`;
  if (
    /\b(?:secret venue|venue (?:tba|to be announced)|location (?:tba|to be announced))\b/i.test(
      locationState,
    )
  )
    return "Venue to be announced";
  if (/\b(?:multiple|various) (?:venues|locations)\b/i.test(locationState))
    return "Multiple locations";
  return (
    clean(title)
      ?.match(/\s+at\s+([^.!?]+)$/i)?.[1]
      ?.trim() ?? null
  );
}

function embeddedCards(result) {
  const html =
    typeof result?.text === "string"
      ? result.text
      : typeof result?.document?.text === "string"
        ? result.document.text
        : "";
  const match = html.match(
    /<stb-event-and-festivals\b[^>]*\baem-data\s*=\s*(["'])([\s\S]*?)\1/i,
  );
  if (!match) return [];
  try {
    const data = JSON.parse(decodeHtml(match[2]));
    return Array.isArray(data.cardmultifield) ? data.cardmultifield : [];
  } catch {
    return [];
  }
}

function cardRecord(card, source, listingUrl, index) {
  const title = clean(card.cardTitle_t ?? card.cardTitle),
    description = plainText(card.cardDescription_t ?? card.cardDescription);
  const dateText = clean(card.eventFormattedDate),
    start = isoDate(card.eventStartDate),
    end = isoDate(card.eventEndDate) ?? start;
  const outboundUrl = clean(card.ctaUrl);
  let identityUrl = outboundUrl;
  try {
    identityUrl = canonicalRenderedUrl(outboundUrl);
  } catch {
    identityUrl = outboundUrl;
  }
  const edition =
    start?.slice(0, 4) ?? dateText?.match(/\b(20\d{2})\b/)?.[1] ?? "undated";
  const sourceId = `visit-singapore-card:${sha(`${identityUrl ?? normalized(title)}\n${edition}`).slice(0, 24)}`;
  const venue = venueFromCard(title, description);
  const scheduleKind =
    start && end && start !== end ? "range" : start ? "exact" : "unverified";
  const startDateTime = start ? `${start}T00:00:00+08:00` : null,
    endDateTime = end ? `${end}T23:59:59+08:00` : null;
  return {
    adapterVersion: source.version,
    listingPage: 1,
    detailUrl: listingUrl,
    outboundUrl,
    sourceId,
    title,
    mode: venue ? "physical" : "unknown",
    dateText,
    timeText: null,
    venue,
    address: null,
    sourceCoordinates: null,
    category: Array.isArray(card.cardPillCategory)
      ? card.cardPillCategory.map(clean).filter(Boolean).join(", ")
      : clean(card.cardPillCategory),
    price: null,
    description,
    organizer: null,
    performances: start
      ? [{ startDateTime, endDateTime, dateText, timeText: null }]
      : [],
    schedule: normalizeSchedule({
      kind: scheduleKind,
      start: startDateTime,
      end: endDateTime,
      sessionRefs: start ? [`${listingUrl}#${sourceId}`] : [],
      displayText: dateText,
    }),
    availability: "unknown",
    accessRestriction: null,
    recordType: "event",
    reasonCode: null,
    rawDocumentHash: sha(JSON.stringify({ card, index })),
  };
}

function parseVisitDetail(
  result,
  source,
  detailUrl,
  { listingRecord = null } = {},
) {
  const document = renderedDocument(result);
  const parsed = parseAuthorityDetail(result, {
    source,
    detailUrl,
    listingRecord,
    classify: ({ title, dateText, document }) => {
      const text = normalized(`${title} ${document.text}`);
      if (/\bpast event\b|\bwhat happened in\b/.test(text) && !dateText)
        return "expired";
      return null;
    },
  });
  const structured = structuredVisitLocation(result, detailUrl, listingRecord);
  const useListingTitle =
    listingRecord?.title &&
    genericDocumentTitle(document.title ?? parsed.title);
  const listingFallbackFields = new Set(parsed.listingFallbackFields ?? []);
  if (useListingTitle) listingFallbackFields.add("title");
  const venue = parsed.venue ?? structured?.venue ?? null;
  const address = parsed.address ?? structured?.address ?? null;
  const performance = structured?.performance ?? null;
  const repaired = {
    ...parsed,
    ...(listingRecord?.sourceId ? { sourceId: listingRecord.sourceId } : {}),
    title: useListingTitle ? listingRecord.title : parsed.title,
    dateText: performance?.dateText ?? parsed.dateText,
    timeText: performance?.timeText ?? parsed.timeText,
    venue,
    address,
    performances: performance ? [performance] : parsed.performances,
    schedule: performance
      ? normalizeSchedule({
          kind: "exact",
          start: performance.startDateTime,
          end: performance.endDateTime,
          sessionRefs: [`${detailUrl}#session-1`],
          displayText: `${performance.dateText} · ${performance.timeText}`,
        })
      : parsed.schedule,
    mode:
      parsed.mode === "unknown" && (venue || address)
        ? "physical"
        : parsed.mode,
    listingFallbackFields: [...listingFallbackFields].sort(),
  };
  if (!performance) return repaired;
  return applyEventFieldCompleteness(repaired, {
    evidenceHash: parsed.rawDocumentHash,
    methods: Object.fromEntries(
      Object.entries(parsed.fieldCompleteness ?? {}).flatMap(
        ([field, assessment]) =>
          assessment?.method ? [[field, assessment.method]] : [],
      ),
    ),
  });
}

export const visitSingaporeAdapter = {
  id: "visit-singapore-rendered-v1",
  listing(result, source, url = source.listing.url) {
    const records = embeddedCards(result)
      .map((card, index) => cardRecord(card, source, url, index))
      .filter(({ sourceId, title }) => sourceId && title);
    const detailItems = [],
      inlineRecords = [];
    for (const record of records) {
      try {
        const outboundUrl = canonicalRenderedUrl(record.outboundUrl);
        detailItems.push({
          url: outboundUrl,
          record: { ...record, outboundUrl },
          referenceKind: "authoritative_listing_outbound",
        });
      } catch {
        inlineRecords.push(record);
      }
    }
    return {
      detailUrls: [],
      detailItems,
      records: inlineRecords,
      appearances: records.length,
      complete: true,
      nextUrl: null,
      evidence: records.length
        ? "embedded_event_cards"
        : "embedded_event_cards_missing",
      zeroResultConfirmed: false,
    };
  },
  detail: parseVisitDetail,
  details(result, source, detailUrl, { listingRecord = null } = {}) {
    if (listingRecord)
      return [parseVisitDetail(result, source, detailUrl, { listingRecord })];
    const entries = splitBoundedEntries(result);
    if (!entries.length) return [parseVisitDetail(result, source, detailUrl)];
    const parsed = entries
      .map(({ itemKey, result: entry }) => ({
        ...parseVisitDetail(entry, source, detailUrl),
        itemKey,
        sourceId: `${new URL(detailUrl).pathname}#${itemKey}`,
      }))
      .filter(({ dateText, venue }) => dateText && venue);
    return parsed.length
      ? parsed
      : [parseVisitDetail(result, source, detailUrl)];
  },
};
