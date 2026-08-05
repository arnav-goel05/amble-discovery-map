import assert from "node:assert/strict";
import test from "node:test";

import { selectCloudflareBuildCommand } from "../scripts/run-cloudflare-build-phase.mjs";

test("Workers Builds compiles the promoted application without repeating tests", () => {
  assert.deepEqual(selectCloudflareBuildCommand("1"), {
    command: "npm",
    args: ["run", "cloudflare:cloud:build"],
  });
});

test("local callers retain the credential-free Cloudflare contract suite", () => {
  for (const workersCi of [undefined, "", "0"]) {
    assert.deepEqual(selectCloudflareBuildCommand(workersCi), {
      command: "npm",
      args: ["run", "cloudflare:cloud:contracts"],
    });
  }
});
