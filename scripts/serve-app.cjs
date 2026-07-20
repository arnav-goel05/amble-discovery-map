const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const zlib = require("node:zlib");
const { planGameApiPlugin } = require("./plan-game-api-plugin.cjs");
const { restaurantApiPlugin } = require("./restaurant-api-plugin.cjs");
const { approvedSnapshotApiPlugin } = require("./approved-snapshot-api-plugin.cjs");
const { weeklyRefreshApiPlugin } = require("./weekly-refresh-api-plugin.cjs");
const { adminApiPlugin } = require("./admin-api-plugin.cjs");
const { realtimeVoiceApiPlugin } = require("./realtime-voice-api-plugin.cjs");
const { applySecurityHeaders, errorEnvelope, sendJson } = require("./lib/http-contract.cjs");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const staticMounts = new Map([
  ["optimized-tiles", path.join(root, "optimized-tiles")],
]);
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const host = option("host", process.env.HOST || "127.0.0.1");
const port = Number(option("port", process.env.PORT || 4173));

if (!fs.existsSync(path.join(dist, "index.html"))) {
  console.error("dist/index.html is missing; run npm run build first.");
  process.exit(1);
}
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("port must be an integer from 1 to 65535.");
  process.exit(1);
}

const planGamePlugin = planGameApiPlugin();
const adminPlugin = adminApiPlugin();
const voicePlugin = realtimeVoiceApiPlugin({ root });
planGamePlugin.startWorker();
const apiMiddlewares = [approvedSnapshotApiPlugin({ root }).middleware, weeklyRefreshApiPlugin().middleware, adminPlugin.middleware, voicePlugin.middleware, planGamePlugin.middleware, restaurantApiPlugin().middleware];
const contentTypes = {
  ".b3dm": "application/octet-stream", ".css": "text/css; charset=utf-8", ".geojson": "application/geo+json; charset=utf-8",
  ".html": "text/html; charset=utf-8", ".ico": "image/x-icon", ".jpeg": "image/jpeg", ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png",
  ".svg": "image/svg+xml", ".webp": "image/webp",
};
const compressibleExtensions = new Set([".css", ".geojson", ".html", ".js", ".json", ".svg"]);

function sendFile(request, response, file) {
  const stat = fs.statSync(file);
  const extension = path.extname(file).toLowerCase();
  const type = contentTypes[extension] || "application/octet-stream";
  const isHashedAsset = /[/\\]assets[/\\]/.test(file);
  const isBuildingTile = extension === ".b3dm";
  const isTilesetManifest = extension === ".json" && /[/\\](?:poi-tiles|optimized-tiles|tiles)[/\\]/.test(file);
  const acceptsGzip = /(?:^|,)\s*gzip\s*(?:;|,|$)/i.test(String(request.headers["accept-encoding"] || ""));
  const useGzip = !request.headers.range && stat.size >= 1024 && compressibleExtensions.has(extension) && acceptsGzip;
  const etag = `"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}${useGzip ? "-gzip" : ""}"`;
  response.setHeader("Content-Type", type);
  if (compressibleExtensions.has(extension)) response.setHeader("Vary", "Accept-Encoding");
  if (useGzip) response.setHeader("Content-Encoding", "gzip");
  else response.setHeader("Accept-Ranges", "bytes");
  applySecurityHeaders(response);
  response.setHeader("ETag", etag);
  response.setHeader("Last-Modified", stat.mtime.toUTCString());
  if (isHashedAsset) response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  else if (isBuildingTile) response.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
  else if (isTilesetManifest) response.setHeader("Cache-Control", "public, max-age=300, must-revalidate");
  else response.setHeader("Cache-Control", "no-cache");

  const ifNoneMatch = String(request.headers["if-none-match"] || "");
  const modifiedSince = Date.parse(String(request.headers["if-modified-since"] || ""));
  const notModified = ifNoneMatch
    ? ifNoneMatch.split(",").map((value) => value.trim()).includes(etag)
    : Number.isFinite(modifiedSince) && modifiedSince >= Math.floor(stat.mtimeMs / 1000) * 1000;
  if (notModified && !request.headers.range) {
    response.statusCode = 304;
    return response.end();
  }
  const range = String(request.headers.range || "").match(/^bytes=(\d*)-(\d*)$/);
  let start = 0, end = stat.size - 1;
  if (range) {
    start = range[1] ? Number(range[1]) : 0;
    end = range[2] ? Number(range[2]) : end;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= stat.size) {
      response.statusCode = 416; response.setHeader("Content-Range", `bytes */${stat.size}`); return response.end();
    }
    end = Math.min(end, stat.size - 1);
    response.statusCode = 206;
    response.setHeader("Content-Range", `bytes ${start}-${end}/${stat.size}`);
  }
  if (!useGzip) response.setHeader("Content-Length", end - start + 1);
  if (request.method === "HEAD") return response.end();
  const stream = fs.createReadStream(file, { start, end });
  if (useGzip) stream.pipe(zlib.createGzip({ level: zlib.constants.Z_BEST_SPEED })).pipe(response);
  else stream.pipe(response);
}

function serveStatic(request, response) {
  if (!["GET", "HEAD"].includes(request.method)) { response.statusCode = 404; return response.end(); }
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname); }
  catch { response.statusCode = 400; return response.end("Bad request"); }
  const relative = pathname.replace(/^\/+/, "");
  const [mountName, ...mountParts] = relative.split("/");
  const mountRoot = staticMounts.get(mountName);
  if (mountRoot) {
    const mountedCandidate = path.resolve(mountRoot, ...mountParts);
    if (mountedCandidate !== mountRoot && !mountedCandidate.startsWith(`${mountRoot}${path.sep}`)) {
      response.statusCode = 403;
      return response.end("Forbidden");
    }
    if (!fs.existsSync(mountedCandidate) || !fs.statSync(mountedCandidate).isFile()) {
      response.statusCode = 404;
      return response.end("Not found");
    }
    return sendFile(request, response, mountedCandidate);
  }
  const candidate = path.resolve(dist, relative || "index.html");
  if (candidate !== dist && !candidate.startsWith(`${dist}${path.sep}`)) { response.statusCode = 403; return response.end("Forbidden"); }
  const file = fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : path.join(dist, "index.html");
  sendFile(request, response, file);
}

const server = http.createServer((request, response) => {
  let index = 0;
  const next = () => {
    const middleware = apiMiddlewares[index++];
    if (middleware) return middleware(request, response, next);
    if (new URL(request.url, "http://localhost").pathname.startsWith("/api/")) {
      return sendJson(response, 404, errorEnvelope("route_not_found", "API route was not found."));
    }
    return serveStatic(request, response);
  };
  Promise.resolve(next()).catch((error) => {
    if (!response.headersSent) return sendJson(response, 500, errorEnvelope("internal_error", "The request could not be completed."));
    response.end();
  });
});
voicePlugin.attachUpgrade(server);

server.listen(port, host, () => console.log(`Amble server listening on http://${host}:${port}`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  planGamePlugin.stopWorker();
  planGamePlugin.api.close();
  adminPlugin.close();
  void voicePlugin.close();
  server.close(() => process.exit(0));
});
