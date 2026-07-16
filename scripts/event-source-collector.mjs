import { createHash } from 'node:crypto';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertProviderAllowed, loadProviderPolicy } from './lib/provider-policy.mjs';

const sha = (value) => createHash('sha256').update(value).digest('hex');

function atomicWrite(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, value);
  renameSync(temporary, path);
}

const writeJson = (path, value) => atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`);
const pointer = (value, path) => path === '' ? value : path.slice(1).split('/').reduce((current, token) => current?.[token.replaceAll('~1', '/').replaceAll('~0', '~')], value);
const first = (value, paths) => paths.map((path) => pointer(value, path)).find((item) => item !== undefined && item !== null && item !== '');
const text = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;
const asArray = (value) => Array.isArray(value) ? value : [];
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const DEFAULT_PROVIDER_POLICY = fileURLToPath(new URL('../data/provider-policy.json', import.meta.url));

export async function requestWithRetry(transport, request, {
  maxAttempts = 3,
  timeoutMs = 15_000,
  initialBackoffMs = 500,
  maximumBackoffMs = 4_000,
  sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
} = {}) {
  let lastError = null;
  let response = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      let timeout;
      response = await Promise.race([
        Promise.resolve().then(() => transport(request)),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(Object.assign(new Error("request timed out"), { code: "request_timeout" })), timeoutMs); }),
      ]).finally(() => clearTimeout(timeout));
      if (response?.ok || !RETRYABLE_STATUSES.has(response?.status) || attempt === maxAttempts) return { response, attempts: attempt };
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) throw Object.assign(new Error(`Request failed after ${attempt} attempts: ${error.message}`), { code: error.code ?? "request_failed", attempts: attempt });
    }
    await sleep(Math.min(maximumBackoffMs, initialBackoffMs * 2 ** (attempt - 1)));
  }
  if (response) return { response, attempts: maxAttempts };
  throw lastError ?? new Error("Request failed");
}

export function validateOfficialReference(source, requestedUrl, response) {
  if (!response?.ok) throw new Error(`Official event reference returned status ${response?.status ?? "unknown"}`);
  const domains = source?.officialDomains ?? [];
  const requested = new URL(requestedUrl);
  const destination = new URL(response.url || requestedUrl);
  const approved = (hostname) => domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  if (!approved(requested.hostname.toLowerCase())) throw new Error(`Official event reference uses unapproved domain ${requested.hostname}`);
  if (!approved(destination.hostname.toLowerCase())) throw new Error(`Official event reference redirect uses unapproved domain ${destination.hostname}`);
  return { requestedUrl: requested.href, finalUrl: destination.href, status: response.status };
}

export function validateSourcePolicy(source, policy = loadProviderPolicy(DEFAULT_PROVIDER_POLICY)) {
  if (!source?.providerId || !source?.owner || !source?.adapterId || !source?.version) {
    throw new Error(`${source?.name ?? 'Source'} has incomplete provider or adapter identity`);
  }
  const provider = assertProviderAllowed(policy, source.providerId);
  if (source.costClass !== provider.costClass || source.owner !== provider.owner) {
    throw new Error(`${source.name} provider ownership or cost classification does not match approved policy`);
  }
  if (!Array.isArray(source.officialDomains) || !source.officialDomains.length) {
    throw new Error(`${source.name} has no approved official domains`);
  }
  for (const domain of source.officialDomains) {
    assertProviderAllowed(policy, source.providerId, { url: `https://${domain}/` });
  }
  for (const endpoint of [source.listing, source.detail]) {
    assertProviderAllowed(policy, source.providerId, { url: endpoint?.url });
  }
  return provider;
}

