#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const DEFAULT_DIRS = ["public/poi-tiles", "optimized-tiles", "tiles"];
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
    limit: 80,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === "--query") {
      args.query = value;
      index += 1;
    } else if (key === "--dirs") {
      args.dirs = value.split(",").map((item) => item.trim()).filter(Boolean);
      index += 1;
    } else if (key === "--limit") {
      args.limit = Number(value);
      index += 1;
    } else if (key === "--help") {
      console.log("Usage: node scripts/find-poi-tile-candidates.mjs --query \"Venue Name\" [--dirs optimized-tiles,tiles] [--limit 80]");
      process.exit(0);
    }
  }

  if (!args.query) throw new Error("Missing --query.");
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
  if (normalizedCandidate.includes(normalizedQuery)) return 88;
  if (normalizedQuery.includes(normalizedCandidate)) return 78;

  const queryTokens = new Set(tokens(query));
  const candidateTokens = new Set(tokens(candidate));
  const overlap = [...queryTokens].filter((token) => candidateTokens.has(token)).length;
  if (!overlap) return 0;
  return Math.round((overlap / queryTokens.size) * 70);
}

function candidatesForFile(filePath, query) {
  let batchTable = null;
  try {
    batchTable = readB3dmBatchTable(filePath);
  } catch {
    return [];
  }
  if (!batchTable) return [];

  const names = batchTable["gml:name"] || [];
  const ids = batchTable["gml:id"] || [];
  const hits = [];
  for (let batchId = 0; batchId < names.length; batchId += 1) {
    const name = names[batchId] || "";
    const score = scoreName(query, name);
    if (score > 0) {
      hits.push({
        score,
        file: filePath,
        batchId,
        name,
        gmlId: ids[batchId] || "",
      });
    }
  }
  return hits;
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

const args = parseArgs(process.argv);
const files = args.dirs.flatMap((dir) => walkB3dmFiles(dir));
const candidates = files.flatMap((filePath) => candidatesForFile(filePath, args.query));
const grouped = groupCandidates(candidates).slice(0, args.limit);

console.log(JSON.stringify({
  query: args.query,
  searchedFiles: files.length,
  candidateGroups: grouped.length,
  candidates: grouped,
}, null, 2));
