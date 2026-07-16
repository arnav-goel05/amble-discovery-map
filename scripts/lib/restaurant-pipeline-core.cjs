const crypto = require("node:crypto");
const dns = require("node:dns").promises;
const net = require("node:net");
const { approvedProvider, assertRestaurantProviderConfig } = require("./restaurant-provider-policy.cjs");
const { fresh, readJson, writeJsonAtomic } = require("./json-runtime-store.cjs");

const DEFAULT_AMENITIES = ["restaurant", "fast_food", "food_court", "cafe"];
const DEAL_TERMS = /(?:\bhappy\s*hour\b|\bearly\s*bird\b|\b(?:1|one)\s*[- ]?for\s*[- ]?(?:1|one)\b|\b\d{1,2}%\s*(?:off|discount)\b|\bcomplimentary\s+[a-z][a-z-]*|\bsave\s+(?:s?\$|sgd)\s*\d|\bfree\s+(?:drink|dessert|meal|starter|appetiser|appetizer|side|delivery|parking)[^.!?]{0,60}\b(?:with\s+(?:purchase|minimum\s+spend|order)|when\s+you)\b|\b(?:member|cardholder|weekday|lunch|dinner)\s+(?:deal|discount)\b|\bdiscount(?:ed)?\s+(?:price|rate|for|on)\b)/i;
const DEAL_LINK_TERMS = /\b(deals?|offers?|promotions?|promos?|happy-hour|rewards?|what-s-on)\b/i;
const MAX_BODY_BYTES = 1_500_000;
const CACHE_VERSION = "1.0";
const DEAL_EXTRACTOR_VERSION = "4.4";
const WEBSITE_DISCOVERY_VERSION = "1.4";
const SEARCH_BLOCKED_HOSTS = [
  "facebook.com", "instagram.com", "tripadvisor.", "yelp.", "chope.co", "eatigo.com",
  "foodpanda.", "deliveroo.", "grab.com", "google.com", "wikipedia.org", "hungrygowhere.com",
];
function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function normalizeSpace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeIdentity(value) {
  return normalizeSpace(String(value || "").normalize("NFKD").replace(/\p{Mark}/gu, "").replace(/[^\p{Letter}\p{Number}]+/gu, " ")).toLocaleLowerCase();
}

function plainText(value) {
  return normalizeSpace(String(value || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&ndash;/gi, "-")
    .replace(/&mdash;/gi, "-")
    .replace(/&rsquo;/gi, "’")
    .replace(/&lsquo;/gi, "‘")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))));
}

function parseBbox(input, { maxLatSpan = 0.12, maxLngSpan = 0.12 } = {}) {
  const values = (Array.isArray(input) ? input : String(input || "").split(",")).map(Number);
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
    throw new Error("bbox must be south,west,north,east");
  }
  const [south, west, north, east] = values;
  if (south < -90 || north > 90 || west < -180 || east > 180 || south >= north || west >= east) {
    throw new Error("bbox coordinates are invalid");
  }
  if (north - south > maxLatSpan || east - west > maxLngSpan) {
    throw new Error("viewport is too large; zoom in before searching restaurants");
  }
  return { south, west, north, east, key: values.map((value) => value.toFixed(5)).join(",") };
}

function overpassQuery(bbox, amenities = DEFAULT_AMENITIES) {
  const pattern = amenities.map((value) => value.replace(/[^a-z_]/g, "")).filter(Boolean).join("|");
  return `[out:json][timeout:20];nwr["amenity"~"^(${pattern})$"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});out center tags qt 500;`;
}

function tag(tags, ...keys) {
  for (const key of keys) if (normalizeSpace(tags?.[key])) return normalizeSpace(tags[key]);
  return null;
}

