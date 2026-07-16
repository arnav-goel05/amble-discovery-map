function finite(value) { const number = Number(value); return Number.isFinite(number) ? number : null; }
function radians(value) { return value * Math.PI / 180; }

function distanceMeters(left, right) {
  const earth = 6_371_000;
  const dLat = radians(right.latitude - left.latitude);
  const dLng = radians(right.longitude - left.longitude);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(left.latitude)) * Math.cos(radians(right.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * earth * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pointInPolygon(longitude, latitude, polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const [x, y] = polygon[index];
    const [priorX, priorY] = polygon[previous];
    if (((y > latitude) !== (priorY > latitude)) && (longitude < (priorX - x) * (latitude - y) / ((priorY - y) || Number.EPSILON) + x)) inside = !inside;
  }
  return inside;
}

function verifyLocationEvidence({ mission, location, messageDate, now = new Date(), priorReadings = [] }) {
  const latitude = finite(location?.latitude);
  const longitude = finite(location?.longitude);
  const accuracy = finite(location?.horizontal_accuracy ?? location?.accuracy);
  if (latitude === null || longitude === null) return { status: "rejected", reason: "invalid_coordinates" };
  const verification = mission.verification || {};
  const maxAgeSeconds = finite(verification.maxAgeSeconds) || 300;
  if (Number.isFinite(messageDate)) {
    const ageSeconds = now.getTime() / 1000 - messageDate;
    if (ageSeconds > maxAgeSeconds) return { status: "rejected", reason: "stale_location", ageSeconds: Math.round(ageSeconds), maxAgeSeconds };
    if (ageSeconds < -60) return { status: "rejected", reason: "future_location" };
  }
  const maxAccuracyMeters = finite(verification.maxAccuracyMeters) || 200;
  if (accuracy !== null && accuracy > maxAccuracyMeters) return { status: "rejected", reason: "low_accuracy", accuracyMeters: accuracy, maxAccuracyMeters };
  const baseRadius = finite(verification.radiusMeters ?? mission.radiusMeters) || 300;
  const effectiveRadius = accuracy === null ? baseRadius : Math.min(baseRadius + 100, Math.max(baseRadius, accuracy * 1.5));
  const distance = distanceMeters({ latitude, longitude }, mission);
  const buildingMatch = pointInPolygon(longitude, latitude, verification.buildingPolygon);
  if (!buildingMatch && distance > effectiveRadius) return { status: "rejected", reason: "too_far", distanceMeters: Math.round(distance), effectiveRadiusMeters: Math.round(effectiveRadius), accuracyMeters: accuracy };
  const reading = { missionId: mission.id, latitude, longitude, accuracyMeters: accuracy, at: now.toISOString() };
  if (verification.requireConsistentReadings) {
    const consistent = priorReadings.find((prior) => prior.missionId === mission.id
      && now.getTime() - Date.parse(prior.at) <= 120_000
      && distanceMeters(prior, reading) <= Math.max(50, (prior.accuracyMeters || 0) + (accuracy || 0)));
    if (!consistent) return { status: "pending", reason: "second_reading_required", reading, distanceMeters: Math.round(distance), effectiveRadiusMeters: Math.round(effectiveRadius) };
  }
  return {
    status: "accepted",
    reason: buildingMatch ? "building_footprint" : accuracy === null ? "coordinate_fallback" : "adaptive_radius",
    reading,
    distanceMeters: Math.round(distance),
    effectiveRadiusMeters: Math.round(effectiveRadius),
    accuracyMeters: accuracy,
  };
}

class MetadataPhotoVerifier {
  constructor({ requireUniqueId = true } = {}) { this.name = "telegram-metadata-v1"; this.requireUniqueId = requireUniqueId; }
  verify({ message, precomputed }) {
    const photo = Array.isArray(message?.photo) ? message.photo.at(-1) : null;
    const fileUniqueId = photo?.file_unique_id || (!this.requireUniqueId ? photo?.file_id : null);
    if (!photo) return { status: "rejected", reason: "missing_photo", verifier: this.name };
    if (!fileUniqueId) return { status: "needs_review", reason: "missing_unique_identity", verifier: this.name, fileUniqueId: photo.file_id || null };
    if (precomputed && ["accepted", "rejected", "needs_review"].includes(precomputed.status)) {
      return { ...precomputed, verifier: precomputed.verifier || "configured-vision-provider", fileUniqueId };
    }
    return { status: "accepted", reason: "metadata_only_fallback", verifier: this.name, fileUniqueId };
  }
}

module.exports = { MetadataPhotoVerifier, distanceMeters, pointInPolygon, verifyLocationEvidence };
