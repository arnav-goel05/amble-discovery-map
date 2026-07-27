const finite = (value) => Number.isFinite(value);

export function median(values) {
  const sorted = values.filter(finite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function summarizeCpuProfile(profile, limit = 20) {
  const nodes = new Map(
    (profile?.nodes ?? []).map((node) => [node.id, node]),
  );
  const selfTime = new Map();
  for (let index = 0; index < (profile?.samples?.length ?? 0); index += 1) {
    const frame = nodes.get(profile.samples[index])?.callFrame ?? {};
    const key = [
      frame.functionName || "(anonymous)",
      frame.url || "",
      frame.lineNumber ?? -1,
    ].join("|");
    selfTime.set(
      key,
      (selfTime.get(key) ?? 0) + (profile.timeDeltas?.[index] ?? 0),
    );
  }
  return [...selfTime]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([key, microseconds]) => {
      const [functionName, url, lineNumber] = key.split("|");
      return {
        functionName,
        url,
        lineNumber: Number(lineNumber),
        selfTimeMs: Number((microseconds / 1000).toFixed(2)),
      };
    });
}

export function validateVariantConfig(config) {
  if (config?.schemaVersion !== 1)
    throw new Error("Diagnostic variant schemaVersion must be 1");
  if (!Array.isArray(config.variants) || config.variants.length < 2)
    throw new Error("At least two diagnostic variants are required");
  const ids = new Set();
  const workloadKeys = [
    "background3d",
    "highlighted3d",
    "overlays",
    "interface",
    "transit",
    "waterParks",
    "restaurantMap",
    "discoveryContext",
    "densityMinimap",
    "minimapViewportTracking",
    "moveEndSearchRefresh",
    "moveEndSearchRefreshMode",
    "primeEventSearch",
    "minimapRenderMode",
  ];
  for (const variant of config.variants) {
    if (!variant?.id || ids.has(variant.id))
      throw new Error(`Invalid or duplicate diagnostic variant: ${variant?.id}`);
    ids.add(variant.id);
    if (!variant.comparisonGroup || !variant.intendedDifference)
      throw new Error(`${variant.id} lacks comparison metadata`);
    for (const key of workloadKeys.slice(0, 4))
      if (typeof variant.workloads?.[key] !== "boolean")
        throw new Error(`${variant.id}.${key} must be boolean`);
    const unknown = Object.keys(variant.workloads).filter(
      (key) => !workloadKeys.includes(key),
    );
    if (unknown.length)
      throw new Error(`${variant.id} has unknown workloads: ${unknown.join()}`);
    if (
      variant.workloads.moveEndSearchRefreshMode != null &&
      !["full", "viewport"].includes(
        variant.workloads.moveEndSearchRefreshMode,
      )
    )
      throw new Error(
        `${variant.id}.moveEndSearchRefreshMode must be full or viewport`,
      );
    if (
      variant.workloads.primeEventSearch != null &&
      typeof variant.workloads.primeEventSearch !== "boolean"
    )
      throw new Error(`${variant.id}.primeEventSearch must be boolean`);
    if (
      variant.workloads.minimapRenderMode != null &&
      !["cached", "legacy"].includes(variant.workloads.minimapRenderMode)
    )
      throw new Error(
        `${variant.id}.minimapRenderMode must be cached or legacy`,
      );
  }
  for (const variant of config.variants)
    if (variant.controlId && !ids.has(variant.controlId))
      throw new Error(`${variant.id} references unknown control`);
  return config;
}

export function compatibleVariants(control, candidate) {
  if (!control || !candidate) return false;
  if (control.comparisonGroup !== candidate.comparisonGroup) return false;
  const keys = new Set([
    ...Object.keys(control.workloads),
    ...Object.keys(candidate.workloads),
  ]);
  const workloadValue = (workloads, key) =>
    key === "moveEndSearchRefreshMode"
      ? (workloads[key] ?? "viewport")
      : key === "minimapRenderMode"
        ? (workloads[key] ?? "cached")
      : key === "primeEventSearch"
        ? (workloads[key] ?? false)
      : (workloads[key] ?? true);
  const changed = [...keys].filter(
    (key) =>
      workloadValue(control.workloads, key) !==
      workloadValue(candidate.workloads, key),
  );
  return changed.length === 1;
}

export function validateTrial(trial) {
  const reasons = [...(trial.validity?.reasons ?? [])];
  if (trial.visibility !== "visible") reasons.push("background_execution");
  if (!trial.readiness?.complete) reasons.push("incomplete_readiness");
  if ((trial.network?.activeAtMotionStart ?? 0) > 0)
    reasons.push("network_active_at_motion_start");
  if ((trial.network?.failed ?? 0) > 0) reasons.push("failed_resources");
  if (!finite(trial.motion?.averageFps) || trial.motion.frameCount < 4)
    reasons.push("insufficient_motion_frames");
  return {
    ...trial,
    validity: {
      state: reasons.length ? "invalid" : "valid",
      reasons: [...new Set(reasons)],
    },
  };
}

const stats = (trials) => ({
  validTrials: trials.length,
  averageFps: median(trials.map((trial) => trial.motion.averageFps)),
  medianFrameMs: median(trials.map((trial) => trial.motion.medianFrameMs)),
  p95FrameMs: median(trials.map((trial) => trial.motion.p95FrameMs)),
  longTaskMs: median(trials.map((trial) => trial.motion.longTaskMs)),
});

export function compareVariants(config, trials) {
  const variants = new Map(config.variants.map((variant) => [variant.id, variant]));
  const valid = trials.filter(
    (trial) => trial.validity?.state === "valid",
  );
  const byVariant = (id) => valid.filter((trial) => trial.variantId === id);
  return config.variants
    .filter(
      (candidate) =>
        candidate.controlId && variants.has(candidate.controlId),
    )
    .map((candidate) => {
      const control = variants.get(candidate.controlId);
      const controlTrials = byVariant(control.id);
      const candidateTrials = byVariant(candidate.id);
      const controlStats = stats(controlTrials);
      const candidateStats = stats(candidateTrials);
      const compatible = compatibleVariants(control, candidate);
      const frameDeltaMs =
        controlStats.medianFrameMs == null ||
        candidateStats.medianFrameMs == null
          ? null
          : controlStats.medianFrameMs - candidateStats.medianFrameMs;
      const fpsDelta =
        controlStats.averageFps == null || candidateStats.averageFps == null
          ? null
          : candidateStats.averageFps - controlStats.averageFps;
      const pairedDirections = Array.from({
        length: Math.min(controlTrials.length, candidateTrials.length),
      }).map(
        (_, index) =>
          controlTrials[index].motion.medianFrameMs -
          candidateTrials[index].motion.medianFrameMs,
      );
      const directionMatches = pairedDirections.filter(
        (value) => Math.sign(value) === Math.sign(frameDeltaMs),
      ).length;
      const consistent =
        pairedDirections.length > 0 &&
        directionMatches / pairedDirections.length > 0.5;
      const material = frameDeltaMs != null && Math.abs(frameDeltaMs) >= 2;
      return {
        controlVariantId: control.id,
        candidateVariantId: candidate.id,
        intendedDifference: candidate.intendedDifference,
        compatible,
        control: controlStats,
        candidate: candidateStats,
        effect: { frameDeltaMs, fpsDelta },
        consistency: {
          matchingTrials: directionMatches,
          comparedTrials: pairedDirections.length,
        },
        classification:
          compatible &&
          controlTrials.length >= 3 &&
          candidateTrials.length >= 3 &&
          material &&
          consistent
            ? "confirmed"
            : material
              ? "contributing"
              : "inconclusive",
      };
    });
}

export function renderDiagnosticMarkdown(report) {
  const comparisons = report.comparisons
    .map(
      (item) =>
        `| ${item.intendedDifference} | ${item.control.averageFps ?? "n/a"} | ${item.candidate.averageFps ?? "n/a"} | ${item.effect.frameDeltaMs ?? "n/a"} | ${item.classification} |`,
    )
    .join("\n");
  return `# Map performance diagnostic

- Generated: ${report.generatedAt}
- Valid trials: ${report.trials.filter((trial) => trial.validity.state === "valid").length}/${report.trials.length}

| Isolated workload | Control FPS | Candidate FPS | Frame saving (ms) | Result |
| --- | ---: | ---: | ---: | --- |
${comparisons}
`;
}
