const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ENDPOINT = "/__local-building-assets/manifest.json";
const ASSET_PREFIX = "/__local-building-assets/";
const hash = (bytes) =>
  `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;

function readVerifiedAsset(reference, label) {
  if (!reference?.path || !path.isAbsolute(reference.path))
    throw new Error(`${label}-path-invalid`);
  const stat = fs.lstatSync(reference.path);
  if (stat.isSymbolicLink() || !stat.isFile())
    throw new Error(`${label}-not-regular-file`);
  const bytes = fs.readFileSync(reference.path);
  if (reference.complete !== true || hash(bytes) !== reference.sha256)
    throw new Error(`${label}-verification-failed`);
  return { bytes, directory: path.dirname(reference.path) };
}

function loadManifest(activeManifestPath) {
  const manifestBytes = fs.readFileSync(activeManifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (manifest.schemaVersion !== "local-building-assets-v1")
    throw new Error("manifest-schema-invalid");
  if (!["active-local", "rolled-back"].includes(manifest.state))
    throw new Error("manifest-not-active");
  const background = readVerifiedAsset(manifest.background, "background");
  const overlays = readVerifiedAsset(manifest.overlays, "overlays");
  return {
    directories: {
      background: background.directory,
      overlays: overlays.directory,
    },
    manifest: {
      ...manifest,
      background: {
        ...manifest.background,
        url: `${ASSET_PREFIX}background/${path.basename(manifest.background.path)}`,
      },
      overlays: {
        ...manifest.overlays,
        url: `${ASSET_PREFIX}overlays/${path.basename(manifest.overlays.path)}`,
      },
    },
  };
}

function sendJson(response, status, value) {
  const body = Buffer.from(`${JSON.stringify(value)}\n`);
  response.statusCode = status;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", String(body.length));
  response.end(body);
}

function resolveAsset(pathname, directories) {
  const match =
    /^\/__local-building-assets\/(background|overlays)\/(.+)$/u.exec(pathname);
  if (!match) return null;
  let relative;
  try {
    relative = decodeURIComponent(match[2]);
  } catch {
    return null;
  }
  const root = directories[match[1]];
  const candidate = path.resolve(root, relative);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`))
    return null;
  return candidate;
}

function serveFile(request, response, filename) {
  if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) return false;
  const stat = fs.statSync(filename);
  let start = 0;
  let end = stat.size - 1;
  const range = /^bytes=(\d+)-(\d*)$/u.exec(request.headers.range ?? "");
  if (range) {
    start = Number(range[1]);
    end = range[2] ? Math.min(Number(range[2]), end) : end;
    if (start > end || start >= stat.size) {
      response.statusCode = 416;
      response.setHeader("Content-Range", `bytes */${stat.size}`);
      response.end();
      return true;
    }
    response.statusCode = 206;
    response.setHeader("Content-Range", `bytes ${start}-${end}/${stat.size}`);
  } else {
    response.statusCode = 200;
  }
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Accept-Ranges", "bytes");
  response.setHeader(
    "Content-Type",
    filename.endsWith(".json")
      ? "application/json; charset=utf-8"
      : "application/octet-stream",
  );
  response.setHeader("Content-Length", String(end - start + 1));
  if (request.method === "HEAD") response.end();
  else fs.createReadStream(filename, { start, end }).pipe(response);
  return true;
}

function localBuildingAssetsPlugin({ activeManifestPath, enabled = true }) {
  return {
    name: "local-building-assets",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!enabled || !["GET", "HEAD"].includes(request.method))
          return next();
        const pathname = new URL(request.url, "http://localhost").pathname;
        if (pathname !== ENDPOINT && !pathname.startsWith(ASSET_PREFIX))
          return next();

        let loaded;
        try {
          loaded = loadManifest(activeManifestPath);
        } catch (error) {
          if (error?.code === "ENOENT")
            return sendJson(response, 404, { state: "missing" });
          return sendJson(response, 503, {
            error: error?.message ?? "manifest-unavailable",
            state: "invalid",
          });
        }

        if (pathname === ENDPOINT)
          return sendJson(response, 200, loaded.manifest);
        const filename = resolveAsset(pathname, loaded.directories);
        if (!filename || !serveFile(request, response, filename))
          return sendJson(response, 404, { state: "missing" });
      });
    },
  };
}

module.exports = {
  ENDPOINT,
  loadManifest,
  localBuildingAssetsPlugin,
  resolveAsset,
};
