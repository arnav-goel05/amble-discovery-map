"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { errorEnvelope, sendJson, successEnvelope } = require("./lib/http-contract.cjs");

function weeklyRefreshApiPlugin({ outputRoot = process.env.WEEKLY_REFRESH_OUTPUT_ROOT || path.join(process.cwd(), "outputs/weekly-refresh") } = {}) {
  const middleware = (request, response, next) => {
    let url;
    try { url = new URL(request.url, "http://localhost"); } catch { return next(); }
    if (url.pathname !== "/api/weekly-refresh/status") return next();
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("Allow", "GET, HEAD");
      return sendJson(response, 405, errorEnvelope("method_not_allowed", "Only GET and HEAD are supported."));
    }
    try {
      const latest = JSON.parse(fs.readFileSync(path.join(outputRoot, "latest.json"), "utf8"));
      const statusFile = path.resolve(outputRoot, latest.statusRef || "");
      if (!statusFile.startsWith(`${path.resolve(outputRoot)}${path.sep}`)) throw new Error("invalid status reference");
      const status = JSON.parse(fs.readFileSync(statusFile, "utf8"));
      const data = {
        runId: status.runId, startedAt: status.startedAt, completedAt: status.completedAt,
        complete: status.complete === true, status: status.status,
        events: { complete: status.events?.complete === true, status: status.events?.status || "unknown" },
        restaurants: {
          status: status.restaurants?.status || "unknown",
          coverageComplete: (status.restaurants?.coverage || []).filter((item) => item.complete).length,
          coverageTotal: (status.restaurants?.coverage || []).length,
        },
      };
      const envelope = successEnvelope(data, { fetchedAt: status.completedAt || status.startedAt, stale: false, source: { id: "weekly-refresh-local", costClass: "free" } });
      if (request.method === "HEAD") { response.statusCode = 200; return response.end(); }
      return sendJson(response, 200, envelope, { cacheControl: "no-cache" });
    } catch {
      return sendJson(response, 503, errorEnvelope("weekly_refresh_status_unavailable", "Weekly refresh status is unavailable."));
    }
  };
  return { name: "weekly-refresh-api", middleware, configureServer(server) { server.middlewares.use(middleware); }, configurePreviewServer(server) { server.middlewares.use(middleware); } };
}

module.exports = { weeklyRefreshApiPlugin };
