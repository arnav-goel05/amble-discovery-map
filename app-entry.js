import { getDeviceSupport } from "./device-support.js";

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
  navigator: globalThis.navigator,
});
const queryParams = new URLSearchParams(globalThis.location?.search ?? "");

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

startSupportedApplication();
