import { canonicalLinks, normalized, parseAuthorityDetail, terminalPagination } from "./rendered-adapter-utils.mjs";

export const singaporeFilmSocietyAdapter = {
  id: "singapore-film-society-rendered-v1",
  listing(result, source, url = source.listing.url) { return { detailUrls: canonicalLinks(result, { baseUrl: url, pathPattern: source.listing.detailPathPattern }), ...terminalPagination(result, { baseUrl: url }) }; },
  detailLinks(result, source, url) { return canonicalLinks(result, { baseUrl: url, pathPattern: "^/schedule/" }); },
  detail(result, source, detailUrl) { return parseAuthorityDetail(result, { source, detailUrl, classify: ({ dateText, venue, document }) => {
    const text = normalized(document.text);
    if (/sign in to view|login required/.test(text) && !dateText) return "schedule_unverified";
    if (!venue) return "missing_venue";
    return null;
  } }); },
};
