const DEAL_TERMS = /(?:\bhappy\s*hour\b|\bearly\s*bird\b|\b(?:1|one)\s*[- ]?for\s*[- ]?(?:1|one)\b|\b\d{1,2}%\s*(?:off|discount)\b|\bcomplimentary\s+[a-z][a-z-]*|\bsave\s+(?:s?\$|sgd)\s*\d|\bfree\s+(?:drink|dessert|meal|starter|appetiser|appetizer|side|delivery|parking)[^.!?]{0,60}\b(?:with\s+(?:purchase|minimum\s+spend|order)|when\s+you)\b|\b(?:member|cardholder|weekday|lunch|dinner)\s+(?:deal|discount)\b|\bdiscount(?:ed)?\s+(?:price|rate|for|on)\b)/i;
const DEAL_LINK_TERMS = /\b(deals?|offers?|promotions?|promos?|happy-hour|rewards?|what-s-on)\b/i;
const BLOCKED_SEARCH_HOSTS = ["facebook.com", "instagram.com", "tripadvisor.", "yelp.", "chope.co", "eatigo.com", "foodpanda.", "deliveroo.", "grab.com", "google.com", "wikipedia.org"];
const ID_PATTERN = /^osm-(?:node|way|relation)-\d+$/;
const MAX_BODY_BYTES = 1_500_000;
const TINYFISH_SEARCH = "https://api.search.tinyfish.ai";
const TINYFISH_FETCH = "https://api.fetch.tinyfish.ai";

function normalizeSpace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function plainText(value) {
  return normalizeSpace(String(value || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&ndash;/gi, "–").replace(/&mdash;/gi, "—")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))));
}

function normalizeIdentity(value) {
  return normalizeSpace(String(value || "").normalize("NFKD").replace(/\p{Mark}/gu, "").replace(/[^\p{Letter}\p{Number}]+/gu, " ")).toLowerCase();
}

function safeWebsite(value) {
  try {
    const url = new URL(/^https?:\/\//i.test(value || "") ? value : `https://${value}`);
    const host = url.hostname.toLowerCase();
    if (!["http:", "https:"].includes(url.protocol) || host === "localhost" || host.endsWith(".localhost") || /^\d+(?:\.\d+){3}$/.test(host)) return null;
    return url;
  } catch { return null; }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 20_000) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
}

function robotsDecision(text, pathname) {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.replace(/#.*$/, "").trim());
  let applies = false;
  const rules = [];
  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === "user-agent") applies = value === "*";
    else if (applies && ["allow", "disallow"].includes(key) && value && pathname.startsWith(value)) rules.push({ key, value });
  }
  rules.sort((left, right) => right.value.length - left.value.length || (left.key === "allow" ? -1 : 1));
  return rules[0]?.key !== "disallow";
}

async function robotsAllowed(url) {
  try {
    const response = await fetchWithTimeout(new URL("/robots.txt", url.origin), { headers: { accept: "text/plain" } }, 8_000);
    return !response.ok || robotsDecision((await response.text()).slice(0, 250_000), url.pathname);
  } catch { return true; }
}

async function directPage(url) {
  if (!await robotsAllowed(url)) throw new Error("website robots.txt disallows this page");
  const response = await fetchWithTimeout(url, { headers: { accept: "text/html,application/xhtml+xml" } }, 18_000);
  if (!response.ok) throw new Error(`Official website HTTP ${response.status}`);
  const type = response.headers.get("content-type") || "";
  if (!type.includes("text/html") && !type.includes("application/xhtml+xml")) throw new Error("Official website did not return HTML");
  const body = await response.text();
  if (body.length > MAX_BODY_BYTES) throw new Error("Official website response exceeded the size limit");
  return { body, finalUrl: safeWebsite(response.url) || url, links: [], retrieval: "direct_http" };
}

async function tinyfishPage(url, apiKey) {
  if (!apiKey) throw new Error("TinyFish is not configured");
  if (!await robotsAllowed(url)) throw new Error("website robots.txt disallows this page");
  const response = await fetchWithTimeout(TINYFISH_FETCH, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify({ urls: [url.href], format: "html", links: true, image_links: false, ttl: 3600, per_url_timeout_ms: 45_000 }),
  }, 55_000);
  if (!response.ok) throw new Error(`TinyFish Fetch HTTP ${response.status}`);
  const payload = await response.json();
  const result = payload?.results?.[0];
  if (!result) throw new Error("TinyFish could not render the official website");
  const body = String(result.text || "");
  if (body.length > MAX_BODY_BYTES) throw new Error("TinyFish rendered page exceeded the size limit");
  const finalUrl = safeWebsite(result.final_url || result.url || url.href);
  if (!finalUrl) throw new Error("TinyFish returned an invalid website URL");
  return { body, finalUrl, links: Array.isArray(result.links) ? result.links : [], retrieval: "tinyfish_fetch" };
}