function normalizeWebsite(value) {
  if (!value) return null;
  try {
    const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    const url = new URL(withProtocol);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function normalizeRestaurant(element) {
  const tags = element.tags || {};
  const latitude = Number(element.lat ?? element.center?.lat);
  const longitude = Number(element.lon ?? element.center?.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const id = `osm-${element.type}-${element.id}`;
  const address = [
    tag(tags, "addr:housenumber"),
    tag(tags, "addr:street"),
    tag(tags, "addr:housename"),
    tag(tags, "addr:city"),
    tag(tags, "addr:postcode"),
  ].filter(Boolean).join(", ");
  const name = tag(tags, "name", "brand") || "Unnamed food venue";
  const website = normalizeWebsite(tag(tags, "website", "contact:website", "brand:website"));
  return {
    id,
    osm: { type: element.type, id: String(element.id), url: `https://www.openstreetmap.org/${element.type}/${element.id}` },
    name,
    brand: tag(tags, "brand"),
    category: tag(tags, "amenity") || "restaurant",
    cuisine: tag(tags, "cuisine"),
    address: address || null,
    latitude,
    longitude,
    openingHours: tag(tags, "opening_hours"),
    phone: tag(tags, "phone", "contact:phone"),
    email: tag(tags, "email", "contact:email"),
    website,
    wikidata: tag(tags, "wikidata"),
    brandWikidata: tag(tags, "brand:wikidata"),
    takeaway: tag(tags, "takeaway"),
    delivery: tag(tags, "delivery"),
    dietary: Object.entries(tags)
      .filter(([key, value]) => key.startsWith("diet:") && ["yes", "only"].includes(value))
      .map(([key]) => key.slice(5).replaceAll("_", " ")),
    source: "OpenStreetMap",
    sourceUpdatedAt: null,
  };
}

function websiteCatalogQuery(amenities = DEFAULT_AMENITIES) {
  const pattern = amenities.map((value) => value.replace(/[^a-z_]/g, "")).filter(Boolean).join("|");
  return `[out:json][timeout:90];area(3600536780)->.sg;nwr(area.sg)["amenity"~"^(${pattern})$"][~"^(website|contact:website|brand:website)$"~"."];out center tags;`;
}

async function collectWebsiteCatalog({ endpoints, fetchImpl = fetchWithTimeout, amenities = DEFAULT_AMENITIES }) {
  const attempts = [];
  const query = websiteCatalogQuery(amenities);
  for (const endpoint of endpoints) {
    const startedAt = new Date().toISOString();
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          "User-Agent": "onemap-poi-highlight-spike/1.0 official website discovery",
        },
        body: new URLSearchParams({ data: query }),
      }, 120_000);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!Array.isArray(payload.elements)) throw new Error("response has no elements array");
      const entries = payload.elements.flatMap((element) => {
        const tags = element.tags || {};
        const website = normalizeWebsite(tag(tags, "website", "contact:website", "brand:website"));
        if (!website) return [];
        return [...new Set([tag(tags, "name"), tag(tags, "brand")].filter(Boolean))].map((name) => ({
          name,
          normalizedName: normalizeIdentity(name),
          website,
          osm: { type: element.type, id: String(element.id), url: `https://www.openstreetmap.org/${element.type}/${element.id}` },
        }));
      });
      attempts.push({ endpoint, startedAt, status: "success", count: entries.length });
      return { schemaVersion: CACHE_VERSION, discoveryVersion: WEBSITE_DISCOVERY_VERSION, fetchedAt: new Date().toISOString(), endpoint, attempts, entries };
    } catch (error) {
      attempts.push({ endpoint, startedAt, status: "failed", error: normalizeSpace(error.message) });
    }
  }
  const error = new Error(`All website-catalog endpoints failed (${attempts.map(({ endpoint, error: message }) => `${endpoint}: ${message}`).join("; ")})`);
  error.attempts = attempts;
  throw error;
}

function singaporeWebsiteScore(value) {
  try {
    const url = new URL(value);
    let score = 0;
    if (url.hostname.toLowerCase().endsWith(".sg")) score += 4;
    if (/singapore|sg\b/i.test(`${url.hostname} ${url.pathname}`)) score += 2;
    if (!url.pathname || url.pathname === "/") score += 1;
    return score;
  } catch { return -1; }
}

function selectCatalogCandidate(restaurant, catalog) {
  const names = new Set([restaurant.name, restaurant.brand].filter(Boolean).map(normalizeIdentity));
  const matches = (catalog?.entries || []).filter((entry) => names.has(entry.normalizedName));
  const byOrigin = new Map();
  for (const match of matches) {
    const parsed = new URL(match.website);
    const origin = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const group = byOrigin.get(origin) || { origin, score: singaporeWebsiteScore(match.website), entries: [] };
    group.entries.push(match);
    group.score = Math.max(group.score, singaporeWebsiteScore(match.website));
    byOrigin.set(origin, group);
  }
  const ranked = [...byOrigin.values()].sort((left, right) => right.score - left.score || right.entries.length - left.entries.length || left.origin.localeCompare(right.origin));
  if (!ranked.length) return { status: "not_found", candidates: [] };
  if (ranked.length > 1 && ranked[0].score === ranked[1].score && ranked[0].entries.length === ranked[1].entries.length) {
    return { status: "needs_review", candidates: ranked.map((group) => ({ website: group.entries[0].website, score: group.score, evidence: group.entries.map((entry) => entry.osm.url) })) };
  }
  const selected = ranked[0];
  return {
    status: "approved",
    website: selected.entries.sort((left, right) => singaporeWebsiteScore(right.website) - singaporeWebsiteScore(left.website))[0].website,
    source: "osm_exact_name",
    evidence: selected.entries.map((entry) => entry.osm.url),
    candidates: ranked.map((group) => ({ website: group.entries[0].website, score: group.score, evidence: group.entries.map((entry) => entry.osm.url) })),
  };
}

