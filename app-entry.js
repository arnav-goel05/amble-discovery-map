import "./styles/device-gate.css";
import "./styles/experience-intro.css";
import { getDeviceSupport } from "./device-support.js";

function showUnsupportedDevice(support) {
  document.body.dataset.deviceSupport = "unsupported";
  document.body.dataset.deviceScreenEdge = String(support.shortestScreenEdge);
  document.getElementById("map")?.remove();
  document.getElementById("map-brand")?.remove();
  document.getElementById("experience-intro")?.remove();

  const gate = document.createElement("main");
  gate.id = "device-gate";
  gate.className = "device-gate";
  gate.setAttribute("aria-labelledby", "device-gate-title");
  gate.innerHTML = `
    <section class="device-gate__card">
      <img class="device-gate__wordmark" src="/brand/amble-wordmark.png" alt="Amble" width="1422" height="449">
      <h1 id="device-gate-title" class="device-gate__title">Singapore is waiting on the big screen</h1>
      <p class="device-gate__copy">Open Amble on your laptop to explore the city in 3D, uncover exciting events, find your next restaurant, and build the perfect day out.</p>
    </section>
  `;
  document.body.appendChild(gate);
}

function showApplicationLoadFailure(errorCode) {
  document.body.dataset.applicationState = "failed";
  document.body.dataset.applicationError = errorCode;
  document.body.dataset.experienceIntro = "error";

  const intro = document.getElementById("experience-intro");
  if (!intro) return;

  intro.dataset.failureReason = errorCode;
  intro.classList.add("is-error");
  const loading = intro.querySelector(".experience-intro__loading");
  const enter = intro.querySelector(".experience-intro__enter");
  const errorMessage = intro.querySelector(".experience-intro__error");
  const retry = intro.querySelector(".experience-intro__retry");
  if (loading) loading.hidden = true;
  if (enter) {
    enter.hidden = true;
    enter.disabled = true;
  }
  if (errorMessage) errorMessage.hidden = false;
  retry?.addEventListener("click", () => globalThis.location.reload(), {
    once: true,
  });
}

const support = getDeviceSupport({
  screen: globalThis.screen,
  viewport: {
    width: globalThis.innerWidth,
    height: globalThis.innerHeight,
  },
  navigator: globalThis.navigator,
});
const queryParams = new URLSearchParams(globalThis.location?.search ?? "");
const allowNarrowEmptyFixture =
  !support.mobileOrTablet && queryParams.has("emptyApprovedSnapshot");

async function startSupportedApplication() {
  document.body.dataset.deviceSupport =
    support.mode === "degraded" ? "degraded" : "supported";
  if (queryParams.get("performanceDiagnostics") === "1") {
    let diagnostics;
    try {
      const { createPerformanceDiagnostics } =
        await import("./activity-scenes/performance-diagnostics.js");
      diagnostics = createPerformanceDiagnostics();
      globalThis.__performanceDiagnostics = diagnostics;
      diagnostics.start();
    } catch (error) {
      diagnostics?.destroy?.();
      delete globalThis.__performanceDiagnostics;
      document.body.dataset.performanceDiagnostics = "failed";
      console.warn("Performance diagnostics could not start.", error);
    }
  }
  try {
    await import("./main.js");
  } catch (error) {
    showApplicationLoadFailure("application_module_failed");
    console.error("Amble could not load.", error);
  }
}

if (support.supported || allowNarrowEmptyFixture) {
  startSupportedApplication();
} else {
  showUnsupportedDevice(support);
}
