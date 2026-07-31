import {
  canonicalLinks,
  clean,
  field,
  normalized,
  renderedDocument,
  sha,
  terminalPagination,
} from "./rendered-adapter-utils.mjs";
import { applyEventFieldCompleteness } from "./event-field-extraction.mjs";

export function discoveryListing(result, source, url = source.listing.url) {
  return {
    detailUrls: canonicalLinks(result, {
      baseUrl: url,
      pathPattern: source.listing.detailPathPattern,
    }),
    ...terminalPagination(result, { baseUrl: url }),
  };
}

export function parseDiscoveryDetail(
  result,
  source,
  detailUrl,
  {
    classify = () => null,
    roundupParentId = null,
    itemKey = null,
    listingRecord = null,
  } = {},
) {
  const document = renderedDocument(result);
  const structured = document.structured ?? { fields: {}, methods: {} };
  const labels = source.confirmation.outboundLabels.map(normalized);
  const labelled = document.links.filter((link) =>
    labels.some(
      (label) =>
        normalized(link.text) === label ||
        normalized(link.text).includes(label),
    ),
  );
  const candidates = labelled.length
    ? labelled
    : document.links.filter((link) => {
        try {
          return (
            new URL(link.url, detailUrl).hostname !==
            new URL(detailUrl).hostname
          );
        } catch {
          return false;
        }
      });
  const outboundLinks = candidates.map((link) => ({
    url: new URL(link.url, detailUrl).href,
    text: link.text,
    rawPointer: `rendered:${sha(`${link.url}:${link.text}`)}`,
  }));
  const claims = {
    title: clean(
      structured.fields.title ??
        document.title ??
        field(document, ["Title", "Event"]) ??
        listingRecord?.title,
    ),
    dateText:
      structured.fields.schedule?.start ??
      field(document, ["Date", "Dates", "When"]) ??
      clean(listingRecord?.dateText),
    timeText:
      field(document, ["Time", "Times"]) ?? clean(listingRecord?.timeText),
    venue:
      structured.fields.venue ??
      field(document, ["Venue", "Location", "Address"]) ??
      clean(listingRecord?.venue),
    address:
      structured.fields.address ??
      field(document, ["Address"]) ??
      clean(listingRecord?.address),
    description:
      structured.fields.description ??
      field(document, ["Description"]) ??
      clean(listingRecord?.description),
    category:
      structured.fields.category ??
      field(document, ["Category", "Type"]) ??
      listingRecord?.category ??
      null,
    price:
      structured.fields.price ??
      field(document, ["Price", "Admission"]) ??
      clean(listingRecord?.price),
    organizer:
      structured.fields.organizer ??
      field(document, ["Organizer", "Presented by"]) ??
      clean(listingRecord?.organizer),
    availability:
      structured.fields.availability ??
      clean(listingRecord?.availability) ??
      "unknown",
    url: structured.fields.url ?? detailUrl,
    sourceCoordinates: structured.coordinates ?? null,
    scope:
      field(document, ["Country", "City"]) ??
      clean(listingRecord?.scope) ??
      "Singapore",
  };
  const reasonCode = classify({ document, claims, outboundLinks });
  const discovery = {
    recordType: "discovery",
    discoveryRecordId: `${source.adapterId}:${canonicalKey(detailUrl, itemKey)}`,
    sourceName: source.name,
    detailUrl,
    roundupParentId,
    itemKey,
    claims,
    outboundLinks,
    evidenceRefs: [],
    confirmationIds: [],
    terminalStatus: reasonCode ? "rejected" : null,
    reasonCode,
    adapterId: source.adapterId,
    adapterVersion: source.version,
  };
  const enriched = applyEventFieldCompleteness(
    {
      ...discovery,
      ...claims,
      detailUrl,
      schedule: claims.dateText ? { displayText: claims.dateText } : null,
    },
    {
      evidenceHash: sha(JSON.stringify(document)),
      methods: structured.methods,
    },
  );
  discovery.fieldCompleteness = enriched.fieldCompleteness;
  discovery.extractionContractVersion = enriched.extractionContractVersion;
  return discovery;
}

function canonicalKey(detailUrl, itemKey) {
  const url = new URL(detailUrl);
  url.hash = "";
  for (const key of [...url.searchParams.keys()])
    if (/^(?:utm_.+|fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
  return `${url.href}${itemKey ? `#${itemKey}` : ""}`;
}

export function genericDiscoveryExclusion(text, patterns) {
  const value = normalized(text);
  return patterns.find(([pattern]) => pattern.test(value))?.[1] ?? null;
}
