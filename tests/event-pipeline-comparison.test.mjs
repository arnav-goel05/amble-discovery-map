import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value)}\n`);

test("run comparison reads final placements and nested excluded source identities", () => {
  const root = mkdtempSync(join(tmpdir(), "event-comparison-"));
  const snapshotRoot = join(root, "snapshots");
  for (const runId of ["before", "after"]) {
    mkdirSync(join(root, runId, "normalized"), { recursive: true });
    mkdirSync(join(snapshotRoot, runId), { recursive: true });
    writeJson(join(root, runId, "status.json"), {
      runId,
      sources: { "Source A": { counts: {} } },
      deduplication: { counts: { eligiblePreDedup: 1, acceptedPrimary: 1 } },
      publication: { candidateSnapshotId: runId },
    });
    writeJson(join(root, runId, "normalized", "events.json"), {
      records: [{ sourceName: "Source A", title: "Event" }],
    });
    writeJson(join(root, runId, "normalized", "excluded.json"), {
      records: runId === "after" ? [{ event: { sourceName: "Source A", title: "Excluded" } }] : [],
    });
    writeJson(join(snapshotRoot, runId, "events.json"), {
      mapped: runId === "after" ? [{ sourceName: "Source A", title: "Event" }] : [],
      offMap: runId === "after"
        ? [{ sourceName: "Source A", title: "Review", mappingStatus: "pending_review" }]
        : [],
    });
  }
  const output = join(root, "comparison.json");
  const result = spawnSync(
    process.execPath,
    [
      "scripts/compare-event-pipeline-runs.mjs",
      "--before", join(root, "before"),
      "--after", join(root, "after"),
      "--snapshot-root", snapshotRoot,
      "--output", output,
    ],
    { cwd: new URL("..", import.meta.url), encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const comparison = JSON.parse(readFileSync(output, "utf8"));
  assert.equal(comparison.after.bySource["Source A"].mapped, 1);
  assert.equal(comparison.after.bySource["Source A"].excluded, 1);
  assert.equal(comparison.after.bySource["Source A"].mappingReview, 1);
  assert.equal(comparison.after.totals.publishedMapped, 1);
});
