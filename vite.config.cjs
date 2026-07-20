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
          !origin ||
          !["GET", "HEAD"].includes(request.method) ||
          !TILE_PATH.test(url.pathname)
        )
          return next();

        const localPath = path.resolve(
          process.cwd(),
          "public",
          `.${url.pathname}`,
        );
        const publicRoot = path.resolve(process.cwd(), "public");
        if (
          localPath.startsWith(`${publicRoot}${path.sep}`) &&
          fs.existsSync(localPath)
        )
          return next();

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
