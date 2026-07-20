import { createLocationModel } from "./location-model.js";

const browserPosition = (position) => ({
  coordinates: [position.coords.longitude, position.coords.latitude],
  accuracyMeters: position.coords.accuracy,
  observedAt: Number.isFinite(position.timestamp)
    ? position.timestamp
    : Date.now(),
});

const permissionForError = (error) =>
  error?.code === 1 ? "denied" : "unavailable";

export function createLocationController({
  geolocation = globalThis.navigator?.geolocation,
  permissions = globalThis.navigator?.permissions,
  model = createLocationModel(),
  positionOptions = {
    enableHighAccuracy: true,
    timeout: 12_000,
    maximumAge: 30_000,
  },
} = {}) {
  let watchId = null;
  let permissionStatus = null;
  let permissionListener = null;
  let destroyed = false;

  const ensureAvailable = () => {
    if (destroyed) throw new Error("Location controller has been destroyed");
    if (!geolocation?.getCurrentPosition) {
      model.setPermission("unavailable");
      return false;
    }
    return true;
  };
  const success = (position) =>
    model.receivePosition(browserPosition(position));
  const failure = (error) => {
    const permission = permissionForError(error);
    model.setError(permission, { permission });
  };
  const observePermission = async () => {
    if (!permissions?.query || permissionStatus) return;
    try {
      permissionStatus = await permissions.query({ name: "geolocation" });
      if (destroyed) {
        permissionStatus = null;
        return;
      }
      if (
        permissionStatus.state !== "prompt" ||
        model.snapshot().permission !== "granted"
      ) {
        model.setPermission(permissionStatus.state);
      }
      permissionListener = () => model.setPermission(permissionStatus.state);
      permissionStatus.addEventListener?.("change", permissionListener);
    } catch {
      // Permission API support is optional; geolocation callbacks remain authoritative.
    }
  };

  return Object.freeze({
    model,
    snapshot(options) {
      return model.snapshot(options);
    },
    subscribe(subscriber, options) {
      return model.subscribe(subscriber, options);
    },
    requestLocation() {
      if (!ensureAvailable())
        return Promise.resolve(model.snapshot({ includeExact: true }));
      void observePermission();
      model.beginRequest();
      return new Promise((resolve) => {
        geolocation.getCurrentPosition(
          (position) => resolve(success(position)),
          (error) => {
            failure(error);
            resolve(model.snapshot({ includeExact: true }));
          },
          positionOptions,
        );
      });
    },
    startWatch() {
      if (!ensureAvailable() || !geolocation.watchPosition) return false;
      if (watchId !== null) return false;
      void observePermission();
      model.beginRequest();
      watchId = geolocation.watchPosition(success, failure, positionOptions);
      return true;
    },
    stopWatch({ clearExact = false } = {}) {
      if (watchId !== null) geolocation.clearWatch?.(watchId);
      const stopped = watchId !== null;
      watchId = null;
      if (clearExact) model.clearExact();
      return stopped;
    },
    clear() {
      if (watchId !== null) geolocation.clearWatch?.(watchId);
      watchId = null;
      model.clearExact();
    },
    destroy() {
      if (destroyed) return;
      if (watchId !== null) geolocation?.clearWatch?.(watchId);
      watchId = null;
      permissionStatus?.removeEventListener?.("change", permissionListener);
      permissionStatus = null;
      permissionListener = null;
      model.destroy();
      destroyed = true;
    },
  });
}
