import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const base = process.env.CI_BASE_SHA;
const head = process.env.CI_HEAD_SHA || "HEAD";

if (!base) {
  throw new Error(
    "CI_BASE_SHA is required so formatting is checked against the correct base commit.",
  );
}

const supportedExtensions = new Set([
  ".cjs",
  ".css",
  ".js",
  ".json",
  ".jsonc",
  ".md",
  ".mjs",
  ".yaml",
  ".yml",
]);

const changedFiles = execFileSync(
  "git",
  ["diff", "--name-only", "--diff-filter=ACMR", `${base}...${head}`],
  { encoding: "utf8" },
)
  .split("\n")
  .map((file) => file.trim())
  .filter(Boolean)
  .filter((file) => supportedExtensions.has(path.extname(file)))
  .filter((file) => fs.existsSync(file));

if (changedFiles.length === 0) {
  console.log("No changed files require a formatting check.");
  process.exit(0);
}

console.log(`Checking formatting for ${changedFiles.length} changed file(s).`);
execFileSync(
  process.execPath,
  ["node_modules/prettier/bin/prettier.cjs", "--check", ...changedFiles],
  { stdio: "inherit" },
);
