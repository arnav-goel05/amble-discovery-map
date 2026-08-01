const fs = require("node:fs");
const path = require("node:path");
const { restaurantApiPlugin } = require("./scripts/restaurant-api-plugin.cjs");
const { planGameApiPlugin } = require("./scripts/plan-game-api-plugin.cjs");
const {
  approvedSnapshotApiPlugin,
} = require("./scripts/approved-snapshot-api-plugin.cjs");
const {
  weeklyRefreshApiPlugin,
} = require("./scripts/weekly-refresh-api-plugin.cjs");
const { adminApiPlugin } = require("./scripts/admin-api-plugin.cjs");
const {
  realtimeVoiceApiPlugin,
} = require("./scripts/realtime-voice-api-plugin.cjs");

const TILE_PATH = /^\/(?:optimized-tiles|poi-tiles)\//;
const LOCAL_TILE_ROOTS = [
  ["/optimized-tiles/", path.resolve(process.cwd(), "optimized-tiles")],
  ["/poi-tiles/", path.resolve(process.cwd(), "public/poi-tiles")],
];

function resolveLocalTile(pathname) {
  const entry = LOCAL_TILE_ROOTS.find(([prefix]) =>
    pathname.startsWith(prefix),
  );
  if (!entry) return null;
  const [prefix, root] = entry;
  let relative;
  try {
    relative = decodeURIComponent(pathname.slice(prefix.length));
  } catch {
    return null;
  }
  const candidate = path.resolve(root, relative);
  return candidate.startsWith(`${root}${path.sep}`) ? candidate : null;
}

function serveLocalTile(request, response, pathname) {
  const localPath = resolveLocalTile(pathname);
  if (
    !localPath ||
    !fs.existsSync(localPath) ||
    !fs.statSync(localPath).isFile()
  )
    return false;
  const size = fs.statSync(localPath).size;
  response.setHeader("Accept-Ranges", "bytes");
  response.setHeader(
    "Content-Type",
    localPath.endsWith(".json")
      ? "application/json"
      : "application/octet-stream",
  );
  const range = /^bytes=(\d+)-(\d*)$/u.exec(request.headers.range ?? "");
  let start = 0;
  let end = size - 1;
  if (range) {
    start = Number(range[1]);
    end = range[2] ? Math.min(Number(range[2]), end) : end;
    if (start > end || start >= size) {
      response.statusCode = 416;
      response.setHeader("Content-Range", `bytes */${size}`);
      response.end();
      return true;
    }
    response.statusCode = 206;
    response.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
  }
  response.setHeader("Content-Length", String(end - start + 1));
  if (request.method === "HEAD") response.end();
  else fs.createReadStream(localPath, { start, end }).pipe(response);
  return true;
}

function remoteTileFallbackPlugin() {
  return {
    name: "remote-tile-fallback",
    configureServer(server) {
      const configuredOrigin = String(
        process.env.TILE_FALLBACK_ORIGIN ||
          "https://amble.project-hub-arnav.workers.dev",
      )
        .trim()
        .replace(/\/$/, "");
      let origin = null;
      try {
        if (configuredOrigin) origin = new URL(configuredOrigin);
      } catch {
        server.config.logger.warn("Ignoring invalid TILE_FALLBACK_ORIGIN.");
      }

      server.middlewares.use(async (request, response, next) => {
        let url;
        try {
          url = new URL(request.url, "http://localhost");
        } catch {
          return next();
        }
        if (
          !["GET", "HEAD"].includes(request.method) ||
          !TILE_PATH.test(url.pathname)
        )
          return next();
        if (serveLocalTile(request, response, url.pathname)) return;
        if (!origin) return next();

        try {
          const upstream = await fetch(
            new URL(`${url.pathname}${url.search}`, origin),
            {
              method: request.method,
              headers: {
                accept: request.headers.accept || "*/*",
                "accept-encoding": "identity",
                ...(request.headers.range
                  ? { range: request.headers.range }
                  : {}),
              },
            },
          );
          if (upstream.status === 404) return next();
          response.statusCode = upstream.status;
          for (const [name, value] of upstream.headers) {
            if (
              ![
                "content-encoding",
                "content-length",
                "transfer-encoding",
              ].includes(name.toLowerCase())
            )
              response.setHeader(name, value);
          }
          if (request.method === "HEAD") return response.end();
          const body = Buffer.from(await upstream.arrayBuffer());
          response.setHeader("Content-Length", String(body.length));
          response.end(body);
        } catch (error) {
          server.config.logger.warn(
            `Tile fallback failed for ${url.pathname}: ${error.message}`,
          );
          next();
        }
      });
    },
  };
}

module.exports = {
  optimizeDeps: {
    entries: ["index.html"],
  },
  build: {
    rollupOptions: { input: { main: "index.html", admin: "admin.html" } },
  },
  plugins: [
    remoteTileFallbackPlugin(),
    approvedSnapshotApiPlugin(),
    weeklyRefreshApiPlugin(),
    adminApiPlugin(),
    realtimeVoiceApiPlugin(),
    restaurantApiPlugin(),
    planGameApiPlugin(),
  ],
};
