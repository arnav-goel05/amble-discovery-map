import {
  canonicalLinks,
  clean,
  field,
  normalized,
  renderedDocument,
  sha,
  terminalPagination,
} from "./rendered-adapter-utils.mjs";

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
  { classify = () => null, roundupParentId = null, itemKey = null } = {},
) {
  const document = renderedDocument(result);
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
    title: clean(document.title ?? field(document, ["Title", "Event"])),
    dateText: field(document, ["Date", "Dates", "When"]),
    timeText: field(document, ["Time", "Times"]),
    venue: field(document, ["Venue", "Location", "Address"]),
    scope: field(document, ["Country", "City"]) ?? "Singapore",
  };
  const reasonCode = classify({ document, claims, outboundLinks });
  return {
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
