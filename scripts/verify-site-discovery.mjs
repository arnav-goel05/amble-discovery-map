#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SITE_IDENTITY,
  renderRobots,
  renderSitemap,
  validateSiteIdentity,
} from "../cloudflare/site-discovery.mjs";
import { verifyCloudflareFrontend } from "./verify-cloudflare-frontend.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(
  root,
  "tests/fixtures/site-discovery/identity.json",
);

export function loadExpectedIdentity(filePath = fixturePath) {
  return validateSiteIdentity(JSON.parse(fs.readFileSync(filePath, "utf8")));
}

export function sanitizeEvidence(value) {
  const secretPattern =
    /(authorization|cookie|token|secret|password|set-cookie)/i;
  if (Array.isArray(value)) return value.map(sanitizeEvidence);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !secretPattern.test(key))
        .map(([key, entry]) => [key, sanitizeEvidence(entry)]),
    );
  }
  return typeof value === "string"
    ? value.replace(
        /(?:bearer|token|secret|password)\s+[A-Za-z0-9._~+/-]+/gi,
        "[redacted]",
      )
    : value;
}

export function createReleaseRecord({
  checks,
  candidateCommit = null,
  workerVersion = null,
  rollbackVersion = null,
  startedAt = null,
  finishedAt = null,
}) {
  const sanitizedChecks = sanitizeEvidence(checks);
  const mandatoryFailed = sanitizedChecks.some(
    (check) => check.required !== false && check.status === "failed",
  );
  const externalBlocker = sanitizedChecks.some(
    (check) => check.status === "external-blocker",
  );
  return {
    schemaVersion: "1.0",
    candidateCommit,
    workerVersion,
    startedAt,
    finishedAt,
    rollbackVersion,
    checks: sanitizedChecks,
    overallStatus: mandatoryFailed
      ? "failed"
      : externalBlocker
        ? "external-blocker"
        : "passed",
  };
}

export function verifyIdentityFixture() {
  const expected = loadExpectedIdentity();
  for (const key of [
    "canonicalOrigin",
    "canonicalHomepage",
    "workerAliasHost",
    "siteName",
    "title",
    "description",
  ]) {
    if (expected[key] !== SITE_IDENTITY[key])
      throw new Error(`identity fixture differs at ${key}`);
  }
  return { expected, status: "passed" };
}

function check(id, assertion, message) {
  try {
    assertion();
    return { id, required: true, status: "passed" };
  } catch (error) {
    return {
      id,
      required: true,
      status: "failed",
      message: error?.message || message,
    };
  }
}

export function verifyStatic({ buildRoot = null } = {}) {
  const checks = [
    check("identity-fixture", () => verifyIdentityFixture()),
    check("robots-policy", () => {
      const robots = renderRobots();
      if (
        !robots.includes(
          `Sitemap: ${SITE_IDENTITY.canonicalOrigin}/sitemap.xml`,
        )
      )
        throw new Error("robots sitemap declaration is incorrect");
      if (/<html/i.test(robots)) throw new Error("robots contains HTML");
    }),
    check("sitemap-membership", () => {
      const sitemap = renderSitemap();
      if ((sitemap.match(/<loc>/g) || []).length !== 1)
        throw new Error("sitemap membership is not exactly one URL");
      if (!sitemap.includes(`<loc>${SITE_IDENTITY.canonicalHomepage}</loc>`))
        throw new Error("canonical homepage is absent from sitemap");
    }),
  ];
  if (buildRoot)
    checks.push(
      check("built-frontend", () => verifyCloudflareFrontend(buildRoot)),
    );
  return checks;
}

async function readResponse(response) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    status: response.status,
    contentType: response.headers.get("content-type"),
    cacheControl: response.headers.get("cache-control"),
    location: response.headers.get("location"),
    body: new TextDecoder().decode(bytes),
    bytes,
  };
}