function promotionLinks(page) {
  const links = [];
  for (const match of page.body.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const url = new URL(match[1], page.finalUrl);
      if (url.origin === page.finalUrl.origin && DEAL_LINK_TERMS.test(`${url.pathname} ${plainText(match[2])}`)) links.push(url);
    } catch {}
  }
  for (const value of page.links || []) {
    try {
      const url = new URL(value, page.finalUrl);
      if (url.origin === page.finalUrl.origin && DEAL_LINK_TERMS.test(url.pathname)) links.push(url);
    } catch {}
  }
  return [...new Map(links.map((url) => [url.href, url])).values()].slice(0, 4);
}

function evidenceSnippets(html) {
  const clauses = plainText(html).split(/(?<=[.!?])\s+|\s*[|•]\s*/).map(normalizeSpace).filter(Boolean);
  const found = [];
  for (const clause of clauses) {
    const signal = clause.match(DEAL_TERMS)?.[0];
    if (!signal) continue;
    const index = clause.toLowerCase().indexOf(signal.toLowerCase());
    const evidence = normalizeSpace(clause.slice(Math.max(0, index - 140), index + signal.length + 240));
    const signature = normalizeSpace(signal).toLowerCase();
    if (evidence.length >= 8 && !found.some((item) => item.signature === signature)) found.push({ title: signal.replace(/^\w/, (character) => character.toUpperCase()), evidence, signature });
    if (found.length >= 8) break;
  }
  return found;
}

function dealValidity(evidence) {
  const match = String(evidence || "").match(/(?:valid|available|offer|promotion)\s+(?:until|through|till)\s+|(?:ends?|expires?)\s+(?:on\s+)?/i);
  if (!match) return null;
  const dateText = String(evidence).slice(match.index + match[0].length).match(/^(\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]+\s+\d{4}|[A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})/i)?.[1];
  const parsed = dateText ? Date.parse(dateText.replace(/(\d)(?:st|nd|rd|th)/i, "$1")) : NaN;
  if (!Number.isFinite(parsed)) return null;
  const end = new Date(parsed); end.setUTCHours(23, 59, 59, 999); return end.toISOString();
}

