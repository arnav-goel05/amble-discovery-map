import { formatPerformanceValue } from "./performance-diagnostics-model.js";

export function createPerformanceDiagnosticsView({
  document,
  onClose,
  onExport,
}) {
  let panel = null;

  const mount = () => {
    if (panel || !document?.body) return;
    panel = document.createElement("aside");
    panel.className = "performance-diagnostics";
    panel.setAttribute("aria-label", "Performance diagnostics");
    panel.innerHTML = `
      <header>
        <div><strong>Performance</strong><small class="performance-diagnostics__status"></small></div>
        <button type="button" data-action="close" aria-label="Close performance diagnostics">×</button>
      </header>
      <ul class="performance-diagnostics__metrics"></ul>
      <details class="performance-diagnostics__resources">
        <summary>Largest resources</summary>
        <p class="performance-diagnostics__first-resource"></p>
        <ol></ol>
      </details>
      <button type="button" class="performance-diagnostics__export" data-action="export">Export snapshot</button>
    `;
    panel
      .querySelector('[data-action="close"]')
      ?.addEventListener("click", onClose);
    panel
      .querySelector('[data-action="export"]')
      ?.addEventListener("click", onExport);
    document.body.append(panel);
  };

  const render = (snapshot) => {
    if (!panel) return;
    panel.querySelector(".performance-diagnostics__status").textContent =
      `${snapshot.visibility} · ${snapshot.reducedMotion ? "reduced motion" : "standard motion"}`;
    panel.querySelector(".performance-diagnostics__metrics").innerHTML =
      snapshot.samples
        .map(
          (item) =>
            `<li data-state="${item.state}"><span>${item.metric}</span><strong>${formatPerformanceValue(item)}</strong></li>`,
        )
        .join("");
    const first = snapshot.resources.first;
    panel.querySelector(
      ".performance-diagnostics__first-resource",
    ).textContent = first
      ? `First resource · ${first.group} · ${first.path} · ${formatPerformanceValue({ value: first.bytes, unit: "bytes", state: first.bytes == null ? "unsupported" : "healthy" })}`
      : "First resource · pending";
    panel.querySelector(".performance-diagnostics__resources ol").innerHTML =
      snapshot.resources.largest
        .slice(0, 4)
        .map(
          ({ bytes, group, path }) =>
            `<li><span>${group} · ${path}</span><strong>${formatPerformanceValue({ value: bytes, unit: "bytes" })}</strong></li>`,
        )
        .join("");
  };

  const remove = () => {
    panel?.remove();
    panel = null;
  };

  return { mount, remove, render };
}
