import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isPrivateAddress } from "../provider-policy.mjs";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const TRACKERS = /^(?:utm_.+|fbclid|gclid|mc_cid|mc_eid)$/i;

export function canonicalRenderedUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw Object.assign(new Error("Rendered target must be credential-free HTTPS"), { code: "unsafe_destination" });
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if (url.port === "443") url.port = "";
  const retained = [...url.searchParams].filter(([key]) => !TRACKERS.test(key)).sort(([ak, av], [bk, bv]) => ak.localeCompare(bk) || av.localeCompare(bv));
  url.search = "";
  for (const [key, value] of retained) url.searchParams.append(key, value);
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.href;
}

export async function assertPublicUrl(value, { resolver = lookup } = {}) {
  const canonicalUrl = canonicalRenderedUrl(value);
  const url = new URL(canonicalUrl);
  if (isPrivateAddress(url.hostname)) throw Object.assign(new Error("Private destination rejected"), { code: "unsafe_destination" });
  const answers = await resolver(url.hostname, { all: true });
  if (!Array.isArray(answers) || answers.length === 0 || answers.some(({ address }) => isPrivateAddress(address))) {
    throw Object.assign(new Error("Destination did not resolve exclusively to public addresses"), { code: "unsafe_destination" });
  }
  return canonicalUrl;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const RETRYABLE_RESULT_ERRORS = new Set(["bot_blocked", "proxy_error", "target_unreachable", "timeout"]);

function blockerCodeForHttpStatus(status) {
  if (status === 401 || status === 403) return "authentication_or_captcha";
  if (status === 429) return "persistent_rate_limit";
  if (status >= 400 && status < 500) return "provider_policy_invalid";
  return "source_unavailable";
}

async function readBoundedResponseText(response, maximumResponseBytes) {
  const declaredLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumResponseBytes) {
    await response.body?.cancel?.();
    throw Object.assign(new Error("TinyFish response exceeded size limit"), { code: "response_too_large" });
  }
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > maximumResponseBytes) throw Object.assign(new Error("TinyFish response exceeded size limit"), { code: "response_too_large" });
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maximumResponseBytes) {
      await reader.cancel();
      throw Object.assign(new Error("TinyFish response exceeded size limit"), { code: "response_too_large" });
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, bytes).toString("utf8");
}

