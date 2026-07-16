#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const DEFAULT_DIRS = ["optimized-tiles", "tiles"];
const DEFAULT_OUT = "outputs/data/venue-registry-candidates.json";
const DEFAULT_REVIEW_OUT = "outputs/data/venue-registry-needs-review.md";
const GENERIC_TOKENS = new Set([
  "the",
  "at",
  "and",
  "of",
  "on",
  "bay",
  "centre",
  "center",
  "theatre",
  "theater",
  "hall",
  "studio",
  "room",
  "building",
  "tower",
  "mall",
  "museum",
  "gallery",
]);

function parseArgs(argv) {
  const args = {
    dirs: DEFAULT_DIRS,
    limit: 8,
    out: DEFAULT_OUT,
    reviewOut: DEFAULT_REVIEW_OUT,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === "--events") {
      args.events = value;
      index += 1;
    } else if (key === "--registry") {
      args.registry = value;
      index += 1;
    } else if (key === "--dirs") {
      args.dirs = value.split(",").map((item) => item.trim()).filter(Boolean);
      index += 1;
    } else if (key === "--limit") {
      args.limit = Number(value);
      index += 1;
    } else if (key === "--out") {
      args.out = value;
      index += 1;
    } else if (key === "--review-out") {
      args.reviewOut = value;
      index += 1;
    } else if (key === "--help") {
      console.log("Usage: node scripts/update-venue-registry.mjs --events outputs/data/events.json [--registry data/venue-registry.json]");
      process.exit(0);
    }
  }

  if (!args.events) throw new Error("Missing --events.");
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

function tokens(value) {
  return normalize(value)
    .split(" ")
    .filter((token) => token.length > 1 && !GENERIC_TOKENS.has(token));
}

function walkB3dmFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) walkB3dmFiles(filePath, out);
    else if (entry.name.endsWith(".b3dm")) out.push(filePath);
  }
  return out;
}

function readB3dmBatchTable(filePath) {
  const bytes = fs.readFileSync(filePath);
  if (bytes.toString("utf8", 0, 4) !== "b3dm") return null;

  const featureTableJsonByteLength = bytes.readUInt32LE(12);
  const featureTableBinaryByteLength = bytes.readUInt32LE(16);
  const batchTableJsonByteLength = bytes.readUInt32LE(20);
  const batchTableJsonStart = 28 + featureTableJsonByteLength + featureTableBinaryByteLength;
  const batchTableJsonEnd = batchTableJsonStart + batchTableJsonByteLength;
  const batchTableJson = bytes.subarray(batchTableJsonStart, batchTableJsonEnd).toString("utf8").trim();
  return batchTableJson ? JSON.parse(batchTableJson) : null;
}

function scoreName(query, candidate) {
  const normalizedQuery = normalize(query);
  const normalizedCandidate = normalize(candidate);
  if (!normalizedCandidate) return 0;
  if (normalizedCandidate === normalizedQuery) return 100;
  if (` ${normalizedCandidate} `.includes(` ${normalizedQuery} `)) return 88;
  if (` ${normalizedQuery} `.includes(` ${normalizedCandidate} `)) return 78;

  const queryTokens = new Set(tokens(query));
  const candidateTokens = new Set(tokens(candidate));
  if (!queryTokens.size) return 0;
  const overlap = [...queryTokens].filter((token) => candidateTokens.has(token)).length;
  if (!overlap) return 0;
  return Math.round((overlap / queryTokens.size) * 70);
}

function loadEvents(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.rows)) return parsed.rows;
  if (Array.isArray(parsed.events)) return parsed.events;
  if (Array.isArray(parsed.records)) return parsed.records;
  throw new Error(`Unsupported events JSON shape in ${filePath}. Expected array, rows, events, or records.`);
}

function loadRegistry(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return new Map();
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const rows = Array.isArray(parsed) ? parsed : parsed.venues || parsed.entries || [];
  const approved = rows.filter((row) => {
    const explicitlyApproved = row.registryApproved === true || row.resolutionStatus === "approved" || row.status === "approved";
    const candidate = row.candidate || row;
    const hasIdentity = candidate.poiId || candidate.batchId !== undefined || candidate.gmlIds?.length || candidate.files?.length || candidate.sourceTilePaths?.length;
    const hasLocation = candidate.latitude !== undefined || candidate.anchor?.latitude !== undefined || candidate.coordinates?.lat !== undefined;
    return explicitlyApproved && hasIdentity && hasLocation;
  });
  return new Map(approved.map((row) => [normalize(row.venue || row.name || row.normalizedVenue), row]));
}

function candidateFromRegistry(row) {
  if (!row) return null;
  const latitude = row.latitude ?? row.anchor?.latitude ?? row.candidate?.latitude;
  const longitude = row.longitude ?? row.anchor?.longitude ?? row.candidate?.longitude;
  return compactObject({
    score: 100,
    name: row.metadataName || row.name || row.candidate?.name || row.venue || "",
    batchId: row.batchId ?? row.candidate?.batchId ?? null,
    gmlIds: row.gmlIds || row.candidate?.gmlIds || [],
    files: row.files || row.sourceTilePaths || row.candidate?.files || [],
    latitude: latitude ?? null,
    longitude: longitude ?? null,
    registryApproved: true,
  });
}

