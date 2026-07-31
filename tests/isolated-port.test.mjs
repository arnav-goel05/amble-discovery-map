import assert from "node:assert/strict";
import test from "node:test";

import { stableIsolatedPort } from "../scripts/lib/isolated-port.mjs";

test("isolated ports are stable, bounded, and distinct by identity", () => {
  const first = stableIsolatedPort("first");
  assert.equal(first, stableIsolatedPort("first"));
  assert.notEqual(first, stableIsolatedPort("second"));
  assert.ok(first >= 40_000 && first < 50_000);
  const performance = stableIsolatedPort("first", { base: 50_000 });
  assert.ok(performance >= 50_000 && performance < 60_000);
});

test("isolated ports reject invalid identities and ranges", () => {
  assert.throws(() => stableIsolatedPort(""), /identity/);
  assert.throws(
    () => stableIsolatedPort("invalid", { base: 60_000, span: 10_000 }),
    /TCP port limit/,
  );
});
