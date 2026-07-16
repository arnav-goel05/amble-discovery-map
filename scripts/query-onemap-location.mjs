#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

const ENDPOINT = 'https://www.onemap.gov.sg/api/common/elastic/search';

function normalizeOneMapResults(payload) {
  return {
    found: Number(payload?.found ?? 0),
    totalNumPages: Number(payload?.totalNumPages ?? 0),
    results: (payload?.results ?? []).slice(0, 10).map((row) => ({
      searchValue: row.SEARCHVAL ?? null,
      address: row.ADDRESS ?? null,
      postalCode: row.POSTAL || null,
      latitude: Number.isFinite(Number(row.LATITUDE)) ? Number(row.LATITUDE) : null,
      longitude: Number.isFinite(Number(row.LONGITUDE)) ? Number(row.LONGITUDE) : null
    }))
  };
}

function parseArgs(argv) {
  const index = argv.indexOf('--query');
  const query = index >= 0 ? String(argv[index + 1] ?? '').trim() : '';
  if (!query) throw new Error('Usage: npm run onemap-geocode -- --query <verified address or postal code>');
  return { query };
}

function searchQueries(query) {
  const postalCode = query.match(/\b\d{6}\b/)?.[0] ?? null;
  const withoutUnit = query.replace(/\s*#\d{1,3}(?:-\d{1,4})?\b/g, '').replace(/\s+/g, ' ').trim();
  return [...new Set([query, withoutUnit, postalCode].filter(Boolean))];
}

async function queryOneMap(query) {
  const attempts = [];
  for (const candidate of searchQueries(query)) {
    const url = new URL(ENDPOINT);
    url.searchParams.set('searchVal', candidate);
    url.searchParams.set('returnGeom', 'Y');
    url.searchParams.set('getAddrDetails', 'Y');
    url.searchParams.set('pageNum', '1');
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`OneMap search failed with HTTP ${response.status}`);
    const result = normalizeOneMapResults(await response.json());
    attempts.push({ query: candidate, found: result.found });
    if (result.found > 0) return { schemaVersion: '1.0', query, selectedQuery: candidate, requestUrl: url.href, attempts, ...result };
  }
  return { schemaVersion: '1.0', query, selectedQuery: null, requestUrl: null, attempts, found: 0, totalNumPages: 0, results: [] };
}

async function main() {
  try {
    const { query } = parseArgs(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(await queryOneMap(query), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();

export { normalizeOneMapResults, queryOneMap, searchQueries };
