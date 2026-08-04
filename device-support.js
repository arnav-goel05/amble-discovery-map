export const MINIMUM_SUPPORTED_SHORT_SCREEN_EDGE = 500;

const MOBILE_OR_TABLET_USER_AGENT =
  /Android|iPhone|iPad|iPod|Windows Phone|webOS|BlackBerry|Opera Mini|IEMobile/i;

export function getDeviceSupport({
  screen,
  viewport,
  navigator,
  capabilities = {},
} = {}) {
  const screenWidth = Number(screen?.width) || 0;
  const screenHeight = Number(screen?.height) || 0;
  const userAgent = String(navigator?.userAgent || "");
  const mobileHint = navigator?.userAgentData?.mobile;
  const ipadDesktopMode =
    /Macintosh/i.test(userAgent) && Number(navigator?.maxTouchPoints) > 1;
  const mobileOrTablet =
    mobileHint === true ||
    MOBILE_OR_TABLET_USER_AGENT.test(userAgent) ||
    ipadDesktopMode;
  const viewportWidth = Number(viewport?.width) || 0;
  const viewportHeight = Number(viewport?.height) || 0;
  const screenEdges = [screenWidth, screenHeight].filter((edge) => edge > 0);
  const viewportEdges = [viewportWidth, viewportHeight].filter(
    (edge) => edge > 0,
  );
  const effectiveEdges =
    mobileOrTablet && viewportEdges.length === 2
      ? [...screenEdges, ...viewportEdges]
      : screenEdges;
  const longestScreenEdge = Math.max(...effectiveEdges, 0);
  const shortestScreenEdge = effectiveEdges.length
    ? Math.min(...effectiveEdges)
    : 0;

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
