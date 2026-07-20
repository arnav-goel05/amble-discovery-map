const TARGET_SAMPLE_RATE = 24_000;

const toBase64 = (bytes) => {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
};

const fromBase64 = (value) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
};

function pcm16(floatSamples, sourceRate) {
  const ratio = sourceRate / TARGET_SAMPLE_RATE;
  const length = Math.max(1, Math.floor(floatSamples.length / ratio));
  const output = new Int16Array(length);
  for (let index = 0; index < length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.max(start + 1, Math.floor((index + 1) * ratio));
    let sum = 0;
    for (
      let cursor = start;
      cursor < end && cursor < floatSamples.length;
      cursor += 1
    )
      sum += floatSamples[cursor];
    const sample = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return new Uint8Array(output.buffer);
}

export function createBrowserPcmCapture({
  stream,
  appendChunk,
  speechStart,
  speechEnd,
  AudioContextImpl = globalThis.AudioContext || globalThis.webkitAudioContext,
  silenceMs = 650,
  threshold = 0.018,
} = {}) {
  let context;
  let source;
  let processor;
  let speaking = false;
  let lastSpeechAt = 0;

  const stop = () => {
    if (processor) processor.onaudioprocess = null;
    try {
      processor?.disconnect();
      source?.disconnect();
    } catch {}
    void context?.close?.();
    context = source = processor = null;
    if (speaking) speechEnd?.();
    speaking = false;
  };

  return Object.freeze({
    start() {
      if (!AudioContextImpl || !stream) return false;
      try {
        context = new AudioContextImpl({ sampleRate: TARGET_SAMPLE_RATE });
        source = context.createMediaStreamSource(stream);
        processor = context.createScriptProcessor(2048, 1, 1);
      } catch {
        void context?.close?.();
        context = source = processor = null;
        return false;
      }
      processor.onaudioprocess = (event) => {
        const samples = event.inputBuffer.getChannelData(0);
        let energy = 0;
        for (const sample of samples) energy += sample * sample;
        const rms = Math.sqrt(energy / Math.max(1, samples.length));
        const now = performance.now();
        if (rms >= threshold) {
          lastSpeechAt = now;
          if (!speaking) {
            speaking = true;
            speechStart?.();
          }
        } else if (speaking && now - lastSpeechAt >= silenceMs) {
          speaking = false;
          speechEnd?.();
        }
        if (speaking) appendChunk(toBase64(pcm16(samples, context.sampleRate)));
      };
      source.connect(processor);
      processor.connect(context.destination);
      void context.resume?.();
      return true;
    },
    stop,
  });
}

export function createBrowserPcmPlayback({
  AudioContextImpl = globalThis.AudioContext || globalThis.webkitAudioContext,
} = {}) {
  let context = null;
  let active = null;
  return Object.freeze({
    async play(encodedAudio) {
      if (!AudioContextImpl) return;
      context ||= new AudioContextImpl({ sampleRate: TARGET_SAMPLE_RATE });
      const bytes = fromBase64(encodedAudio);
      const samples = new Int16Array(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength / 2,
      );
      const buffer = context.createBuffer(
        1,
        samples.length,
        TARGET_SAMPLE_RATE,
      );
      const channel = buffer.getChannelData(0);
      for (let index = 0; index < samples.length; index += 1)
        channel[index] =
          samples[index] / (samples[index] < 0 ? 0x8000 : 0x7fff);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      active = source;
      await new Promise((resolve) => {
        source.onended = resolve;
        source.start();
      });
      if (active === source) active = null;
    },
    cancel() {
      try {
        active?.stop();
      } catch {}
      active = null;
    },
    close() {
      this.cancel();
      void context?.close?.();
      context = null;
    },
  });
}
