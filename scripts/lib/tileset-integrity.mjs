import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { inspectB3dm } from "../inspect-3d-tile-assets.mjs";

const hash = (algorithm, bytes) =>
  createHash(algorithm).update(bytes).digest("hex");
const normalizedEtag = (value) =>
  value?.replace(/^W\//u, "").replace(/^"|"$/gu, "").toLowerCase() ?? null;

export function collectTilesetContentReferences(tileset) {
  const references = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    const contents = [node.content, ...(node.contents ?? [])];
    for (const content of contents) {
      const uri = content?.uri ?? content?.url;
      if (typeof uri === "string") references.push(uri);
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(tileset?.root);
  return references;
}

export function removeTilesetContentReferences(tileset, pathnames) {
  const copy = structuredClone(tileset);
  const rejected = new Set(pathnames);
  let removed = 0;
  const shouldRemove = (content, baseUrl) => {
    const uri = content?.uri ?? content?.url;
    if (typeof uri !== "string") return false;
    const pathname = decodeURIComponent(new URL(uri, baseUrl).pathname);
    return rejected.has(pathname);
  };
  const visit = (node, baseUrl) => {
    if (!node || typeof node !== "object") return;
    if (node.content && shouldRemove(node.content, baseUrl)) {
      const uri = node.content.uri ?? node.content.url;
      node.extras = {
        ...(node.extras ?? {}),
        omittedContentUris: [
          ...new Set([...(node.extras?.omittedContentUris ?? []), uri]),
        ],
      };
      delete node.content;
      removed += 1;
    }
    if (Array.isArray(node.contents)) {
      const omitted = node.contents
        .filter((content) => shouldRemove(content, baseUrl))
        .map((content) => content.uri ?? content.url);
      const retained = node.contents.filter(
        (content) => !shouldRemove(content, baseUrl),
      );
      removed += node.contents.length - retained.length;
      if (omitted.length > 0)
        node.extras = {
          ...(node.extras ?? {}),
          omittedContentUris: [
            ...new Set([
              ...(node.extras?.omittedContentUris ?? []),
              ...omitted,
            ]),
          ],
        };
      if (retained.length > 0) node.contents = retained;
      else delete node.contents;
    }
    for (const child of node.children ?? []) visit(child, baseUrl);
  };
  visit(copy.root, "https://tiles.invalid/optimized-tiles/tileset.json");
  return { tileset: copy, removed };
}

function localPathForUrl(url, publicRoot) {
  const pathname = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  const resolved = path.resolve(publicRoot, pathname);
  const relative = path.relative(path.resolve(publicRoot), resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error(`Tileset content escapes the public root: ${url.href}`);
  return resolved;
}

export async function buildTilesetIntegrityInventory({
  manifestPath,
  manifestUrl,
  publicRoot,
  validateLocalContent = true,
}) {
  const manifests = new Set();
  const objects = new Map();
  const errors = [];
  let referenceCount = 0;

  const visitManifest = async (localPath, publicUrl) => {
    const manifestKey = path.resolve(localPath);
    if (manifests.has(manifestKey)) return;
    manifests.add(manifestKey);
    let tileset;
    try {
      tileset = JSON.parse(await readFile(localPath, "utf8"));
    } catch (error) {
      errors.push({
        kind: "manifest-unreadable",
        path: localPath,
        message: error.message,
      });
      return;
    }
    const references = collectTilesetContentReferences(tileset);
    referenceCount += references.length;
    for (const reference of references) {
      let url;
      try {
        url = new URL(reference, publicUrl);
      } catch (error) {
        errors.push({
          kind: "invalid-content-uri",
          path: reference,
          message: error.message,
        });
        continue;
      }
      if (url.origin !== publicUrl.origin) {
        errors.push({
          kind: "external-content-uri",
          path: reference,
          message: `Expected ${publicUrl.origin}; received ${url.origin}`,
        });
        continue;
      }
      let contentPath;
      try {
        contentPath = localPathForUrl(url, publicRoot);
      } catch (error) {
        errors.push({
          kind: "unsafe-content-uri",
          path: reference,
          message: error.message,
        });
        continue;
      }
      if (url.pathname.endsWith(".json")) {
        await visitManifest(contentPath, url);
        continue;
      }
      if (!url.pathname.endsWith(".b3dm")) {
        errors.push({
          kind: "unsupported-content",
          path: url.pathname,
          message: "Only nested JSON tilesets and B3DM content are supported",
        });
        continue;
      }
      const key = url.pathname;
      if (objects.has(key)) continue;
      const validateObject =
        typeof validateLocalContent === "function"
          ? validateLocalContent({
              pathname: url.pathname,
              url: url.href,
              localPath: contentPath,
            })
          : validateLocalContent;
      if (!validateObject) {
        objects.set(key, {
          pathname: url.pathname,
          url: url.href,
          localPath: contentPath,
        });
        continue;
      }
      try {
        const bytes = await readFile(contentPath);
        const inspection = inspectB3dm(
          bytes,
          path.relative(publicRoot, contentPath),
        );
        const item = {
          pathname: url.pathname,
          url: url.href,
          localPath: contentPath,
          byteLength: bytes.length,
          md5: hash("md5", bytes),
          sha256: hash("sha256", bytes),
          meshes: inspection.meshes,
          primitives: inspection.primitives,
          triangles: inspection.estimatedTriangles,
        };
        objects.set(key, item);
        if (
          inspection.meshes < 1 ||
          inspection.primitives < 1 ||
          inspection.estimatedTriangles < 1
        )
          errors.push({
            kind: "non-drawable-b3dm",
            path: url.pathname,
            message: `meshes=${inspection.meshes}, primitives=${inspection.primitives}, triangles=${inspection.estimatedTriangles}`,
          });
      } catch (error) {
        errors.push({
          kind: "invalid-local-b3dm",
          path: url.pathname,
          message: error.message,
        });
      }
    }
  };

  await visitManifest(path.resolve(manifestPath), new URL(manifestUrl));
  const sortedObjects = [...objects.values()].sort((left, right) =>
    left.pathname.localeCompare(right.pathname),
  );
  return {
    complete: errors.length === 0,
    manifestCount: manifests.size,
    referenceCount,
    objectCount: objects.size,
    referenceSha256: hash(
      "sha256",
      Buffer.from(
        sortedObjects
          .map(({ pathname }) => pathname.replace(/^\/+/, ""))
          .join("\n"),
      ),
    ),
    objects: sortedObjects,
    errors,
  };
}

async function mapLimit(items, limit, operation) {
  const results = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await operation(items[index], index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

export async function auditRemoteTilesetObjects({
  objects,
  origin,
  concurrency = 24,
  fetchImpl = fetch,
  onProgress = () => {},
}) {
  const base = new URL(origin);
  let rateLimitError = null;
  let checkedObjects = 0;
  const request = async (url, init) => {
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await fetchImpl(url, init);
        if (response.status === 429) {
          await response.body?.cancel();
          const error = new Error(
            "429 rate limit; public object audit stopped",
          );
          error.code = "PUBLIC_RATE_LIMIT";
          throw error;
        }
        if (
          response.ok ||
          (![408, 425].includes(response.status) &&
            (response.status < 500 || response.status > 599)) ||
          attempt === 3
        )
          return response;
        await response.body?.cancel();
        lastError = new Error(`${response.status} ${response.statusText}`);
      } catch (error) {
        if (error.code === "PUBLIC_RATE_LIMIT") throw error;
        lastError = error;
        if (attempt === 3) throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 150));
    }
    throw lastError;
  };
  const results = await mapLimit(objects, concurrency, async (item, index) => {
    if (rateLimitError) return null;
    let started = false;
    const url = new URL(item.url);
    url.protocol = base.protocol;
    url.host = base.host;
    try {
      started = true;
      const response = await request(url, {
        method: "HEAD",
        redirect: "follow",
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok)
        throw new Error(`${response.status} ${response.statusText}`);
      if (response.headers.get("x-amble-tile-source") !== "r2")
        throw new Error("Object was not served by R2");
      const byteLength = Number(response.headers.get("content-length"));
      if (!Number.isFinite(byteLength) || byteLength < 28)
        throw new Error(`invalid content length ${byteLength}`);
      if (item.byteLength != null && byteLength !== item.byteLength)
        throw new Error(
          `byte length ${byteLength}; expected ${item.byteLength}`,
        );
      const etag = normalizedEtag(response.headers.get("etag"));
      if (!etag) throw new Error("R2 ETag is missing");
      if (item.md5 && etag !== item.md5)
        throw new Error(`ETag ${etag || "missing"}; expected MD5 ${item.md5}`);
      if (byteLength <= 1024) {
        const body = await request(url, {
          redirect: "follow",
          signal: AbortSignal.timeout(120_000),
        });
        if (!body.ok) throw new Error(`${body.status} ${body.statusText}`);
        const inspection = inspectB3dm(
          Buffer.from(await body.arrayBuffer()),
          item.pathname,
        );
        if (
          inspection.meshes < 1 ||
          inspection.primitives < 1 ||
          inspection.estimatedTriangles < 1
        )
          throw new Error(
            `non-drawable B3DM: meshes=${inspection.meshes}, primitives=${inspection.primitives}, triangles=${inspection.estimatedTriangles}`,
          );
      }
      return null;
    } catch (error) {
      if (error.code === "PUBLIC_RATE_LIMIT") {
        rateLimitError ??= {
          kind: "public-rate-limited",
          path: item.pathname,
          message: error.message,
        };
        return null;
      }
      return {
        kind: "remote-object-mismatch",
        path: item.pathname,
        message: error.message,
      };
    } finally {
      if (started) checkedObjects += 1;
      if (checkedObjects % 500 === 0 || checkedObjects === objects.length)
        onProgress(checkedObjects, objects.length);
    }
  });
  const errors = [
    ...results.filter(Boolean),
    ...(rateLimitError ? [rateLimitError] : []),
  ];
  return {
    complete: errors.length === 0,
    checkedObjects,
    errors,
  };
}

export function compareR2BindingInventory({
  id,
  inventory,
  published,
  requireObjectMetadata = false,
}) {
  const errors = [];
  if (!published)
    errors.push({
      kind: "inventory-missing",
      path: id,
      message: "The R2 binding report omitted this tileset",
    });
  else {
    if (!published.complete)
      errors.push(
        ...(published.errors?.length
          ? published.errors
          : [
              {
                kind: "published-inventory-incomplete",
                path: id,
                message: `${published.errorCount ?? "unknown"} published inventory errors`,
              },
            ]),
      );
    if (published.referenceCount !== inventory.objectCount)
      errors.push({
        kind: "reference-count-mismatch",
        path: id,
        message: `published=${published.referenceCount}, local=${inventory.objectCount}`,
      });
    if (published.referenceSha256 !== inventory.referenceSha256)
      errors.push({
        kind: "reference-digest-mismatch",
        path: id,
        message: `published=${published.referenceSha256}, local=${inventory.referenceSha256}`,
      });
    if (requireObjectMetadata) {
      if (!Array.isArray(published.inventoryObjects))
        errors.push({
          kind: "object-inventory-missing",
          path: id,
          message: "The R2 binding report omitted per-object metadata",
        });
      else {
        const metadataByKey = new Map(
          published.inventoryObjects.map((item) => [item.key, item]),
        );
        for (const local of inventory.objects ?? []) {
          const key = local.pathname.replace(/^\/+/, "");
          const remote = metadataByKey.get(key);
          if (!remote) {
            errors.push({
              kind: "object-missing",
              path: local.pathname,
              message:
                "The R2 binding inventory omitted this referenced object",
            });
            continue;
          }
          const etag = normalizedEtag(remote.etag);
          const remoteMd5 =
            remote.md5 ?? (/^[a-f0-9]{32}$/u.test(etag ?? "") ? etag : null);
          if (!remoteMd5) {
            errors.push({
              kind: "object-validator-unverifiable",
              path: local.pathname,
              message: "The R2 object has no reliable MD5 validator",
            });
            continue;
          }
          if (remote.size !== local.byteLength || remoteMd5 !== local.md5)
            errors.push({
              kind: "object-validator-mismatch",
              path: local.pathname,
              message: `stored=${remoteMd5}/${remote.size}, expected=${local.md5}/${local.byteLength}`,
            });
        }
      }
    }
  }
  return { complete: errors.length === 0, errors };
}
