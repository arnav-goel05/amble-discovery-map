#!/usr/bin/env node

import { chromium } from 'playwright';

const START = process.env.EVENT_WINDOW_START ?? '2026-07-11';
const END = process.env.EVENT_WINDOW_END ?? '2026-07-18';
const ddmmyyyy = (value) => value.split('-').reverse().join('/');
const windowStart = Date.parse(`${START}T00:00:00+08:00`);
const windowEnd = Date.parse(`${END}T23:59:59+08:00`);

function overlaps(start, end) {
  const startValue = Date.parse(start);
  const endValue = Date.parse(end ?? start);
  return Number.isFinite(startValue) && Number.isFinite(endValue) && endValue >= windowStart && startValue <= windowEnd;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function json(response, label) {
  assert(response.ok, `${label} returned HTTP ${response.status}`);
  const value = await response.json();
  assert(value && typeof value === 'object', `${label} did not return JSON`);
  return value;
}

async function verifyCatch() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const navigation = await page.goto('https://www.catch.sg/Event', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    assert(navigation?.ok(), `Catch listing returned HTTP ${navigation?.status()}`);
    const result = await page.evaluate(async ({ start, end }) => {
      const eventDate = `${start}-${end}`;
      const fetchPage = async (pageIndex) => {
        const body = new URLSearchParams({
          'filter[pageIndex]': String(pageIndex), 'filter[PageSize]': '100', 'filter[EventDate]': eventDate,
          pathUrl: `https://www.catch.sg/Event?EventDate=${encodeURIComponent(eventDate)}`
        });
        const response = await fetch('/api/events/SearchListEvent', { method: 'POST', body });
        return { status: response.status, payload: await response.json() };
      };
      const first = await fetchPage(1);
      const pageTotal = first.payload?.data?.PageTotal ?? 0;
      const pages = [first];
      for (let pageIndex = 2; pageIndex <= pageTotal; pageIndex += 1) pages.push(await fetchPage(pageIndex));
      const records = pages.flatMap((pageResult) => pageResult.payload?.data?.Items ?? []);
      const samplePath = records.find((record) => record.Url)?.Url;
      const sampleUrl = new URL(samplePath, location.origin).href;
      const detailHtml = await (await fetch(sampleUrl)).text();
      const eventPageID = detailHtml.match(/event-detail-page-id="([^"]+)"/)?.[1];
      let detail = null;
      if (eventPageID) {
        const body = new URLSearchParams({
          pathUrl: sampleUrl, eventPageID, articlePageSize: '6', photosPageSize: '8',
          isPhotosPaginated: 'false', articlePageIndex: '1', photosPageIndex: '1'
        });
        detail = await (await fetch('/api/site/GetEventDetail', { method: 'POST', body })).json();
      }
      return { pages, sampleDetail: detail?.data };
    }, { start: ddmmyyyy(START), end: ddmmyyyy(END) });
    assert(result.pages.every((pageResult) => pageResult.status === 200 && pageResult.payload?.code === 200), 'Catch filtered listing API failed');
    assert(result.sampleDetail?.ID && result.sampleDetail?.DisplayEventTitle, 'Catch detail API contract failed');
    const data = result.pages[0].payload.data;
    assert(Number.isInteger(data?.ItemTotal) && Number.isInteger(data?.PageTotal) && Array.isArray(data?.Items), 'Catch response contract changed');
    assert(data.Items.length <= 100, 'Catch ignored the configured page size');
    const records = result.pages.flatMap((pageResult) => pageResult.payload.data.Items ?? []);
    assert(records.length === data.ItemTotal, `Catch pagination returned ${records.length} of ${data.ItemTotal} records`);
    const urls = records.map((record) => record.Url).filter(Boolean);
    const physical = records.filter((record) => ['physical', 'hybrid'].includes(String(record.Info?.EventFormat).toLowerCase()) && record.Info?.Location);
    return {
      source: 'Catch.sg', status: 'success', total: data.ItemTotal, pages: data.PageTotal,
      records: records.length, uniqueDetailUrls: new Set(urls).size, missingDetailUrls: records.length - urls.length,
      physicalRecords: physical.length, uniquePhysicalVenues: new Set(physical.map((record) => record.Info.Location.trim())).size
    };
  } finally {
    await browser.close();
  }
}

async function verifySistic() {
  const url = new URL('https://cms.sistic.com.sg/sistic/docroot/api/events');
  url.searchParams.set('first', '0');
  url.searchParams.set('limit', '30');
  url.searchParams.set('sort_type', 'date');
  url.searchParams.set('sort_order', 'ASC');
  url.searchParams.set('index', 'global');
  url.searchParams.set('client', '1');
  const firstPage = await json(await fetch(url), 'SISTIC listing API');
  assert(Array.isArray(firstPage.data), 'SISTIC response records path changed');
  const total = firstPage.total_records;
  assert(Number.isInteger(total), 'SISTIC provider total path changed');
  const records = [...firstPage.data];
  for (let first = 30; first < total; first += 30) {
    url.searchParams.set('first', String(first));
    const page = await json(await fetch(url), `SISTIC listing API offset ${first}`);
    records.push(...page.data);
  }
  assert(records.length === total, `SISTIC pagination returned ${records.length} of ${total} records`);
  const aliases = records.map((record) => record.alias).filter(Boolean);
  const inWindowPhysical = records.filter((record) => record.venue_name && overlaps(record.start_date, record.end_date));
  const sampleAlias = aliases[0];
  const detailUrl = new URL('https://cms.sistic.com.sg/sistic/docroot/api/event-detail');
  detailUrl.searchParams.set('client', '1');
  detailUrl.searchParams.set('code', sampleAlias);
  const detail = await json(await fetch(detailUrl), 'SISTIC detail API');
  assert(detail.alias === sampleAlias && detail.title, 'SISTIC detail API contract changed');
  return {
    source: 'SISTIC', status: 'success', total, records: records.length,
    uniqueDetailAliases: new Set(aliases).size, duplicateDetailAliases: aliases.length - new Set(aliases).size,
    missingDetailAliases: records.length - aliases.length,
    inWindowPhysicalRecords: inWindowPhysical.length,
    uniqueInWindowVenues: new Set(inWindowPhysical.map((record) => record.venue_name.trim())).size
  };
}

const results = [];
for (const verifier of [verifyCatch, verifySistic]) results.push(await verifier());
process.stdout.write(`${JSON.stringify({ window: { start: START, end: END }, results }, null, 2)}\n`);
