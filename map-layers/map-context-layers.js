export function createMapContextLayerGroup(managers = []) {
  const active = managers.filter(Boolean);
  let finalized = false;

  return Object.freeze({
    managers: Object.freeze([...active]),
    finalize() {
      if (finalized) return;
      finalized = true;
      for (const manager of [...active].reverse()) manager?.finalize?.();
    },
  });
}
