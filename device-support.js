export const MINIMUM_SUPPORTED_SCREEN_EDGE = 1024;

const MOBILE_OR_TABLET_USER_AGENT = /Android|iPhone|iPad|iPod|Windows Phone|webOS|BlackBerry|Opera Mini|IEMobile/i;

export function getDeviceSupport({ screen, navigator } = {}) {
  const width = Number(screen?.width) || 0;
  const height = Number(screen?.height) || 0;
  const longestScreenEdge = Math.max(width, height);
  const userAgent = String(navigator?.userAgent || "");
  const mobileHint = navigator?.userAgentData?.mobile;
  const ipadDesktopMode = /Macintosh/i.test(userAgent) && Number(navigator?.maxTouchPoints) > 1;
  const mobileOrTablet = mobileHint === true
    || MOBILE_OR_TABLET_USER_AGENT.test(userAgent)
    || ipadDesktopMode;

  return {
    supported: !mobileOrTablet && longestScreenEdge >= MINIMUM_SUPPORTED_SCREEN_EDGE,
    longestScreenEdge,
    mobileOrTablet,
  };
}
