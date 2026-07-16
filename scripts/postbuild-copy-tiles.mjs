import fs from "fs";
import path from "path";

const COPY_TILES_TO_DIST = process.env.COPY_TILES_TO_DIST === "1";
const SOURCE_DIR = "optimized-tiles";
const TARGET_DIR = path.join("dist", "optimized-tiles");

if (!COPY_TILES_TO_DIST) {
  console.log("Skipping tile copy. Set COPY_TILES_TO_DIST=1 to package optimized-tiles into dist.");
  process.exit(0);
}

fs.rmSync(TARGET_DIR, { recursive: true, force: true });
fs.cpSync(SOURCE_DIR, TARGET_DIR, { recursive: true });
console.log(`Copied ${SOURCE_DIR} to ${TARGET_DIR}.`);