async function wikidataWebsite(id, { fetchImpl = fetchWithTimeout } = {}) {
  if (!/^Q\d+$/.test(String(id || ""))) return null;
  const endpoint = `https://www.wikidata.org/wiki/Special:EntityData/${id}.json`;
  const response = await fetchImpl(endpoint, { headers: { Accept: "application/json", "User-Agent": "onemap-poi-highlight-spike/1.0 official website discovery" } }, 20_000);
  if (!response.ok) throw new Error(`Wikidata HTTP ${response.status}`);
  const entity = (await response.json()).entities?.[id];
  const websites = (entity?.claims?.P856 || []).map((claim) => normalizeWebsite(claim?.mainsnak?.datavalue?.value)).filter(Boolean);
  return websites.length === 1 ? { website: websites[0], source: "wikidata_p856", evidence: [endpoint] } : null;
}

function searchResultCandidate(restaurant, result) {
  const website = normalizeWebsite(result?.url);
  if (!website) return null;
  const url = new URL(website);
  const hostname = url.hostname.toLowerCase();
  if (SEARCH_BLOCKED_HOSTS.some((blocked) => hostname.includes(blocked))) return null;
  const identity = normalizeIdentity(restaurant.name);
  const terms = identity.split(" ").filter((term) => term.length > 1);
  const evidence = normalizeIdentity(`${result.title || ""} ${plainText(result.description || "")}`);
  const matchedTerms = terms.filter((term) => evidence.includes(term)).length;
  const nameScore = terms.length ? matchedTerms / terms.length : 0;
  const localScore = singaporeWebsiteScore(website) > 0 || /\bsingapore\b/i.test(`${result.title || ""} ${plainText(result.description || "")}`);
  const officialScore = /\bofficial\b/i.test(result.title || "") || terms.some((term) => hostname.includes(term));
  if (nameScore < 0.75 || !localScore || !officialScore) return null;
  return { website, score: nameScore * 5 + singaporeWebsiteScore(website) + (officialScore ? 2 : 0), title: plainText(result.title), description: plainText(result.description) };
}

async function tinyfishWebsiteCandidates(restaurant, { fetchImpl = fetchWithTimeout, apiKey, config } = {}) {
  if (!apiKey) throw new Error("TINYFISH_API_KEY is not configured");
  if (!config?.endpoint) throw new Error("TinyFish Search endpoint is not configured");
  const exclusions = ["tripadvisor.com", "yelp.com", "chope.co", "eatigo.com", "facebook.com", "instagram.com", "grab.com"];
  const query = normalizeSpace(`\"${restaurant.name}\" ${restaurant.address || "Singapore"} official restaurant ${exclusions.map((domain) => `-site:${domain}`).join(" ")}`).slice(0, 900);
  const url = new URL(config.endpoint);
  url.searchParams.set("query", query);
  url.searchParams.set("purpose", "Find the official Singapore website for this exact restaurant or branch.");
  url.searchParams.set("location", config.location || "SG");
  url.searchParams.set("language", config.language || "en");
  url.searchParams.set("domain_type", "web");
  const response = await fetchImpl(url.href, { headers: { Accept: "application/json", "X-API-Key": apiKey } }, Number(config.timeoutMs || 20_000));
  if (!response.ok) throw new Error(`TinyFish Search HTTP ${response.status}`);
  const payload = await response.json();
  const candidates = (payload.results || [])
    .map((result) => searchResultCandidate(restaurant, { ...result, description: result.snippet || result.description }))
    .filter(Boolean);
  const byOrigin = new Map();
  for (const candidate of candidates) {
    const origin = new URL(candidate.website).origin;
    const existing = byOrigin.get(origin);
    if (!existing || candidate.score > existing.score) byOrigin.set(origin, candidate);
  }
  return [...byOrigin.values()].sort((left, right) => right.score - left.score || left.website.localeCompare(right.website)).slice(0, 3);
}

function verifiesRestaurantWebsite(restaurant, page) {
  const content = normalizeIdentity(plainText(page.body));
  const nameTerms = normalizeIdentity(restaurant.name).split(" ").filter((term) => term.length > 1);
  const matchedTerms = nameTerms.filter((term) => content.includes(term)).length;
  const nameMatch = nameTerms.length > 0 && matchedTerms / nameTerms.length >= 0.75;
  const postcode = String(restaurant.address || "").match(/\b\d{6}\b/)?.[0];
  const phone = String(restaurant.phone || "").replace(/\D/g, "").slice(-8);
  const pageDigits = plainText(page.body).replace(/\D/g, "");
  const strongIdentity = Boolean((postcode && pageDigits.includes(postcode)) || (phone.length === 8 && pageDigits.includes(phone)));
  const local = page.finalUrl.hostname.toLowerCase().endsWith(".sg") || /\bsingapore\b/i.test(plainText(page.body)) || strongIdentity;
  return nameMatch && local;
}

