#!/usr/bin/env node

const DEFAULT_ORIGIN = "https://amblefinds.com";
const DEFAULT_ATTEMPTS = 8;
const DEFAULT_REQUIRED_SUCCESSES = 3;
const DEFAULT_DELAY_MS = 2_000;

function positiveInteger(value, fallback, name) {
  if (value == null || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function moduleEntry(html) {
  return html.match(
    /<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["']/i,
  )?.[1];
}

async function requireSuccessfulResponse(url, expectedType) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      accept: expectedType,
      "user-agent": "amble-production-smoke/1.0",
    },
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes(expectedType.split("/")[1])) {
    throw new Error(`${url} returned unexpected content-type ${contentType}`);
  }
  return response;
}

export async function verifyCloudflareDeployment(origin = DEFAULT_ORIGIN) {
  const canonicalOrigin = new URL(origin).origin;
  const homepageUrl = new URL("/", canonicalOrigin);
  const homepage = await requireSuccessfulResponse(homepageUrl, "text/html");
  if (new URL(homepage.url).origin !== canonicalOrigin) {
    throw new Error(`homepage redirected away from ${canonicalOrigin}`);
  }

  const html = await homepage.text();
  if (!/<title>Amble - Singapore Events Map<\/title>/i.test(html)) {
    throw new Error("homepage identity is missing or incorrect");
  }

  const entry = moduleEntry(html);
  if (!entry) throw new Error("homepage module entry is missing");
  const entryUrl = new URL(entry, canonicalOrigin);
  if (entryUrl.origin !== canonicalOrigin) {
    throw new Error(
      "homepage module entry is not served by the canonical origin",
    );
  }
  await requireSuccessfulResponse(entryUrl, "application/javascript");

  return { homepage: homepage.url, entry: entryUrl.href };
}

export async function verifyWithRetries({
  origin = DEFAULT_ORIGIN,
  attempts = DEFAULT_ATTEMPTS,
  requiredSuccesses = DEFAULT_REQUIRED_SUCCESSES,
  delayMs = DEFAULT_DELAY_MS,
} = {}) {
  if (requiredSuccesses > attempts) {
    throw new Error("required successes cannot exceed attempts");
  }

  let consecutiveSuccesses = 0;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await verifyCloudflareDeployment(origin);
      consecutiveSuccesses += 1;
      console.log(
        `Production smoke ${attempt}/${attempts} passed (${consecutiveSuccesses}/${requiredSuccesses} consecutive).`,
      );
      if (consecutiveSuccesses >= requiredSuccesses) return result;
    } catch (error) {
      consecutiveSuccesses = 0;
      lastError = error;
      console.error(
        `Production smoke ${attempt}/${attempts} failed: ${error.message}`,
      );
    }
    if (attempt < attempts) await sleep(delayMs);
  }

  throw new Error(
    `Production did not pass ${requiredSuccesses} consecutive checks: ${lastError?.message ?? "unknown failure"}`,
  );
}

const invokedDirectly = process.argv[1]
  ? import.meta.url === new URL(`file://${process.argv[1]}`).href
  : false;

if (invokedDirectly) {
  const result = await verifyWithRetries({
    origin: process.env.PRODUCTION_ORIGIN ?? DEFAULT_ORIGIN,
    attempts: positiveInteger(
      process.env.PRODUCTION_SMOKE_ATTEMPTS,
      DEFAULT_ATTEMPTS,
      "PRODUCTION_SMOKE_ATTEMPTS",
    ),
    requiredSuccesses: positiveInteger(
      process.env.PRODUCTION_SMOKE_REQUIRED_SUCCESSES,
      DEFAULT_REQUIRED_SUCCESSES,
      "PRODUCTION_SMOKE_REQUIRED_SUCCESSES",
    ),
    delayMs: positiveInteger(
      process.env.PRODUCTION_SMOKE_DELAY_MS,
      DEFAULT_DELAY_MS,
      "PRODUCTION_SMOKE_DELAY_MS",
    ),
  });
  console.log(`Cloudflare production verified: ${JSON.stringify(result)}`);
}
