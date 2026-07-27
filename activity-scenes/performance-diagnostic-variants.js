import variantConfig from "../config/map-performance-diagnostic-variants.json";

const variants = new Map(
  variantConfig.variants.map((variant) => [variant.id, variant]),
);

export function requestedPerformanceVariant(search = globalThis.location?.search) {
  const params = new URLSearchParams(search ?? "");
  if (params.get("performanceDiagnostics") !== "1") return null;
  const id = params.get("performanceVariant");
  return id && variants.has(id) ? structuredClone(variants.get(id)) : null;
}

export function installPerformanceVariantController({
  map,
  buildingHighlights,
  eventScene,
  search,
  documentRef = document,
  globalRef = globalThis,
}) {
  const variant = requestedPerformanceVariant(search);
  if (!variant) return null;
  let applied = false;
  const apply = () => {
    if (applied) return false;
    const before = buildingHighlights.diagnosticSnapshot();
    buildingHighlights.setDiagnosticTileTraversal(false);
    const { workloads } = variant;
    if (!workloads.background3d && map.getLayer("buildings-3d"))
      map.removeLayer("buildings-3d");
    if (!workloads.highlighted3d && map.getLayer("event-venues-3d"))
      map.removeLayer("event-venues-3d");
    if (!workloads.overlays) {
      const removable = map
        .getStyle()
        .layers.map(({ id }) => id)
        .filter(
          (id) =>
            ![
              "carto-voyager-nolabels",
              "buildings-3d",
              "event-venues-3d",
            ].includes(id),
        )
        .reverse();
      for (const id of removable) if (map.getLayer(id)) map.removeLayer(id);
    }
    const removeMatchingLayers = (predicate) => {
      const ids = map
        .getStyle()
        .layers.map(({ id }) => id)
        .filter(predicate)
        .reverse();
      for (const id of ids) if (map.getLayer(id)) map.removeLayer(id);
    };
    if (workloads.transit === false)
      removeMatchingLayers((id) => id.startsWith("mrt-"));
    if (workloads.waterParks === false)
      removeMatchingLayers(
        (id) => id.startsWith("water-overlay") || id.startsWith("parks-overlay"),
      );
    if (workloads.restaurantMap === false)
      removeMatchingLayers((id) => id.startsWith("viewport-restaurant-"));
    if (workloads.discoveryContext === false)
      removeMatchingLayers(
        (id) =>
          id.startsWith("discovery-areas-") ||
          id.startsWith("user-location-"),
      );
    if (workloads.minimapViewportTracking === false)
      eventScene?.setDiagnosticMinimapViewportTracking?.(false);
    if (workloads.moveEndSearchRefresh === false)
      eventScene?.setDiagnosticMoveEndSearchRefresh?.(false);
    if (workloads.moveEndSearchRefreshMode)
      eventScene?.setDiagnosticMoveEndSearchRefreshMode?.(
        workloads.moveEndSearchRefreshMode,
      );
    if (!workloads.interface) {
      const style = documentRef.createElement("style");
      style.id = "performance-diagnostic-hide-interface";
      style.textContent =
        "body > *:not(#map):not(.performance-diagnostics){display:none!important}";
      documentRef.head.appendChild(style);
    }
    applied = true;
    documentRef.body.dataset.performanceVariant = variant.id;
    documentRef.body.dataset.performanceVariantApplied = "true";
    map.triggerRepaint();
    return {
      before,
      after: buildingHighlights.diagnosticSnapshot(),
      eventDiagnostics: {
        minimapViewportTracking:
          documentRef
            .getElementById("event-density-minimap")
            ?.dataset.viewportTracking ?? null,
        moveEndSearchRefresh:
          documentRef.body.dataset.eventSearchMoveEndRefreshEnabled ?? null,
        moveEndSearchRefreshMode:
          documentRef.body.dataset.eventSearchMoveEndRefreshMode ?? null,
      },
    };
  };
  const destroy = () => {
    delete globalRef.__applyPerformanceDiagnosticVariant;
    delete globalRef.__setPerformanceDiagnosticEventWorkloads;
    documentRef
      .getElementById("performance-diagnostic-hide-interface")
      ?.remove();
  };
  globalRef.__applyPerformanceDiagnosticVariant = apply;
  globalRef.__setPerformanceDiagnosticEventWorkloads = ({
    minimapViewportTracking,
    moveEndSearchRefresh,
    moveEndSearchRefreshMode,
  } = {}) => ({
    minimapViewportTracking:
      minimapViewportTracking == null
        ? null
        : eventScene?.setDiagnosticMinimapViewportTracking?.(
            minimapViewportTracking,
          ) ?? false,
    moveEndSearchRefresh:
      moveEndSearchRefresh == null
        ? null
        : eventScene?.setDiagnosticMoveEndSearchRefresh?.(
            moveEndSearchRefresh,
          ) ?? false,
    moveEndSearchRefreshMode:
      moveEndSearchRefreshMode == null
        ? null
        : eventScene?.setDiagnosticMoveEndSearchRefreshMode?.(
            moveEndSearchRefreshMode,
          ) ?? false,
  });
  documentRef.body.dataset.performanceVariant = variant.id;
  documentRef.body.dataset.performanceVariantApplied = "false";
  return Object.freeze({ apply, destroy, variant });
}