async function discoverRestaurantWebsite(restaurant, {
  catalog,
  registry = [],
  fetchImpl = fetchWithTimeout,
  tinyfishSearchImpl = fetchWithTimeout,
  tinyfishFetchImpl = fetchWithTimeout,
  tinyfishApiKey = null,
  tinyfishSearchConfig = null,
  tinyfishFetchConfig = null,
  lookup = dns.lookup,
  onProgress = () => {},
} = {}) {
  const attempts = [];
  const rejectedOrigins = new Set();
  if (restaurant.website) {
    const website = normalizeWebsite(restaurant.website);
    if (!tinyfishSearchConfig) return { status: "approved", website, source: "osm_viewport", evidence: [restaurant.osm?.url].filter(Boolean), candidates: [] };
    onProgress({ stage: "validating_website", label: "Validating the saved official website…" });
    try {
      await fetchDealPage(new URL(website), { fetchImpl, lookup, robotsCache: new Map() });
      return { status: "approved", website, source: "osm_viewport", evidence: [restaurant.osm?.url].filter(Boolean), candidates: [], attempts: [{ source: "osm_viewport", status: "approved", website }] };
    } catch (directError) {
      try {
        onProgress({ stage: "rendering_website", label: "Rendering the saved website…" });
        await fetchTinyfishDealPage(new URL(website), {
          fetchImpl, tinyfishFetchImpl, lookup, robotsCache: new Map(), apiKey: tinyfishApiKey, config: tinyfishFetchConfig,
        });
        return { status: "approved", website, source: "osm_viewport", evidence: [restaurant.osm?.url].filter(Boolean), candidates: [], attempts: [{ source: "osm_viewport", status: "approved_rendered", website }] };
      } catch (renderedError) {
        rejectedOrigins.add(new URL(website).origin);
        attempts.push({ source: "osm_viewport", status: "failed", website, error: normalizeSpace(renderedError.message || directError.message) });
      }
    }
  }
  const approved = registry.find((entry) => {
    if (entry.status !== "approved" || (entry.restaurantId !== restaurant.id && normalizeIdentity(entry.name) !== normalizeIdentity(restaurant.name)) || !entry.website) return false;
    try { return !rejectedOrigins.has(new URL(normalizeWebsite(entry.website)).origin); } catch { return false; }
  });
  if (approved?.website) return { status: "approved", website: normalizeWebsite(approved.website), source: "approved_registry", evidence: approved.evidence || [], candidates: [] };
  const filteredCatalog = { ...(catalog || {}), entries: (catalog?.entries || []).filter((entry) => {
    try { return !rejectedOrigins.has(new URL(entry.website).origin); } catch { return false; }
  }) };
  const catalogResult = selectCatalogCandidate(restaurant, filteredCatalog);
  attempts.push({ source: "osm_singapore_catalog", status: catalogResult.status, candidates: catalogResult.candidates });
  if (catalogResult.status === "approved") return { ...catalogResult, attempts };
  for (const id of [...new Set([restaurant.wikidata, restaurant.brandWikidata].filter(Boolean))]) {
    try {
      const result = await wikidataWebsite(id, { fetchImpl });
      if (result && rejectedOrigins.has(new URL(result.website).origin)) {
        attempts.push({ source: "wikidata_p856", status: "rejected_dead_website", id, website: result.website });
        continue;
      }
      attempts.push({ source: "wikidata_p856", status: result ? "approved" : "not_found", id });
      if (result) return { status: "approved", ...result, candidates: [], attempts };
    } catch (error) { attempts.push({ source: "wikidata_p856", status: "failed", id, error: normalizeSpace(error.message) }); }
  }
  if (tinyfishSearchConfig) {
    try {
      onProgress({ stage: "searching_website", label: "Searching for the official website…" });
      const candidates = await tinyfishWebsiteCandidates(restaurant, { fetchImpl: tinyfishSearchImpl, apiKey: tinyfishApiKey, config: tinyfishSearchConfig });
      const verified = [];
      for (const [index, candidate] of candidates.entries()) {
        try {
          onProgress({ stage: "verifying_website", label: `Verifying website candidate ${index + 1} of ${candidates.length}…` });
          const page = await fetchTinyfishDealPage(new URL(candidate.website), {
            fetchImpl,
            tinyfishFetchImpl,
            lookup,
            robotsCache: new Map(),
            apiKey: tinyfishApiKey,
            config: tinyfishFetchConfig,
          });
          verified.push({ ...candidate, verified: verifiesRestaurantWebsite(restaurant, page) });
        } catch (error) {
          verified.push({ ...candidate, verified: false, error: normalizeSpace(error.message) });
        }
      }
      const matches = verified.filter(({ verified: isVerified }) => isVerified);
      const status = matches.length === 1 ? "approved" : (matches.length > 1 ? "needs_review" : "not_found");
      attempts.push({ source: "tinyfish_search", status, candidates: verified });
      if (status === "approved") return {
        status,
        website: matches[0].website,
        source: "tinyfish_search_verified",
        evidence: [matches[0].website],
        candidates: verified,
        attempts,
      };
    } catch (error) {
      attempts.push({ source: "tinyfish_search", status: "failed", error: normalizeSpace(error.message), candidates: [] });
    }
  }
  return { status: attempts.some((attempt) => attempt.status === "needs_review") ? "needs_review" : "not_found", website: null, source: null, evidence: [], candidates: attempts.flatMap((attempt) => attempt.candidates || []), attempts };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 35_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function collectRestaurants({ bbox: bboxInput, endpoints, fetchImpl = fetchWithTimeout, amenities = DEFAULT_AMENITIES, providerPolicy = null }) {
  const bbox = typeof bboxInput === "object" && bboxInput.key ? bboxInput : parseBbox(bboxInput);
  const attempts = [];
  const query = overpassQuery(bbox, amenities);
  const provider = providerPolicy ? approvedProvider(providerPolicy, "openstreetmap-overpass") : null;
  for (const endpoint of endpoints) {
    if (providerPolicy) approvedProvider(providerPolicy, "openstreetmap-overpass", endpoint);
    const startedAt = new Date().toISOString();
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          "User-Agent": "onemap-poi-highlight-spike/1.0 restaurant viewport discovery",
        },
        body: new URLSearchParams({ data: query }),
      }, 25_000);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!Array.isArray(payload.elements)) throw new Error("response has no elements array");
      const restaurants = payload.elements.map(normalizeRestaurant).filter(Boolean);
      const unique = [...new Map(restaurants.map((restaurant) => [restaurant.id, restaurant])).values()]
        .sort((left, right) => left.name.localeCompare(right.name));
      attempts.push({ endpoint, providerId: "openstreetmap-overpass", startedAt, status: "success", count: unique.length });
      return {
        schemaVersion: CACHE_VERSION,
        bbox: { south: bbox.south, west: bbox.west, north: bbox.north, east: bbox.east },
        fetchedAt: new Date().toISOString(),
        source: "OpenStreetMap / Overpass",
        provider: provider
          ? { id: provider.id, owner: provider.owner, costClass: provider.costClass }
          : { id: "openstreetmap-overpass", costClass: "open" },
        endpoint,
        attempts,
        restaurants: unique,
      };
    } catch (error) {
      attempts.push({ endpoint, providerId: "openstreetmap-overpass", startedAt, status: "failed", error: normalizeSpace(error.message) });
    }
  }
  const error = new Error(`All Overpass endpoints failed (${attempts.map(({ endpoint, error: message }) => `${endpoint}: ${message}`).join("; ")})`);
  error.attempts = attempts;
  throw error;
}

