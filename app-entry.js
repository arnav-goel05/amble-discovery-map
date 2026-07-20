import "./styles/device-gate.css";
import { getDeviceSupport } from "./device-support.js";

function showUnsupportedDevice(support) {
  document.body.dataset.deviceSupport = "unsupported";
  document.body.dataset.deviceScreenEdge = String(support.longestScreenEdge);
  document.getElementById("map")?.remove();
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

const support = getDeviceSupport({ screen: globalThis.screen, navigator: globalThis.navigator });
const queryParams = new URLSearchParams(globalThis.location?.search ?? "");
const allowNarrowEmptyFixture = !support.mobileOrTablet
  && queryParams.has("autoStart")
  && queryParams.has("emptyApprovedSnapshot");

if (support.supported || allowNarrowEmptyFixture) {
  document.body.dataset.deviceSupport = support.mode === "degraded" ? "degraded" : "supported";
  import("./main.js").catch((error) => {
    document.body.dataset.applicationState = "failed";
    document.body.dataset.applicationError = "application_module_failed";
    console.error("Amble could not load.", error);
  });
} else {
  showUnsupportedDevice(support);
}
