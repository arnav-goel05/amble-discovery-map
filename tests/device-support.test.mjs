import assert from "node:assert/strict";
import test from "node:test";

import { getDeviceSupport } from "../device-support.js";

const supportFor = ({ media = true, socket = true }) =>
  getDeviceSupport({
    navigator: {
      ...(media ? { mediaDevices: { getUserMedia() {} } } : {}),
    },
    capabilities: {
      webSocket: socket,
      audioContext: media,
    },
  });

test("device support is based on capabilities rather than screen size", () => {
  assert.deepEqual(supportFor({}), {
    mode: "full",
    voiceSupported: true,
    textAssistantSupported: true,
    missingCapabilities: [],
  });
});

test("missing voice capabilities degrades a supported desktop to direct controls", () => {
  const degraded = supportFor({ media: false });
  assert.equal(degraded.mode, "degraded");
  assert.equal(degraded.voiceSupported, false);
  assert.deepEqual(degraded.missingCapabilities, [
    "audio-capture",
    "audio-output",
  ]);
});

test("missing realtime transport preserves direct mode and identifies the missing capability", () => {
  const degraded = supportFor({ socket: false });
  assert.equal(degraded.mode, "degraded");
  assert.equal(degraded.textAssistantSupported, false);
  assert.deepEqual(degraded.missingCapabilities, ["websocket"]);
});
