import assert from "node:assert/strict";
import test from "node:test";

import { getDeviceSupport, MINIMUM_SUPPORTED_SCREEN_EDGE } from "../device-support.js";

const supportFor = ({ width, height, userAgent, mobile, maxTouchPoints = 0 }) => getDeviceSupport({
  screen: { width, height },
  navigator: {
    userAgent,
    maxTouchPoints,
    ...(mobile === undefined ? {} : { userAgentData: { mobile } }),
  },
});

test("device support allows laptop and desktop browsers", () => {
  assert.equal(MINIMUM_SUPPORTED_SCREEN_EDGE, 1024);
  assert.equal(supportFor({ width: 1440, height: 900, userAgent: "Mozilla/5.0 Macintosh Chrome", mobile: false }).supported, true);
  assert.equal(supportFor({ width: 1366, height: 768, userAgent: "Mozilla/5.0 Windows NT", maxTouchPoints: 10 }).supported, true);
});

test("device support blocks phones, tablets, and undersized screens", () => {
  assert.equal(supportFor({ width: 430, height: 932, userAgent: "Mozilla/5.0 iPhone", mobile: true }).supported, false);
  assert.equal(supportFor({ width: 1280, height: 800, userAgent: "Mozilla/5.0 Android", mobile: false }).supported, false);
  assert.equal(supportFor({ width: 1024, height: 1366, userAgent: "Mozilla/5.0 Macintosh", mobile: false, maxTouchPoints: 5 }).supported, false);
  assert.equal(supportFor({ width: 900, height: 700, userAgent: "Mozilla/5.0 Linux", mobile: false }).supported, false);
});
