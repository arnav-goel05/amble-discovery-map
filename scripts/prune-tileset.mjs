import fs from "fs";
import path from "path";

const SOURCE_TILESET = process.env.SOURCE_TILESET || "tiles/tileset.json";
const TILE_DIR = process.env.TILE_DIR || "optimized-tiles";
const OUTPUT_TILESET = process.env.OUTPUT_TILESET || path.join(TILE_DIR, "tileset.json");

function contentUri(tile) {
  return tile?.content?.uri || tile?.content?.url || null;
}

function contentExists(uri) {
  if (!uri) return true;
  return fs.existsSync(path.join(TILE_DIR, uri));
}

function cloneTileWithAvailableContent(tile, stats) {
  const children = (tile.children || [])
    .map((child) => cloneTileWithAvailableContent(child, stats))
    .filter(Boolean);
  const uri = contentUri(tile);
  const hasContent = contentExists(uri);

  if (uri && !hasContent) stats.removed += 1;
  if (uri && hasContent) stats.kept += 1;
  if (uri && !hasContent && children.length === 0) return null;

  const clone = { ...tile };
  if (uri && !hasContent) delete clone.content;
  if (children.length > 0) clone.children = children;
  else delete clone.children;
  return clone;
}

const tileset = JSON.parse(fs.readFileSync(SOURCE_TILESET, "utf8"));
const stats = { kept: 0, removed: 0 };
const root = cloneTileWithAvailableContent(tileset.root, stats);

if (!root) throw new Error(`No renderable tiles found in ${TILE_DIR}`);

fs.mkdirSync(path.dirname(OUTPUT_TILESET), { recursive: true });
fs.writeFileSync(
  OUTPUT_TILESET,
  `${JSON.stringify(
    {
      ...tileset,
      root,
    },
    null,
    0,
  )}\n`,
);

console.log(`Wrote ${OUTPUT_TILESET}`);
console.log(`Kept ${stats.kept} content tiles; removed ${stats.removed} missing content references.`);