function isPrivateIp(address) {
  if (net.isIPv4(address)) {
    const octets = address.split(".").map(Number);
    return octets[0] === 10 || octets[0] === 127 || octets[0] === 0 ||
      (octets[0] === 169 && octets[1] === 254) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168);
  }
  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
  }
  return true;
}

async function assertPublicUrl(url, lookup = dns.lookup) {
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("unsupported website protocol");
  if (["localhost", "localhost.localdomain"].includes(url.hostname.toLowerCase())) throw new Error("private website host blocked");
  const records = await lookup(url.hostname, { all: true });
  if (!records.length || records.some(({ address }) => isPrivateIp(address))) throw new Error("private website address blocked");
}

async function fetchFollowingPublic(initialUrl, { fetchImpl, lookup, options, timeoutMs, maxRedirects = 5 }) {
  let url = new URL(initialUrl);
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    await assertPublicUrl(url, lookup);
    const response = await fetchImpl(url.href, { ...options, redirect: "manual" }, timeoutMs);
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) throw new Error("website redirect has no location");
    url = new URL(location, url);
  }
  throw new Error("website exceeded redirect limit");
}

function robotsDecision(text, pathname) {
  const groups = [];
  let agents = [];
  let rules = [];
  const flush = () => {
    if (agents.length) groups.push({ agents, rules });
    agents = [];
    rules = [];
  };
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === "user-agent") {
      if (rules.length) flush();
      agents.push(value.toLowerCase());
    } else if ((key === "allow" || key === "disallow") && agents.length) {
      rules.push({ type: key, path: value });
    }
  }
  flush();
  const applicable = groups.filter(({ agents: names }) => names.includes("*")).flatMap(({ rules: entries }) => entries)
    .filter((rule) => rule.path && pathname.startsWith(rule.path))
    .sort((left, right) => right.path.length - left.path.length || (left.type === "allow" ? -1 : 1));
  return applicable[0]?.type !== "disallow";
}

