#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const DEFAULT_OUT = "outputs/data/event-pill-eligibility.json";
const DEFAULT_MD_OUT = "outputs/data/event-pill-eligibility.md";

function parseArgs(argv) {
  const args = {
    out: DEFAULT_OUT,
    mdOut: DEFAULT_MD_OUT,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === "--events") {
      args.events = value;
      index += 1;
    } else if (key === "--venue-candidates") {
      args.venueCandidates = value;
      index += 1;
    } else if (key === "--out") {
      args.out = value;
      index += 1;
    } else if (key === "--md-out") {
      args.mdOut = value;
      index += 1;
    } else if (key === "--help") {
      console.log("Usage: node scripts/process-event-pill-eligibility.mjs --events outputs/data/events.json --venue-candidates outputs/data/venue-registry-candidates.json");
      process.exit(0);
    }
  }

  if (!args.events) throw new Error("Missing --events.");
  if (!args.venueCandidates) throw new Error("Missing --venue-candidates.");
  return args;
}

function normalize(value = "") {
  return String(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function loadRows(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.rows)) return parsed.rows;
  if (Array.isArray(parsed.events)) return parsed.events;
  throw new Error(`Unsupported events JSON shape in ${filePath}. Expected array, rows, or events.`);
}

function loadVenueCandidates(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const venues = parsed.venues || [];
  return new Map(venues.map((venue) => [venue.normalizedVenue || normalize(venue.venue), venue]));
}

function cleanEvent(row) {
  return {
    source: row.source || row.Source || "",
    title: row.title || row.Title || "",
    category: row.category || row.EventFormat || row.format || "",
    venue: row.venue || row.location || row.Location || "",
    date: row.date || row.EventStartDate || "",
    price: row.price || row.FixedPrice || row.MinPrice || "",
    url: row.url || row.Url || "",
  };
}

function isEmptyOptional(value) {
  return value === "" || value === null || value === undefined || (Array.isArray(value) && value.length === 0);
}

function compactObject(value) {
  if (Array.isArray(value)) return value.map(compactObject).filter((item) => !isEmptyOptional(item));
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [key, compactObject(item)])
      .filter(([, item]) => !isEmptyOptional(item)),
  );
}

function statusForEvent(event, venueMatch) {
  if (event.category.toLowerCase() === "online") return "list_only_online";
  if (!event.venue) return "missing_venue";
  if (!venueMatch) return "venue_not_processed";
  if (venueMatch.status === "needs_review") return "review_needed";
  if (!venueMatch.candidate?.latitude || !venueMatch.candidate?.longitude) return "missing_anchor";
  if (!event.title) return "missing_title";
  if (!event.date) return "missing_date";
  return "pill_ready";
}

function buildPillRecord(event, venueMatch) {
  const candidate = venueMatch.candidate;
  return compactObject({
    source: event.source,
    title: event.title,
    date: event.date,
    price: event.price,
    venue: event.venue,
    url: event.url,
    anchor: {
      longitude: candidate.longitude,
      latitude: candidate.latitude,
      source: "onemap-b3dm-batch-metadata",
      metadataName: candidate.name,
      batchId: candidate.batchId,
    },
    poi: {
      status: venueMatch.status,
      metadataName: candidate.name,
      files: candidate.files,
    },
  });
}

function processEligibility(events, venuesByName) {
  const rows = events.map(cleanEvent);
  const buckets = {
    pill_ready: [],
    review_needed: [],
    missing_venue: [],
    list_only_online: [],
    venue_not_processed: [],
    missing_anchor: [],
    missing_title: [],
    missing_date: [],
  };

  for (const event of rows) {
    const venueMatch = venuesByName.get(normalize(event.venue));
    const status = statusForEvent(event, venueMatch);
    if (status === "pill_ready") {
      buckets.pill_ready.push(buildPillRecord(event, venueMatch));
    } else {
      buckets[status].push(compactObject({
        ...event,
        reason: reasonForStatus(status),
        candidate: venueMatch?.candidate ? {
          name: venueMatch.candidate.name,
          score: venueMatch.candidate.score,
          latitude: venueMatch.candidate.latitude,
          longitude: venueMatch.candidate.longitude,
        } : null,
      }));
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    totalEvents: rows.length,
    counts: Object.fromEntries(Object.entries(buckets).map(([key, value]) => [key, value.length])),
    buckets,
  };
}

function reasonForStatus(status) {
  return {
    missing_venue: "Source row has no usable venue text.",
    list_only_online: "Online-only event should not render as a map pill.",
    venue_not_processed: "Venue was not present in the venue registry candidate output.",
    review_needed: "Venue match is weak, ambiguous, or not locally found.",
    missing_anchor: "Venue match has no usable coordinate anchor.",
    missing_title: "Pill cannot render without a title.",
    missing_date: "Partial pill still needs a date or date range.",
  }[status] || status;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeMarkdown(filePath, result) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lines = [
    "# Event Pill Eligibility",
    "",
    `Generated: ${result.generatedAt}`,
    "",
    `Total events processed: ${result.totalEvents}`,
    "",
    "| Bucket | Count |",
    "|---|---:|",
    ...Object.entries(result.counts).map(([bucket, count]) => `| ${bucket} | ${count} |`),
    "",
    "## Pill Ready",
    "",
    "| Title | Venue | Date | Anchor |",
    "|---|---|---|---|",
  ];

  for (const row of result.buckets.pill_ready) {
    lines.push(`| ${escapeTable(row.title)} | ${escapeTable(row.venue)} | ${escapeTable(row.date)} | ${row.anchor.latitude.toFixed(6)}, ${row.anchor.longitude.toFixed(6)} |`);
  }

  lines.push("", "## Needs Review", "", "| Title | Venue | Reason | Candidate |", "|---|---|---|---|");
  for (const row of result.buckets.review_needed) {
    lines.push(`| ${escapeTable(row.title)} | ${escapeTable(row.venue)} | ${escapeTable(row.reason)} | ${escapeTable(row.candidate ? `${row.candidate.name} (${row.candidate.score})` : "")} |`);
  }

  const otherBuckets = Object.entries(result.buckets).filter(([bucket]) => !["pill_ready", "review_needed"].includes(bucket));
  for (const [bucket, rows] of otherBuckets) {
    if (!rows.length) continue;
    const hasVenue = rows.some((row) => row.venue);
    lines.push("", `## ${bucket}`, "", hasVenue ? "| Title | Venue | Reason |" : "| Title | Reason |", hasVenue ? "|---|---|---|" : "|---|---|");
    for (const row of rows) {
      if (hasVenue) {
        lines.push(`| ${escapeTable(row.title)} | ${escapeTable(row.venue || "")} | ${escapeTable(row.reason)} |`);
      } else {
        lines.push(`| ${escapeTable(row.title)} | ${escapeTable(row.reason)} |`);
      }
    }
  }

  fs.writeFileSync(filePath, `${lines.join("\n")}\n`);
}

function escapeTable(value = "") {
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

const args = parseArgs(process.argv);
const events = loadRows(args.events);
const venuesByName = loadVenueCandidates(args.venueCandidates);
const result = processEligibility(events, venuesByName);
writeJson(args.out, result);
writeMarkdown(args.mdOut, result);
console.log(JSON.stringify({
  out: args.out,
  mdOut: args.mdOut,
  totalEvents: result.totalEvents,
  counts: result.counts,
}, null, 2));
