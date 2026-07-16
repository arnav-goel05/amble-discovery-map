export function createOverlayCoordinator() {
  const registrations = new Map();
  const handledMapClicks = new WeakSet();
  let activeId = null;

  const close = (id) => {
    for (const callback of [...(registrations.get(id) ?? [])]) callback();
  };

  return {
    register(id, callback) {
      if (!id || typeof callback !== "function") throw new TypeError("Overlay identity and close callback are required");
      const callbacks = registrations.get(id) ?? new Set();
      callbacks.add(callback);
      registrations.set(id, callbacks);
      let registered = true;
      return () => {
        if (!registered) return;
        registered = false;
        callbacks.delete(callback);
        if (!callbacks.size) registrations.delete(id);
        if (activeId === id && !registrations.has(id)) activeId = null;
      };
    },
    open(id) {
      if (!id || activeId === id) return false;
      const previous = activeId;
      activeId = id;
      if (previous) close(previous);
      return true;
    },
    dismiss() {
      if (!activeId) return false;
      const previous = activeId;
      activeId = null;
      close(previous);
      return true;
    },
    closed(id) {
      if (!id || activeId !== id) return false;
      activeId = null;
      return true;
    },
    keepOpenForMapClick(event) {
      const nativeEvent = event?.originalEvent || event;
      if (nativeEvent && typeof nativeEvent === "object") handledMapClicks.add(nativeEvent);
    },
    dismissFromMapClick(event) {
      const nativeEvent = event?.originalEvent || event;
      if (nativeEvent && typeof nativeEvent === "object" && handledMapClicks.delete(nativeEvent)) return false;
      this.dismiss();
      return true;
    },
    active: () => activeId,
  };
}

const defaultCoordinator = createOverlayCoordinator();
const OVERLAY_OPEN_EVENT = "whats-here:overlay-open";
const OVERLAY_CLOSE_EVENT = "whats-here:overlay-close";
const OVERLAY_DISMISS_EVENT = "whats-here:overlay-dismiss";
let legacyTarget = null;

function ensureEventBridge() {
  const target = globalThis.window;
  if (!target || legacyTarget === target) return target;
  target.addEventListener(OVERLAY_OPEN_EVENT, (event) => defaultCoordinator.open(event.detail?.id));
  target.addEventListener(OVERLAY_CLOSE_EVENT, (event) => defaultCoordinator.closed(event.detail?.id));
  target.addEventListener(OVERLAY_DISMISS_EVENT, () => defaultCoordinator.dismiss());
  legacyTarget = target;
  return target;
}

export function announceOverlayOpen(id) {
  const target = ensureEventBridge();
  if (target) { target.dispatchEvent(new CustomEvent(OVERLAY_OPEN_EVENT, { detail: { id } })); return true; }
  return defaultCoordinator.open(id);
}

export function announceOverlayClosed(id) {
  const target = ensureEventBridge();
  if (target) { target.dispatchEvent(new CustomEvent(OVERLAY_CLOSE_EVENT, { detail: { id } })); return true; }
  return defaultCoordinator.closed(id);
}

export function watchOverlayState(callback) {
  const target = ensureEventBridge();
  if (!target || typeof callback !== "function") return () => {};
  const onOpen = (event) => callback({ id: event.detail?.id, open: true });
  const onClose = (event) => callback({ id: event.detail?.id, open: false });
  target.addEventListener(OVERLAY_OPEN_EVENT, onOpen);
  target.addEventListener(OVERLAY_CLOSE_EVENT, onClose);
  return () => {
    target.removeEventListener(OVERLAY_OPEN_EVENT, onOpen);
    target.removeEventListener(OVERLAY_CLOSE_EVENT, onClose);
  };
}

export function dismissOpenOverlays() {
  const target = ensureEventBridge();
  if (target) { target.dispatchEvent(new Event(OVERLAY_DISMISS_EVENT)); return true; }
  return defaultCoordinator.dismiss();
}

export function keepOverlaysOpenForMapClick(event) {
  return defaultCoordinator.keepOpenForMapClick(event);
}

export function dismissOpenOverlaysFromMapClick(event) {
  return defaultCoordinator.dismissFromMapClick(event);
}

export function closeWhenAnotherOverlayOpens(id, close) {
  ensureEventBridge();
  return defaultCoordinator.register(id, close);
}