async function robotsAllowed(url, { fetchImpl, lookup, cache }) {
  if (cache.has(url.origin)) return robotsDecision(cache.get(url.origin), url.pathname);
  const robotsUrl = new URL("/robots.txt", url.origin);
  await assertPublicUrl(robotsUrl, lookup);
  try {
    const response = await fetchFollowingPublic(robotsUrl, {
      fetchImpl,
      lookup,
      options: { headers: { Accept: "text/plain", "User-Agent": "onemap-poi-highlight-spike/1.0 deal evidence collector" } },
      timeoutMs: 8_000,
    });
    const text = response.ok ? (await response.text()).slice(0, 250_000) : "";
    cache.set(url.origin, text);
    return robotsDecision(text, url.pathname);
  } catch {
    cache.set(url.origin, "");
    return true;
  }
}

function extractLinks(html, baseUrl) {
  const links = [];
  const regex = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(regex)) {
    try {
      const url = new URL(match[1], baseUrl);
      if (url.origin !== baseUrl.origin || !["http:", "https:"].includes(url.protocol)) continue;
      const label = plainText(match[2]);
      if (DEAL_LINK_TERMS.test(`${url.pathname} ${label}`)) links.push(url);
    } catch {}
  }
  return [...new Map(links.map((url) => [url.href, url])).values()].slice(0, 4);
}

function promotionLinks(page) {
  const links = extractLinks(page.body, page.finalUrl);
  for (const value of page.links || []) {
    try {
      const url = new URL(value, page.finalUrl);
      if (url.origin === page.finalUrl.origin && ["http:", "https:"].includes(url.protocol) && DEAL_LINK_TERMS.test(url.pathname)) links.push(url);
    } catch {}
  }
  return [...new Map(links.map((url) => [url.href, url])).values()].slice(0, 4);
}

function evidenceSnippets(html) {
  const text = plainText(html);
  const clauses = text.split(/(?<=[.!?])\s+|\s*[|•]\s*/).map(normalizeSpace).filter(Boolean);
  const deals = [];
  for (let index = 0; index < clauses.length; index += 1) {
    const signal = clauses[index].match(DEAL_TERMS)?.[0];
    if (!signal) continue;
    const matchIndex = clauses[index].toLocaleLowerCase().indexOf(signal.toLocaleLowerCase());
    const start = Math.max(0, matchIndex - 140);
    const validity = /\b(?:valid|available|offer|promotion)\s+(?:until|through|till)|\b(?:ends?|expires?)\s+(?:on\s+)?/i.test(clauses[index + 1] || "")
      ? ` ${clauses[index + 1]}`
      : "";
    const evidence = normalizeSpace(`${clauses[index].slice(start, matchIndex + signal.length + 240)}${validity}`);
    const signature = normalizeSpace(signal).toLocaleLowerCase();
    if (evidence.length < 8 || deals.some((item) => item.signature === signature)) continue;
    deals.push({ title: signal.replace(/^\w/, (character) => character.toUpperCase()), evidence, signature });
    if (deals.length >= 8) break;
  }
  return deals;
}

function dealValidity(evidence) {
  const match = String(evidence || "").match(/(?:valid|available|offer|promotion)\s+(?:until|through|till)\s+|(?:ends?|expires?)\s+(?:on\s+)?/i);
  if (!match) return null;
  const after = String(evidence).slice(match.index + match[0].length);
  const dateText = after.match(/^(\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]+\s+\d{4}|[A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})/i)?.[1];
  if (!dateText) return null;
  const parsed = Date.parse(dateText.replace(/(\d)(?:st|nd|rd|th)/i, "$1"));
  if (!Number.isFinite(parsed)) return null;
  const end = new Date(parsed);
  end.setUTCHours(23, 59, 59, 999);
  return end.toISOString();
}

