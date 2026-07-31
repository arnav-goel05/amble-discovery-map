import { canonicalRenderedUrl } from "./tinyfish-fetch.mjs";
import {
  canonicalLinks,
  clean,
  decodeHtml,
  normalized,
  parseAuthorityDetail,
  readableText,
  renderedDocument,
  sha,
  terminalPagination,
} from "./rendered-adapter-utils.mjs";
import {
  isOrdinaryAttractionAdmission,
  normalizeSchedule,
} from "./activity-policy.mjs";
import { applyEventFieldCompleteness } from "./event-field-extraction.mjs";

function rawMarkup(result) {
  for (const value of [
    result?.text,
    result?.document?.text,
    result?.document?.content,
    result?.content,
    result?.data,
  ]) {
    if (typeof value === "string" && /<a\b/i.test(value)) return value;
  }
  return "";
}

function rawDocumentMarkup(result) {
  for (const value of [
    result?.text,
    result?.document?.text,
    result?.document?.content,
    result?.content,
    result?.data,
  ]) {
    if (typeof value === "string" && /<[^>]+>/.test(value)) return value;
  }
  return "";
}

function feverTransferState(result) {
  const markup = rawDocumentMarkup(result);
  const payload = markup.match(
    /<script\b[^>]*\bid\s*=\s*(["'])astro-tools-transfer-state\1[^>]*>([\s\S]*?)<\/script>/i,
  )?.[2];
  if (!payload) return null;
  try {
    return JSON.parse(payload.trim());
  } catch {
    return null;
  }
}

function strictOffsetTimestamp(value) {
  const text = clean(value);
  return text &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      text,
    ) &&
    Number.isFinite(Date.parse(text))
    ? text
    : null;
}

function selectorPlaceId(key) {
  return (
    String(key).match(/ForPlace:\d+:(\d+)(?::|$)/i)?.[1] ?? "unknown-place"
  );
}

function feverSelectorPerformances(result, detailUrl) {
  const state = feverTransferState(result);
  const transferState = state?.["ticket-selector-config"]?.transferState;
  if (!transferState || typeof transferState !== "object") return [];
  const performances = new Map();
  const visit = (value, placeId) => {
    if (!value || typeof value !== "object") return;
    const session = value.value;
    const start = strictOffsetTimestamp(
      session?.starts_at_iso ?? session?.startsAtIso,
    );
    const end = strictOffsetTimestamp(
      session?.ends_at_iso ?? session?.endsAtIso,
    );
    if (start) {
      const key = `${placeId}\0${start}\0${end ?? ""}`;
      const existing = performances.get(key);
      const sessionId = clean(session?.id == null ? null : String(session.id));
      performances.set(key, {
        startDateTime: start,
        endDateTime: end,
        dateText: start.slice(0, 10),
        timeText: start.slice(11, 16),
        availability:
          existing?.availability === "available" ||
          session?.has_available_tickets === true
            ? "available"
            : "sold_out",
        sourceSessionIds: [
          ...new Set([
            ...(existing?.sourceSessionIds ?? []),
            ...(sessionId ? [sessionId] : []),
          ]),
        ].sort(),
        sessionRef: `${detailUrl}#fever-session-${sha(key).slice(0, 16)}`,
      });
    }
    for (const child of Array.isArray(value) ? value : Object.values(value))
      visit(child, placeId);
  };
  for (const [key, value] of Object.entries(transferState))
    visit(value, selectorPlaceId(key));
  return [...performances.values()].sort((a, b) =>
    `${a.startDateTime}\0${a.endDateTime ?? ""}`.localeCompare(
      `${b.startDateTime}\0${b.endDateTime ?? ""}`,
    ),
  );
}

function attribute(tag, name) {
  const match = tag.match(
    new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"),
  );
  return clean(match ? decodeHtml(match[2]) : null);
}

function elementText(html, classPattern) {
  const match = html.match(
    new RegExp(
      `<[^>]+class\\s*=\\s*(["'])[^"']*${classPattern}[^"']*\\1[^>]*>([\\s\\S]*?)<\\/[^>]+>`,
      "i",
    ),
  );
  return clean(match ? readableText(match[2]) : null);
}

function visibleDate(text, title, venue, price) {
  const candidates = text
    .split(
      /\n|(?<=[a-z)])(?=\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b)/i,
    )
    .map(clean)
    .filter(Boolean);
  return (
    candidates.find(
      (value) =>
        value !== title &&
        value !== venue &&
        value !== price &&
        (/\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(?:uary|ruary|ch|il|e|y|ust|tember|ober|ember)?\b/i.test(
          value,
        ) ||
          /\b(?:today|tomorrow|this (?:week|month)|various dates|select(?: a| your)? date)\b/i.test(
            value,
          )),
    ) ?? null
  );
}

