#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {};

  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === "--input") {
      args.input = value;
      index += 1;
    } else if (key === "--out") {
      args.out = value;
      index += 1;
    } else if (key === "--help") {
      console.log("Usage: node scripts/parse-catch-week-md.mjs --input outputs/data/catch-this-week-2026-07-06-to-2026-07-12.md");
      process.exit(0);
    }
  }

  if (!args.input) throw new Error("Missing --input.");
  args.out ||= args.input.replace(/\.md$/i, ".json");
  return args;
}

function splitMarkdownRow(line) {
  const cells = [];
  let current = "";
  let escaped = false;

  for (const char of line.trim()) {
    if (escaped) {
      current += char;
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current.trim());
  return cells.slice(1, -1);
}

function extractUrl(value) {
  const match = value.match(/\]\(([^)]+)\)/);
  return match ? match[1] : value;
}

function normalizePrice(value) {
  const cleaned = value.replace(/^S\$/, "").trim();
  return cleaned.toLowerCase() === "not listed" ? "" : cleaned;
}

function parseRows(markdown) {
  return markdown
    .split("\n")
    .filter((line) => /^\|\s*\d+\s*\|/.test(line))
    .map((line) => {
      const [index, title, venue, start, end, format, price, free, url] = splitMarkdownRow(line);
      return {
        source: "Catch.sg",
        index: Number(index),
        title,
        category: format,
        venue,
        date: start === end ? start : `${start} to ${end}`,
        start,
        end,
        price: normalizePrice(price),
        free: free.toLowerCase() === "yes",
        url: extractUrl(url),
      };
    });
}

const args = parseArgs(process.argv);
const markdown = fs.readFileSync(args.input, "utf8");
const rows = parseRows(markdown);
const result = {
  source: "Catch.sg",
  input: args.input,
  generatedAt: new Date().toISOString(),
  count: rows.length,
  rows,
};

fs.mkdirSync(path.dirname(args.out), { recursive: true });
fs.writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ out: args.out, count: rows.length }, null, 2));
