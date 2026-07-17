import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const store = fs.mkdtempSync(path.join(os.tmpdir(), "whats-here-production-smoke-"));
const port = 43000 + Math.floor(Math.random() * 10000);
const origin = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  PLAN_STORE_ROOT: store,
  PUBLIC_BASE_URL: "https://whats-here.example",
  TELEGRAM_BOT_USERNAME: "WhatsHereTestBot",
  TELEGRAM_WEBHOOK_SECRET: "production-smoke-secret",
};
let child;

function start() {
  child = spawn(process.execPath, ["scripts/serve-app.cjs", "--host", "127.0.0.1", "--port", String(port)], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  let diagnostic = "";
  child.stdout.on("data", (chunk) => { diagnostic += chunk; });
  child.stderr.on("data", (chunk) => { diagnostic += chunk; });
  child.diagnostic = () => diagnostic;
}

async function waitUntilReady() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`production server exited early:\n${child.diagnostic()}`);
    try { if ((await fetch(origin)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`production server did not become ready:\n${child.diagnostic()}`);
}

async function stop() {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((_, reject) => setTimeout(() => reject(new Error("production server did not stop")), 3000)),
  ]);
}

try {
  start(); await waitUntilReady();
  const create = await fetch(`${origin}/api/plans`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Production smoke plan", travelMode: "walking", stops: [{ id: "smoke", type: "event", title: "Smoke event", place: "Esplanade", latitude: 1.2897, longitude: 103.8559 }] }),
  });
  assert.equal(create.status, 201);
  const plan = await create.json();
  assert.equal(Object.hasOwn(plan, "shareUrl"), false);
  assert.equal((await (await fetch(`${origin}/api/plans/${plan.id}`)).json()).title, "Production smoke plan");
  assert.match(await (await fetch(origin)).text(), /Amble: See What’s Happening in Singapore/);
  const backgroundTilesetUrl = `${origin}/optimized-tiles/tileset.json`;
  const compressedTileset = await fetch(backgroundTilesetUrl, { headers: { "Accept-Encoding": "gzip" } });
  assert.equal(compressedTileset.status, 200);
  assert.equal(compressedTileset.headers.get("content-encoding"), "gzip");
  assert.match(compressedTileset.headers.get("vary") || "", /accept-encoding/i);
  assert.deepEqual(
    Buffer.from(await compressedTileset.arrayBuffer()),
    fs.readFileSync(path.join(root, "optimized-tiles", "tileset.json")),
    "gzip delivery must preserve the exact tileset manifest",
  );
  const index = fs.readdirSync(path.join(root, "dist", "assets")).find((file) => /^(?:index|main)\..+\.js$/.test(file));
  assert.ok(index, "a hashed public application script must exist");
  const range = await fetch(`${origin}/assets/${index}`, { headers: { Range: "bytes=0-9" } });
  assert.equal(range.status, 206);
  assert.equal((await range.arrayBuffer()).byteLength, 10);
  assert.equal(range.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.ok(range.headers.get("etag"));

  const tilePath = fs.readdirSync(path.join(root, "dist", "poi-tiles"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join("poi-tiles", entry.name, "tileset.json"))
    .find((relative) => fs.existsSync(path.join(root, "dist", relative)));
  assert.ok(tilePath, "a production POI tileset must exist for cache verification");
  const tileUrl = `${origin}/${tilePath.split(path.sep).join("/")}`;
  const tile = await fetch(tileUrl);
  assert.equal(tile.status, 200);
  assert.equal(tile.headers.get("cache-control"), "public, max-age=300, must-revalidate");
  assert.ok(tile.headers.get("last-modified"));
  const tileEtag = tile.headers.get("etag");
  assert.ok(tileEtag);
  const revalidatedTile = await fetch(tileUrl, { headers: { "If-None-Match": tileEtag } });
  assert.equal(revalidatedTile.status, 304);
  assert.equal((await revalidatedTile.arrayBuffer()).byteLength, 0);

  const tileDirectory = path.dirname(path.join(root, "dist", tilePath));
  const buildingTileName = fs.readdirSync(tileDirectory).find((file) => file.endsWith(".b3dm"));
  assert.ok(buildingTileName, "a production building tile must exist for cache verification");
  const buildingTileUrl = `${origin}/${path.join(path.dirname(tilePath), buildingTileName).split(path.sep).join("/")}`;
  const buildingTile = await fetch(buildingTileUrl, { method: "HEAD" });
  assert.equal(buildingTile.status, 200);
  assert.equal(buildingTile.headers.get("cache-control"), "public, max-age=86400, stale-while-revalidate=604800");
  const buildingTileEtag = buildingTile.headers.get("etag");
  assert.ok(buildingTileEtag);
  const revalidatedBuildingTile = await fetch(buildingTileUrl, {
    method: "HEAD",
    headers: { "If-None-Match": buildingTileEtag },
  });
  assert.equal(revalidatedBuildingTile.status, 304);
  await stop();

  start(); await waitUntilReady();
  const persisted = await fetch(`${origin}/api/plans/${plan.id}`);
  assert.equal(persisted.status, 200);
  assert.equal((await persisted.json()).title, "Production smoke plan");
  console.log(JSON.stringify({
    cacheValidation: "verified",
    compression: "lossless_gzip_verified",
    complete: true,
    planId: plan.id,
    persistence: "restart_verified",
    rangeRequests: "verified",
  }, null, 2));
} finally {
  await stop().catch(() => {});
  fs.rmSync(store, { recursive: true, force: true });
}
