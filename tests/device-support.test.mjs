import assert from "node:assert/strict";
import test from "node:test";

import {
  getDeviceSupport,
  MINIMUM_SUPPORTED_SHORT_SCREEN_EDGE,
} from "../device-support.js";

const supportFor = ({
  width,
  height,
  userAgent,
  mobile,
  maxTouchPoints = 0,
  viewportWidth,
  viewportHeight,
  media = true,
  socket = true,
}) =>
  getDeviceSupport({
    screen: { width, height },
    ...(viewportWidth && viewportHeight
      ? { viewport: { width: viewportWidth, height: viewportHeight } }
      : {}),
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

test("device support allows laptop, desktop, and tablet-sized screens", () => {
  assert.equal(MINIMUM_SUPPORTED_SHORT_SCREEN_EDGE, 500);
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
      width: 768,
      height: 1024,
      userAgent: "Mozilla/5.0 iPad",
      mobile: true,
      maxTouchPoints: 5,
    }).supported,
    true,
  );
  assert.equal(
    supportFor({
      width: 800,
      height: 1280,
      userAgent: "Mozilla/5.0 Android",
      mobile: true,
    }).supported,
    true,
  );
});

test("device support blocks screens whose shortest edge is below 500 pixels", () => {
  assert.equal(
    supportFor({
      width: 430,
      height: 932,
      userAgent: "Mozilla/5.0 iPhone",
      mobile: true,
    }).supported,
    false,
  );
  assert.equal(
    supportFor({
      width: 499,
      height: 1024,
      userAgent: "Mozilla/5.0 Macintosh",
      mobile: false,
      maxTouchPoints: 5,
    }).supported,
    false,
  );
  assert.equal(
    supportFor({
      width: 900,
      height: 499,
      userAgent: "Mozilla/5.0 Linux",
      mobile: false,
    }).supported,
    false,
  );
  assert.equal(
    supportFor({
      width: 500,
      height: 700,
      userAgent: "Mozilla/5.0 Android",
      mobile: true,
    }).supported,
    true,
  );
});

test("mobile viewport wins when a privacy-resistant browser masks its screen size", () => {
  const maskedPhone = supportFor({
    width: 1366,
    height: 768,
    viewportWidth: 390,
    viewportHeight: 844,
    userAgent: "Mozilla/5.0 (Android 14; Mobile; rv:142.0) Firefox/142.0",
    mobile: true,
  });
  assert.equal(maskedPhone.mobileOrTablet, true);
  assert.equal(maskedPhone.shortestScreenEdge, 390);
  assert.equal(maskedPhone.supported, false);
});

test("missing voice capabilities degrades a supported desktop to direct controls", () => {
  const degraded = supportFor({
    width: 1440,
    height: 900,
    userAgent: "Mozilla/5.0 Macintosh Chrome",
    mobile: false,
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
    width: 1440,
    height: 900,
    userAgent: "Mozilla/5.0 Linux",
    mobile: false,
    socket: false,
  });
  assert.equal(degraded.supported, true);
  assert.equal(degraded.mode, "degraded");
  assert.equal(degraded.textAssistantSupported, false);
  assert.deepEqual(degraded.missingCapabilities, ["websocket"]);
});
