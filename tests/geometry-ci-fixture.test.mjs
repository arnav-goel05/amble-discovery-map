import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateCiGeometryFixture } from "../scripts/verify-ci-geometry-fixture.mjs";

const original = JSON.parse(
  await readFile(
    new URL("fixtures/geometry-release/manifest.json", import.meta.url),
    "utf8",
  ),
);
const copy = () => structuredClone(original);

test("checked-in geometry fixture is compact, complete, and offline", () => {
  assert.deepEqual(validateCiGeometryFixture(copy()), {
    fixtureId: "singapore-geometry-contract-v1",
    objectCount: 4,
    totalBytes: 592,
    productionRequests: 0,
  });
});

test("fixture fails closed when an object is missing", () => {
  const fixture = copy();
  fixture.objects = fixture.objects.filter(({ role }) => role !== "nested");
  assert.throws(
    () => validateCiGeometryFixture(fixture),
    /Missing required fixture role: nested/,
  );
});

test("fixture fails closed for corrupt B3DM bytes", () => {
  const fixture = copy();
  fixture.objects[0].base64 = Buffer.from("not-a-b3dm").toString("base64");
  fixture.objects[0].byteLength = 10;
  fixture.objects[0].sha256 =
    "8f6ab57777fcf99705baef736e6057b44a5c28a7631956f050222e9d2eb4933b";
  assert.throws(
    () => validateCiGeometryFixture(fixture),
    /truncated B3DM|corrupt B3DM/,
  );
});

test("fixture fails closed for a hash mismatch", () => {
  const fixture = copy();
  fixture.objects[0].sha256 = "0".repeat(64);
  assert.throws(() => validateCiGeometryFixture(fixture), /hash mismatch/);
});

test("fixture fails closed when highlight and background identities overlap", () => {
  const fixture = copy();
  fixture.objects[2].identity = fixture.objects[2].sourceIdentity;
  assert.throws(
    () => validateCiGeometryFixture(fixture),
    /duplicate identity|not separated/,
  );
});

test("fixture fails closed for production endpoints and excess size", () => {
  const endpoint = copy();
  endpoint.origin = "https://amblefinds.com";
  assert.throws(
    () => validateCiGeometryFixture(endpoint),
    /production service/,
  );
  const oversized = copy();
  oversized.budgets.maxCheckedInBytes = 1;
  assert.throws(() => validateCiGeometryFixture(oversized), /exceeds 1 bytes/);
});
