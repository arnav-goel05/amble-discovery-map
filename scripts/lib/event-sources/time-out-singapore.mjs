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
import { normalizeSchedule } from "./activity-policy.mjs";

const MONTH =
  "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const DATE = `\\d{1,2}\\s+${MONTH}\\s+20\\d{2}`;
const MONTH_FIRST_DATE = `${MONTH}\\s+\\d{1,2},?\\s+20\\d{2}`;

const SURFACES = [
  {
    key: "hotlist",
    path: /\/singapore\/things-to-do\/the-time-out-singapore-hotlist$/,
    heading: /^Best events in Singapore this week$/i,
  },
  {
    key: "weekend",
    path: /\/singapore\/things-to-do\/things-to-do-in-singapore-this-weekend$/,
    heading: /^What['’]s on in Singapore this weekend$/i,
  },
  {
    key: "month",
    path: /\/singapore\/things-to-do\/the-best-things-to-do-in-singapore-in-[a-z]+$/,
    heading: /^[A-Z][a-z]+['’]s best activities$/i,
  },
  {
    key: "art",
    path: /\/singapore\/art\/the-best-art-exhibitions-in-singapore$/,
    heading: /^Best art exhibitions in Singapore$/i,
  },
  {
    key: "concerts",
    path: /\/singapore\/music\/upcoming-concerts-in-singapore$/,
    heading: /^What['’]s in 20\d{2}$/i,
  },
];

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

function surfaceFor(url) {
  const path = new URL(url).pathname;
  return SURFACES.find((surface) => surface.path.test(path)) ?? null;
}

function boundedEventZone(markup, surface) {
  const headings = [...markup.matchAll(/<h2\b[^>]*>[\s\S]*?<\/h2>/gi)];
  const index = headings.findIndex((heading) =>
    surface.heading.test(readableText(heading[0])),
  );
  if (index < 0) return "";
  return markup.slice(
    headings[index].index + headings[index][0].length,
    headings[index + 1]?.index ?? markup.length,
  );
}

function listingDate(text) {
  const date = `(?:${DATE}|${MONTH_FIRST_DATE})`;
  const until = text.match(new RegExp(`\\bUntil\\s+(${date})`, "i"))?.[1];
  if (until) return `Until ${until}`;
  const sharedYear = text.match(
    new RegExp(
      `\\b(\\d{1,2})\\s+(${MONTH})\\s*(?:[-–]|to)?\\s*(\\d{1,2})\\s+(${MONTH})[,]?\\s+(20\\d{2})\\b`,
      "i",
    ),
  );
  if (sharedYear)
    return `${sharedYear[1]} ${sharedYear[2]} ${sharedYear[5]} to ${sharedYear[3]} ${sharedYear[4]} ${sharedYear[5]}`;
  const sameMonth = text.match(
    new RegExp(
      `\\b(${MONTH})\\s+(\\d{1,2})\\s*(?:[-–]|to)\\s*(\\d{1,2})[,]?\\s+(20\\d{2})\\b`,
      "i",
    ),
  );
  if (sameMonth)
    return `${sameMonth[1]} ${sameMonth[2]}, ${sameMonth[4]} to ${sameMonth[1]} ${sameMonth[3]}, ${sameMonth[4]}`;
  const range = text.match(
    new RegExp(`\\b(${date})\\s*(?:[-–]|to)\\s*(${date})`, "i"),
  );
  if (range) return `${range[1]} to ${range[2]}`;
  return text.match(new RegExp(`\\b(${date})\\b`, "i"))?.[1] ?? null;
}

function listingRecord(surface, ordinal, title, text) {
  return {
    title,
    dateText: listingDate(text),
    scope: "Singapore",
    surface: surface.key,
    surfaceOrdinal: ordinal,
    ...(surface.key === "hotlist" ? { hotlistOrdinal: ordinal } : {}),
  };
}

function structuredSurfaceCards(result, source, baseUrl, surface) {
  const zone = boundedEventZone(rawMarkup(result), surface);
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
    items.push({ url, record: listingRecord(surface, ordinal, title, text) });
  }
  items.sort(
    (a, b) =>
      a.record.surfaceOrdinal - b.record.surfaceOrdinal ||
      a.url.localeCompare(b.url),
  );
  const uniqueItems = [
    ...new Map(items.map((item) => [item.url, item])).values(),
  ];
  const completeSequence =
    uniqueItems.length > 0 &&
    uniqueItems.every(
      (item, index) => item.record.surfaceOrdinal === index + 1,
    );
  return {
    items: completeSequence ? uniqueItems : [],
    appearances,
    completeSequence,
  };
}

function semanticSurfaceCards(result, source, baseUrl, surface) {
  const zone = boundedEventZone(rawMarkup(result), surface);
  const articles = [...zone.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)]
    .map((match) => match[1])
    .filter((article) => {
      const text = readableText(article);
      return text && !/^\[(?:title|image)\]$/i.test(text);
    });
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
    record: listingRecord(surface, index + 1, null, readableText(article)),
  }));
  return {
    items,
    appearances: items.map((_, index) => index + 1),
    completeSequence: true,
  };
}

