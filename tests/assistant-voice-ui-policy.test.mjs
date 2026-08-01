import assert from "node:assert/strict";
import test from "node:test";

import { resolveVoiceUiEnabled } from "../activity-scenes/assistant/voice-ui-policy.js";

test("voice UI policy honors explicit true and false values", () => {
  assert.equal(
    resolveVoiceUiEnabled({ configuredValue: "true", development: false }),
    true,
  );
  assert.equal(
    resolveVoiceUiEnabled({ configuredValue: "false", development: true }),
    false,
  );
});

test("voice UI policy defaults on in development and off in production", () => {
  assert.equal(resolveVoiceUiEnabled({ development: true }), true);
  assert.equal(resolveVoiceUiEnabled({ development: false }), false);
});

test("voice UI policy fails closed for malformed configured values", () => {
  assert.equal(
    resolveVoiceUiEnabled({ configuredValue: "TRUE", development: true }),
    false,
  );
  assert.equal(
    resolveVoiceUiEnabled({ configuredValue: "yes", development: false }),
    false,
  );
});
