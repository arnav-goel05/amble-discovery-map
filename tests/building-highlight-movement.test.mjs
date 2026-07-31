import assert from "node:assert/strict";
import test from "node:test";

import { createMovementRenderingGuard } from "../map-layers/building-highlight-layers.js";

test("movement rendering preservation applies to exactly one camera movement", () => {
  const guard = createMovementRenderingGuard();

  assert.deepEqual(guard.begin(), {
    hideBackground: true,
    pauseTraversal: true,
  });
  guard.end();

  guard.preserveNext();
  assert.deepEqual(guard.begin(), {
    hideBackground: false,
    pauseTraversal: false,
  });
  guard.end();

  assert.deepEqual(guard.begin(), {
    hideBackground: true,
    pauseTraversal: true,
  });
});
