export const MINIMUM_SUPPORTED_SHORT_SCREEN_EDGE = 500;

const MOBILE_OR_TABLET_USER_AGENT =
  /Android|iPhone|iPad|iPod|Windows Phone|webOS|BlackBerry|Opera Mini|IEMobile/i;

export function getDeviceSupport({
  screen,
  navigator,
  capabilities = {},
} = {}) {
  const width = Number(screen?.width) || 0;
  const height = Number(screen?.height) || 0;
  const longestScreenEdge = Math.max(width, height);
  const shortestScreenEdge = Math.min(width, height);
  const userAgent = String(navigator?.userAgent || "");
  const mobileHint = navigator?.userAgentData?.mobile;
  const ipadDesktopMode =
    /Macintosh/i.test(userAgent) && Number(navigator?.maxTouchPoints) > 1;
  const mobileOrTablet =
    mobileHint === true ||
    MOBILE_OR_TABLET_USER_AGENT.test(userAgent) ||
    ipadDesktopMode;

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
  const supported = shortestScreenEdge >= MINIMUM_SUPPORTED_SHORT_SCREEN_EDGE;

  return {
    supported,
    mode: voiceSupported && textAssistantSupported ? "full" : "degraded",
    voiceSupported,
    textAssistantSupported,
    missingCapabilities,
    longestScreenEdge,
    shortestScreenEdge,
    mobileOrTablet,
  };
}