export function sourceRecordProvenance({ run, source, retrievedAt, listingRef, responseRef, officialReferenceRef = null, officialReference = null, detailUrl }) {
  return {
    adapterId: source.adapterId,
    adapterVersion: source.version,
    adapterDefinitionHash: sha(JSON.stringify({
      adapterId: source.adapterId, version: source.version, listing: source.listing, detail: source.detail,
    })),
    providerId: source.providerId,
    providerOwner: source.owner,
    providerCostClass: source.costClass,
    sourceName: source.name,
    sourceUrl: detailUrl,
    retrievedAt,
    requestedWindow: { ...run.window, timezone: "Asia/Singapore" },
    provenance: { method: "GET", parentListingRef: listingRef, responseRef, officialReferenceRef, officialReference },
  };
}

export function canonicalDetailUrl(value, base) {
  const url = new URL(value, base);
  url.hash = '';
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) url.port = '';
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
  const retained = [...url.searchParams].filter(([key]) => !/^utm_/i.test(key) && !/^(?:gclid|fbclid)$/i.test(key));
  retained.sort(([ak, av], [bk, bv]) => ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0);
  url.search = '';
  for (const [key, item] of retained) url.searchParams.append(key, item);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`Unsupported detail URL protocol: ${url.protocol}`);
  return url.href;
}

function modeFrom(value, venue) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized.includes('hybrid')) return 'hybrid';
  if (normalized === 'online' || normalized.includes('online only')) return 'online';
  if (normalized.includes('physical') || normalized.includes('onsite') || venue) return 'physical';
  return 'unknown';
}

function performancesFrom(detail, fallback = {}) {
  const candidates = first(detail, ['/performances', '/schedules', '/event_dates', '/EventDates', '/PerformanceDates']);
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  return candidates.map((item) => ({
    startDateTime: text(first(item, ['/startDateTime', '/start_datetime', '/start_date', '/StartDateTime', '/StartDate'])),
    endDateTime: text(first(item, ['/endDateTime', '/end_datetime', '/end_date', '/EndDateTime', '/EndDate'])),
    dateText: text(first(item, ['/dateText', '/date', '/event_date', '/DisplayDate'])) ?? fallback.dateText ?? null,
    timeText: text(first(item, ['/timeText', '/time', '/event_time', '/DisplayTime'])) ?? fallback.timeText ?? null
  }));
}

