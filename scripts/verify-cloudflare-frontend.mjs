#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SITE_IDENTITY } from "../cloudflare/site-discovery.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
  throw new Error(`Cloudflare frontend verification failed: ${message}`);
}

function attributes(tag) {
  return Object.fromEntries(
    [...tag.matchAll(/([:\w-]+)\s*=\s*["']([^"']*)["']/g)].map(
      ([, name, value]) => [name.toLowerCase(), value],
    ),
  );
}

function declarations(html, tagName, key, value) {
  return [...html.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, "gi"))]
    .map(([tag]) => attributes(tag))
    .filter((entry) => entry[key] === value);
}

function oneDeclaration(html, tagName, key, value) {
  const matches = declarations(html, tagName, key, value);
  if (matches.length !== 1) fail(`${value} must be declared exactly once`);
  return matches[0];
}

function pngDimensions(filePath) {
  const bytes = fs.readFileSync(filePath);
  if (bytes.toString("ascii", 1, 4) !== "PNG") fail(`${filePath} is not PNG`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function publicAssetPath(buildRoot, absoluteUrl) {
  const url = new URL(absoluteUrl, SITE_IDENTITY.canonicalOrigin);
  if (url.origin !== SITE_IDENTITY.canonicalOrigin)
    fail(`asset must use the canonical origin: ${absoluteUrl}`);
  return path.join(buildRoot, url.pathname.replace(/^\//, ""));
}

export function verifyCloudflareFrontend(
  buildRoot = path.join(root, "dist-cloudflare"),
) {
  const indexPath = path.join(buildRoot, "index.html");
  if (!fs.existsSync(indexPath))
    fail("dist-cloudflare/index.html is missing; run cloudflare:prepare first");

  const html = fs.readFileSync(indexPath, "utf8");
  const title = html.match(/<title>([^<]+)<\/title>/i)?.[1];
  const description = html.match(
    /<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i,
  )?.[1];
  const canonical = html.match(
    /<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i,
  )?.[1];
  const robots = html.match(
    /<meta\s+name=["']robots["']\s+content=["']([^"']+)["']/i,
  )?.[1];
  if (title !== SITE_IDENTITY.title)
    fail("the homepage title does not match the canonical identity");
  if (description !== SITE_IDENTITY.description)
    fail("the homepage description does not match the canonical identity");
  if (canonical !== SITE_IDENTITY.canonicalHomepage)
    fail("the homepage canonical URL is missing or incorrect");
  if (!/index/i.test(robots || "") || !/follow/i.test(robots || ""))
    fail("the homepage is not explicitly indexable");
  if (
    /cloudflareinsights|data-cf-beacon|google-analytics|gtag\s*\(/i.test(html)
  )
    fail("visitor analytics must be absent");

  const socialFields = {
    "og:type": "website",
    "og:site_name": SITE_IDENTITY.siteName,
    "og:locale": SITE_IDENTITY.locale,
    "og:title": SITE_IDENTITY.title,
    "og:description": SITE_IDENTITY.description,
    "og:url": SITE_IDENTITY.canonicalHomepage,
    "og:image": SITE_IDENTITY.socialImage.url,
    "og:image:type": "image/png",
    "og:image:width": String(SITE_IDENTITY.socialImage.width),
    "og:image:height": String(SITE_IDENTITY.socialImage.height),
    "og:image:alt": SITE_IDENTITY.socialImage.alt,
  };
  for (const [property, expected] of Object.entries(socialFields)) {
    const declaration = oneDeclaration(html, "meta", "property", property);
    if (declaration.content !== expected)
      fail(`${property} does not match the canonical identity`);
  }
  const twitterFields = {
    "twitter:card": "summary_large_image",
    "twitter:title": SITE_IDENTITY.title,
    "twitter:description": SITE_IDENTITY.description,
    "twitter:image": SITE_IDENTITY.socialImage.url,
    "twitter:image:alt": SITE_IDENTITY.socialImage.alt,
  };
  for (const [name, expected] of Object.entries(twitterFields)) {
    const declaration = oneDeclaration(html, "meta", "name", name);
    if (declaration.content !== expected)
      fail(`${name} does not match the canonical identity`);
  }

  const socialPath = publicAssetPath(buildRoot, SITE_IDENTITY.socialImage.url);
  if (!fs.existsSync(socialPath)) fail("the social preview asset is missing");
  const socialDimensions = pngDimensions(socialPath);
  if (
    socialDimensions.width !== SITE_IDENTITY.socialImage.width ||
    socialDimensions.height !== SITE_IDENTITY.socialImage.height
  )
    fail("the social preview has incorrect dimensions");
  if (fs.statSync(socialPath).size > SITE_IDENTITY.socialImage.maxBytes)
    fail("the social preview exceeds the byte limit");

  const favicon = oneDeclaration(html, "link", "rel", "icon");
  const touchIcon = oneDeclaration(html, "link", "rel", "apple-touch-icon");
  for (const [declaration, expected] of [
    [favicon, { width: 32, height: 32 }],
    [touchIcon, { width: 180, height: 180 }],
  ]) {
    const assetPath = publicAssetPath(buildRoot, declaration.href);
    if (!fs.existsSync(assetPath))
      fail(`icon asset is missing: ${declaration.href}`);
    assertDimensions(pngDimensions(assetPath), expected, declaration.href);
  }

  const jsonLdBlocks = [
    ...html.matchAll(
      /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ];
  if (jsonLdBlocks.length !== 1) fail("JSON-LD must be declared exactly once");
  let graph;
  try {
    graph = JSON.parse(jsonLdBlocks[0][1])["@graph"];
  } catch {
    fail("JSON-LD is not valid JSON");
  }
  if (!Array.isArray(graph) || graph.length !== 2)
    fail("JSON-LD must contain only WebSite and Organization");
  const website = graph.find((entity) => entity["@type"] === "WebSite");
  const organization = graph.find(
    (entity) => entity["@type"] === "Organization",
  );
  if (
    website?.["@id"] !== SITE_IDENTITY.websiteId ||
    website?.publisher?.["@id"] !== SITE_IDENTITY.organizationId ||
    website?.inLanguage !== SITE_IDENTITY.language ||
    organization?.["@id"] !== SITE_IDENTITY.organizationId ||
    organization?.logo?.url !== SITE_IDENTITY.logoUrl
  )
    fail("JSON-LD identity or relationships are inconsistent");
  if (
    graph.some(
      (entity) => !["WebSite", "Organization"].includes(entity["@type"]),
    )
  )
    fail("JSON-LD contains an unsupported schema type");
  const moduleMatch = html.match(
    /<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["']/i,
  );
  if (!moduleMatch) fail("the production HTML has no module entry script");

  const entryUrl = moduleMatch[1];
  const entryPath = path.join(buildRoot, entryUrl.replace(/^\//, ""));
  if (!fs.existsSync(entryPath))
    fail(`the module entry ${entryUrl} does not exist`);

  const entry = fs.readFileSync(entryPath, "utf8");
  const requiredEntrySignals = [
    "device-gate",
    "deviceSupport",
    "maxTouchPoints",
    "Singapore is waiting on the big screen",
    "Open Amble on your laptop",
  ];

  for (const signal of requiredEntrySignals) {
    if (!entry.includes(signal))
      fail(`the module entry is missing ${JSON.stringify(signal)}`);
  }

  if (!entry.includes("import("))
    fail("the 3D application is not loaded through a dynamic import");
  if (Buffer.byteLength(entry) > 100_000)
    fail(
      "the compatibility entry unexpectedly contains the full 3D application",
    );

  const stylesheets = [
    ...html.matchAll(
      /<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref=["']([^"']+)["']/gi,
    ),
  ]
    .map((match) => path.join(buildRoot, match[1].replace(/^\//, "")))
    .filter((filePath) => fs.existsSync(filePath));
  if (
    !stylesheets.some((filePath) =>
      fs.readFileSync(filePath, "utf8").includes("device-gate"),
    )
  ) {
    fail("the production HTML does not load the device-gate styles");
  }

  return {
    canonical,
    entryUrl,
    title,
    socialImage: SITE_IDENTITY.socialImage.url,
  };
}

function assertDimensions(actual, expected, label) {
  if (actual.width !== expected.width || actual.height !== expected.height)
    fail(`${label} has incorrect dimensions`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { entryUrl } = verifyCloudflareFrontend();
  console.log(`Verified Cloudflare compatibility entry ${entryUrl}.`);
}
