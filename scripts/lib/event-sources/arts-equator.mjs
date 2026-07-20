import {
  discoveryListing,
  genericDiscoveryExclusion,
  parseDiscoveryDetail,
} from "./discovery-adapter-utils.mjs";
import { clean, renderedDocument } from "./rendered-adapter-utils.mjs";

const MONTH =
  "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";

function calendarHeading(document) {
  return (
    [...document.text.matchAll(/^##\s+(.+)$/gm)]
      .map((match) => clean(match[1]))
      .find(
        (heading) =>
          heading &&
          new RegExp(`\\b${MONTH}\\s+\\d{1,2}\\b`, "i").test(heading),
      ) ?? null
  );
}

function calendarVenue(document) {
  const block =
    document.text.match(
      /(?:^|\n)##\s+Venue\s*\n([\s\S]*?)(?=\n##\s|$)/i,
    )?.[1] ?? "";
  const lines = block
    .split("\n")
    .map((line) => clean(line.replace(/^\s*:\s*/, "").replace(/,\s*$/, "")))
    .filter((line) => line && !/^(?:\+?\s*Google Map|Website:)$/i.test(line));
  return lines.length ? lines.slice(0, 4).join(", ") : null;
}

function eventWebsite(document) {
  return (
    document.text.match(
      /(?:^|\n)\s*(?:\*\*)?Website:(?:\*\*)?\s*:?[ \t]*(https?:\/\/\S+)/i,
    )?.[1] ?? null
  );
}

function enrichArtsEquatorDetail(result) {
  const document = renderedDocument(result);
  const dateText = calendarHeading(document);
  const venue = calendarVenue(document);
  const website = eventWebsite(document);
  return {
    ...result,
    document: {
      ...document,
      fields: {
        ...document.fields,
        ...(dateText ? { Date: dateText } : {}),
        ...(venue ? { Venue: venue } : {}),
      },
      links: website
        ? [...document.links, { url: website, text: "Event Website" }]
        : document.links,
    },
  };
}

export const artsEquatorAdapter = {
  id: "arts-equator-discovery-v1",
  listing: discoveryListing,
  detail(result, source, detailUrl) {
    return parseDiscoveryDetail(
      enrichArtsEquatorDetail(result),
      source,
      detailUrl,
      {
        classify: ({ document, claims }) => {
          const excluded = genericDiscoveryExclusion(document.text, [
            [
              /\b(?:promo code|discount code|giveaway|flash sale)\b/,
              "pure_promotion",
            ],
            [
              /\b(?:open call|grant application|residency application|competition deadline)\b(?![\s\S]*\b(?:performance|exhibition|screening|workshop|programme|festival)\b)/,
              "non_attendable_opportunity",
            ],
          ]);
          if (excluded) return excluded;
          if (
            /online/i.test(claims.venue ?? "") ||
            (claims.scope && !/singapore/i.test(claims.scope))
          )
            return "not_physical_sg";
          return null;
        },
      },
    );
  },
};
