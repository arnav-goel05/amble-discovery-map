const MONTHS = new Map([
  ["jan", 1],
  ["january", 1],
  ["feb", 2],
  ["february", 2],
  ["mar", 3],
  ["march", 3],
  ["apr", 4],
  ["april", 4],
  ["may", 5],
  ["jun", 6],
  ["june", 6],
  ["jul", 7],
  ["july", 7],
  ["aug", 8],
  ["august", 8],
  ["sep", 9],
  ["sept", 9],
  ["september", 9],
  ["oct", 10],
  ["october", 10],
  ["nov", 11],
  ["november", 11],
  ["dec", 12],
  ["december", 12],
]);

const MONTH_PATTERN =
  "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?";
const STRICT_ISO_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

const pad = (value) => String(value).padStart(2, "0");

export function strictIsoOffsetTimestamp(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!STRICT_ISO_OFFSET.test(text) || !Number.isFinite(Date.parse(text)))
    return null;
  return text;
}

export function normalizeSingaporeTimestamp(
  value,
  { endOfDay = false, fallbackTime = null } = {},
) {
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim();
  const strict = strictIsoOffsetTimestamp(text);
  if (strict) return strict;
  const isoDate = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDate) {
    const clock = parseClock(fallbackTime);
    return `${isoDate[1]}-${isoDate[2]}-${isoDate[3]}T${
      clock ? `${clock}:00` : endOfDay ? "23:59:59" : "00:00:00"
    }+08:00`;
  }
  const human = text.match(
    new RegExp(
      `^(?:[A-Za-z]+,?\\s+)?(\\d{1,2})\\s+(${MONTH_PATTERN})[,]?\\s+(\\d{4})(?:[,]?\\s+(\\d{1,2})(?:(?::|\\.)(\\d{2}))?\\s*(am|pm)?)?$`,
      "i",
    ),
  );
  const monthFirst = text.match(
    new RegExp(
      `^(?:[A-Za-z]+,?\\s+)?(${MONTH_PATTERN})\\s+(\\d{1,2})[,]?\\s+(\\d{4})(?:[,]?\\s+(\\d{1,2})(?:(?::|\\.)(\\d{2}))?\\s*(am|pm)?)?(?:\\s+\\+08(?::00)?)?$`,
      "i",
    ),
  );
  const compact = text.match(
    new RegExp(`^(\\d{1,2})\\s+(${MONTH_PATTERN})\\s+[’']?(\\d{2})$`, "i"),
  );
  if (!human && !monthFirst && !compact) return null;
  const day = Number(human?.[1] ?? monthFirst?.[2] ?? compact[1]);
  const month = MONTHS.get(
    (human?.[2] ?? monthFirst?.[1] ?? compact[2]).toLowerCase(),
  );
  const rawYear = Number(human?.[3] ?? monthFirst?.[3] ?? compact[3]);
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  if (!month || !validCalendarDate(year, month, day)) return null;
  const fallbackClock = parseClock(fallbackTime);
  let clock = fallbackClock
    ? `${fallbackClock}:00`
    : endOfDay
      ? "23:59:59"
      : "00:00:00";
  const time = human ?? monthFirst ?? compact;
  if (time[4]) {
    let hour = Number(time[4]);
    const minute = Number(time[5] ?? 0);
    const meridiem = time[6]?.toLowerCase();
    if (meridiem) {
      if (hour < 1 || hour > 12) return null;
      if (hour === 12) hour = 0;
      if (meridiem === "pm") hour += 12;
    }
    if (hour > 23 || minute > 59) return null;
    clock = `${pad(hour)}:${pad(minute)}:00`;
  }
  return `${year}-${pad(month)}-${pad(day)}T${clock}+08:00`;
}

function validCalendarDate(year, month, day) {
  const value = new Date(Date.UTC(year, month - 1, day));
  return (
    value.getUTCFullYear() === year &&
    value.getUTCMonth() === month - 1 &&
    value.getUTCDate() === day
  );
}

function parseClock(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/\b(\d{1,2})(?:(?::|\.)(\d{2}))?\s*(am|pm)\b/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  if (hour < 1 || hour > 12 || minute > 59) return null;
  if (hour === 12) hour = 0;
  if (match[3].toLowerCase() === "pm") hour += 12;
  return `${pad(hour)}:${pad(minute)}`;
}

