#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

const DEFAULT_MAX_BODY_BYTES = 2_000_000;
const DEFAULT_MAX_SNIPPETS = 12;
const DEFAULT_SNIPPET_CHARS = 320;
const RETRY_DELAYS_MS = [1_000, 3_000];

function decodeEntities(value) {
  return String(value ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&quot;/gi, '"').replace(/&apos;|&#39;/gi, "'")
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ');
}

function plainText(value) {
  return decodeEntities(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\\u003c/gi, '<').replace(/\\u003e/gi, '>').replace(/\\u0026/gi, '&')
    .replace(/\\\//g, '/').replace(/\\n|\\r|\\t/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function collectJsonStrings(value, output = [], depth = 0) {
  if (depth > 8 || output.length >= 500) return output;
  if (typeof value === 'string') output.push(value);
  else if (Array.isArray(value)) for (const item of value) collectJsonStrings(item, output, depth + 1);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) collectJsonStrings(item, output, depth + 1);
  return output;
}

function metaValue(html, key, attribute = 'property') {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+${attribute}=["']${escaped}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+${attribute}=["']${escaped}["']`, 'i')
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return plainText(match[1]);
  }
  return null;
}

function validCoordinate(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}

function extractCoordinates(...values) {
  const coordinates = new Map();
  const add = (latValue, lngValue, source) => {
    const lat = Number(latValue), lng = Number(lngValue);
    if (!validCoordinate(lat, lng)) return;
    const key = `${lat.toFixed(7)},${lng.toFixed(7)}`;
    if (!coordinates.has(key)) coordinates.set(key, { lat, lng, source });
  };
  for (const value of values.filter(Boolean).map(String)) {
    for (const match of value.matchAll(/\/@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)(?:,|\/|$)/g)) add(match[1], match[2], 'map_viewport');
    for (const match of value.matchAll(/!3d(-?\d{1,2}(?:\.\d+)?)[^!]{0,40}!4d(-?\d{1,3}(?:\.\d+)?)/g)) add(match[1], match[2], 'map_place_pin');
    for (const match of value.matchAll(/(?:center|query|destination|daddr|ll|sll)=(-?\d{1,2}(?:\.\d+)?)(?:%2C|,)(-?\d{1,3}(?:\.\d+)?)/gi)) add(match[1], match[2], 'map_url');
    for (const match of value.matchAll(/\b(?:lat|latitude)["'=:\s]+(-?\d{1,2}(?:\.\d+)?).{0,80}?\b(?:lng|lon|longitude)["'=:\s]+(-?\d{1,3}(?:\.\d+)?)/gi)) add(match[1], match[2], 'page_text');
  }
  const results = [...coordinates.values()];
  if (results.some((item) => item.source === 'map_place_pin')) return results.filter((item) => item.source !== 'map_viewport');
  return results.map((item) => item.source === 'map_viewport' ? { ...item, source: 'map_url' } : item);
}

function extractRelevantLinks(html, baseUrl) {
  const links = [];
  for (const match of String(html ?? '').matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = plainText(match[2]);
    const rawHref = decodeEntities(match[1]).replace(/\\\//g, '/');
    let url;
    try { url = new URL(rawHref, baseUrl).href; } catch { continue; }
    let hostname = '';
    try { hostname = new URL(url).hostname; } catch { continue; }
    if (!/(?:maps|onemap)\./i.test(hostname) && !/\b(?:map|direction|start|location|address|contact|visit|find us|outlet)\b/i.test(label)) continue;
    if (!links.some((item) => item.url === url)) links.push({ label: label || null, url });
    if (links.length >= 12) break;
  }
  return links;
}

function evidenceText(body, contentType) {
  if (/json|javascript/i.test(contentType)) {
    try { return plainText(collectJsonStrings(JSON.parse(body)).join(' ')); } catch { /* fall through */ }
  }
  return plainText(body);
}

function extractEvidenceFromBody({ body, contentType = '', finalUrl, terms = [] }) {
  const html = String(body ?? '');
  const title = plainText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '') || null;
  const metadata = {
    title,
    description: metaValue(html, 'description', 'name'),
    ogTitle: metaValue(html, 'og:title'),
    ogDescription: metaValue(html, 'og:description')
  };
  const searchable = [...Object.values(metadata).filter(Boolean), evidenceText(html, contentType)].join(' ');
  const matches = [];
  for (const term of [...new Set(terms.map((item) => item.trim()).filter(Boolean))].slice(0, 12)) {
    const index = searchable.toLocaleLowerCase().indexOf(term.toLocaleLowerCase());
    if (index < 0) continue;
    const start = Math.max(0, index - Math.floor(DEFAULT_SNIPPET_CHARS / 2));
    matches.push({ term, snippet: searchable.slice(start, start + DEFAULT_SNIPPET_CHARS).trim() });
    if (matches.length >= DEFAULT_MAX_SNIPPETS) break;
  }
  return {
    metadata,
    coordinates: extractCoordinates(finalUrl, ...Object.values(metadata).filter(Boolean), searchable.slice(0, 200_000)),
    links: extractRelevantLinks(html, finalUrl),
    matches
  };
}

function parseArgs(argv) {
  const options = { terms: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--url') options.url = argv[++index];
    else if (token === '--terms') {
      const parts = [String(argv[++index] ?? '')];
      while (index + 1 < argv.length && !argv[index + 1].startsWith('--')) parts.push(argv[++index]);
      options.terms.push(...parts.join(' ').split(','));
    }
    else if (token === '--max-body-bytes') options.maxBodyBytes = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${token}`);
  }
  if (!options.url) throw new Error('Usage: npm run web-evidence -- --url <url> [--terms term,term]');
  new URL(options.url);
  options.maxBodyBytes = Number.isFinite(options.maxBodyBytes) && options.maxBodyBytes > 0 ? options.maxBodyBytes : DEFAULT_MAX_BODY_BYTES;
  return options;
}

