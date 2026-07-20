import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { canonicalRenderedUrl } from "./tinyfish-fetch.mjs";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const atomicJson = (path, value) => { mkdirSync(dirname(path), { recursive: true }); const temporary = `${path}.tmp-${process.pid}`; writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`); renameSync(temporary, path); };

export function createAuthorityCaptureIndex({ runDir, runId, window, retrievalDefinitionHash }) {
  const path = join(runDir, "raw/authority/index.json");
  const value = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { schemaVersion: "1.0", runId, window, entries: [] };
  if (value.runId !== runId || JSON.stringify(value.window) !== JSON.stringify(window)) throw new Error("Authority index belongs to another run/window");
  const save = () => atomicJson(path, value);
  if (!existsSync(path)) save();
  const find = (url) => value.entries.find((entry) => entry.canonicalUrl === canonicalRenderedUrl(url));
  return {
    path,
    reserve(requestedUrl) {
      const canonicalUrl = canonicalRenderedUrl(requestedUrl);
      let entry = find(canonicalUrl);
      if (!entry) { entry = { canonicalUrl, requestedAliases: [requestedUrl], retrievalDefinitionHash, status: "reserved", captureRef: null, payloadHash: null, parsed: {} }; value.entries.push(entry); value.entries.sort((a, b) => a.canonicalUrl.localeCompare(b.canonicalUrl)); save(); }
      else if (!entry.requestedAliases.includes(requestedUrl)) { entry.requestedAliases.push(requestedUrl); entry.requestedAliases.sort(); save(); }
      return structuredClone(entry);
    },
    complete(requestedUrl, { payload, payloadHash = sha(JSON.stringify(payload)), finalUrl = requestedUrl, redirectChain = [] }) {
      const canonicalUrl = canonicalRenderedUrl(finalUrl);
      let entry = find(requestedUrl);
      if (!entry) entry = this.reserve(requestedUrl) && find(requestedUrl);
      entry.canonicalUrl = canonicalUrl; entry.status = "validated"; entry.payloadHash = payloadHash; entry.redirectChain = redirectChain;
      entry.captureRef = `raw/authority/${sha(canonicalUrl)}.response.json`;
      atomicJson(join(runDir, entry.captureRef), payload); save(); return structuredClone(entry);
    },
    parsed(url, parserHash, fixture) {
      const entry = find(url); if (!entry || entry.status !== "validated") throw new Error("Validated authority capture required");
      const fixtureRef = `raw/authority/${sha(entry.canonicalUrl)}.${parserHash.slice(0, 12)}.json`;
      atomicJson(join(runDir, fixtureRef), fixture); entry.parsed[parserHash] = fixtureRef; save(); return fixtureRef;
    },
    reusable(url, parserHash = null) {
      const entry = find(url);
      if (!entry || entry.status !== "validated" || entry.retrievalDefinitionHash !== retrievalDefinitionHash) return null;
      if (parserHash && !entry.parsed[parserHash]) return null;
      return structuredClone(entry);
    },
    snapshot: () => structuredClone(value),
  };
}
