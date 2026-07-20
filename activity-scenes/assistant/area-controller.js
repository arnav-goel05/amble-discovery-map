export function createAreaController({
  getCandidates,
  layerManager = null,
  onChange = null,
} = {}) {
  let areas = [];
  let selectedAreaId = null;
  let revision = 0;
  const emit = () =>
    onChange?.({ revision, selectedAreaId, areas: structuredClone(areas) });

  return Object.freeze({
    reconcile(nextAreas = []) {
      const previousIds = new Set(areas.map(({ areaId }) => areaId));
      const nextIds = new Set(nextAreas.map(({ areaId }) => areaId));
      const removedAreaIds = [...previousIds]
        .filter((id) => !nextIds.has(id))
        .sort();
      const selectionCleared =
        selectedAreaId !== null && !nextIds.has(selectedAreaId);
      if (selectionCleared) selectedAreaId = null;
      areas = nextAreas.map((area) => structuredClone(area));
      revision += 1;
      layerManager?.reconcile?.({ areas });
      emit();
      return { removedAreaIds, selectionCleared, revision };
    },
    openArea(areaId) {
      const area = areas.find((candidate) => candidate.areaId === areaId);
      if (!area) return null;
      selectedAreaId = areaId;
      revision += 1;
      layerManager?.setSelectedArea?.(areaId);
      layerManager?.focusArea?.(areaId);
      const candidates = (getCandidates?.() || []).filter(
        (candidate) => candidate.areaId === areaId,
      );
      emit();
      return {
        area: structuredClone(area),
        candidates: structuredClone(candidates),
        revision,
      };
    },
    compareAreas(areaIds = []) {
      return areaIds
        .map((areaId) => areas.find((area) => area.areaId === areaId))
        .filter(Boolean)
        .map((area) => structuredClone(area));
    },
    dismissArea(areaId) {
      const exists = areas.some((area) => area.areaId === areaId);
      if (!exists) return false;
      areas = areas.filter((area) => area.areaId !== areaId);
      if (selectedAreaId === areaId) selectedAreaId = null;
      revision += 1;
      layerManager?.reconcile?.({ areas });
      layerManager?.setSelectedArea?.(selectedAreaId);
      emit();
      return true;
    },
    handleAction(actionId, argumentsValue) {
      if (actionId === "map.openarea" || actionId === "map.selectarea")
        return this.openArea(argumentsValue?.areaId);
      if (actionId === "map.compareareas")
        return this.compareAreas(argumentsValue?.areaIds);
      if (actionId === "map.dismissarea")
        return this.dismissArea(argumentsValue?.areaId);
      return null;
    },
    snapshot() {
      return { revision, selectedAreaId, areas: structuredClone(areas) };
    },
  });
}