function surfaceCards(result, source, baseUrl, surface) {
  const structured = structuredSurfaceCards(result, source, baseUrl, surface);
  return structured.appearances.length
    ? structured
    : semanticSurfaceCards(result, source, baseUrl, surface);
}

function currentMonthRoute(result, source, baseUrl) {
  const base = new URL(baseUrl),
    pattern = new RegExp(source.listing.monthlyPathPattern);
  const candidates = renderedDocument(result).links.flatMap((link) => {
    try {
      const url = canonicalRenderedUrl(new URL(link.url, base).href),
        parsed = new URL(url);
      return parsed.hostname === base.hostname && pattern.test(parsed.pathname)
        ? [{ url, labelled: /^this month$/i.test(clean(link.text) ?? "") }]
        : [];
    } catch {
      return [];
    }
  });
  const labelled = [
    ...new Set(
      candidates.filter(({ labelled }) => labelled).map(({ url }) => url),
    ),
  ].sort();
  if (labelled.length) return labelled;
  const unlabelled = [...new Set(candidates.map(({ url }) => url))].sort();
  return unlabelled.length === 1 ? unlabelled : [];
}

const MONTH_NUMBER = new Map(
  [
    ["jan", "01"],
    ["feb", "02"],
    ["mar", "03"],
    ["apr", "04"],
    ["may", "05"],
    ["jun", "06"],
    ["jul", "07"],
    ["aug", "08"],
    ["sep", "09"],
    ["oct", "10"],
    ["nov", "11"],
    ["dec", "12"],
  ],
);

