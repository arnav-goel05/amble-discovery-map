import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  AudioControllerError,
  createAudioController,
  validateAudioMetadata,
} from "../activity-scenes/assistant/audio-controller.js";
import { createBrowserPcmCapture } from "../activity-scenes/assistant/browser-audio-io.js";

const fixture = JSON.parse(
  fs.readFileSync(
    new URL("./fixtures/voice/audio-metadata.json", import.meta.url),
    "utf8",
  ),
);

function mediaFixture() {
  const listeners = new Map();
  const track = {
    readyState: "live",
    stopped: 0,
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type) => listeners.delete(type),
    stop() {
      this.stopped += 1;
      this.readyState = "ended";
    },
    revoke() {
      this.readyState = "ended";
      listeners.get("ended")?.();
    },
  };
  return {
    track,
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track] }) },
  };
}

test("fixture audio formats and chunks enforce the declared bounds", () => {
  for (const item of fixture.cases) {
    const run = () => validateAudioMetadata(item);
    if (item.expected === "accepted") assert.equal(run().format, "pcm16");
    else
      assert.throws(
        run,
        (error) =>
          error instanceof AudioControllerError && error.code === item.expected,
      );
  }
});

test("microphone acquisition requires disclosure and owns terminal track cleanup", async () => {
  const { track, mediaDevices } = mediaFixture();
  let requests = 0;
  const controller = createAudioController({
    mediaDevices: {
      getUserMedia: async (...args) => {
        requests += 1;
        return mediaDevices.getUserMedia(...args);
      },
    },
  });
  await assert.rejects(
    controller.start(),
    (error) => error.code === "disclosure_required",
  );
  assert.equal(requests, 0);
  await controller.start({ disclosureAccepted: true });
  assert.equal(controller.snapshot().activeTrackCount, 1);
  controller.stop("user");
  assert.equal(track.stopped, 1);
  assert.equal(controller.snapshot().state, "stopped");
  controller.stop("user");
  assert.equal(track.stopped, 1);
});

test("semantic VAD and push-to-talk bound capture and cancel playback on interruption", async () => {
  const { mediaDevices } = mediaFixture();
  const chunks = [];
  const events = [];
  const controller = createAudioController({
    mediaDevices,
    onChunk: (chunk) => chunks.push(chunk.byteLength),
    cancelPlayback: () => events.push("cancel"),
    onSpeechStart: () => events.push("start"),
    onSpeechEnd: () => events.push("end"),
    audioBounds: {
      format: "pcm16",
      sampleRateHz: 24_000,
      channels: 1,
      maxChunkBytes: 8,
    },
  });
  await controller.start({ disclosureAccepted: true });
  controller.setVadState("speech_started");
  assert.equal(controller.appendChunk(new Uint8Array(8)), true);
  controller.setVadState("speech_stopped");
  controller.beginPushToTalk();
  assert.equal(controller.appendChunk(new Uint8Array(4)), true);
  controller.endPushToTalk();
  assert.deepEqual(chunks, [8, 4]);
  assert.deepEqual(events, [
    "start",
    "cancel",
    "end",
    "start",
    "cancel",
    "end",
  ]);
  assert.throws(
    () => controller.appendChunk(new Uint8Array(9)),
    (error) => error.code === "protocol",
  );
});

test("rejected ambient speech does not interrupt assistant playback", async () => {
  const { mediaDevices } = mediaFixture();
  const events = [];
  const controller = createAudioController({
    mediaDevices,
    cancelPlayback: () => events.push("cancel"),
    onSpeechStart: () => {
      events.push("ambient");
      return false;
    },
  });

  await controller.start({ disclosureAccepted: true });
  assert.equal(controller.setVadState("speech_started"), false);
  assert.deepEqual(events, ["ambient"]);
});

test("permission revoke and pagehide terminate capture without retained chunks", async () => {
  const first = mediaFixture();
  const terminal = [];
  const controller = createAudioController({
    mediaDevices: first.mediaDevices,
    onTerminal: (reason) => terminal.push(reason),
  });
  await controller.start({ disclosureAccepted: true });
  first.track.revoke();
  assert.deepEqual(terminal, ["permission"]);

  const second = mediaFixture();
  const listeners = new Map();
  const page = {
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type) => listeners.delete(type),
  };
  const pageController = createAudioController({
    mediaDevices: second.mediaDevices,
  });
  pageController.bindPageLifecycle(page);
  await pageController.start({ disclosureAccepted: true });
  listeners.get("pagehide")();
  assert.equal(second.track.stopped, 1);
  assert.equal(pageController.snapshot().terminalReason, "pagehide");
  assert.equal(Object.hasOwn(pageController.snapshot(), "chunks"), false);
});

test("browser capture converts live microphone samples to 24 kHz PCM and signals a turn", () => {
  let processor;
  let closed = 0;
  const events = [];
  const chunks = [];
  class FakeAudioContext {
    constructor() {
      this.sampleRate = 48_000;
      this.destination = {};
    }
    createMediaStreamSource() {
      return { connect() {}, disconnect() {} };
    }
    createScriptProcessor() {
      processor = { connect() {}, disconnect() {}, onaudioprocess: null };
      return processor;
    }
    close() {
      closed += 1;
    }
    resume() {}
  }
  const capture = createBrowserPcmCapture({
    stream: {},
    AudioContextImpl: FakeAudioContext,
    appendChunk: (chunk) => chunks.push(chunk),
    speechStart: () => events.push("start"),
    speechEnd: () => events.push("end"),
  });

  assert.equal(capture.start(), true);
  processor.onaudioprocess({
    inputBuffer: { getChannelData: () => new Float32Array(2_048).fill(0.25) },
  });
  assert.deepEqual(events, ["start"]);
  assert.equal(chunks.length, 1);
  assert.equal(Buffer.from(chunks[0], "base64").byteLength, 2_048);

  capture.stop();
  assert.deepEqual(events, ["start", "end"]);
  assert.equal(closed, 1);
});