const MONTHS = new Map(['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].map((month, index) => [month, index + 1]));
const WEEKDAYS = new Map([
  ['sun', 0], ['sunday', 0], ['mon', 1], ['monday', 1], ['tue', 2], ['tues', 2], ['tuesday', 2],
  ['wed', 3], ['wednesday', 3], ['thu', 4], ['thur', 4], ['thurs', 4], ['thursday', 4],
  ['fri', 5], ['friday', 5], ['sat', 6], ['saturday', 6]
]);

function catchDate(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const iso = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const named = value.trim().match(/^(\d{1,2})[\s/]([A-Za-z]{3})[\s/](\d{4})/);
  if (!named) return null;
  const month = MONTHS.get(named[2].toLowerCase());
  return month ? `${named[3]}-${String(month).padStart(2, '0')}-${String(Number(named[1])).padStart(2, '0')}` : null;
}

function catchTime(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const iso = value.trim().match(/T(\d{2}):(\d{2})/);
  if (iso) return `${iso[1]}:${iso[2]}`;
  const match = value.trim().match(/(\d{1,2}):(\d{2})(?:\s*([ap]m))?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  if (match[3]) {
    if (hour === 12) hour = 0;
    if (match[3].toLowerCase() === 'pm') hour += 12;
  }
  return `${String(hour).padStart(2, '0')}:${match[2]}`;
}

function catchDateTime(dateValue, timeValue) {
  const date = catchDate(dateValue);
  const time = catchTime(timeValue) ?? '00:00';
  return date ? `${date}T${time}:00+08:00` : null;
}

function catchCalendarDate(value) {
  return new Date(`${value}T00:00:00Z`);
}

function catchDateString(value) {
  return value.toISOString().slice(0, 10);
}

function catchScheduleDates(rangeStart, rangeEnd, dayValues, window) {
  const normalizedDays = asArray(dayValues).map((value) => String(value).trim().toLowerCase()).filter(Boolean);
  if (!normalizedDays.length) return [];
  const daily = normalizedDays.some((value) => value === 'daily' || value === 'every day');
  const weekdays = new Set(normalizedDays.map((value) => WEEKDAYS.get(value)).filter((value) => value !== undefined));
  if (!daily && !weekdays.size) return [];
  const windowStart = catchDate(window?.start) ?? rangeStart;
  const windowEnd = catchDate(window?.end) ?? rangeEnd;
  const start = catchCalendarDate(rangeStart > windowStart ? rangeStart : windowStart);
  const end = catchCalendarDate(rangeEnd < windowEnd ? rangeEnd : windowEnd);
  const dates = [];
  for (const date = start; date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    if (daily || weekdays.has(date.getUTCDay())) dates.push(catchDateString(date));
  }
  return dates;
}

function catchOccurrence(date, startClock, endClock, fullDay = false) {
  if (fullDay) return { startDateTime: null, endDateTime: null, dateText: date, timeText: 'Full day' };
  return {
    startDateTime: catchDateTime(date, startClock),
    endDateTime: catchDateTime(date, endClock ?? startClock),
    dateText: date,
    timeText: [startClock, endClock].filter(Boolean).join(' - ') || null,
  };
}

function catchPerformances(detail, window) {
  const rangeStart = catchDate(detail.EventStartDate);
  const rangeEnd = catchDate(detail.EventEndDate) ?? rangeStart;
  const schedules = asArray(detail.LstDateTime);
  const performances = schedules.flatMap((item) => {
    const explicitStartDate = catchDate(item.StartTime) ?? catchDate(item.SetDate);
    const explicitEndDate = catchDate(item.EndTime) ?? explicitStartDate;
    if (explicitStartDate) {
      const startClock = catchTime(item.StartTime) ?? catchTime(item.StartHour);
      const endClock = catchTime(item.EndTime) ?? catchTime(item.EndHour);
      if (item.IsFullDayEvent && explicitStartDate === explicitEndDate) return [catchOccurrence(explicitStartDate, null, null, true)];
      return [{
        startDateTime: catchDateTime(explicitStartDate, startClock),
        endDateTime: catchDateTime(explicitEndDate, endClock ?? startClock),
        dateText: explicitStartDate === explicitEndDate ? explicitStartDate : `${explicitStartDate} to ${explicitEndDate}`,
        timeText: [startClock, endClock].filter(Boolean).join(' - ') || null,
      }];
    }
    if (!rangeStart) return [];
    const startClock = catchTime(item.StartHour);
    const endClock = catchTime(item.EndHour);
    const recurringDates = catchScheduleDates(rangeStart, rangeEnd, item.SetDayArr, window);
    if (recurringDates.length) return recurringDates.map((date) => catchOccurrence(date, startClock, endClock, item.IsFullDayEvent));
    return [{
      startDateTime: catchDateTime(rangeStart, startClock),
      endDateTime: catchDateTime(rangeEnd, endClock ?? startClock),
      dateText: rangeStart === rangeEnd ? rangeStart : `${rangeStart} to ${rangeEnd}`,
      timeText: [startClock, endClock].filter(Boolean).join(' - ') || (item.IsFullDayEvent ? 'Full day' : null),
    }];
  });
  if (performances.length) return performances;
  if (!rangeStart) return [];
  const startClock = catchTime(detail.EventStartDate);
  const endClock = catchTime(detail.EventEndDate);
  return [{
    startDateTime: catchDateTime(rangeStart, startClock), endDateTime: catchDateTime(rangeEnd, endClock ?? startClock),
    dateText: rangeStart === rangeEnd ? rangeStart : `${rangeStart} to ${rangeEnd}`,
    timeText: [startClock, endClock].filter(Boolean).join(' - ') || null,
  }];
}

function detailUrlForListing(source, listing) {
  if (source.adapterId === 'sistic-official-listing-v1') {
    const alias = text(listing.alias);
    if (!alias) return { invalid: 'missing_detail_url' };
    return { publicUrl: canonicalDetailUrl(`/event-details/${alias}`, 'https://www.sistic.com.sg') };
  }
  const rawPath = text(listing.Url) ?? text(listing.URL) ?? text(listing.Link);
  if (!rawPath) return { invalid: 'missing_detail_url' };
  return { publicUrl: canonicalDetailUrl(rawPath, 'https://www.catch.sg') };
}

export function mapSisticDetail(detail, listing, detailUrl, listingPage) {
  const venueValue = first(detail, ['/venue_name/name', '/venue_name', '/venue/name']) ?? first(listing, ['/venue_name/name', '/venue_name']);
  const venue = text(typeof venueValue === 'object' ? venueValue.name : venueValue);
  const sourceLatitude = Number(first(detail, ['/venue_name/latitude', '/venue/latitude', '/latitude']));
  const sourceLongitude = Number(first(detail, ['/venue_name/longitude', '/venue/longitude', '/longitude']));
  const sourceCoordinates = Number.isFinite(sourceLatitude) && Number.isFinite(sourceLongitude)
    ? { lat: sourceLatitude, lng: sourceLongitude }
    : null;
  const dateText = text(first(detail, ['/event_date', '/date_text'])) ?? text(first(listing, ['/event_date']));
  const fixture = {
    adapterVersion: '1.0', listingPage, detailUrl, sourceId: text(detail.alias) ?? text(listing.alias),
    title: text(detail.title) ?? text(listing.title), mode: modeFrom(first(detail, ['/event_format', '/format', '/mode']), venue),
    dateText, timeText: text(first(detail, ['/event_time', '/time_text'])), venue,
    address: text(first(detail, ['/venue_name/address', '/venue_address', '/address'])),
    sourceCoordinates,
    category: text(first(detail, ['/category/name', '/category', '/genre'])),
    price: text(first(detail, ['/price', '/price_range', '/ticket_price'])),
    description: text(first(detail, ['/description', '/synopsis'])),
    organizer: text(first(detail, ['/organizer', '/promoter', '/presenter'])), performances: []
  };
  fixture.performances = performancesFrom(detail, fixture);
  if (!fixture.performances.length) fixture.performances = [{
    startDateTime: text(detail.start_date) ?? text(listing.start_date), endDateTime: text(detail.end_date) ?? text(listing.end_date),
    dateText: fixture.dateText, timeText: fixture.timeText
  }];
  return fixture;
}

export function mapCatchDetail(detail, listing, detailUrl, listingPage, window = null) {
  const venue = text(first(detail, ['/Location', '/Venue', '/EventVenue', '/Address/Location'])) ?? text(first(listing, ['/Info/Location', '/Location']));
  const startDate = catchDate(detail.EventStartDate);
  const endDate = catchDate(detail.EventEndDate) ?? startDate;
  const dateText = text(first(detail, ['/DisplayEventDate', '/EventDate', '/DateText']))
    ?? (startDate ? (startDate === endDate ? startDate : `${startDate} to ${endDate}`) : null)
    ?? text(first(listing, ['/Info/EventDate', '/EventDate']));
  const fixture = {
    adapterVersion: '1.0', listingPage, detailUrl, sourceId: new URL(detailUrl).pathname,
    recordType: detail.MembershipExclusivesPromo && /^\s*(?:[•*-]\s*)?offer\b/i.test(String(detail.AdmissionRule ?? '').replace(/<[^>]+>/g, ' ').trim())
      ? 'membership_offer' : 'event',
    title: text(first(detail, ['/DisplayEventTitle', '/Title'])) ?? text(first(listing, ['/Title', '/Name'])),
    mode: modeFrom(first(detail, ['/EventFormat', '/Format']) ?? first(listing, ['/Info/EventFormat']), venue),
    dateText, timeText: text(first(detail, ['/DisplayEventTime', '/EventTime', '/TimeText'])), venue,
    address: text(first(detail, ['/Address', '/VenueAddress', '/LocationAddress'])),
    category: text(first(detail, ['/Category', '/EventCategory'])) ?? text(first(listing, ['/Info/Category'])),
    price: text(first(detail, ['/Price', '/DisplayPrice'])) ?? text(first(listing, ['/Info/Price'])),
    description: text(first(detail, ['/Description', '/Synopsis', '/EventDescription'])),
    organizer: text(first(detail, ['/Organizer', '/Presenter', '/PresentedBy'])), performances: []
  };
  fixture.performances = catchPerformances(detail, window);
  return fixture;
}

function interval(record) {
  const start = Date.parse(record.startDateTime ?? record.dateText ?? '');
  const end = Date.parse(record.endDateTime ?? record.startDateTime ?? record.dateText ?? '');
  return Number.isFinite(start) ? { start, end: Number.isFinite(end) ? end : start } : null;
}

export function classifyFixture(fixture, window) {
  if (!fixture.sourceId) return 'missing_source_id';
  if (!fixture.title) return 'missing_title';
  if (!fixture.detailUrl) return 'missing_detail_url';
  return null;
}

async function defaultTransport(request) {
  const response = await fetch(request.url, { method: request.method, headers: request.headers, body: request.body });
  const rawText = await response.text();
  let body;
  try { body = JSON.parse(rawText); } catch { body = null; }
  return { status: response.status, ok: response.ok, url: response.url, body, text: rawText };
}

function requestForListing(source, window, pageIndex) {
  if (source.adapterId === 'catch-official-listing-v1') {
    const start = window.start.slice(0, 10).split('-').reverse().join('/');
    const end = window.end.slice(0, 10).split('-').reverse().join('/');
    const eventDate = `${start}-${end}`;
    return { url: source.listing.url, method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({
      'filter[pageIndex]': String(pageIndex), 'filter[PageSize]': String(source.listing.pageSize), 'filter[EventDate]': eventDate,
      pathUrl: `https://www.catch.sg/Event?EventDate=${encodeURIComponent(eventDate)}`
    }).toString() };
  }
  const url = new URL(source.listing.url);
  Object.entries({ first: (pageIndex - 1) * source.listing.pageSize, limit: source.listing.pageSize, sort_type: 'date', sort_order: 'ASC', index: 'global', client: 1 })
    .forEach(([key, value]) => url.searchParams.set(key, String(value)));
  return { url: url.href, method: 'GET' };
}

async function requestDetail(source, listing, transport, publicUrl) {
  if (source.adapterId === 'sistic-official-listing-v1') {
    const alias = text(listing.alias);
    if (!alias) return { invalid: 'missing_detail_url' };
    const url = new URL(source.detail.url); url.searchParams.set('client', '1'); url.searchParams.set('code', alias);
    publicUrl = publicUrl ?? canonicalDetailUrl(`/event-details/${alias}`, 'https://www.sistic.com.sg');
    const response = await transport({ url: url.href, method: 'GET' });
    if (!response.ok) return { publicUrl, response };
    const officialResponse = await transport({ url: publicUrl, method: 'GET' });
    return { publicUrl, response, officialResponse };
  }
  if (!publicUrl) {
    const rawPath = text(listing.Url) ?? text(listing.URL) ?? text(listing.Link);
    if (!rawPath) return { invalid: 'missing_detail_url' };
    publicUrl = canonicalDetailUrl(rawPath, 'https://www.catch.sg');
  }
  const bootstrap = await transport({ url: publicUrl, method: 'GET' });
  if (!bootstrap.ok) return { blocked: `Catch detail bootstrap returned HTTP ${bootstrap.status}` };
  const eventPageID = bootstrap.text.match(/event-detail-page-id=["']([^"']+)["']/i)?.[1];
  if (!eventPageID) return { blocked: 'Catch detail bootstrap no longer exposes event-detail-page-id' };
  const body = new URLSearchParams({ pathUrl: publicUrl, eventPageID, articlePageSize: '6', photosPageSize: '8', isPhotosPaginated: 'false', articlePageIndex: '1', photosPageIndex: '1' });
  return { publicUrl, officialResponse: bootstrap, response: await transport({ url: source.detail.url, method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() }) };
}

export async function collectSource({ runDir, run, source, transport = defaultTransport, now = () => new Date().toISOString(), paginationCeiling = 50, requestPolicy = {} }) {
  try { validateSourcePolicy(source); }
  catch (error) { return { status: 'blocked', blockerReasonCode: 'provider_policy_invalid', error: error.message }; }
  const resilientTransport = async (request) => (await requestWithRetry(transport, request, requestPolicy)).response;
  const slug = source.adapterId.split('-')[0];
  const pages = [], listings = [];
  let providerTotal = null, pageTotal = null;
  for (let pageIndex = 1; pageIndex <= paginationCeiling; pageIndex += 1) {
    const response = await resilientTransport(requestForListing(source, run.window, pageIndex));
    if (!response.ok || !response.body) return { status: 'blocked', blockerReasonCode: 'source_unavailable', error: `${source.name} listing returned HTTP ${response.status}` };
    const pageRef = `raw/${slug}/listings/page-${String(pageIndex).padStart(4, '0')}.json`;
    writeJson(join(runDir, pageRef), response.body);
    const records = pointer(response.body, source.listing.recordsPointer);
    const total = pointer(response.body, source.listing.totalPointer);
    if (!Array.isArray(records) || !Number.isInteger(total)) return { status: 'blocked', blockerReasonCode: 'layout_contract_changed', error: `${source.name} listing response no longer matches configured pointers` };
    if (providerTotal === null) providerTotal = total;
    else if (providerTotal !== total) return { status: 'blocked', blockerReasonCode: 'layout_contract_changed', error: `${source.name} provider total changed during pagination` };
    pages.push({ ref: pageRef, count: records.length });
    listings.push(...records.map((record, index) => ({ record, pageIndex, listingRef: `${pageRef}#${source.listing.recordsPointer}/${index}` })));
    pageTotal = source.listing.pageTotalPointer ? pointer(response.body, source.listing.pageTotalPointer) : Math.ceil(total / source.listing.pageSize);
    if (pageIndex >= pageTotal || listings.length >= total) break;
  }
  if (listings.length !== providerTotal) return { status: 'blocked', blockerReasonCode: 'pagination_inaccessible', error: `${source.name} pagination returned ${listings.length} of ${providerTotal} records` };

  const artifactRefs = pages.map(({ ref }) => ref), sourceRecordRefs = [], invalidSourceRecordRefs = [], processedSourceRecordRefs = [], invalidReasonCodes = {};
  let detailUrlsDiscovered = 0;
  const seenDetailUrls = new Set();
  for (const listing of listings) {
    const detailUrl = detailUrlForListing(source, listing.record);
    if (detailUrl.invalid) {
      sourceRecordRefs.push(listing.listingRef); invalidSourceRecordRefs.push(listing.listingRef); invalidReasonCodes[listing.listingRef] = detailUrl.invalid; continue;
    }
    if (seenDetailUrls.has(detailUrl.publicUrl)) {
      sourceRecordRefs.push(listing.listingRef); invalidSourceRecordRefs.push(listing.listingRef); invalidReasonCodes[listing.listingRef] = 'duplicate_detail_url'; continue;
    }
    seenDetailUrls.add(detailUrl.publicUrl);
    const detail = await requestDetail(source, listing.record, resilientTransport, detailUrl.publicUrl);
    if (detail.blocked) return { status: 'blocked', blockerReasonCode: 'layout_contract_changed', error: detail.blocked };
    if (detail.invalid) {
      sourceRecordRefs.push(listing.listingRef); invalidSourceRecordRefs.push(listing.listingRef); invalidReasonCodes[listing.listingRef] = detail.invalid; continue;
    }
    detailUrlsDiscovered += 1;
    if (!detail.response.ok || !detail.response.body) return { status: 'blocked', blockerReasonCode: 'source_unavailable', error: `${source.name} detail returned HTTP ${detail.response.status}` };
    let officialReference;
    try { officialReference = validateOfficialReference(source, detail.publicUrl, detail.officialResponse); }
    catch (error) { return { status: 'blocked', blockerReasonCode: 'official_reference_invalid', error: error.message }; }
    const rawDetail = pointer(detail.response.body, source.detail.dataPointer);
    if (!rawDetail || typeof rawDetail !== 'object') return { status: 'blocked', blockerReasonCode: 'layout_contract_changed', error: `${source.name} detail response no longer matches configured pointer` };
    const fixture = source.adapterId === 'catch-official-listing-v1'
      ? mapCatchDetail(rawDetail, listing.record, detail.publicUrl, listing.pageIndex, run.window)
      : mapSisticDetail(rawDetail, listing.record, detail.publicUrl, listing.pageIndex);
    const hash = sha(detail.publicUrl), responseRef = `raw/${slug}/details/${hash}.response.json`, fixtureRef = `raw/${slug}/details/${hash}.json`;
    const officialReferenceRef = `raw/${slug}/details/${hash}.official.json`;
    const retrievedAt = now();
    Object.assign(fixture, sourceRecordProvenance({ run, source, retrievedAt, listingRef: listing.listingRef, responseRef, officialReferenceRef, officialReference, detailUrl: detail.publicUrl }));
    writeJson(join(runDir, responseRef), detail.response.body);
    writeJson(join(runDir, officialReferenceRef), {
      schemaVersion: '1.0', retrievedAt, ...officialReference,
      contentHash: sha(detail.officialResponse?.text ?? JSON.stringify(detail.officialResponse?.body ?? null)),
    });
    writeJson(join(runDir, fixtureRef), { schemaVersion: '1.0', runId: run.runId, createdAt: retrievedAt, source: source.name, counts: { records: 1 }, records: [fixture] });
    artifactRefs.push(responseRef, officialReferenceRef, fixtureRef);
    const recordRef = `${fixtureRef}#/records/0`, reason = classifyFixture(fixture, run.window);
    sourceRecordRefs.push(recordRef);
    if (reason) { invalidSourceRecordRefs.push(recordRef); invalidReasonCodes[recordRef] = reason; }
    else processedSourceRecordRefs.push(recordRef);
  }
  let occurrencesEmitted = 0, excludedOccurrences = 0, eligiblePreDedup = 0;
  for (const recordRef of processedSourceRecordRefs) {
    const fixtureRef = recordRef.split('#')[0];
    const fixture = JSON.parse(await import('node:fs/promises').then(({ readFile }) => readFile(join(runDir, fixtureRef), 'utf8'))).records[0];
    for (const occurrence of fixture.performances.length ? fixture.performances : [fixture]) {
      occurrencesEmitted += 1;
      const value = interval({ ...fixture, ...occurrence });
      const overlap = value && value.end >= Date.parse(run.window.start) && value.start <= Date.parse(run.window.end);
      const eligible = fixture.recordType !== 'membership_offer' && fixture.mode !== 'online' && fixture.venue && (overlap || !value);
      if (eligible) eligiblePreDedup += 1; else excludedOccurrences += 1;
    }
  }
  return {
    status: 'success', counts: { pages: pages.length, sourceRecordsReceived: providerTotal, invalidSourceRecords: invalidSourceRecordRefs.length, processedSourceRecords: processedSourceRecordRefs.length, occurrencesEmitted, excludedOccurrences, eligiblePreDedup },
    completion: { paginationComplete: true, pagesVisited: pages.map(({ ref }) => ref), sourceRecordsDiscovered: providerTotal, providerReportedTotal: providerTotal,
      providerTotalEvidence: { artifactRef: pages[0].ref, jsonPointer: source.listing.totalPointer }, pageRecordCounts: pages.map(({ count }) => count), detailUrlsDiscovered,
      detailPagesCaptured: new Set(processedSourceRecordRefs.map((ref) => ref.split('#')[0])).size, zeroResultConfirmed: providerTotal === 0 },
    sourceRecordRefs, invalidSourceRecordRefs, processedSourceRecordRefs, invalidReasonCodes, artifactRefs, error: null
  };
}
