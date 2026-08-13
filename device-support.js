export function getDeviceSupport({ navigator, capabilities = {} } = {}) {
  const audioCapture =
    typeof navigator?.mediaDevices?.getUserMedia === "function";
  const audioOutput =
    capabilities.audioContext ??
    (typeof globalThis.AudioContext === "function" ||
      typeof globalThis.webkitAudioContext === "function");
  const webSocket =
    capabilities.webSocket ?? typeof globalThis.WebSocket === "function";
  const missingCapabilities = [];
  if (!audioCapture) missingCapabilities.push("audio-capture");
  if (!audioOutput) missingCapabilities.push("audio-output");
  if (!webSocket) missingCapabilities.push("websocket");

  const voiceSupported = audioCapture && audioOutput && webSocket;
  const textAssistantSupported = webSocket;
  return {
    mode: voiceSupported && textAssistantSupported ? "full" : "degraded",
    voiceSupported,
    textAssistantSupported,
    missingCapabilities,
  };
}