async function fetchHtml(url, { fetchImpl, lookup, robotsCache, timeoutMs = 18_000 }) {
  await assertPublicUrl(url, lookup);
  if (!await robotsAllowed(url, { fetchImpl, lookup, cache: robotsCache })) throw new Error("website robots.txt disallows this page");
  const response = await fetchFollowingPublic(url, {
    fetchImpl,
    lookup,
    options: { headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "onemap-poi-highlight-spike/1.0 deal evidence collector",
    } },
    timeoutMs,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const type = response.headers.get("content-type") || "";
  if (!type.includes("text/html") && !type.includes("application/xhtml+xml")) throw new Error("website did not return HTML");
  const body = await response.text();
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) throw new Error("website response exceeded size limit");
  return { body, finalUrl: new URL(response.url || url.href), retrieval: "direct_http" };
}

async function fetchDealPage(url, { fetchImpl, lookup, robotsCache, timeoutMs = 18_000 }) {
  return fetchHtml(url, { fetchImpl, lookup, robotsCache, timeoutMs });
}

async function fetchTinyfishDealPage(url, {
  fetchImpl,
  tinyfishFetchImpl,
  lookup,
  robotsCache,
  apiKey,
  config,
}) {
  await assertPublicUrl(url, lookup);
  if (!await robotsAllowed(url, { fetchImpl, lookup, cache: robotsCache })) throw new Error("website robots.txt disallows this page");
  if (!apiKey) throw new Error("TINYFISH_API_KEY is not configured");
  const endpoint = config?.endpoint;
  if (!endpoint) throw new Error("TinyFish Fetch endpoint is not configured");
  const timeoutMs = Math.min(110_000, Math.max(1, Number(config.timeoutMs || 45_000)));
  const response = await tinyfishFetchImpl(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
    body: JSON.stringify({
      urls: [url.href],
      format: "html",
      links: true,
      image_links: false,
      ttl: Math.max(0, Number(config.cacheTtlSeconds || 0)),
      per_url_timeout_ms: timeoutMs,
    }),
  }, timeoutMs + 10_000);
  if (!response.ok) throw new Error(`TinyFish Fetch HTTP ${response.status}`);
  const responseText = await response.text();
  if (Buffer.byteLength(responseText) > MAX_BODY_BYTES * 2) throw new Error("TinyFish Fetch response exceeded size limit");
  let payload;
  try { payload = JSON.parse(responseText); } catch { throw new Error("TinyFish Fetch returned invalid JSON"); }
  const result = payload?.results?.[0];
  if (!result) {
    const failure = payload?.errors?.[0]?.error;
    const detail = failure ? normalizeSpace(typeof failure === "string" ? failure : JSON.stringify(failure)) : "";
    if (/page_not_found/i.test(detail)) throw new Error("TinyFish could not open this website");
    throw new Error(`TinyFish Fetch failed${detail ? `: ${detail}` : ""}`);
  }
  const body = String(result.text || "");
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) throw new Error("TinyFish rendered page exceeded size limit");
  const finalUrl = new URL(result.final_url || result.url || url.href);
  if (!["http:", "https:"].includes(finalUrl.protocol)) throw new Error("TinyFish returned an unsupported final URL");
  return { body, finalUrl, links: Array.isArray(result.links) ? result.links : [], retrieval: "tinyfish_fetch" };
}

