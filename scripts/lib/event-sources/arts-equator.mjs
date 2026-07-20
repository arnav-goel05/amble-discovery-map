import { discoveryListing, genericDiscoveryExclusion, parseDiscoveryDetail } from "./discovery-adapter-utils.mjs";

export const artsEquatorAdapter = {
  id: "arts-equator-discovery-v1",
  listing: discoveryListing,
  detail(result, source, detailUrl) { return parseDiscoveryDetail(result, source, detailUrl, { classify: ({ document, claims }) => {
    const excluded = genericDiscoveryExclusion(document.text, [
      [/\b(?:promo code|discount code|giveaway|flash sale)\b/, "pure_promotion"],
      [/\b(?:open call|grant application|residency application|competition deadline)\b(?![\s\S]*\b(?:performance|exhibition|screening|workshop|programme|festival)\b)/, "non_attendable_opportunity"],
    ]);
    if (excluded) return excluded;
    if (/online/i.test(claims.venue ?? "") || claims.scope && !/singapore/i.test(claims.scope)) return "not_physical_sg";
    return null;
  } }); },
};
