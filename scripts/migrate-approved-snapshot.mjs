import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { APPROVED_LANDMARKS } from "../data/approved-landmarks.js";
import { APPROVED_POIS } from "../data/approved-pois.js";
import { computeSnapshotContentHash, hashFile, loadApprovedSnapshot, writeActiveSnapshotPointer } from "./lib/approved-snapshot.mjs";
import { validateApprovedSnapshot } from "./lib/contracts/baseline-contracts.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const snapshotId = "initial";
const snapshotDirectory = path.join(root, "data/snapshots", snapshotId);
const pointerPath = path.join(root, "data/approved-snapshot.json");

const atomicWrite = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, value);
  fs.renameSync(temporary, file);
};
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

function singaporeCalendarDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function rewriteTilesetUris(value) {
  if (Array.isArray(value)) return value.map(rewriteTilesetUris);
  if (!value || typeof value !== "object") return value;
  const result = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, rewriteTilesetUris(child)]));
  if (typeof result.uri === "string" && result.uri.startsWith("../")) result.uri = `/poi-tiles/${result.uri.slice(3)}`;
  return result;
}

function assertEquivalent(records, expected, label) {
  if (JSON.stringify(records) !== JSON.stringify(expected)) throw new Error(`${label} migration changed approved content`);
  const ids = records.map(({ id }) => id);
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) throw new Error(`${label} contains missing or duplicate stable IDs`);
}

function migrate() {
  if (fs.existsSync(pointerPath) && fs.existsSync(path.join(snapshotDirectory, "manifest.json"))) {
    const active = loadApprovedSnapshot({ root });
    if (active.snapshotId !== snapshotId) throw new Error("Refusing to replace a non-initial active snapshot during compatibility migration");
    const landmarks = JSON.parse(fs.readFileSync(path.join(snapshotDirectory, active.landmarksRef), "utf8"));
    const pois = JSON.parse(fs.readFileSync(path.join(snapshotDirectory, active.poisRef), "utf8"));
    assertEquivalent(landmarks, APPROVED_LANDMARKS, "Landmark");
    assertEquivalent(pois, APPROVED_POIS, "POI");
    const expectedTileset = rewriteTilesetUris(JSON.parse(fs.readFileSync(path.join(root, "public/poi-tiles/event-venues/tileset.json"), "utf8")));
    const migratedTileset = JSON.parse(fs.readFileSync(path.join(snapshotDirectory, active.tilesetRef), "utf8"));
    if (JSON.stringify(migratedTileset) !== JSON.stringify(expectedTileset)) throw new Error("Tileset migration no longer matches the approved combined tileset");
    return active;
  }

  fs.mkdirSync(snapshotDirectory, { recursive: true });
  const landmarksRef = "landmarks.json", poisRef = "pois.json", tilesetRef = "tileset.json";
  atomicWrite(path.join(snapshotDirectory, landmarksRef), json(APPROVED_LANDMARKS));
  atomicWrite(path.join(snapshotDirectory, poisRef), json(APPROVED_POIS));
  const currentTileset = JSON.parse(fs.readFileSync(path.join(root, "public/poi-tiles/event-venues/tileset.json"), "utf8"));
  atomicWrite(path.join(snapshotDirectory, tilesetRef), json(rewriteTilesetUris(currentTileset)));

  assertEquivalent(JSON.parse(fs.readFileSync(path.join(snapshotDirectory, landmarksRef), "utf8")), APPROVED_LANDMARKS, "Landmark");
  assertEquivalent(JSON.parse(fs.readFileSync(path.join(snapshotDirectory, poisRef), "utf8")), APPROVED_POIS, "POI");
  const publishedAt = new Date().toISOString();
  const staleAfter = new Date(new Date(publishedAt).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const start = singaporeCalendarDate(new Date(publishedAt));
  const endDate = new Date(`${start}T00:00:00.000Z`); endDate.setUTCDate(endDate.getUTCDate() + 7);
  const artifactHashes = Object.fromEntries([landmarksRef, poisRef, tilesetRef].map((reference) => [reference, hashFile(path.join(snapshotDirectory, reference))]));
  const base = {
    schemaVersion: "1.0", snapshotId, publishedAt,
    coveredWindow: { start, end: singaporeCalendarDate(endDate), timezone: "Asia/Singapore" },
    freshness: "fresh", staleAfter,
    sourceHealth: { legacyMigration: { status: "migrated", lastSuccessfulAt: publishedAt } },
    landmarksRef, poisRef, tilesetRef, previousSnapshotId: null, artifactHashes,
  };
  const manifest = validateApprovedSnapshot({ ...base, contentHash: computeSnapshotContentHash(base) });
  const manifestPath = path.join(snapshotDirectory, "manifest.json");
  atomicWrite(manifestPath, json(manifest));
  writeActiveSnapshotPointer({ root, snapshotId, manifestPath, pointerPath });
  return loadApprovedSnapshot({ root });
}

try {
  const snapshot = migrate();
  console.log(JSON.stringify({ ok: true, snapshotId: snapshot.snapshotId, contentHash: snapshot.contentHash }));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
