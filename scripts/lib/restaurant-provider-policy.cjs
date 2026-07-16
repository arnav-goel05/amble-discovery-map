"use strict";

const APPROVED_COST_CLASSES = new Set(["free", "open"]);

function approvedProvider(policy, providerId, url = null) {
  const provider = policy?.providers?.find(({ id }) => id === providerId);
  if (!provider) throw new Error(`Restaurant provider ${providerId} is not approved`);
  if (!APPROVED_COST_CLASSES.has(provider.costClass)) throw new Error(`Restaurant provider ${providerId} must be classified free/open`);
  if (provider.enabled !== true) throw new Error(`Restaurant provider ${providerId} is disabled`);
  if (!provider.owner || !Array.isArray(provider.domains) || !provider.domains.length) throw new Error(`Restaurant provider ${providerId} lacks owner/domain evidence`);
  if (url) {
    const hostname = new URL(url).hostname.toLowerCase();
    if (!provider.domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) throw new Error(`Restaurant provider domain ${hostname} is not approved for ${providerId}`);
  }
  return provider;
}

function assertRestaurantProviderConfig(config, policy) {
  if (!Array.isArray(config?.providerIds) || !config.providerIds.length) throw new Error("Restaurant providerIds are required");
  const providers = config.providerIds.map((id) => approvedProvider(policy, id));
  for (const endpoint of config.overpassEndpoints || []) approvedProvider(policy, "openstreetmap-overpass", endpoint);
  const retrieval = config.dealRetrieval;
  if (!["direct_http", "direct_http_with_tinyfish_fetch"].includes(retrieval?.mode) || retrieval?.costClass !== "free" || retrieval?.respectRobots !== true) {
    throw new Error("Restaurant deal retrieval must be free, direct-first, and enforce robots.txt");
  }
  if (retrieval.mode === "direct_http_with_tinyfish_fetch") {
    const tinyfish = retrieval.tinyfish;
    if (!tinyfish || tinyfish.providerId !== "tinyfish-fetch" || tinyfish.format !== "html") throw new Error("TinyFish Fetch fallback configuration is invalid");
    approvedProvider(policy, tinyfish.providerId, tinyfish.endpoint);
  }
  const tinyfishSearch = config.websiteDiscovery?.tinyfishSearch;
  if (tinyfishSearch) {
    if (tinyfishSearch.providerId !== "tinyfish-search" || tinyfishSearch.location !== "SG" || tinyfishSearch.language !== "en") throw new Error("TinyFish Search website discovery configuration is invalid");
    approvedProvider(policy, tinyfishSearch.providerId, tinyfishSearch.endpoint);
  }
  return providers;
}

module.exports = { approvedProvider, assertRestaurantProviderConfig };
