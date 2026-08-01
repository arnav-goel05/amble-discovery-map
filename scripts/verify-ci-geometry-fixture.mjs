#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_ROLES = new Set([
  "background",
  "nested",
  "highlight",
  "event-highlight",
]);
const REQUIRED_FAILURES = new Set([
  "missing-object",
  "corrupt-b3dm",
  "hash-mismatch",
  "background-highlight-separation",
]);
const PRODUCTION_URL =
  /(?:amblefinds\.com|workers\.dev|r2\.cloudflarestorage\.com)/iu;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validateB3dm(bytes, objectPath) {
  assert(bytes.length >= 48, `${objectPath}: truncated B3DM`);
  assert(
    bytes.toString("ascii", 0, 4) === "b3dm",
    `${objectPath}: corrupt B3DM magic`,
  );
  assert(
    bytes.readUInt32LE(4) === 1,
    `${objectPath}: unsupported B3DM version`,
  );
  assert(
    bytes.readUInt32LE(8) === bytes.length,
    `${objectPath}: B3DM length mismatch`,
  );
  const featureJson = bytes.readUInt32LE(12);
  const featureBinary = bytes.readUInt32LE(16);
  const batchJson = bytes.readUInt32LE(20);
  const batchBinary = bytes.readUInt32LE(24);
  const glbOffset = 28 + featureJson + featureBinary + batchJson + batchBinary;
  assert(
    bytes.toString("ascii", glbOffset, glbOffset + 4) === "glTF",
    `${objectPath}: missing embedded GLB`,
  );
}

export function validateCiGeometryFixture(manifest) {
  assert(
    manifest?.schemaVersion === "ci-geometry-fixture-v1",
    "Unsupported fixture schema",
  );
  assert(
    typeof manifest.fixtureId === "string" && manifest.fixtureId,
    "Missing fixture identity",
  );
  assert(
    manifest.budgets?.productionRequests === 0,
    "Fixture production request budget must be zero",
  );
  assert(
    Number.isInteger(manifest.budgets?.maxCheckedInBytes),
    "Missing fixture byte budget",
  );
  assert(
    Array.isArray(manifest.objects) && manifest.objects.length > 0,
    "Fixture contains no objects",
  );
  assert(
    !PRODUCTION_URL.test(JSON.stringify(manifest)),
    "Fixture references a production service",
  );

  const paths = new Set();
  const identities = new Map();
  let totalBytes = 0;
  for (const object of manifest.objects) {
    assert(
      typeof object.path === "string" && object.path,
      "Fixture object has no path",
    );
    assert(
      !path.isAbsolute(object.path) && !object.path.split("/").includes(".."),
      `${object.path}: unsafe path`,
    );
    assert(!paths.has(object.path), `${object.path}: duplicate path`);
    paths.add(object.path);
    assert(
      REQUIRED_ROLES.has(object.role),
      `${object.path}: unknown role ${object.role}`,
    );
    assert(
      typeof object.identity === "string" && object.identity,
      `${object.path}: missing identity`,
    );
    assert(
      !identities.has(object.identity),
      `${object.path}: duplicate identity ${object.identity}`,
    );
    identities.set(object.identity, object.role);
    let bytes;
    try {
      bytes = Buffer.from(object.base64, "base64");
    } catch {
      throw new Error(`${object.path}: invalid base64`);
    }
    assert(
      bytes.length === object.byteLength,
      `${object.path}: byte length mismatch`,
    );
    const digest = createHash("sha256").update(bytes).digest("hex");
    assert(digest === object.sha256, `${object.path}: hash mismatch`);
    validateB3dm(bytes, object.path);
    totalBytes += bytes.length;
  }

  for (const role of REQUIRED_ROLES)
    assert(
      manifest.objects.some((object) => object.role === role),
      `Missing required fixture role: ${role}`,
    );
  for (const failure of REQUIRED_FAILURES)
    assert(
      manifest.failureCases?.includes(failure),
      `Missing required failure case: ${failure}`,
    );

  for (const object of manifest.objects) {
    if (object.role === "nested")
      assert(
        paths.has(object.parent),
        `${object.path}: missing nested parent ${object.parent}`,
      );
    if (["highlight", "event-highlight"].includes(object.role)) {
      assert(
        identities.has(object.sourceIdentity),
        `${object.path}: missing source identity`,
      );
      assert(
        object.identity !== object.sourceIdentity,
        `${object.path}: highlight was not separated from background identity`,
      );
      assert(
        ["background", "nested"].includes(
          identities.get(object.sourceIdentity),
        ),
        `${object.path}: highlight source is not background geometry`,
      );
    }
  }
  assert(
    totalBytes <= manifest.budgets.maxCheckedInBytes,
    `Fixture exceeds ${manifest.budgets.maxCheckedInBytes} bytes`,
  );
  return {
    fixtureId: manifest.fixtureId,
    objectCount: manifest.objects.length,
    totalBytes,
    productionRequests: 0,
  };
}

const isCli =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const manifestPath = path.resolve(
    process.argv[2] ?? "tests/fixtures/geometry-release/manifest.json",
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  console.log(JSON.stringify(validateCiGeometryFixture(manifest), null, 2));
}