function pngDimensions(bytes) {
  if (
    bytes.length < 24 ||
    ![137, 80, 78, 71, 13, 10, 26, 10].every(
      (byte, index) => bytes[index] === byte,
    )
  )
    throw new Error("social card is not a valid PNG");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

export async function verifyHttpOrigin(
  origin,
  {
    fetchImpl = fetch,
    expectedCanonicalRedirect = false,
    expectedIndexRedirect = true,
  } = {},
) {
  const base = new URL(origin);
  const request = async (pathname, method = "GET") =>
    readResponse(
      await fetchImpl(new URL(pathname, base), {
        method,
        redirect: "manual",
      }),
    );
  if (expectedCanonicalRedirect) {
    const [root, preservedPath] = await Promise.all([
      request("/"),
      request("/events/example?source=alias"),
    ]);
    return [
      check("canonical-redirect", () => {
        if (
          root.status !== 308 ||
          root.location !== SITE_IDENTITY.canonicalHomepage
        )
          throw new Error("alias must redirect once to the canonical homepage");
        if (
          preservedPath.status !== 308 ||
          preservedPath.location !==
            `${SITE_IDENTITY.canonicalOrigin}/events/example?source=alias`
        )
          throw new Error("alias redirect does not preserve path and query");
      }),
    ];
  }
  const [
    root,
    rootHead,
    robots,
    robotsHead,
    sitemap,
    sitemapHead,
    index,
    missing,
    socialCard,
    socialCardHead,
    missingAsset,
    privatePage,
    privateApi,
    missingApi,
  ] = await Promise.all([
    request("/"),
    request("/", "HEAD"),
    request("/robots.txt"),
    request("/robots.txt", "HEAD"),
    request("/sitemap.xml"),
    request("/sitemap.xml", "HEAD"),
    request("/index.html"),
    request("/__site-discovery-missing__"),
    request("/brand/amble-social-card.png"),
    request("/brand/amble-social-card.png", "HEAD"),
    request("/brand/missing.png"),
    request("/admin.html"),
    request("/api/admin/state"),
    request("/api/__site-discovery-missing__"),
  ]);
  return [
    check("homepage-http", () => {
      if (root.status !== 200 || !/text\/html/i.test(root.contentType || ""))
        throw new Error("homepage is not successful HTML");
      if (!root.body.includes(SITE_IDENTITY.title))
        throw new Error("homepage metadata is incomplete");
      if (rootHead.status !== root.status || rootHead.body)
        throw new Error("homepage HEAD differs from GET");
    }),
    check("robots-http", () => {
      if (
        robots.status !== 200 ||
        !/^text\/plain/i.test(robots.contentType || "")
      )
        throw new Error("robots response contract failed");
      if (robots.body !== renderRobots())
        throw new Error("robots policy differs");
      if (robotsHead.status !== robots.status || robotsHead.body)
        throw new Error("robots HEAD differs from GET");
    }),
    check("sitemap-http", () => {
      if (
        sitemap.status !== 200 ||
        !/(?:application|text)\/xml/i.test(sitemap.contentType || "")
      )
        throw new Error("sitemap response contract failed");
      if (sitemap.body !== renderSitemap()) throw new Error("sitemap differs");
      if (sitemapHead.status !== sitemap.status || sitemapHead.body)
        throw new Error("sitemap HEAD differs from GET");
    }),
    check("redirect-and-404-http", () => {
      if (
        expectedIndexRedirect &&
        (index.status !== 308 ||
          index.location !== SITE_IDENTITY.canonicalHomepage)
      )
        throw new Error("index.html does not redirect canonically");
      if (missing.status !== 404)
        throw new Error("unknown path is not a true 404");
      if (
        missingAsset.status !== 404 ||
        privatePage.status !== 404 ||
        privateApi.status !== 404
      )
        throw new Error("missing or private route is not a true 404");
      if (
        missingApi.status !== 404 ||
        !/application\/json/i.test(missingApi.contentType || "")
      )
        throw new Error("unknown API route does not retain its JSON 404");
    }),
    check("social-card-http", () => {
      if (
        socialCard.status !== 200 ||
        !/^image\/png/i.test(socialCard.contentType || "")
      )
        throw new Error("social card is not public PNG content");
      const dimensions = pngDimensions(socialCard.bytes);
      if (dimensions.width !== 1200 || dimensions.height !== 630)
        throw new Error("social card dimensions are not 1200x630");
      if (socialCard.bytes.byteLength > 500 * 1024)
        throw new Error("social card exceeds 500 KiB");
      if (socialCardHead.status !== socialCard.status || socialCardHead.body)
        throw new Error("social card HEAD differs from GET");
      if (/immutable/i.test(socialCard.cacheControl || ""))
        throw new Error("unversioned social card must not be cached immutably");
    }),
  ];
}

function parseCli(argv) {
  const options = { mode: "static", origins: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--mode") ((options.mode = value), (index += 1));
    else if (argument === "--origin")
      (options.origins.push(value), (index += 1));
    else if (argument === "--build-root")
      ((options.buildRoot = value), (index += 1));
    else if (argument === "--output") ((options.output = value), (index += 1));
    else if (argument === "--candidate-commit")
      ((options.candidateCommit = value), (index += 1));
    else if (argument === "--worker-version")
      ((options.workerVersion = value), (index += 1));
    else if (argument === "--rollback-version")
      ((options.rollbackVersion = value), (index += 1));
    else if (argument === "--attempts")
      ((options.attempts = Number(value)), (index += 1));
    else if (argument === "--retry-delay-ms")
      ((options.retryDelayMs = Number(value)), (index += 1));
    else throw new Error(`unknown argument: ${argument}`);
  }
  if (!["static", "preview", "live"].includes(options.mode))
    throw new Error(`unsupported mode: ${options.mode}`);
  if (options.mode !== "static" && options.origins.length === 0)
    throw new Error(`${options.mode} mode requires --origin`);
  if (
    options.attempts !== undefined &&
    (!Number.isInteger(options.attempts) || options.attempts < 1)
  )
    throw new Error("--attempts must be a positive integer");
  if (
    options.retryDelayMs !== undefined &&
    (!Number.isFinite(options.retryDelayMs) || options.retryDelayMs < 0)
  )
    throw new Error("--retry-delay-ms must be a non-negative number");
  return options;
}

export async function verifyHttpOrigins(
  origins,
  {
    mode,
    fetchImpl = fetch,
    attempts = mode === "live" ? 6 : 1,
    retryDelayMs = 10_000,
    sleepImpl = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
  },
) {
  let checks = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    checks = [];
    for (const [index, origin] of origins.entries()) {
      const redirect = mode === "live" && index > 0;
      checks.push(
        ...(await verifyHttpOrigin(origin, {
          fetchImpl,
          expectedCanonicalRedirect: redirect,
          expectedIndexRedirect: mode === "live",
        })),
      );
    }
    const failed = checks.some(
      (entry) => entry.required !== false && entry.status === "failed",
    );
    if (!failed || attempt === attempts)
      return { checks, attemptsUsed: attempt };
    await sleepImpl(retryDelayMs);
  }
  throw new Error("HTTP verification exhausted without a result");
}