function createMetadataIndex(dirs) {
  const files = dirs.flatMap((dir) => walkB3dmFiles(dir));
  const rows = [];

  for (const file of files) {
    let batchTable = null;
    try {
      batchTable = readB3dmBatchTable(file);
    } catch {
      batchTable = null;
    }
    if (!batchTable) continue;

    const names = batchTable["gml:name"] || [];
    const ids = batchTable["gml:id"] || [];
    const latitudes = batchTable.Latitude || batchTable.latitude || [];
    const longitudes = batchTable.Longitude || batchTable.longitude || [];
    for (let batchId = 0; batchId < names.length; batchId += 1) {
      if (!names[batchId]) continue;
      rows.push({
        file,
        batchId,
        name: names[batchId],
        gmlId: ids[batchId] || "",
        latitude: latitudes[batchId] ?? null,
        longitude: longitudes[batchId] ?? null,
      });
    }
  }

  return { files, rows };
}

function groupCandidates(candidates) {
  const groups = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.name}::${candidate.gmlId || `${candidate.file}::${candidate.batchId}`}`;
    const group = groups.get(key) || {
      key,
      score: candidate.score,
      name: candidate.name,
      batchId: candidate.batchId,
      gmlIds: new Set(),
      files: [],
      latitude: candidate.latitude,
      longitude: candidate.longitude,
    };
    group.score = Math.max(group.score, candidate.score);
    if (candidate.gmlId) group.gmlIds.add(candidate.gmlId);
    group.files.push(candidate.file);
    groups.set(key, group);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      gmlIds: [...group.gmlIds],
      files: [...new Set(group.files)].sort(),
    }))
    .sort((a, b) => b.score - a.score || b.files.length - a.files.length || a.name.localeCompare(b.name));
}

function findCandidates(index, venue, limit) {
  const candidates = index.rows
    .map((row) => ({ ...row, score: scoreName(venue, row.name) }))
    .filter((row) => row.score > 0);
  return groupCandidates(candidates).slice(0, limit);
}

function classifyVenue(venue, candidates, registryHit) {
  if (registryHit) return "registered";
  if (!candidates.length) return "needs_review";

  const [top, second] = candidates;
  const unambiguous = !second || top.score > second.score;
  if (top.score >= 78 && unambiguous) return "candidate_matched";
  return "needs_review";
}

function toVenueRows(events, registry, index, limit) {
  const grouped = new Map();
  const missing = [];

  for (const event of events) {
    const venue = String(event.venue || event.location || event.Location || "").trim();
    const category = String(event.category || event.EventFormat || event.format || "").trim();
    if (!venue) {
      missing.push(compactObject({
        status: "missing_venue",
        title: event.title || event.Title || "",
        category,
      }));
      continue;
    }

    const key = normalize(venue);
    const row = grouped.get(key) || {
      venue,
      normalizedVenue: key,
      events: [],
    };
    row.events.push(compactObject({
      title: event.title || event.Title || "",
      date: event.date || event.EventStartDate || "",
      price: event.price || event.MinPrice || event.FixedPrice || "",
      source: event.source || "",
      url: event.url || event.Url || "",
    }));
    grouped.set(key, row);
  }

  const venues = [...grouped.values()].map((row) => {
    const registryHit = registry.get(row.normalizedVenue);
    const candidates = registryHit ? [] : findCandidates(index, row.venue, limit);
    const status = classifyVenue(row.venue, candidates, registryHit);
    const registryCandidate = candidateFromRegistry(registryHit);
    return compactObject({
      ...row,
      status,
      registryHit: registryHit || null,
      candidate: registryCandidate || candidates[0] || null,
      alternatives: candidates.slice(1),
    });
  });

  return { venues, missing };
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

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeReview(filePath, rows, missing) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lines = [
    "# Venue Registry Review Queue",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "These venues should not become POI highlights until a human approves the match.",
    "",
    "| Venue | Reason | Top Candidate | Score | Events |",
    "|---|---|---|---:|---:|",
  ];

  for (const row of rows) {
    const top = row.candidate;
    lines.push(`| ${escapeTable(row.venue)} | ${top ? "ambiguous/weak match" : "no local tile candidate"} | ${escapeTable(top?.name || "")} | ${top?.score || 0} | ${row.events.length} |`);
  }

  if (missing.length) {
    lines.push("", "## Missing Venue Text", "", "| Title | Category |", "|---|---|");
    for (const row of missing) {
      lines.push(`| ${escapeTable(row.title)} | ${escapeTable(row.category)} |`);
    }
  }

  fs.writeFileSync(filePath, `${lines.join("\n")}\n`);
}

function escapeTable(value = "") {
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

const args = parseArgs(process.argv);
const events = loadEvents(args.events);
const registry = loadRegistry(args.registry);
const index = createMetadataIndex(args.dirs);
const { venues, missing } = toVenueRows(events, registry, index, args.limit);
const needsReview = venues.filter((row) => row.status === "needs_review");
const result = {
  generatedAt: new Date().toISOString(),
  eventsFile: args.events,
  searchedFiles: index.files.length,
  uniqueVenues: venues.length,
  registered: venues.filter((row) => row.status === "registered").length,
  candidateMatched: venues.filter((row) => row.status === "candidate_matched").length,
  needsReview: needsReview.length,
  missingVenue: missing.length,
  venues,
  missing,
};

writeJson(args.out, result);
writeReview(args.reviewOut, needsReview, missing);
console.log(JSON.stringify({
  out: args.out,
  reviewOut: args.reviewOut,
  searchedFiles: result.searchedFiles,
  uniqueVenues: result.uniqueVenues,
  registered: result.registered,
  candidateMatched: result.candidateMatched,
  needsReview: result.needsReview,
  missingVenue: result.missingVenue,
}, null, 2));
