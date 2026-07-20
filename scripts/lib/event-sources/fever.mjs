import { canonicalRenderedUrl } from "./tinyfish-fetch.mjs";
import {
  canonicalLinks,
  clean,
  decodeHtml,
  normalized,
  parseAuthorityDetail,
  readableText,
  terminalPagination,
} from "./rendered-adapter-utils.mjs";
import { isOrdinaryAttractionAdmission } from "./activity-policy.mjs";

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
    return parseAuthorityDetail(result, {
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
  },
};