export function createTinyfishFetchClient({
  apiKey = process.env.TINYFISH_API_KEY,
  endpoint = "https://api.fetch.tinyfish.ai",
  fetchImpl = globalThis.fetch,
  resolver = lookup,
  sleep = wait,
  logger = () => {},
  now = () => Date.now(),
  batchSize = 10,
  maximumUrlsPerMinute = 149,
  timeoutMs = 110_000,
  maxAttempts = 3,
  maximumResponseBytes = 5 * 1024 * 1024,
  format = "markdown",
  ttl = undefined,
  includeSelectors = [],
  excludeSelectors = [],
} = {}) {
  if (!apiKey) throw Object.assign(new Error("TINYFISH_API_KEY is required"), { code: "retrieval_credential_missing" });
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 10 || maximumUrlsPerMinute < 1 || maximumUrlsPerMinute >= 150) throw new Error("Invalid TinyFish free-tier bounds");
  if (!["html", "json", "markdown"].includes(format)) throw new Error("Invalid TinyFish response format");
  if (ttl !== undefined && (!Number.isInteger(ttl) || ttl < 0)) throw new Error("Invalid TinyFish cache freshness");
  for (const selectors of [includeSelectors, excludeSelectors]) {
    if (!Array.isArray(selectors) || selectors.length > 20 || selectors.some((selector) => typeof selector !== "string" || selector.length < 1 || selector.length > 1000)) throw new Error("Invalid TinyFish selector scope");
  }
  let lastBatchAt = 0;
  const delayPerUrl = 60_000 / maximumUrlsPerMinute;

  async function fetchBatch(values, context = {}) {
    const requestOptions = context.requestOptions ?? {};
    const requestFormat = requestOptions.format ?? format;
    const requestTtl = requestOptions.ttl ?? ttl;
    const requestIncludeSelectors = requestOptions.includeSelectors ?? includeSelectors;
    const requestExcludeSelectors = requestOptions.excludeSelectors ?? excludeSelectors;
    if (!["html", "json", "markdown"].includes(requestFormat)) throw new Error("Invalid TinyFish response format");
    if (requestTtl !== undefined && (!Number.isInteger(requestTtl) || requestTtl < 0)) throw new Error("Invalid TinyFish cache freshness");
    for (const selectors of [requestIncludeSelectors, requestExcludeSelectors]) {
      if (!Array.isArray(selectors) || selectors.length > 20 || selectors.some((selector) => typeof selector !== "string" || selector.length < 1 || selector.length > 1000)) throw new Error("Invalid TinyFish selector scope");
    }
    const urls = [...new Set(await Promise.all(values.map((value) => assertPublicUrl(value, { resolver }))))].sort();
    if (urls.length > batchSize) throw Object.assign(new Error(`TinyFish batch exceeds ${batchSize}`), { code: "batch_limit_exceeded" });
    const delay = Math.max(0, lastBatchAt + Math.ceil(delayPerUrl * urls.length) - now());
    if (delay) await sleep(delay);
    lastBatchAt = now();
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const startedAt = now();
      logger({ action: "retrieval_attempt", attempt, urls: urls.length, format: requestFormat, ttl: requestTtl ?? null, includeSelectors: requestIncludeSelectors.length, excludeSelectors: requestExcludeSelectors.length, stage: context.stage, sourceName: context.sourceName, pageIndex: context.pageIndex, entityId: context.entityId });
      try {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            urls,
            format: requestFormat,
            links: true,
            image_links: false,
            ...(requestTtl === undefined ? {} : { ttl: requestTtl }),
            ...(requestIncludeSelectors.length ? { include_selectors: requestIncludeSelectors } : {}),
            ...(requestExcludeSelectors.length ? { exclude_selectors: requestExcludeSelectors } : {}),
            per_url_timeout_ms: timeoutMs,
          }),
          signal: controller.signal,
        });
        const bodyText = await readBoundedResponseText(response, maximumResponseBytes);
        if (!response.ok) {
          const error = Object.assign(new Error(`TinyFish returned HTTP ${response.status}`), {
            code: blockerCodeForHttpStatus(response.status),
            status: response.status,
          });
          if (![408, 425, 429, 500, 502, 503, 504].includes(response.status) || attempt === maxAttempts) throw error;
          lastError = error;
        } else {
          const payload = JSON.parse(bodyText);
          const results = Array.isArray(payload.results) ? payload.results : Array.isArray(payload.data) ? payload.data : [];
          const errors = Array.isArray(payload.errors) ? payload.errors : [];
          if (!results.length && errors.length && errors.every((item) => RETRYABLE_RESULT_ERRORS.has(item.error ?? item.code)) && attempt < maxAttempts) {
            lastError = Object.assign(new Error("TinyFish returned only transient per-URL failures"), { code: "source_unavailable" });
            logger({ action: "retrieval_retry", attempt, urls: urls.length, reason: "transient_per_url_errors", errors: errors.length, ...context });
          } else {
            logger({ action: "retrieval_complete", attempt, urls: urls.length, results: results.length, errors: errors.length, durationMs: now() - startedAt, ...context });
            return { urls, results, errors, payloadHash: sha(bodyText), payload };
          }
        }
      } catch (error) {
        lastError = error.name === "AbortError" ? Object.assign(new Error("TinyFish request timed out"), { code: "source_unavailable" }) : error;
        if (attempt === maxAttempts || !["source_unavailable", "persistent_rate_limit"].includes(lastError.code)) throw Object.assign(lastError, { attempts: attempt });
      } finally { clearTimeout(timeout); }
      await sleep(Math.min(4_000, 500 * 2 ** (attempt - 1)));
    }
    throw lastError;
  }

  async function fetchUrls(values, context = {}) {
    const canonical = [...new Set(values.map(canonicalRenderedUrl))].sort();
    const output = [];
    for (let index = 0; index < canonical.length; index += batchSize) output.push(await fetchBatch(canonical.slice(index, index + batchSize), context));
    return output;
  }
  return { fetchBatch, fetchUrls };
}
