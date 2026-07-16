import fs from "fs";
import path from "path";

const TILESET_ROOT = "https://www.onemap.gov.sg/omapi/tilesets/sg_noterrain_tiles/";
const TILESET_URL = `${TILESET_ROOT}tileset.json`;
const TILE_LIMIT = Number(process.env.TILE_LIMIT || 5);
const FULL_TILES = process.env.FULL_TILES === "1";
const DOWNLOAD_CONCURRENCY = Number(process.env.DOWNLOAD_CONCURRENCY || 6);
const DOWNLOAD_RETRIES = Number(process.env.DOWNLOAD_RETRIES || 5);
const DOWNLOAD_TIMEOUT_MS = Number(process.env.DOWNLOAD_TIMEOUT_MS || 30000);
const SKIP_FAILED_TILES = process.env.SKIP_FAILED_TILES !== "0";
const SAMPLE_LON = Number(process.env.SAMPLE_LON || 103.857897);
const SAMPLE_LAT = Number(process.env.SAMPLE_LAT || 1.285844);
const REQUEST_HEADERS = {
  Referer: "https://www.onemap.gov.sg/3d",
  Origin: "https://www.onemap.gov.sg",
  "User-Agent": "Mozilla/5.0",
};

function contentUri(tile) {
  const uri = tile?.content?.uri || tile?.content?.url;
  return uri || null;
}

function collectContentTiles(tile, contentTiles = []) {
  if (contentUri(tile)) contentTiles.push(tile);
  (tile?.children || []).forEach((child) => collectContentTiles(child, contentTiles));
  return contentTiles;
}

function radians(degrees) {
  return (degrees * Math.PI) / 180;
}

function tileDistanceToTarget(tile, targetLonRad, targetLatRad) {
  const region = tile?.boundingVolume?.region;
  if (!region || region.length < 4) return Number.POSITIVE_INFINITY;

  const centerLon = (region[0] + region[2]) / 2;
  const centerLat = (region[1] + region[3]) / 2;
  return Math.hypot(centerLon - targetLonRad, centerLat - targetLatRad);
}

function cloneSampleTile(tile) {
  return {
    boundingVolume: tile.boundingVolume,
    geometricError: tile.geometricError || 0,
    refine: tile.refine,
    content: tile.content,
  };
}

function sampleTileset(tileset, sampledTiles) {
  return {
    asset: tileset.asset,
    geometricError: tileset.geometricError,
    root: {
      boundingVolume: tileset.root.boundingVolume,
      geometricError: tileset.root.geometricError,
      refine: tileset.root.refine || "ADD",
      children: sampledTiles.map(cloneSampleTile),
    },
  };
}

async function fetchFile(url, outputPath) {
  if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) return "skipped";

  let lastError;
  for (let attempt = 1; attempt <= DOWNLOAD_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: REQUEST_HEADERS,
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });
      if (!response.ok) {
        const error = new Error(`Failed ${response.status}`);
        error.status = response.status;
        throw error;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, buffer);
      return "downloaded";
    } catch (error) {
      lastError = error;
      if (error.status === 403 || error.status === 404) break;
      if (attempt < DOWNLOAD_RETRIES) {
        const delayMs = attempt * 1500;
        console.warn(`Retry ${attempt}/${DOWNLOAD_RETRIES} after ${error.message}: ${url}`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw new Error(`${lastError.message} ${url}`);
}

async function downloadUris(uris, { mirrorToOptimized = false } = {}) {
  let nextIndex = 0;
  let downloaded = 0;
  let skipped = 0;
  const failed = [];

  async function worker() {
    while (nextIndex < uris.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      const uri = uris[currentIndex];
      const fullUrl = new URL(uri, TILESET_ROOT).toString();
      const rawOutputPath = path.join("tiles", uri);
      const sampleOutputPath = path.join("optimized-tiles", uri);
      let result;
      try {
        result = await fetchFile(fullUrl, rawOutputPath);
      } catch (error) {
        if (!SKIP_FAILED_TILES) throw error;
        failed.push({ uri, url: fullUrl, error: error.message });
        fs.writeFileSync("tiles/download-failures.json", `${JSON.stringify(failed, null, 2)}\n`);
        console.warn(`Skipping failed tile: ${error.message}`);
        continue;
      }
      if (result === "skipped") skipped += 1;
      else downloaded += 1;

      if (mirrorToOptimized) {
        fs.mkdirSync(path.dirname(sampleOutputPath), { recursive: true });
        fs.copyFileSync(rawOutputPath, sampleOutputPath);
      }

      if ((currentIndex + 1) % 100 === 0 || currentIndex === uris.length - 1) {
        console.log(`${currentIndex + 1}/${uris.length} complete (${downloaded} downloaded, ${skipped} skipped)`);
      }
    }
  }

  const workerCount = Math.max(1, Math.min(DOWNLOAD_CONCURRENCY, uris.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  if (failed.length > 0) {
    fs.writeFileSync("tiles/download-failures.json", `${JSON.stringify(failed, null, 2)}\n`);
    console.warn(`Skipped ${failed.length} failed tile downloads. See tiles/download-failures.json.`);
  }
}

const response = await fetch(TILESET_URL, { headers: REQUEST_HEADERS });
if (!response.ok) throw new Error(`Failed ${response.status} ${TILESET_URL}`);

const tileset = await response.json();
fs.mkdirSync("tiles", { recursive: true });
fs.writeFileSync("tiles/tileset.json", `${JSON.stringify(tileset)}\n`);

const allContentTiles = collectContentTiles(tileset.root);
const targetLonRad = radians(SAMPLE_LON);
const targetLatRad = radians(SAMPLE_LAT);
const sampledTiles = FULL_TILES
  ? allContentTiles
  : allContentTiles
      .map((tile) => ({
        tile,
        distance: tileDistanceToTarget(tile, targetLonRad, targetLatRad),
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, TILE_LIMIT)
      .map(({ tile }) => tile);
const uris = [...new Set(sampledTiles.map(contentUri))];
const localTileset = FULL_TILES ? tileset : sampleTileset(tileset, sampledTiles);

fs.mkdirSync("optimized-tiles", { recursive: true });
fs.writeFileSync("optimized-tiles/tileset.json", `${JSON.stringify(localTileset)}\n`);

if (FULL_TILES) {
  console.log(`Fetched source tileset. Downloading all ${uris.length} content tiles with concurrency ${DOWNLOAD_CONCURRENCY}.`);
  console.log("Raw tiles go to tiles/. Run npm run optimize-tiles to create optimized-tiles/.");
  await downloadUris(uris);
} else {
  console.log(
    `Fetched source tileset. Sampling ${uris.length} of ${allContentTiles.length} content tiles nearest ${SAMPLE_LAT}, ${SAMPLE_LON}.`,
  );
  console.log("Writing the sample directly into optimized-tiles so the spike can render without a full optimization pass.");
  await downloadUris(uris, { mirrorToOptimized: true });
}