async function digest(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function candidateFromSearch(restaurant, result) {
  const url = safeWebsite(result?.url);
  if (!url || BLOCKED_SEARCH_HOSTS.some((blocked) => url.hostname.toLowerCase().includes(blocked))) return null;
  const terms = normalizeIdentity(restaurant.name).split(" ").filter((term) => term.length > 1);
  const evidence = normalizeIdentity(`${result.title || ""} ${result.snippet || result.description || ""}`);
  const score = terms.length ? terms.filter((term) => evidence.includes(term)).length / terms.length : 0;
  const local = url.hostname.endsWith(".sg") || /\bsingapore\b/i.test(`${result.title || ""} ${result.snippet || ""}`);
  const official = /\bofficial\b/i.test(result.title || "") || terms.some((term) => url.hostname.includes(term));
  return score >= 0.75 && local && official ? url : null;
}

function verifiesRestaurant(restaurant, page) {
  const content = normalizeIdentity(plainText(page.body));
  const terms = normalizeIdentity(restaurant.name).split(" ").filter((term) => term.length > 1);
  const nameMatch = terms.length && terms.filter((term) => content.includes(term)).length / terms.length >= 0.75;
  const postcode = String(restaurant.address || "").match(/\b\d{6}\b/)?.[0];
  return Boolean(nameMatch && (page.finalUrl.hostname.endsWith(".sg") || content.includes("singapore") || (postcode && content.includes(postcode))));
}

async function discoverWebsite(restaurant, apiKey) {
  const existing = safeWebsite(restaurant.website);
  if (existing) return { website: existing, source: "osm_viewport" };
  const query = normalizeSpace(`"${restaurant.name}" ${restaurant.address || "Singapore"} official restaurant -site:tripadvisor.com -site:facebook.com -site:instagram.com`).slice(0, 900);
  const url = new URL(TINYFISH_SEARCH);
  url.searchParams.set("query", query); url.searchParams.set("purpose", "Find the official Singapore website for this exact restaurant or branch.");
  url.searchParams.set("location", "SG"); url.searchParams.set("language", "en"); url.searchParams.set("domain_type", "web");
  const response = await fetchWithTimeout(url, { headers: { accept: "application/json", "x-api-key": apiKey } }, 20_000);
  if (!response.ok) throw new Error(`TinyFish Search HTTP ${response.status}`);
  const candidates = [...new Map(((await response.json()).results || []).map((result) => candidateFromSearch(restaurant, result)).filter(Boolean).map((item) => [item.origin, item])).values()].slice(0, 3);
  const verified = [];
  for (const candidate of candidates) {
    try { if (verifiesRestaurant(restaurant, await tinyfishPage(candidate, apiKey))) verified.push(candidate); } catch {}
  }
  return verified.length === 1 ? { website: verified[0], source: "tinyfish_search_verified" } : { website: null, source: null };
}

async function collectDeals(restaurant, apiKey) {
  const fetchedAt = new Date().toISOString();
  const discovery = await discoverWebsite(restaurant, apiKey);
  const website = discovery.website;
  const base = { schemaVersion: "1.0", extractorVersion: "4.4-cloud", discoveryVersion: "1.4-cloud", restaurantId: restaurant.id, restaurantName: restaurant.name, website: website?.href || null, websiteDiscovery: discovery, fetchedAt };
  if (!website) return { ...base, status: "not_available", reason: "No uniquely verified official website was found.", pagesInspected: [], deals: [] };
  const pagesInspected = [];
  const deals = [];
  const inspect = async (page) => {
    pagesInspected.push({ url: page.finalUrl.href, status: "success", retrieval: page.retrieval });
    for (const candidate of evidenceSnippets(page.body)) {
      const validUntil = dealValidity(candidate.evidence);
      if (validUntil && Date.parse(validUntil) < Date.now()) continue;
      const id = await digest(`${restaurant.id}|${candidate.signature}`);
      if (!deals.some((deal) => deal.id === id)) deals.push({ id, title: candidate.title, evidence: candidate.evidence, validUntil, sourceUrl: page.finalUrl.href, sourceType: "official_website", retrieval: page.retrieval, observedAt: fetchedAt });
    }
  };
  let directError = null;
  try {
    const home = await directPage(website); await inspect(home);
    for (const link of promotionLinks(home)) try { await inspect(await directPage(link)); } catch (error) { pagesInspected.push({ url: link.href, status: "failed", retrieval: "direct_http", error: normalizeSpace(error.message) }); }
  } catch (error) { directError = error; }
  let renderedError = null;
  let rendered = false;
  if (!deals.length && !/robots\.txt disallows/i.test(directError?.message || "")) {
    try {
      const home = await tinyfishPage(website, apiKey); await inspect(home); rendered = true;
      for (const link of promotionLinks(home)) try { await inspect(await tinyfishPage(link, apiKey)); } catch (error) { pagesInspected.push({ url: link.href, status: "failed", retrieval: "tinyfish_fetch", error: normalizeSpace(error.message) }); }
    } catch (error) { renderedError = error; }
  }
  const unavailable = !pagesInspected.some((page) => page.status === "success");
  return { ...base, provider: { id: rendered ? "tinyfish-fetch" : "official-website-direct", costClass: "free", domain: website.hostname }, status: deals.length ? "success" : (unavailable ? "unavailable" : "no_deals_found"), reason: deals.length ? null : (unavailable ? normalizeSpace(renderedError?.message || directError?.message || "Official website retrieval failed") : "No current discount or promotion language was found on the inspected official pages."), fallback: { providerId: "tinyfish-fetch", status: rendered ? "success" : "unavailable", error: renderedError ? normalizeSpace(renderedError.message) : null }, pagesInspected, deals };
}

function envelope(restaurantId, status, result = null, { cache = null, error = null, progress = null } = {}) {
  const publicStatus = status === "complete" ? (["unavailable", "not_available"].includes(result?.status) ? "unavailable" : "success") : (["queued", "running"].includes(status) ? "pending" : (status === "failed" ? "error" : status));
  return { schemaVersion: "1.0", restaurantId, status: publicStatus, data: result, result, fetchedAt: result?.fetchedAt || null, stale: false, warning: null, error, cache, progress };
}

async function currentDeal(id, env) {
  return env.RUNTIME_DB.prepare("SELECT status,payload,fetched_at,expires_at FROM restaurant_deals WHERE restaurant_id=?").bind(id).first();
}

function changed(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0) > 0;
}

async function claimDeal(id, env) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 2 * 60_000).toISOString();
  const inserted = await env.RUNTIME_DB.prepare("INSERT OR IGNORE INTO restaurant_deals(restaurant_id,status,payload,fetched_at,expires_at) VALUES(?,?,?,?,?)")
    .bind(id, "running", null, now.toISOString(), expiresAt).run();
  if (changed(inserted)) return true;
  const updated = await env.RUNTIME_DB.prepare("UPDATE restaurant_deals SET status=?,payload=NULL,fetched_at=?,expires_at=? WHERE restaurant_id=? AND expires_at<=?")
    .bind("running", now.toISOString(), expiresAt, id, now.toISOString()).run();
  return changed(updated);
}

