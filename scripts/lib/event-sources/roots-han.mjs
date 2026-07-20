import { canonicalLinks, clean, normalized, parseAuthorityDetail, terminalPagination } from "./rendered-adapter-utils.mjs";

function rootsPerformances({ document, dateText, timeText, basePerformance }) {
  if (basePerformance.length) return basePerformance;
  if (/various timings/i.test(timeText ?? "")) return [];
  const dates = (dateText ?? "").split(/\s*,\s*|\s*;\s*/).map(clean).filter(Boolean);
  return dates.map((date) => ({ startDateTime: null, endDateTime: null, dateText: date, timeText }));
}

export const rootsHanAdapter = {
  id: "roots-han-rendered-v1",
  listing(result, source, url = source.listing.url) { return { detailUrls: canonicalLinks(result, { baseUrl: url, pathPattern: source.listing.detailPathPattern }), ...terminalPagination(result, { baseUrl: url, nextLabels: ["next"] }) }; },
  detail(result, source, detailUrl) { return parseAuthorityDetail(result, { source, detailUrl, performanceBuilder: rootsPerformances, classify: ({ timeText, mode, dateText, document }) => {
    const text = normalized(document.text);
    if (/open call|volunteer|get involved|resource/.test(text)) return "non_event_editorial";
    if (mode === "online") return "not_physical_sg";
    if (/various timings/i.test(timeText ?? "") || !dateText) return "undated_review";
    return null;
  } }); },
};
