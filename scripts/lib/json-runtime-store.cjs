"use strict";

const fs = require("node:fs");
const path = require("node:path");

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

function fresh(timestamp, ttlMs, now = Date.now()) {
  const parsed = Date.parse(timestamp || "");
  return Number.isFinite(parsed) && now - parsed < ttlMs;
}

module.exports = { fresh, readJson, writeJsonAtomic };