async function runDeal(id, env) {
  const row = await env.RUNTIME_DB.prepare("SELECT payload FROM restaurants WHERE id=?").bind(id).first();
  if (!row) return envelope(id, "failed", null, { error: "Restaurant data is unavailable. Search this area again and retry." });
  try {
    const result = await collectDeals(JSON.parse(row.payload), env.TINYFISH_API_KEY);
    const ttl = result.status === "success" ? 24 * 3_600_000 : 12 * 3_600_000;
    await env.RUNTIME_DB.prepare("UPDATE restaurant_deals SET status=?,payload=?,fetched_at=?,expires_at=? WHERE restaurant_id=?")
      .bind("complete", JSON.stringify(result), result.fetchedAt, new Date(Date.now() + ttl).toISOString(), id).run();
    return envelope(id, "complete", result, { cache: "miss" });
  } catch (error) {
    const message = normalizeSpace(error.message || "Deal discovery failed").slice(0, 240);
    await env.RUNTIME_DB.prepare("UPDATE restaurant_deals SET status=?,payload=?,fetched_at=?,expires_at=? WHERE restaurant_id=?")
      .bind("failed", JSON.stringify({ error: message }), new Date().toISOString(), new Date(Date.now() + 30 * 60_000).toISOString(), id).run();
    return envelope(id, "failed", null, { error: message });
  }
}

async function startDeal(id, env) {
  if (await claimDeal(id, env)) return runDeal(id, env);
  const row = await currentDeal(id, env);
  if (row?.status === "complete" && row.payload) return envelope(id, "complete", JSON.parse(row.payload), { cache: "hit" });
  if (row?.status === "failed") {
    let failure = null;
    try { failure = JSON.parse(row.payload || "null"); } catch {}
    return envelope(id, "failed", null, { error: failure?.error || "Deal discovery is temporarily unavailable." });
  }
  return envelope(id, row?.status || "running", null, { progress: { stage: "running", label: "Checking the official website and TinyFish…" } });
}

export async function dealResponse(request, url, env, context, { json, errorEnvelope }) {
  if (request.method === "POST" && url.pathname === "/api/restaurant-deals/batch") {
    let payload;
    try { payload = await request.json(); } catch { return json(errorEnvelope("invalid_request_body", "The request body must be valid JSON."), { status: 400 }); }
    const ids = payload.restaurantIds || payload.ids;
    if (!Array.isArray(ids) || ids.length > 250 || ids.some((id) => !ID_PATTERN.test(String(id)))) return json(errorEnvelope("invalid_restaurant_ids", "restaurantIds must contain at most 250 mapped restaurant IDs."), { status: 400 });
    const unique = [...new Set(ids.map(String))];
    const jobs = [];
    for (const id of unique) {
      const row = await currentDeal(id, env);
      if (row?.status === "complete" && Date.parse(row.expires_at) > Date.now()) jobs.push(envelope(id, "complete", JSON.parse(row.payload), { cache: "hit" }));
      else {
        jobs.push(envelope(id, "queued", null, { progress: { stage: "queued", label: "Preparing restaurant lookup…" } }));
        context.waitUntil(startDeal(id, env));
      }
    }
    return json({ schemaVersion: "1.0", jobs }, { status: 202 });
  }
  if (request.method === "GET" && url.pathname === "/api/restaurant-deals") {
    const id = url.searchParams.get("id");
    if (!id || !ID_PATTERN.test(id)) return json(errorEnvelope("restaurant_id_required", "A valid restaurant ID is required."), { status: 400 });
    const row = await currentDeal(id, env);
    if (row?.status === "complete" && row.payload && Date.parse(row.expires_at) > Date.now()) return json(envelope(id, "complete", JSON.parse(row.payload), { cache: "hit" }));
    if (row?.status === "failed" && Date.parse(row.expires_at) > Date.now()) {
      let failure = null;
      try { failure = JSON.parse(row.payload || "null"); } catch {}
      return json(envelope(id, "failed", null, { error: failure?.error || "Deal discovery is temporarily unavailable." }));
    }
    if (["queued", "running"].includes(row?.status) && Date.parse(row.expires_at) > Date.now()) return json(envelope(id, row.status, null, { progress: { stage: row.status, label: row.status === "running" ? "Checking the official website and TinyFish…" : "Preparing restaurant lookup…" } }));
    return json(await startDeal(id, env));
  }
  return null;
}
