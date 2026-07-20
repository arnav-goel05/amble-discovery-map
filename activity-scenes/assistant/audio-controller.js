const AUDIO_FORMATS = new Set(["pcm16"]);
const VAD_STATES = new Set(["idle", "speech_started", "speech_stopped"]);
const TERMINAL_REASONS = new Set([
  "user",
  "pagehide",
  "idle",
  "duration",
  "permission",
  "disabled",
  "usage_limit",
  "provider",
  "network",
  "protocol",
]);

export class AudioControllerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AudioControllerError";
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new AudioControllerError(code, message);
};
const byteLength = (chunk) => {
  if (chunk instanceof ArrayBuffer) return chunk.byteLength;
  if (ArrayBuffer.isView(chunk)) return chunk.byteLength;
  if (typeof chunk === "string")
    return Math.floor((chunk.replace(/=+$/, "").length * 3) / 4);
  return -1;
};

export const DEFAULT_AUDIO_BOUNDS = Object.freeze({
  format: "pcm16",
  sampleRateHz: 24_000,
  channels: 1,
  maxChunkBytes: 64 * 1_024,
});

export function validateAudioMetadata(metadata, bounds = DEFAULT_AUDIO_BOUNDS) {
  if (
    !AUDIO_FORMATS.has(metadata?.format) ||
    metadata.format !== bounds.format ||
    metadata.sampleRateHz !== bounds.sampleRateHz ||
    metadata.channels !== bounds.channels
  ) {
    fail("invalid_request", "Audio format is unsupported");
  }
  if (
    !Number.isSafeInteger(metadata.maxChunkBytes) ||
    metadata.maxChunkBytes <= 0 ||
    metadata.maxChunkBytes > bounds.maxChunkBytes
  ) {
    fail("protocol", "Audio chunk exceeds its bound");
  }
  return Object.freeze({
    format: metadata.format,
    sampleRateHz: metadata.sampleRateHz,
    channels: metadata.channels,
    maxChunkBytes: metadata.maxChunkBytes,
  });
}

export function createAudioController({
  mediaDevices = globalThis.navigator?.mediaDevices,
  captureFactory = null,
  audioBounds = DEFAULT_AUDIO_BOUNDS,
  onChunk = null,
  onStateChange = null,
  onSpeechStart = null,
  onSpeechEnd = null,
  cancelPlayback = null,
  onTerminal = null,
} = {}) {
  let state = "idle";
  let vadState = "idle";
  let mode = "semantic_vad";
  let stream = null;
  let capture = null;
  let tracks = [];
  let terminalReason = null;
  let lifecycleTarget = null;
  let pagehideHandler = null;

  const emit = () =>
    onStateChange?.(
      Object.freeze({
        state,
        vadState,
        mode,
        activeTrackCount: tracks.filter(
          ({ readyState }) => readyState !== "ended",
        ).length,
        terminalReason,
      }),
    );
  const removeTrackHandlers = () => {
    for (const track of tracks)
      track.removeEventListener?.("ended", permissionEnded);
  };
  const permissionEnded = () => {
    if (state !== "stopped") stop("permission");
  };

  const appendChunk = (chunk) => {
    if (
      state !== "listening" ||
      (mode === "push_to_talk" && vadState !== "speech_started")
    )
      return false;
    const size = byteLength(chunk);
    if (size < 0) fail("invalid_request", "Audio chunk type is unsupported");
    if (size > audioBounds.maxChunkBytes) {
      stop("protocol");
      fail("protocol", "Audio chunk exceeds its bound");
    }
    onChunk?.(chunk, { byteLength: size });
    return true;
  };

  const speechStart = () => {
    if (state !== "listening") return false;
    vadState = "speech_started";
    const accepted = onSpeechStart?.() !== false;
    if (!accepted) {
      emit();
      return false;
    }
    cancelPlayback?.();
    emit();
    return true;
  };
  const speechEnd = () => {
    if (state !== "listening" || vadState !== "speech_started") return false;
    vadState = "speech_stopped";
    onSpeechEnd?.();
    emit();
    return true;
  };

  const start = async ({
    disclosureAccepted = false,
    constraints = { audio: true },
  } = {}) => {
    if (state === "stopped")
      fail("session_stopped", "A stopped audio controller cannot restart");
    if (state !== "idle") return snapshot();
    if (disclosureAccepted !== true)
      fail(
        "disclosure_required",
        "Microphone disclosure must be accepted first",
      );
    if (typeof mediaDevices?.getUserMedia !== "function")
      fail("permission", "Microphone access is unavailable");
    state = "requesting";
    emit();
    try {
      stream = await mediaDevices.getUserMedia(constraints);
    } catch {
      state = "idle";
      emit();
      fail("permission", "Microphone permission was denied");
    }
    tracks = [...(stream?.getTracks?.() || [])];
    for (const track of tracks)
      track.addEventListener?.("ended", permissionEnded, { once: true });
    capture =
      captureFactory?.({
        stream,
        appendChunk,
        audioBounds,
        speechStart,
        speechEnd,
      }) || null;
    capture?.start?.();
    state = "listening";
    vadState = "idle";
    emit();
    return snapshot();
  };

  const stop = (reason = "user") => {
    if (!TERMINAL_REASONS.has(reason))
      fail("invalid_terminal_reason", "Audio terminal reason is invalid");
    if (state === "stopped") return snapshot();
    state = "stopping";
    capture?.stop?.();
    capture = null;
    removeTrackHandlers();
    for (const track of tracks) track.stop?.();
    tracks = [];
    stream = null;
    vadState = "idle";
    state = "stopped";
    terminalReason = reason;
    emit();
    onTerminal?.(reason);
    return snapshot();
  };

  const snapshot = () =>
    Object.freeze({
      state,
      vadState,
      mode,
      activeTrackCount: tracks.length,
      terminalReason,
    });

  return Object.freeze({
    start,
    stop,
    appendChunk,
    snapshot,
    setVadState(nextState) {
      if (!VAD_STATES.has(nextState))
        fail("invalid_vad_state", "VAD state is invalid");
      if (nextState === "speech_started") return speechStart();
      if (nextState === "speech_stopped") return speechEnd();
      vadState = "idle";
      emit();
      return true;
    },
    beginPushToTalk() {
      mode = "push_to_talk";
      return speechStart();
    },
    endPushToTalk() {
      const ended = speechEnd();
      mode = "semantic_vad";
      emit();
      return ended;
    },
    setMuted(muted) {
      for (const track of tracks) track.enabled = muted !== true;
      if (muted === true && vadState === "speech_started") speechEnd();
      emit();
      return muted === true;
    },
    bindPageLifecycle(target = globalThis.window) {
      if (!target?.addEventListener) return () => {};
      if (lifecycleTarget) return () => {};
      lifecycleTarget = target;
      pagehideHandler = () => stop("pagehide");
      lifecycleTarget.addEventListener("pagehide", pagehideHandler, {
        once: true,
      });
      return () => {
        lifecycleTarget?.removeEventListener?.("pagehide", pagehideHandler);
        lifecycleTarget = null;
        pagehideHandler = null;
      };
    },
  });
}