async function collectRestaurantDeals(restaurant, {
  fetchImpl = fetchWithTimeout,
  tinyfishFetchImpl = fetchWithTimeout,
  tinyfishApiKey = null,
  tinyfishConfig = null,
  lookup = dns.lookup,
  clock = () => new Date(),
  onProgress = () => {},
} = {}) {
  const now = clock();
  const fetchedAt = now.toISOString();
  const website = normalizeWebsite(restaurant.website);
  const base = {
    schemaVersion: CACHE_VERSION,
    extractorVersion: DEAL_EXTRACTOR_VERSION,
    discoveryVersion: WEBSITE_DISCOVERY_VERSION,
    restaurantId: restaurant.id,
    restaurantName: restaurant.name,
    website,
    fetchedAt,
    evidenceHash: hash(`${restaurant.id}|${restaurant.name}|${website || ""}`),
    provider: website ? { id: "official-website-direct", costClass: "free", domain: new URL(website).hostname.toLowerCase() } : null,
  };
  if (!website) return { ...base, websiteDiscovery: restaurant.websiteDiscovery || null, status: "not_available", reason: restaurant.websiteDiscovery?.status === "needs_review" ? "Official website candidates require review before scraping." : "No verified official website was found after online discovery.", pagesInspected: [], deals: [] };
  const pagesInspected = [];
  const robotsCache = new Map();
  const deals = [];
  let expiredEvidenceCount = 0;
  let directError = null;
  let renderedError = null;
  let renderedSucceeded = false;
  const inspectPages = (entries) => {
    for (const page of entries) {
      const pageUrl = page.finalUrl.href;
      pagesInspected.push({ url: pageUrl, status: "success", retrieval: page.retrieval });
      const localScope = page.finalUrl.hostname.toLowerCase().endsWith(".sg") || /singapore/i.test(`${page.finalUrl.hostname}${page.finalUrl.pathname}`);
      for (const candidate of evidenceSnippets(page.body)) {
        if (!localScope && !/\bsingapore\b/i.test(candidate.evidence)) continue;
        const validUntil = dealValidity(candidate.evidence);
        if (validUntil && Date.parse(validUntil) < now.getTime()) {
          expiredEvidenceCount += 1;
          continue;
        }
        const key = hash(`${restaurant.id}|${candidate.signature}`);
        if (deals.some((deal) => deal.id === key)) continue;
        const { signature, ...evidence } = candidate;
        deals.push({ id: key, ...evidence, validUntil, sourceUrl: pageUrl, sourceType: "official_website", retrieval: page.retrieval, observedAt: fetchedAt });
      }
    }
  };
  try {
    onProgress({ stage: "checking_deals", label: "Checking the official website for current deals…" });
    const home = await fetchDealPage(new URL(website), { fetchImpl, lookup, robotsCache });
    const pages = [{ ...home, requestedUrl: website }];
    const appendPromotionPages = async (rootPage, target) => {
      for (const link of promotionLinks(rootPage)) {
        try {
          const page = await fetchDealPage(link, { fetchImpl, lookup, robotsCache });
          target.push({ ...page, requestedUrl: link.href });
        } catch (error) {
          pagesInspected.push({ url: link.href, status: "failed", error: normalizeSpace(error.message) });
        }
      }
    };
    await appendPromotionPages(home, pages);
    inspectPages(pages);
  } catch (error) {
    directError = error;
  }

  const tinyfishEnabled = tinyfishConfig?.providerId === "tinyfish-fetch";
  if (!deals.length && tinyfishEnabled && !/robots\.txt disallows/i.test(directError?.message || "")) {
    try {
      onProgress({ stage: "rendering_deals", label: "Rendering the website to check dynamic deals…" });
      const home = await fetchTinyfishDealPage(new URL(website), {
        fetchImpl, tinyfishFetchImpl, lookup, robotsCache, apiKey: tinyfishApiKey, config: tinyfishConfig,
      });
      const renderedPages = [home];
      for (const link of promotionLinks(home)) {
        try {
          renderedPages.push(await fetchTinyfishDealPage(link, {
            fetchImpl, tinyfishFetchImpl, lookup, robotsCache, apiKey: tinyfishApiKey, config: tinyfishConfig,
          }));
        } catch (error) {
          pagesInspected.push({ url: link.href, status: "failed", retrieval: "tinyfish_fetch", error: normalizeSpace(error.message) });
        }
      }
      inspectPages(renderedPages);
      renderedSucceeded = true;
    } catch (error) {
      renderedError = error;
    }
  }

  const unavailable = !pagesInspected.some(({ status }) => status === "success");
  const reason = deals.length
    ? null
    : (unavailable
      ? normalizeSpace(renderedError?.message || directError?.message || "Official website retrieval failed")
      : "No discount or promotion language was found on the inspected official pages.");
  return {
    ...base,
    provider: renderedSucceeded
      ? { id: "tinyfish-fetch", costClass: "free", domain: new URL(website).hostname.toLowerCase() }
      : base.provider,
    websiteDiscovery: restaurant.websiteDiscovery || null,
    status: deals.length ? "success" : (unavailable ? "unavailable" : "no_deals_found"),
    reason,
    fallback: tinyfishEnabled ? { providerId: "tinyfish-fetch", status: renderedSucceeded ? "success" : "unavailable", error: renderedError ? normalizeSpace(renderedError.message) : null } : null,
    pagesInspected,
    deals,
    expiredEvidenceCount,
  };
}

module.exports = {
  assertRestaurantProviderConfig,
  CACHE_VERSION,
  DEAL_EXTRACTOR_VERSION,
  WEBSITE_DISCOVERY_VERSION,
  DEFAULT_AMENITIES,
  collectRestaurantDeals,
  collectRestaurants,
  collectWebsiteCatalog,
  discoverRestaurantWebsite,
  evidenceSnippets,
  fetchTinyfishDealPage,
  fresh,
  hash,
  normalizeRestaurant,
  normalizeIdentity,
  normalizeWebsite,
  overpassQuery,
  parseBbox,
  plainText,
  readJson,
  robotsDecision,
  searchResultCandidate,
  selectCatalogCandidate,
  tinyfishWebsiteCandidates,
  websiteCatalogQuery,
  writeJsonAtomic,
};
