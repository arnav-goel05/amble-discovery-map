const INTRO_ID = "experience-intro";
const DEFAULT_POLL_INTERVAL_MS = 120;
const DEFAULT_MINIMUM_DISPLAY_MS = 700;
const DEFAULT_READY_SETTLE_MS = 600;
const DEFAULT_MAXIMUM_WAIT_MS = 8_000;

function createMarkup() {
  const root = document.createElement("div");
  root.id = INTRO_ID;
  root.className = "experience-intro";
  root.tabIndex = -1;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "experience-intro-title");
  root.innerHTML = `
    <div class="experience-intro__content">
      <div class="experience-intro__brand">
        <img class="experience-intro__wordmark" src="/brand/amble-wordmark.png" alt="Amble" width="1422" height="449" decoding="async" fetchpriority="high" />
        <h1 id="experience-intro-title" class="experience-intro__title">There is too much happening in Singapore, you just didn't know it</h1>
      </div>
      <div class="experience-intro__loading" role="status" aria-live="polite">
        <span>Bringing Singapore into view</span>
        <span class="experience-intro__dots" aria-hidden="true"><i></i><i></i><i></i></span>
      </div>
      <button class="experience-intro__enter" type="button" hidden disabled>Let's explore</button>
    </div>`;
  document.body.appendChild(root);
  return root;
}

export function isInitialSceneReady(dataset = document.body.dataset) {
  return (
    dataset.mapLoaded === "true" &&
    dataset.buildingsLayerStarted === "true" &&
    dataset.tilesetLoaded === "true" &&
    dataset.backgroundViewLoaded === "true"
  );
}

export function createExperienceIntro({
  root = document.getElementById(INTRO_ID),
  skip = false,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  minimumDisplayMs = DEFAULT_MINIMUM_DISPLAY_MS,
  readySettleMs = DEFAULT_READY_SETTLE_MS,
  maximumWaitMs = DEFAULT_MAXIMUM_WAIT_MS,
  sceneReady = () => isInitialSceneReady(),
  onEnter = () => {},
} = {}) {
  root ||= createMarkup();
  if (skip) {
    root.remove();
    document.body.dataset.experienceIntro = "skipped";
    return { destroy() {}, reveal() {}, enter: () => false };
  }

  const button = root.querySelector(".experience-intro__enter");
  const loading = root.querySelector(".experience-intro__loading");
  const startedAt = performance.now();
  let pollTimer = null;
  let minimumTimer = null;
  let fallbackTimer = null;
  let removalTimer = null;
  let ready = false;
  let dismissed = false;
  let sceneReadySince = null;

  document.body.dataset.experienceIntro = "loading";
  root.focus({ preventScroll: true });

  const stopWaiting = () => {
    if (pollTimer !== null) clearInterval(pollTimer);
    if (minimumTimer !== null) clearTimeout(minimumTimer);
    if (fallbackTimer !== null) clearTimeout(fallbackTimer);
    pollTimer = null;
    minimumTimer = null;
    fallbackTimer = null;
  };

  const reveal = (reason = "scene-ready") => {
    if (ready || dismissed) return;
    const remaining = Math.max(
      0,
      minimumDisplayMs - (performance.now() - startedAt),
    );
    if (remaining > 0) {
      if (minimumTimer === null)
        minimumTimer = setTimeout(() => {
          minimumTimer = null;
          reveal(reason);
        }, remaining);
      return;
    }
    ready = true;
    stopWaiting();
    document.body.dataset.experienceIntro = "ready";
    root.dataset.readyReason = reason;
    button.textContent = "Let's explore";
    loading.hidden = true;
    button.hidden = false;
    button.disabled = false;
    requestAnimationFrame(() => {
      root.classList.add("is-ready");
    });
  };

  const checkScene = () => {
    if (sceneReady()) {
      sceneReadySince ??= performance.now();
      if (performance.now() - sceneReadySince >= readySettleMs)
        reveal("scene-ready");
    } else {
      sceneReadySince = null;
    }
  };

  const finishDismissal = () => {
    if (!root.isConnected) return;
    root.remove();
    document.body.dataset.experienceIntro = "complete";
    document
      .querySelector(".maplibregl-canvas")
      ?.focus({ preventScroll: true });
  };

  const dismiss = () => {
    if (!ready || dismissed) return false;
    dismissed = true;
    stopWaiting();
    button.disabled = true;
    onEnter();
    root.classList.add("is-leaving");
    document.body.dataset.experienceIntro = "leaving";
    removalTimer = setTimeout(finishDismissal, 800);
    return true;
  };

  const handleTransitionEnd = (event) => {
    if (
      dismissed &&
      event.target === root &&
      event.propertyName === "opacity"
    ) {
      clearTimeout(removalTimer);
      removalTimer = null;
      finishDismissal();
    }
  };

  button.addEventListener("click", dismiss);
  root.addEventListener("transitionend", handleTransitionEnd);
  pollTimer = setInterval(checkScene, pollIntervalMs);
  fallbackTimer = setTimeout(() => reveal("maximum-wait"), maximumWaitMs);
  checkScene();

  return {
    reveal,
    enter: dismiss,
    destroy() {
      dismissed = true;
      stopWaiting();
      if (removalTimer !== null) clearTimeout(removalTimer);
      button.removeEventListener("click", dismiss);
      root.removeEventListener("transitionend", handleTransitionEnd);
      root.remove();
    },
  };
}
