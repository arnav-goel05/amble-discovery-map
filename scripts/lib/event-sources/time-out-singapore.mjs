import { discoveryListing, genericDiscoveryExclusion, parseDiscoveryDetail } from "./discovery-adapter-utils.mjs";

export const timeOutSingaporeAdapter = {
  id: "time-out-singapore-discovery-v1",
  listing: discoveryListing,
  detail(result, source, detailUrl) {
    const parsed = parseDiscoveryDetail(result, source, detailUrl, { classify: ({ document }) => genericDiscoveryExclusion(document.text, [
      [/\b(?:promo code|discount code|giveaway|flash sale)\b/, "pure_promotion"],
    ]) });
    if (!parsed.claims.venue) {
      const text = result?.document?.markdown ?? result?.document?.text ?? result?.markdown ?? result?.text ?? "";
      const fixedVenue = text.match(/\b(?:at|inside|within)\s+((?:the\s+)?[A-Z][\p{L}\p{N}'’&.-]*(?:\s+[A-Z][\p{L}\p{N}'’&.-]*){1,7})(?=[,.]|\s+(?:on|from|for|with|where|and|each|every|this)\b)/u)?.[1];
      const distinctSites = [...text.matchAll(/\b(?:Marina Bay|Raffles Place(?: Park)?|South Beach|Singapore River)\b/gi)]
        .map((match) => match[0].toLocaleLowerCase("en-SG"));
      parsed.claims.venue = new Set(distinctSites).size > 1 ? "Multiple locations" : fixedVenue ?? null;
    }
    return parsed;
  },
};