function isoScheduleDate(value) {
  const match = clean(value)?.match(
    new RegExp(`^(\\d{1,2})\\s+(${MONTH})\\s+(20\\d{2})$`, "i"),
  );
  const month = MONTH_NUMBER.get(match?.[2]?.slice(0, 3).toLowerCase());
  if (!match || !month) return null;
  const day = match[1].padStart(2, "0");
  const iso = `${match[3]}-${month}-${day}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return parsed.getUTCFullYear() === Number(match[3]) &&
    parsed.getUTCMonth() + 1 === Number(month) &&
    parsed.getUTCDate() === Number(day)
    ? iso
    : null;
}

function scheduleClock(value) {
  const match = String(value ?? "").match(
    /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i,
  );
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const meridiem = match[3]?.toLowerCase();
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (hour === 12) hour = 0;
    if (meridiem === "pm") hour += 12;
  }
  if (hour > 23 || minute > 59) return null;
  return {
    iso: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    display: `${Number(match[1])}${match[2] ? `:${match[2]}` : ""}${
      meridiem ? ` ${meridiem}` : match[2] ? "" : ":00"
    }`,
    endIndex: match.index + match[0].length,
  };
}

function rowSchedule(value) {
  const start = scheduleClock(value);
  if (!start) return null;
  const remainder = String(value).slice(start.endIndex);
  const separator = remainder.match(/^\s*(?:[-–—]|to)\s*/i);
  const end = separator
    ? scheduleClock(remainder.slice(separator[0].length))
    : null;
  return { start, end };
}

function detailSchedule(document, listingRecord) {
  const scheduleBlock =
    document.text.match(
      /^###\s+Dates and times\s*\n([\s\S]*?)(?=\n###\s|(?![\s\S]))/im,
    )?.[1] ?? "";
  const rowMatches = [
    ...scheduleBlock.matchAll(
      new RegExp(
        `^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\\s+(${DATE})\\s*$`,
        "gmi",
      ),
    ),
  ];
  const rows = rowMatches.map((match) => match[1]);
  const performances = rowMatches.flatMap((match, index) => {
    const date = isoScheduleDate(match[1]);
    const body = scheduleBlock.slice(
      match.index + match[0].length,
      rowMatches[index + 1]?.index ?? scheduleBlock.length,
    );
    const clock = rowSchedule(body);
    if (!date || !clock) return [];
    return [
      {
        startDateTime: `${date}T${clock.start.iso}:00+08:00`,
        endDateTime: clock.end
          ? `${date}T${clock.end.iso}:00+08:00`
          : null,
        dateText: match[1],
        timeText: clock.end
          ? `${clock.start.display}–${clock.end.display}`
          : clock.start.display,
      },
    ];
  });
  const timeText = [
    ...new Set(performances.map((performance) => performance.timeText)),
  ].join(", ");
  if (rows.length > 1)
    return {
      dateText: `${rows[0]} to ${rows.at(-1)}`,
      timeText: clean(timeText),
      performances,
    };
  if (rows.length === 1)
    return {
      dateText: rows[0],
      timeText: clean(timeText),
      performances,
    };
  const until = document.text.match(
    new RegExp(`(?:^|\\n)[*•-]?\\s*Until\\s+(${DATE})`, "i"),
  )?.[1];
  if (until)
    return { dateText: `Until ${until}`, timeText: null, performances: [] };
  const title = document.title ?? listingRecord?.title ?? "";
  const joined = title.match(
    new RegExp(
      `\\b(\\d{1,2})\\s*(?:&|and)\\s*(\\d{1,2})\\s+(${MONTH})[,]?\\s+(20\\d{2})`,
      "i",
    ),
  );
  if (joined)
    return {
      dateText: `${joined[1]} ${joined[3]} ${joined[4]} to ${joined[2]} ${joined[3]} ${joined[4]}`,
      timeText: null,
      performances: [],
    };
  return {
    dateText: clean(listingRecord?.dateText),
    timeText: clean(listingRecord?.timeText),
    performances: [],
  };
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
  const schedule = detailSchedule(document, listingRecord);
  const venue = detailVenue(document, listingRecord);
  return {
    ...result,
    extractedSchedule: schedule,
    document: {
      ...document,
      // Prevent the generic field parser from treating this section heading as the value "and times".
      text: document.text.replace(
        /^###\s+Dates and times\s*$/gim,
        "### Schedule",
      ),
      fields: {
        ...document.fields,
        ...(schedule.dateText ? { Date: schedule.dateText } : {}),
        ...(schedule.timeText ? { Time: schedule.timeText } : {}),
        ...(venue ? { Venue: venue } : {}),
      },
    },
  };
}

export const timeOutSingaporeAdapter = {
  id: "time-out-singapore-discovery-v1",
  listing(result, source, url = source.listing.url) {
    if (new URL(url).pathname === "/singapore") {
      const listingUrls = currentMonthRoute(result, source, url);
      return {
        detailUrls: [],
        detailItems: [],
        listingUrls,
        // The homepage route is traversal metadata, not an event appearance.
        appearances: 0,
        complete: listingUrls.length === 1,
        nextUrl: null,
        evidence:
          listingUrls.length === 1
            ? "current_month_route_discovered"
            : "current_month_route_missing",
        zeroResultConfirmed: false,
      };
    }
    const surface = surfaceFor(url);
    if (!surface)
      return {
        detailUrls: [],
        detailItems: [],
        listingUrls: [],
        appearances: 0,
        complete: false,
        nextUrl: null,
        evidence: "unapproved_listing_surface",
        zeroResultConfirmed: false,
      };
    const {
      items: detailItems,
      appearances,
      completeSequence,
    } = surfaceCards(result, source, url, surface);
    const evidenceSurface = surface.key === "hotlist" ? "hotlist" : surface.key;
    return {
      detailUrls: [],
      detailItems,
      listingUrls: [],
      appearances: appearances.length,
      complete: completeSequence,
      nextUrl: null,
      evidence: detailItems.length
        ? `bounded_numbered_${evidenceSurface}_cards`
        : surface.key === "hotlist"
          ? "numbered_hotlist_gap"
          : "numbered_surface_gap",
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
    parsed.claims.timeText = clean(enriched.document.fields.Time) ?? null;
    parsed.claims.venue = clean(enriched.document.fields.Venue) ?? null;
    parsed.performances = enriched.extractedSchedule.performances;
    parsed.schedule = normalizeSchedule(
      {
        kind:
          parsed.performances.length > 1
            ? "selectable"
            : parsed.performances.length === 1
              ? "exact"
              : undefined,
        start: parsed.performances[0]?.startDateTime ?? null,
        end: parsed.performances[0]?.endDateTime ?? null,
        sessionRefs: parsed.performances.map(
          (_, index) => `${detailUrl}#session-${index + 1}`,
        ),
        displayText: clean(
          [parsed.claims.dateText, parsed.claims.timeText]
            .filter(Boolean)
            .join(" · "),
        ),
      },
      {
        dateText: parsed.claims.dateText,
        performances: parsed.performances,
      },
    );
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
