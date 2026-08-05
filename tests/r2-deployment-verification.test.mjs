import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { buildTilesetIntegrityInventory } from "../scripts/lib/tileset-integrity.mjs";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const highlighted = await buildTilesetIntegrityInventory({
  manifestPath: path.join(root, "public/poi-tiles/event-venues/tileset.json"),
  manifestUrl: "https://inventory.invalid/poi-tiles/event-venues/tileset.json",
  publicRoot: path.join(root, "public"),
  validateLocalContent: false,
});

async function runDeploymentVerification({ backgroundComplete }) {
  let requests = 0;
  let observedUrl;
  const server = http.createServer((request, response) => {
    requests += 1;
    observedUrl = new URL(request.url, "http://inventory.invalid");
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        schemaVersion: 1,
        complete: true,
        releaseId: observedUrl.searchParams.get("release"),
        verificationId: observedUrl.searchParams.get("verification"),
        tilesets: [
          {
            id: "background",
            complete: backgroundComplete,
            referenceCount: 24_542,
            objectCount: 24_542,
            errors: backgroundComplete
              ? []
              : [
                  {
                    kind: "object-missing",
                    path: "/optimized-tiles/missing.b3dm",
                  },
                ],
            errorCount: backgroundComplete ? 0 : 1,
          },
          {
            id: "highlighted",
            complete: true,
            referenceCount: highlighted.objectCount,
            objectCount: highlighted.objectCount,
            referenceSha256: highlighted.referenceSha256,
            errors: [],
            errorCount: 0,
          },
        ],
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "amble-deployment-inventory-"),
  );
  const reportPath = path.join(temporaryRoot, "report.json");
  try {
    let result;
    let error;
    try {
      result = await execFileAsync(
        process.execPath,
        [
          "scripts/verify-r2-tile-delivery.mjs",
          "--deployment",
          "--inventory-origin",
          `http://127.0.0.1:${address.port}`,
          "--report",
          reportPath,
        ],
        { cwd: root },
      );
    } catch (caught) {
      error = caught;
    }
    return {
      error,
      result,
      report: JSON.parse(await readFile(reportPath, "utf8")),
      requests,
      observedUrl,
    };
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

test("deployment verifies a clean checkout with one manifest inventory request", async () => {
  const result = await runDeploymentVerification({
    backgroundComplete: true,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.requests, 1);
  assert.equal(result.observedUrl.searchParams.get("scope"), "poi");
  assert.equal(result.report.complete, true);
  assert.equal(result.report.mode, "deployment-r2-binding-inventory");
  assert.equal(result.report.requestBudget.publicIntegrityRequests, 1);
  assert.equal(result.report.requestBudget.publicObjectRequests, 0);
});

test("deployment fails closed when published background inventory is incomplete", async () => {
  const result = await runDeploymentVerification({
    backgroundComplete: false,
  });
  assert.equal(result.error?.code, 1);
  assert.equal(result.requests, 1);
  assert.equal(result.report.complete, false);
  assert.equal(
    result.report.tilesets[0].remoteErrors[0].kind,
    "object-missing",
  );
});
