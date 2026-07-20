import { canonicalRenderedUrl } from "./tinyfish-fetch.mjs";
import { normalizeSchedule } from "./activity-policy.mjs";
import {
  clean,
  normalized,
  parseAuthorityDetail,
  sha,
  splitBoundedEntries,
} from "./rendered-adapter-utils.mjs";

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
  return listingRecord?.sourceId
    ? { ...parsed, sourceId: listingRecord.sourceId }
    : parsed;
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
