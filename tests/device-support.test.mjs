import assert from "node:assert/strict";
import test from "node:test";

import {
  getDeviceSupport,
  MINIMUM_SUPPORTED_SCREEN_EDGE,
} from "../device-support.js";

const supportFor = ({
  width,
  height,
  userAgent,
  mobile,
  maxTouchPoints = 0,
  media = true,
  socket = true,
}) =>
  getDeviceSupport({
    screen: { width, height },
    navigator: {
      userAgent,
      maxTouchPoints,
      ...(media ? { mediaDevices: { getUserMedia() {} } } : {}),
      ...(mobile === undefined ? {} : { userAgentData: { mobile } }),
    },
    capabilities: {
      webSocket: socket,
      audioContext: media,
    },
  });

test("device support allows laptop, desktop, phone, and tablet browsers", () => {
  assert.equal(MINIMUM_SUPPORTED_SCREEN_EDGE, 1024);
  assert.equal(
    supportFor({
      width: 1440,
      height: 900,
      userAgent: "Mozilla/5.0 Macintosh Chrome",
      mobile: false,
    }).supported,
    true,
  );
  assert.equal(
    supportFor({
      width: 1366,
      height: 768,
      userAgent: "Mozilla/5.0 Windows NT",
      maxTouchPoints: 10,
    }).supported,
    true,
  );
  assert.equal(
    supportFor({
      width: 430,
      height: 932,
      userAgent: "Mozilla/5.0 iPhone",
      mobile: true,
    }).supported,
    true,
  );
  assert.equal(
    supportFor({
      width: 1024,
      height: 1366,
      userAgent: "Mozilla/5.0 Macintosh",
      mobile: false,
      maxTouchPoints: 5,
    }).supported,
    true,
  );
});

test("missing voice capabilities degrades to text and direct controls instead of blocking the app", () => {
  const degraded = supportFor({
    width: 430,
    height: 932,
    userAgent: "Mozilla/5.0 iPhone",
    mobile: true,
    media: false,
  });
  assert.equal(degraded.supported, true);
  assert.equal(degraded.mode, "degraded");
  assert.equal(degraded.voiceSupported, false);
  assert.deepEqual(degraded.missingCapabilities, [
    "audio-capture",
    "audio-output",
  ]);
});

test("missing realtime transport preserves direct mode and identifies the missing capability", () => {
  const degraded = supportFor({
    width: 900,
    height: 700,
    userAgent: "Mozilla/5.0 Linux",
    mobile: false,
    socket: false,
  });
  assert.equal(degraded.supported, true);
  assert.equal(degraded.mode, "degraded");
  assert.equal(degraded.textAssistantSupported, false);
  assert.deepEqual(degraded.missingCapabilities, ["websocket"]);
});
