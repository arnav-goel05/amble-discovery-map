"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { sendJson, sendPublicError, successEnvelope } = require("./lib/http-contract.cjs");

const snapshotModule = import("./lib/approved-snapshot.mjs");

function publicTileset(tileset) {
  const copy = structuredClone(tileset);
  const visit = (tile) => {
    const content = tile?.content;
    if (content) for (const key of ["uri", "url"]) {
      if (typeof content[key] === "string" && content[key].startsWith("/poi-tiles/")) {
        content[key] = `../../../../${content[key].slice(1)}`;
      }
    }
    for (const child of tile?.children ?? []) visit(child);
  };
  visit(copy.root);
  return copy;
}

function publicMetadata(snapshot) {
  const sourceHealth = Object.fromEntries(Object.entries(snapshot.sourceHealth || {}).map(([id, health]) => [id, {
    status: ["success", "failed", "blocked", "unavailable", "stale"].includes(health?.status) ? health.status : "unavailable",
    ...(health?.lastSuccessfulAt && !Number.isNaN(Date.parse(health.lastSuccessfulAt)) ? { lastSuccessfulAt: health.lastSuccessfulAt } : {}),
  }]));
  return {
    schemaVersion: snapshot.schemaVersion,
    snapshotId: snapshot.snapshotId,
    publishedAt: snapshot.publishedAt,
    coveredWindow: snapshot.coveredWindow,
    freshness: snapshot.freshness,
    staleAfter: snapshot.staleAfter,
    sourceHealth,
    landmarksRef: snapshot.publicRefs.landmarks,
    poisRef: snapshot.publicRefs.pois,
    tilesetRef: `${snapshot.publicRefs.tileset}?assetPaths=site-root-v1`,
    previousSnapshotId: snapshot.previousSnapshotId,
    contentHash: snapshot.contentHash,
  };
}

function approvedSnapshotApiPlugin({ root = path.resolve(__dirname, ".."), now = () => new Date() } = {}) {
  const middleware = async (request, response, next) => {
    let url;
    try { url = new URL(request.url, "http://localhost"); }
    catch { return next(); }
    if (url.pathname !== "/api/snapshot" && !url.pathname.startsWith("/api/snapshot/assets/")) return next();
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("Allow", "GET, HEAD");
      return sendJson(response, 405, { schemaVersion: "1.0", error: { code: "method_not_allowed", message: "Only GET and HEAD are supported." } });
    }
    try {
      const snapshots = await snapshotModule;
      const active = snapshots.loadApprovedSnapshot({ root, now: now() });
      const source = { id: "approved-snapshot", costClass: "free" };
      if (url.pathname === "/api/snapshot") {
        const envelope = successEnvelope(publicMetadata(active), { fetchedAt: active.publishedAt, stale: active.stale, warning: active.warning, source });
        return request.method === "HEAD" ? (sendJson(response, 200, envelope), undefined) : sendJson(response, 200, envelope, { cacheControl: "no-cache" });
      }
      const prefix = "/api/snapshot/assets/";
      const pieces = url.pathname.slice(prefix.length).split("/").map((value) => decodeURIComponent(value));
      const snapshotId = pieces.shift();
      const reference = pieces.join("/");
      const file = snapshots.resolveActiveSnapshotAsset({ root, snapshotId, reference });
      if (reference === active.tilesetRef) {
        const tileset = publicTileset(JSON.parse(fs.readFileSync(file, "utf8")));
        response.statusCode = 200;
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        response.setHeader("X-Content-Type-Options", "nosniff");
        if (request.method === "HEAD") return response.end();
        return response.end(`${JSON.stringify(tileset)}\n`);
      }
      const records = JSON.parse(fs.readFileSync(file, "utf8"));
      const envelope = successEnvelope(records, { fetchedAt: active.publishedAt, stale: active.stale, warning: active.warning, source });
      return sendJson(response, 200, envelope, { cacheControl: "public, max-age=31536000, immutable" });
    } catch (error) { return sendPublicError(response, error); }
  };
  return {
    name: "approved-snapshot-api",
    middleware,
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
  };
}

module.exports = { approvedSnapshotApiPlugin, publicMetadata, publicTileset };
