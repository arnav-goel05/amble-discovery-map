import {
  discoveryListing,
  genericDiscoveryExclusion,
  parseDiscoveryDetail,
} from "./discovery-adapter-utils.mjs";

export const honeycombersAdapter = {
  id: "honeycombers-discovery-v1",
  listing: discoveryListing,
  detail(result, source, detailUrl) {
    return parseDiscoveryDetail(result, source, detailUrl, {
      classify: ({ document }) =>
        genericDiscoveryExclusion(document.text, [
          [
            /\b(?:promo code|discount code|giveaway|flash sale)\b/,
            "pure_promotion",
          ],
          [/\bbrunch\b|\brestaurant offer\b/, "non_event_commercial"],
        ]),
    });
  },
};
