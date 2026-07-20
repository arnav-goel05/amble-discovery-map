import {
  genericDiscoveryExclusion,
  parseDiscoveryDetail,
} from "./discovery-adapter-utils.mjs";
import { canonicalRenderedUrl } from "./tinyfish-fetch.mjs";
import {
  clean,
  decodeHtml,
  readableText,
  renderedDocument,
} from "./rendered-adapter-utils.mjs";

const MONTH =
  "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const DATE = `\\d{1,2}\\s+${MONTH}\\s+20\\d{2}`;

function rawMarkup(result) {
  for (const value of [
    result?.text,
    result?.document?.text,
    result?.document?.content,
    result?.content,
  ]) {
    if (typeof value === "string" && /<article\b/i.test(value)) return value;
  }
  return "";
}

function attribute(tag, name) {
  return clean(
    tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"))?.[2],
  );
}

function eventZone(markup) {
  const heading =
    /<h2\b[^>]*data-testid=["']zone-title_testID["'][^>]*>[\s\S]*?Best events in Singapore this week[\s\S]*?<\/h2>/i.exec(
      markup,
    );
  if (!heading) return "";
  const rest = markup.slice(heading.index + heading[0].length);
  const nextZone = rest.search(
    /<h2\b[^>]*data-testid=["']zone-title_testID["']/i,
  );
  return nextZone < 0 ? rest : rest.slice(0, nextZone);
}

function semanticEventZone(markup) {
  const heading =
    /<h2\b[^>]*>\s*Best events in Singapore this week\s*<\/h2>/i.exec(markup);
  if (!heading) return "";
  const rest = markup.slice(heading.index + heading[0].length);
  const nextZone = rest.search(/<h2\b[^>]*>\s*Explore Singapore\s*<\/h2>/i);
  return nextZone < 0 ? "" : rest.slice(0, nextZone);
}

function listingDate(text) {
  const until = text.match(new RegExp(`\\bUntil\\s+(${DATE})`, "i"))?.[1];
  if (until) return `Until ${until}`;
  const range = text.match(
    new RegExp(`\\b(${DATE})\\s*(?:[-–]|to)\\s*(${DATE})`, "i"),
  );
  if (range) return `${range[1]} to ${range[2]}`;
  return text.match(new RegExp(`\\b(${DATE})\\b`, "i"))?.[1] ?? null;
}

function structuredHotlistCards(result, source, baseUrl) {
  const zone = eventZone(rawMarkup(result));
  const items = [],
    appearances = [];
  for (const match of zone.matchAll(
    /<article\b[^>]*data-testid=["']tile-zone-large-list_testID["'][^>]*>([\s\S]*?)<\/article>/gi,
  )) {
    const article = match[1];
    const titleMatch =
      /(<a\b[^>]*data-testid=["']tile-link_testID["'][^>]*>)[\s\S]*?<h3\b[^>]*data-testid=["']tile-title_testID["'][^>]*>([\s\S]*?)<\/h3>/i.exec(
        article,
      );
    const title = clean(
      readableText(titleMatch?.[2] ?? "")?.replace(/^\d+\.\s*/, ""),
    );
    const ordinal = Number(
      readableText(titleMatch?.[2] ?? "").match(/^(\d+)\./)?.[1],
    );
    const href = attribute(titleMatch?.[1] ?? "", "href");
    if (!title || !Number.isInteger(ordinal) || !href) continue;
    let url;
    try {
      url = canonicalRenderedUrl(new URL(decodeHtml(href), baseUrl).href);
      const parsed = new URL(url);
      if (
        parsed.hostname !== new URL(baseUrl).hostname ||
        !new RegExp(source.listing.detailPathPattern).test(parsed.pathname)
      )
        continue;
    } catch {
      continue;
    }
    const text = readableText(article);
    appearances.push(ordinal);
    items.push({
      url,
      record: {
        title,
        dateText: listingDate(text),
        scope: "Singapore",
        hotlistOrdinal: ordinal,
      },
    });
  }
  items.sort(
    (a, b) =>
      a.record.hotlistOrdinal - b.record.hotlistOrdinal ||
      a.url.localeCompare(b.url),
  );
  const uniqueItems = [
    ...new Map(items.map((item) => [item.url, item])).values(),
  ];
  const completeSequence =
    uniqueItems.length > 0 &&
    uniqueItems.every(
      (item, index) => item.record.hotlistOrdinal === index + 1,
    );
  return {
    items: completeSequence ? uniqueItems : [],
    appearances,
    completeSequence,
  };
}

function semanticHotlistCards(result, source, baseUrl) {
  const zone = semanticEventZone(rawMarkup(result));
  const articles = [
    ...zone.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi),
  ].map((match) => match[1]);
  if (!articles.length)
    return { items: [], appearances: [], completeSequence: false };
  const base = new URL(baseUrl),
    pattern = new RegExp(source.listing.detailPathPattern);
  const rawLinks = result?.document?.links ?? result?.links ?? [];
  const orderedLinks = rawLinks
    .map((link) =>
      typeof link === "string" ? link : (link?.url ?? link?.href),
    )
    .map((url) => {
      try {
        const value = canonicalRenderedUrl(new URL(url, base).href),
          parsed = new URL(value);
        return parsed.hostname === base.hostname &&
          pattern.test(parsed.pathname) &&
          value !== canonicalRenderedUrl(base.href)
          ? value
          : null;
      } catch {
        return null;
      }
    });
  const primaryUrls = [],
    seen = new Set();
  for (let index = 0; index < orderedLinks.length; index += 1) {
    const url = orderedLinks[index];
    if (!url || seen.has(url)) continue;
    const repeatsLocally = orderedLinks
      .slice(index + 1, index + 6)
      .includes(url);
    if (!repeatsLocally) continue;
    seen.add(url);
    primaryUrls.push(url);
    if (primaryUrls.length === articles.length) break;
  }
  if (primaryUrls.length !== articles.length)
    return {
      items: [],
      appearances: primaryUrls.map((_, index) => index + 1),
      completeSequence: false,
    };
  const items = articles.map((article, index) => ({
    url: primaryUrls[index],
    record: {
      title: null,
      dateText: listingDate(readableText(article)),
      scope: "Singapore",
      hotlistOrdinal: index + 1,
    },
  }));
  return {
    items,
    appearances: items.map((_, index) => index + 1),
    completeSequence: true,
  };
}

function hotlistCards(result, source, baseUrl) {
  const structured = structuredHotlistCards(result, source, baseUrl);
  return structured.appearances.length
    ? structured
    : semanticHotlistCards(result, source, baseUrl);
}

function detailSchedule(document, listingRecord) {
  const scheduleBlock =
    document.text.match(
      /^###\s+Dates and times\s*\n([\s\S]*?)(?=\n###\s|(?![\s\S]))/im,
    )?.[1] ?? "";
  const rows = [
    ...scheduleBlock.matchAll(
      new RegExp(
        `^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\\s+(${DATE})\\s*$`,
        "gmi",
      ),
    ),
  ].map((match) => match[1]);
  if (rows.length > 1) return `${rows[0]} to ${rows.at(-1)}`;
  if (rows.length === 1) return rows[0];
  const until = document.text.match(
    new RegExp(`(?:^|\\n)[*•-]?\\s*Until\\s+(${DATE})`, "i"),
  )?.[1];
  if (until) return `Until ${until}`;
  const title = document.title ?? listingRecord?.title ?? "";
  const joined = title.match(
    new RegExp(
      `\\b(\\d{1,2})\\s*(?:&|and)\\s*(\\d{1,2})\\s+(${MONTH})[,]?\\s+(20\\d{2})`,
      "i",
    ),
  );
  if (joined)
    return `${joined[1]} ${joined[3]} ${joined[4]} to ${joined[2]} ${joined[3]} ${joined[4]}`;
  return clean(listingRecord?.dateText);
}

function detailVenue(document, listingRecord) {
  const block = document.text.match(
    /(?:^|\n)\*\*Address\*\*[ \t]*:?[ \t]*([^\n]*)([\s\S]*?)(?=\n\*\*(?:Price|Opening hours|Event website)\b|\n###\s|$)/i,
  );
  const lines = [block?.[1], ...(block?.[2] ?? "").split("\n")]
    .map((line) =>
      clean(
        String(line ?? "")
          .replace(/^\s*:\s*/, "")
          .replace(/,\s*$/, ""),
      ),
    )
    .filter((line) => line && !/^\*\*/.test(line));
  if (lines.length) return lines.slice(0, 4).join(", ");
  if (
    /\b(?:multiple locations|various venues|around the city|across Singapore)\b/i.test(
      document.text,
    )
  )
    return "Multiple locations";
  return (
    document.text.match(
      /\b(?:at|inside|within|held at|returns? to|arrives? at)\s+((?:the\s+)?[A-Z][\p{L}\p{N}'’&.*+-]*(?:\s+[A-Z][\p{L}\p{N}'’&.*+-]*){1,7})(?=[,.]|\s+(?:on|from|for|with|where|and|each|every|this)\b)/u,
    )?.[1] ?? clean(listingRecord?.venue)
  );
}

function enrichDetail(result, listingRecord) {
  const document = renderedDocument(result);
  const dateText = detailSchedule(document, listingRecord);
  const venue = detailVenue(document, listingRecord);
  return {
    ...result,
    document: {
      ...document,
      // Prevent the generic field parser from treating this section heading as the value "and times".
      text: document.text.replace(
        /^###\s+Dates and times\s*$/gim,
        "### Schedule",
      ),
      fields: {
        ...document.fields,
        ...(dateText ? { Date: dateText } : {}),
        ...(venue ? { Venue: venue } : {}),
      },
    },
  };
}

export const timeOutSingaporeAdapter = {
  id: "time-out-singapore-discovery-v1",
  listing(result, source, url = source.listing.url) {
    const {
      items: detailItems,
      appearances,
      completeSequence,
    } = hotlistCards(result, source, url);
    return {
      detailUrls: [],
      detailItems,
      appearances: appearances.length,
      complete: true,
      nextUrl: null,
      evidence: detailItems.length
        ? "bounded_numbered_hotlist_cards"
        : completeSequence
          ? "hotlist_cards_missing"
          : "numbered_hotlist_gap",
      zeroResultConfirmed: false,
    };
  },
  detail(result, source, detailUrl, { listingRecord = null } = {}) {
    const enriched = enrichDetail(result, listingRecord);
    const parsed = parseDiscoveryDetail(enriched, source, detailUrl, {
      listingRecord,
      classify: ({ document }) =>
        genericDiscoveryExclusion(document.text, [
          [
            /\b(?:promo code|discount code|giveaway|flash sale)\b/,
            "pure_promotion",
          ],
        ]),
    });
    parsed.claims.dateText = clean(enriched.document.fields.Date) ?? null;
    parsed.claims.venue = clean(enriched.document.fields.Venue) ?? null;
    if (!parsed.claims.venue) {
      const text =
        result?.document?.markdown ??
        result?.document?.text ??
        result?.markdown ??
        result?.text ??
        "";
      const fixedVenue = text.match(
        /\b(?:at|inside|within)\s+((?:the\s+)?[A-Z][\p{L}\p{N}'’&.-]*(?:\s+[A-Z][\p{L}\p{N}'’&.-]*){1,7})(?=[,.]|\s+(?:on|from|for|with|where|and|each|every|this)\b)/u,
      )?.[1];
      const distinctSites = [
        ...text.matchAll(
          /\b(?:Marina Bay|Raffles Place(?: Park)?|South Beach|Singapore River)\b/gi,
        ),
      ].map((match) => match[0].toLocaleLowerCase("en-SG"));
      parsed.claims.venue =
        new Set(distinctSites).size > 1
          ? "Multiple locations"
          : (fixedVenue ?? null);
    }
    return parsed;
  },
};
