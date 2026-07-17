import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { verifyCloudflareFrontend } from "../scripts/verify-cloudflare-frontend.mjs";

function fixture({ entry = "" } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "amble-cloudflare-build-"));
  fs.mkdirSync(path.join(root, "assets"));
  fs.writeFileSync(path.join(root, "index.html"), '<script type="module" src="/assets/entry.js"></script><link rel="stylesheet" href="/assets/entry.css">');
  fs.writeFileSync(path.join(root, "assets/entry.css"), ".device-gate{display:block}");
  fs.writeFileSync(path.join(root, "assets/entry.js"), entry);
  return root;
}

const validEntry = [
  "device-gate",
  "deviceSupport",
  "maxTouchPoints",
  "Singapore is waiting on the big screen",
  "Open Amble on your laptop",
  'import("./application.js")',
].join(";");

test("accepts a lightweight Cloudflare entry containing the compatibility gate", (context) => {
  const root = fixture({ entry: validEntry });
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(verifyCloudflareFrontend(root), { entryUrl: "/assets/entry.js" });
});

test("rejects a Cloudflare entry that bypasses the compatibility gate", (context) => {
  const root = fixture({ entry: 'import("./application.js")' });
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(() => verifyCloudflareFrontend(root), /missing "device-gate"/);
});

test("rejects a Cloudflare entry that eagerly bundles the 3D application", (context) => {
  const root = fixture({ entry: validEntry.replace('import("./application.js")', "startApplication()") });
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(() => verifyCloudflareFrontend(root), /not loaded through a dynamic import/);
});
