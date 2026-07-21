import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { assertPublicUrl, canonicalRenderedUrl } from "./tinyfish-fetch.mjs";

const sha = (value) => createHash("sha256").update(value).digest("hex");

async function boundedText(response, maximumResponseBytes) {
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maximumResponseBytes) {
    await response.body?.cancel?.();
    throw Object.assign(new Error("Direct HTML response exceeded size limit"), { code: "response_too_large" });
  }
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > maximumResponseBytes)
      throw Object.assign(new Error("Direct HTML response exceeded size limit"), { code: "response_too_large" });
    return text;
  }
  const chunks = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maximumResponseBytes) {
      await reader.cancel();
      throw Object.assign(new Error("Direct HTML response exceeded size limit"), { code: "response_too_large" });
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, bytes).toString("utf8");
}

function linksFromHtml(html, baseUrl) {
  const links = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      links.push({ url: new URL(match[1], baseUrl).href, text: match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || null });
    } catch {
      // Invalid page links do not invalidate otherwise usable event evidence.
    }
  }
  return links;
}

function titleFromHtml(html) {
  return html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    ?.replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim() || null;
}

function allowedHost(url, officialDomains) {
  const hostname = new URL(url).hostname.toLowerCase();
  return officialDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

async function assertDirectPublicUrl(value, resolver) {
  await assertPublicUrl(value, { resolver });
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password)
    throw Object.assign(new Error("Direct target must be credential-free HTTPS"), {
      code: "unsafe_destination",
    });
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if (url.port === "443") url.port = "";
  return url.href;
}

function robotsAllows(text, path, userAgent) {
  let applies = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const user = line.match(/^user-agent\s*:\s*(.+)$/i)?.[1]?.trim();
    if (user) {
      applies = user === "*" || userAgent.toLowerCase().includes(user.toLowerCase());
      continue;
    }
    const disallow = line.match(/^disallow\s*:\s*(.*)$/i)?.[1]?.trim();
    if (applies && disallow && path.startsWith(disallow)) return false;
  }
  return true;
}

export function createDirectHtmlFetchClient({
  officialDomains = [],
  fetchImpl = globalThis.fetch,
  resolver = lookup,
  logger = () => {},
  timeoutMs = 20_000,
  maximumResponseBytes = 5 * 1024 * 1024,
  maximumRedirects = 5,
  respectRobots = false,
  userAgent = "OneMapEventPipeline/1.0 (+public event indexing)",
} = {}) {
  if (!officialDomains.length || timeoutMs < 1 || maximumResponseBytes < 1 || maximumRedirects < 0)
    throw new Error("Invalid direct HTML retrieval bounds");
  const pageCache = new Map();
  const robotsCache = new Map();

  async function request(url, { signal } = {}) {
    const canonical = await assertDirectPublicUrl(url, resolver);
    if (!allowedHost(canonical, officialDomains))
      throw Object.assign(new Error("Direct target is outside official source domains"), { code: "official_domain_rejected" });
    return fetchImpl(canonical, {
      method: "GET",
      redirect: "manual",
      headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": userAgent },
      signal,
    });
  }

  async function checkRobots(url, signal) {
    if (!respectRobots) return;
    const parsed = new URL(url);
    const origin = parsed.origin;
    if (!robotsCache.has(origin)) {
      const response = await request(`${origin}/robots.txt`, { signal });
      robotsCache.set(origin, response.ok ? await boundedText(response, Math.min(maximumResponseBytes, 512 * 1024)) : "");
    }
    if (!robotsAllows(robotsCache.get(origin), parsed.pathname, userAgent))
      throw Object.assign(new Error("Direct retrieval disallowed by robots.txt"), { code: "robots_disallowed" });
  }

  async function fetchOne(input, context) {
    const requestedUrl = canonicalRenderedUrl(input);
    if (pageCache.has(requestedUrl)) {
      logger({ action: "direct_html_cache_reused", sourceName: context.sourceName, stage: context.stage, entityId: context.entityId, urlHash: sha(requestedUrl) });
      return pageCache.get(requestedUrl);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let current = requestedUrl;
    try {
      await checkRobots(current, controller.signal);
      for (let redirect = 0; redirect <= maximumRedirects; redirect += 1) {
        logger({ action: "direct_html_attempt", sourceName: context.sourceName, stage: context.stage, entityId: context.entityId, redirect, urlHash: sha(current) });
        const response = await request(current, { signal: controller.signal });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          if (redirect === maximumRedirects)
            throw Object.assign(new Error("Direct HTML redirect limit exceeded"), { code: "redirect_limit_exceeded" });
          const location = response.headers.get("location");
          if (!location) throw Object.assign(new Error("Direct HTML redirect omitted location"), { code: "invalid_redirect" });
          current = new URL(location, current).href;
          continue;
        }
        if (!response.ok)
          throw Object.assign(new Error(`Direct HTML returned HTTP ${response.status}`), { code: response.status === 401 || response.status === 403 ? "bot_blocked" : "source_unavailable", status: response.status });
        const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
        if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml+xml"))
          throw Object.assign(new Error("Direct response was not HTML"), { code: "unsupported_content_type" });
        const html = await boundedText(response, maximumResponseBytes);
        const result = {
          url: requestedUrl,
          final_url: current,
          text: html,
          title: titleFromHtml(html),
          links: linksFromHtml(html, current),
          format: "html",
          retrievalMethod: "direct_html",
          contentHash: sha(html),
        };
        pageCache.set(requestedUrl, result);
        logger({ action: "direct_html_complete", sourceName: context.sourceName, stage: context.stage, entityId: context.entityId, bytes: Buffer.byteLength(html), contentHash: result.contentHash });
        return result;
      }
    } finally {
      clearTimeout(timer);
    }
    throw new Error("Direct HTML retrieval terminated unexpectedly");
  }

  async function fetchBatch(urls, context = {}) {
    const results = [];
    const errors = [];
    for (const url of [...new Set(urls)].sort()) {
      try {
        results.push(await fetchOne(url, context));
      } catch (error) {
        const normalized = error.name === "AbortError"
          ? Object.assign(new Error("Direct HTML request timed out"), { code: "timeout" })
          : error;
        errors.push({ url, code: normalized.code ?? "source_unavailable", status: normalized.status ?? null, message: normalized.message });
        logger({ action: "direct_html_failed", sourceName: context.sourceName, stage: context.stage, entityId: context.entityId, reasonCode: normalized.code ?? "source_unavailable", httpStatus: normalized.status ?? null });
      }
    }
    return { urls, results, errors, payloadHash: sha(JSON.stringify(results.map(({ url, final_url, contentHash }) => ({ url, final_url, contentHash })))) };
  }
  return { fetchBatch };
}
