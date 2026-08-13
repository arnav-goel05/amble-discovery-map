const INTRO_ID = "experience-intro";
const DEFAULT_POLL_INTERVAL_MS = 120;
const DEFAULT_READY_SETTLE_MS = 0;

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
        <img class="experience-intro__wordmark" src="/brand/amble-wordmark.png" alt="Amble" width="300" height="95" decoding="async" fetchpriority="high" />
        <h1 id="experience-intro-title" class="experience-intro__title">There is too much happening in Singapore, you just didn't know it</h1>
      </div>
      <div class="experience-intro__loading" role="status" aria-live="polite">
        <span>Bringing Singapore into view</span>
        <span class="experience-intro__dots" aria-hidden="true"><i></i><i></i><i></i></span>
      </div>
      <div class="experience-intro__error" role="alert" hidden>
        <span>Singapore couldn't finish loading. Check your connection and try again.</span>
        <button class="experience-intro__retry" type="button">Try again</button>
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

export function getInitialSceneFailure(dataset = document.body.dataset) {
  if (dataset.applicationState !== "failed") return null;
  return dataset.applicationError || "application_failed";
}

export function createExperienceIntro({
  root = document.getElementById(INTRO_ID),
  skip = false,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  readySettleMs = DEFAULT_READY_SETTLE_MS,
  sceneReady = () => isInitialSceneReady(),
  sceneFailure = () => getInitialSceneFailure(),
  onEnter = () => {},
  onRetry = () => globalThis.location?.reload(),
} = {}) {
  root ||= createMarkup();
  if (skip) {
    root.remove();
    document.body.dataset.experienceIntro = "skipped";
    return {
      destroy() {},
      reveal() {},
      showFailure() {},
      enter: () => false,
    };
  }

  const button = root.querySelector(".experience-intro__enter");
  const loading = root.querySelector(".experience-intro__loading");
  const errorMessage = root.querySelector(".experience-intro__error");
  const retryButton = root.querySelector(".experience-intro__retry");
  let pollTimer = null;
  let removalTimer = null;
  let ready = false;
  let failed = false;
  let dismissed = false;
  let sceneReadySince = null;

  document.body.dataset.experienceIntro = "loading";
  root.focus({ preventScroll: true });

  const stopWaiting = () => {
    if (pollTimer !== null) clearInterval(pollTimer);
    pollTimer = null;
  };

  const reveal = (reason = "scene-ready") => {
    if (ready || failed || dismissed) return;
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

  const showFailure = (reason = "application_failed") => {
    if (ready || failed || dismissed) return false;
    failed = true;
    stopWaiting();
    sceneReadySince = null;
    document.body.dataset.experienceIntro = "error";
    root.dataset.failureReason = String(reason);
    loading.hidden = true;
    button.hidden = true;
    button.disabled = true;
    errorMessage.hidden = false;
    root.classList.add("is-error");
    requestAnimationFrame(() => retryButton.focus({ preventScroll: true }));
    return true;
  };

  const checkScene = () => {
    const failure = sceneFailure();
    if (failure) {
      showFailure(failure);
      return;
    }
    if (sceneReady()) {
      sceneReadySince ??= performance.now();
      if (performance.now() - sceneReadySince >= readySettleMs)
        reveal("scene-ready");
    } else {
      sceneReadySince = null;
    }
  };

  const retry = () => {
    if (!failed || dismissed) return false;
    onRetry(root.dataset.failureReason);
    return true;
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
  retryButton.addEventListener("click", retry);
  root.addEventListener("transitionend", handleTransitionEnd);
  pollTimer = setInterval(checkScene, pollIntervalMs);
  checkScene();

  return {
    reveal,
    showFailure,
    enter: dismiss,
    destroy() {
      dismissed = true;
      stopWaiting();
      if (removalTimer !== null) clearTimeout(removalTimer);
      button.removeEventListener("click", dismiss);
      retryButton.removeEventListener("click", retry);
      root.removeEventListener("transitionend", handleTransitionEnd);
      root.remove();
    },
  };
}
