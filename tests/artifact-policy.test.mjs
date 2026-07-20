import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { verifyArtifactPolicy } from "../scripts/verify-artifact-policy.mjs";

const required = [
  "data/map-context-sources.json",
  "data/discovery-areas.geojson",
  "data/discovery-areas-manifest.json",
  "data/transit-context.geojson",
  "data/transit-context-manifest.json",
];

test("approved map assets and manifests are release-required artifacts", () => {
  const report = verifyArtifactPolicy({ tracked: [], status: [] });
  for (const file of required)
    assert.ok(report.approvedArtifacts.includes(file), file);
  assert.ok(
    report.approvedFixtureClasses.some((pattern) =>
      pattern.includes("map-context"),
    ),
  );
});

test("download and staging caches remain runtime artifacts", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "amble-artifact-policy-"));
  fs.mkdirSync(path.join(root, "outputs/map-context-staging"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(root, "outputs/map-context-staging/source.geojson"),
    "{}",
  );
  const report = verifyArtifactPolicy({
    root,
    tracked: ["outputs/map-context-staging/source.geojson"],
    status: [],
  });
  assert.ok(
    report.violations.some(
      ({ code, file }) =>
        code === "runtime_artifact_tracked" &&
        file.includes("map-context-staging"),
    ),
  );
  fs.rmSync(root, { recursive: true, force: true });
});