async function fetchWebEvidence(options) {
  const attempts = [];
  let response = await fetchWithRetries(options.url, attempts, 'page');
  const shopifyFallback = shopifyProductJsonUrl(options.url);
  if (shouldRetryStatus(response.status) && shopifyFallback) {
    await response.body?.cancel();
    response = await fetchWithRetries(shopifyFallback, attempts, 'shopify_product_json');
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const body = buffer.subarray(0, options.maxBodyBytes).toString('utf8');
  const contentType = response.headers.get('content-type') ?? '';
  return {
    schemaVersion: '1.0',
    inputUrl: options.url,
    finalUrl: response.url,
    status: response.status,
    attempts,
    contentType,
    bodyBytes: buffer.length,
    bodyTruncated: buffer.length > options.maxBodyBytes,
    ...extractEvidenceFromBody({ body, contentType, finalUrl: response.url, terms: options.terms })
  };
}

async function fetchWithRetries(url, attempts, kind) {
  let response;
  for (let index = 0; index <= RETRY_DELAYS_MS.length; index += 1) {
    response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20_000), headers: { 'user-agent': 'Mozilla/5.0 event-pipeline-evidence/1.0' } });
    attempts.push({ attempt: attempts.length + 1, kind, url, status: response.status });
    if (!shouldRetryStatus(response.status) || index === RETRY_DELAYS_MS.length) break;
    await response.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[index]));
  }
  return response;
}

function shopifyProductJsonUrl(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  const match = url.pathname.match(/\/products\/([^/]+?)(?:\.js)?\/?$/i);
  if (!match || /\.js$/i.test(url.pathname)) return null;
  url.pathname = `/products/${match[1]}.js`;
  url.search = '';
  url.hash = '';
  return url.href;
}

function shouldRetryStatus(status) {
  return status === 429 || status >= 500;
}

async function main() {
  try {
    process.stdout.write(`${JSON.stringify(await fetchWebEvidence(parseArgs(process.argv.slice(2))), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();

export { extractCoordinates, extractEvidenceFromBody, extractRelevantLinks, fetchWebEvidence, shopifyProductJsonUrl, shouldRetryStatus };