export async function runVerification(options) {
  const startedAt = new Date().toISOString();
  let checks = verifyStatic({ buildRoot: options.buildRoot });
  let attemptsUsed = 0;
  if (
    options.origins.length > 0 &&
    !checks.some(
      (entry) => entry.required !== false && entry.status === "failed",
    )
  ) {
    const http = await verifyHttpOrigins(options.origins, {
      mode: options.mode,
      attempts: options.attempts ?? (options.mode === "live" ? undefined : 1),
      retryDelayMs: options.retryDelayMs ?? 10_000,
    });
    checks = checks.concat(http.checks);
    attemptsUsed = http.attemptsUsed;
  }
  const record = createReleaseRecord({
    checks,
    candidateCommit: options.candidateCommit || null,
    workerVersion: options.workerVersion || null,
    rollbackVersion: options.rollbackVersion || null,
    startedAt,
    finishedAt: new Date().toISOString(),
  });
  record.attemptsUsed = attemptsUsed;
  if (options.output) {
    const outputPath = path.resolve(options.output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(record, null, 2)}\n`);
  }
  return record;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const record = await runVerification(parseCli(process.argv.slice(2)));
  console.log(JSON.stringify(record, null, 2));
  if (record.overallStatus === "failed") process.exitCode = 1;
}
