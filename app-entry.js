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
      <p class="device-gate__eyebrow">Larger screen required</p>
      <h1 id="device-gate-title" class="device-gate__title">Open Amble on a laptop or desktop</h1>
      <p class="device-gate__copy">Amble's detailed 3D map needs more graphics memory than phones can reliably provide. Open this same link on a larger screen to explore events, restaurants, and plans.</p>
    </section>
  `;
  document.body.appendChild(gate);
}

const support = getDeviceSupport({ screen: globalThis.screen, navigator: globalThis.navigator });

if (support.supported) {
  document.body.dataset.deviceSupport = "supported";
  import("./main.js").catch((error) => {
    document.body.dataset.applicationState = "failed";
    document.body.dataset.applicationError = "application_module_failed";
    console.error("Amble could not load.", error);
  });
} else {
  showUnsupportedDevice(support);
}