function dateMatches(text) {
  const full = new RegExp(
    `\\b(\\d{1,2})\\s+(${MONTH_PATTERN})\\s*(\\d{4})?\\b`,
    "gi",
  );
  const matches = [...text.matchAll(full)].map((match) => ({
    day: Number(match[1]),
    month: MONTHS.get(match[2].toLowerCase()),
    year: match[3] ? Number(match[3]) : null,
    index: match.index,
    endIndex: match.index + match[0].length,
    raw: match[0],
  }));

  // Handles source forms such as "Thu & Sun, 27 & 30 Aug 2026".
  const shared = new RegExp(
    `\\b(\\d{1,2})\\s*&\\s*(\\d{1,2})\\s+(${MONTH_PATTERN})\\s+(\\d{4})\\b`,
    "i",
  ).exec(text);
  if (shared) {
    const secondIndex = (shared.index ?? 0) + shared[0].lastIndexOf(shared[2]);
    const month = MONTHS.get(shared[3].toLowerCase());
    matches.push(
      {
        day: Number(shared[1]),
        month,
        year: Number(shared[4]),
        index: shared.index ?? 0,
        endIndex: secondIndex,
        raw: shared[1],
      },
      {
        day: Number(shared[2]),
        month,
        year: Number(shared[4]),
        index: secondIndex,
        endIndex: (shared.index ?? 0) + shared[0].length,
        raw: `${shared[2]} ${shared[3]} ${shared[4]}`,
      },
    );
  }

  return [
    ...new Map(
      matches
        .sort((a, b) => a.index - b.index)
        .map((item) => [`${item.index}:${item.day}:${item.month}`, item]),
    ).values(),
  ];
}

export function parseEnumeratedSchedule(displayText) {
  const text =
    typeof displayText === "string"
      ? displayText.replace(/\s+/g, " ").trim()
      : "";
  const rangeConnector = /\s[-–—]\s|\b(?:to|until|through)\b/i.test(text);
  const years = text.match(/\b20\d{2}\b/g) ?? [];
  const timedClauses =
    text.match(/\b\d{1,2}(?:(?::|\.)\d{2})?\s*(?:am|pm)\b/gi) ?? [];
  const enumerationEvidence = text.includes("&") || years.length >= 2;
  if (!text || rangeConnector || !enumerationEvidence)
    return { performances: [], reasonCode: "not_enumerated" };

  const matches = dateMatches(text);
  if (matches.length < 2)
    return { performances: [], reasonCode: "enumeration_not_parsed" };
  const globalYear = matches.findLast((item) => item.year)?.year;
  if (!globalYear)
    return { performances: [], reasonCode: "enumeration_missing_year" };
  for (let index = matches.length - 1; index >= 0; index -= 1)
    matches[index].year ??= matches[index + 1]?.year ?? globalYear;

  const globalClock = parseClock(text);
  const performances = matches.map((item, index) => {
    const next = matches[index + 1];
    const localText = text.slice(item.endIndex, next?.index ?? text.length);
    const clock = parseClock(localText) ?? globalClock ?? "00:00";
    if (!item.month || !validCalendarDate(item.year, item.month, item.day))
      return null;
    const date = `${item.year}-${pad(item.month)}-${pad(item.day)}`;
    return {
      startDateTime: `${date}T${clock}:00+08:00`,
      endDateTime: null,
      dateText: date,
      timeText: clock,
      schedule: {
        kind: "exact",
        displayText: item.raw,
        evidenceReasonCode: "enumerated_dates_parsed",
      },
    };
  });
  if (performances.some((item) => item == null))
    return { performances: [], reasonCode: "enumeration_invalid_date" };
  const unique = [
    ...new Map(performances.map((item) => [item.startDateTime, item])).values(),
  ];
  return unique.length >= 2
    ? { performances: unique, reasonCode: "enumerated_dates_parsed" }
    : { performances: [], reasonCode: "enumeration_not_distinct" };
}

export function explicitContinuousSchedule(displayText) {
  return /\b(?:daily|every day|open throughout|available throughout|continuous(?:ly)?|valid from)\b/i.test(
    String(displayText ?? ""),
  );
}

export function officialProductAuthorityRefs({
  source,
  sourceId,
  bookingUrl,
  detailUrl,
} = {}) {
  const refs = new Set();
  if (source === "SISTIC" && sourceId)
    refs.add(`sistic:${String(sourceId).trim().toLowerCase()}`);
  for (const value of [bookingUrl, detailUrl]) {
    try {
      const url = new URL(value);
      const host = url.hostname.replace(/^www\./, "").toLowerCase();
      if (!["sistic.com.sg", "ticketing.sistic.com.sg"].includes(host))
        continue;
      const parts = url.pathname.split("/").filter(Boolean);
      const alias =
        parts.at(-1) === "booking" ? null : parts.at(-1)?.toLowerCase();
      if (alias && !["event-details", "events"].includes(alias))
        refs.add(`sistic:${alias}`);
    } catch {
      // Only valid official product URLs create authority references.
    }
  }
  return [...refs].sort();
}