function planCards(result, source, baseUrl) {
  const items = [],
    markup = rawMarkup(result);
  let appearances = 0;
  for (const match of markup.matchAll(
    /(<a\b[^>]*\bhref\s*=\s*(["'])[^"']+\2[^>]*>)([\s\S]*?)<\/a>/gi,
  )) {
    const tag = match[1],
      body = match[3],
      href = attribute(tag, "href"),
      planId = attribute(tag, "data-plan-id");
    if (!href || !planId) continue;
    let url;
    try {
      url = canonicalRenderedUrl(new URL(href, baseUrl).href);
      if (
        !new RegExp(source.listing.detailPathPattern).test(
          new URL(url).pathname,
        )
      )
        continue;
    } catch {
      continue;
    }
    appearances += 1;
    const title = attribute(tag, "data-plan-name"),
      price = attribute(tag, "data-plan-price");
    const visible = readableText(body),
      venue = elementText(body, "(?:venue|location)");
    const dateText =
      visibleDate(visible, title, venue, price) ??
      attribute(tag, "data-plan-date")?.slice(0, 10) ??
      null;
    items.push({
      url,
      record: { sourceId: planId, title, dateText, venue, price },
    });
  }
  const byIdentity = new Map();
  for (const item of items) {
    const key = item.record.sourceId || item.url;
    if (!byIdentity.has(key)) byIdentity.set(key, item);
    else {
      const existing = byIdentity.get(key);
      existing.record = Object.fromEntries(
        Object.keys(existing.record).map((field) => [
          field,
          existing.record[field] ?? item.record[field],
        ]),
      );
    }
  }
  return {
    items: [...byIdentity.values()].sort((a, b) => a.url.localeCompare(b.url)),
    appearances,
  };
}

function gettingThere(document) {
  const block = document.text.match(
    /(?:^|\n)#{1,6}\s*Getting there\s*\n([\s\S]*?)(?=\n#{1,6}\s|$)/i,
  )?.[1];
  if (!block) return null;
  const lines = block
    .split("\n")
    .map((line) => clean(line.replace(/^[-*]\s*/, "")))
    .filter(Boolean);
  const postalAddressIndex = lines.findIndex(
    (line) => /\bSingapore\b/i.test(line) && /\b\d{6}\b/.test(line),
  );
  const addressIndex =
    postalAddressIndex >= 0
      ? postalAddressIndex
      : lines.findIndex(
          (line) =>
            /\bSingapore\b/i.test(line) &&
            /\b(?:road|rd|street|st|avenue|ave|drive|dr|lane|ln|way|crescent|close|boulevard|walk)\b/i.test(
              line,
            ),
        );
  if (addressIndex < 0) return null;
  return {
    venue: clean(lines[addressIndex - 1]),
    address: lines[addressIndex],
  };
}

function isGenericSingaporeVenue(value) {
  return /^(?:singapore(?:, singapore)?)$/i.test(clean(value) ?? "");
}

export const feverAdapter = {
  id: "fever-singapore-rendered-v1",
  listing(result, source, url = source.listing.url) {
    const { items: detailItems, appearances } = planCards(result, source, url);
    const detailUrls = [
      ...new Set([
        ...detailItems.map((item) => item.url),
        ...canonicalLinks(result, {
          baseUrl: url,
          pathPattern: source.listing.detailPathPattern,
        }),
      ]),
    ].sort();
    return {
      detailUrls,
      detailItems,
      appearances: appearances || detailUrls.length,
      ...terminalPagination(result, { baseUrl: url }),
    };
  },
  detail(result, source, detailUrl, { listingRecord = null } = {}) {
    let parsed = parseAuthorityDetail(result, {
      source,
      detailUrl,
      listingRecord,
      classify: ({ title, venue, document, schedule }) => {
        const text = normalized(`${title} ${document.text}`);
        if (
          isOrdinaryAttractionAdmission({
            title,
            description: document.text,
            schedule,
            generalAdmission: /\b(?:standard|general|regular) admission\b/.test(
              text,
            ),
            continuouslyAvailable:
              /\b(?:daily|opening hours|normal operations)\b/.test(text),
            permanentFixedAttraction:
              /\bpermanent(?: fixed)? attraction\b/.test(text),
          })
        )
          return "ordinary_attraction_admission";
        if (/johor|batam|malaysia|indonesia/.test(normalized(venue)))
          return "not_physical_sg";
        return null;
      },
    });
    const performances = feverSelectorPerformances(result, detailUrl);
    if (performances.length) {
      const starts = performances.map(({ startDateTime }) => startDateTime);
      const timeText = [
        ...new Set(performances.map((performance) => performance.timeText)),
      ].join(", ");
      parsed = {
        ...parsed,
        dateText:
          parsed.dateText ??
          (starts.length === 1
            ? starts[0].slice(0, 10)
            : `${starts[0].slice(0, 10)} to ${starts.at(-1).slice(0, 10)}`),
        timeText: clean(timeText),
        performances,
        schedule: normalizeSchedule({
          kind: performances.length > 1 ? "selectable" : "exact",
          start:
            performances.length === 1 ? performances[0].startDateTime : null,
          end: performances.length === 1 ? performances[0].endDateTime : null,
          sessionRefs: performances.map(({ sessionRef }) => sessionRef),
          displayText: parsed.dateText,
          finalKnownOccurrence:
            performances.at(-1).endDateTime ??
            performances.at(-1).startDateTime,
        }),
      };
    }
    const directions = gettingThere(renderedDocument(result));
    if (
      directions?.address &&
      (!parsed.venue || isGenericSingaporeVenue(parsed.venue))
    ) {
      parsed = {
        ...parsed,
        venue: directions.venue ?? parsed.venue,
        address: directions.address,
      };
    }
    if (!performances.length && !directions?.address) return parsed;
    const assessments = Object.values(parsed.fieldCompleteness ?? {});
    return applyEventFieldCompleteness(parsed, {
      evidenceHash:
        assessments.find(({ evidenceHash }) => evidenceHash)?.evidenceHash ??
        parsed.rawDocumentHash,
      evidenceRef:
        assessments.find(({ evidenceRef }) => evidenceRef)?.evidenceRef ?? null,
      methods: Object.fromEntries(
        Object.entries(parsed.fieldCompleteness ?? {}).flatMap(
          ([field, assessment]) =>
            assessment?.method ? [[field, assessment.method]] : [],
        ),
      ),
    });
  },
};
