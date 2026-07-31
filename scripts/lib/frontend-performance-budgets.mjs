const ALLOWED_METRICS = new Set([
  "uiReadyWallMs",
  "network.totalBytes",
  "network.totalRequests",
  "network.groups.scripts.bytes",
  "network.groups.api.bytes",
  "network.groups.3d-tiles.bytes",
  "network.groups.tileset-json.bytes",
  "memory.usedJsHeapBytes",
  "memory.totalJsHeapBytes",
  "longTasks.count",
  "longTasks.totalDurationMs",
  "longTasks.p95DurationMs",
  "longTasks.worstDurationMs",
  "motion.averageFps",
  "motion.p95FrameMs",
  "motion.worstFrameMs",
  "motion.framesOver25Ms",
  "motion.framesOver50Ms",
]);

const fail = (message) => {
  throw new Error(`Invalid frontend performance contract: ${message}`);
};

const isRecord = (value) =>
  value != null && typeof value === "object" && !Array.isArray(value);

const finite = (value) => typeof value === "number" && Number.isFinite(value);

export function metricValue(source, path) {
  return path.split(".").reduce((value, key) => value?.[key], source);
}

export function validatePerformanceBudgetConfig(config) {
  if (!isRecord(config)) fail("configuration must be an object");
  if (config.schemaVersion !== "1.0") fail("budget schemaVersion must be 1.0");
  if (typeof config.label !== "string" || !config.label.trim())
    fail("budget label must be a non-empty string");
  if (!isRecord(config.profiles) || !Object.keys(config.profiles).length)
    fail("profiles must be a non-empty object");

  for (const [profile, definition] of Object.entries(config.profiles)) {
    if (!profile.trim()) fail("profile names must be non-empty");
    if (!isRecord(definition) || !isRecord(definition.metrics))
      fail(`${profile} must define metrics`);
    if (!Object.keys(definition.metrics).length)
      fail(`${profile} metrics must not be empty`);
    for (const [metric, budget] of Object.entries(definition.metrics)) {
      if (!ALLOWED_METRICS.has(metric))
        fail(`${profile}.${metric} is not an allowed metric`);
      if (!isRecord(budget)) fail(`${profile}.${metric} must be an object`);
      const directions = ["min", "max"].filter((key) =>
        Object.hasOwn(budget, key),
      );
      if (directions.length !== 1)
        fail(`${profile}.${metric} must define exactly one of min or max`);
      const threshold = budget[directions[0]];
      if (!finite(threshold) || threshold < 0)
        fail(
          `${profile}.${metric} threshold must be a non-negative finite number`,
        );
      if (!["warning", "error"].includes(budget.severity))
        fail(`${profile}.${metric} severity must be warning or error`);
      if (typeof budget.required !== "boolean")
        fail(`${profile}.${metric} required must be boolean`);
    }
  }
  return config;
}

export function evaluatePerformanceBudgets(
  summary,
  rawConfig,
  { mode = "report" } = {},
) {
  const config = validatePerformanceBudgetConfig(rawConfig);
  if (!["report", "enforce"].includes(mode))
    fail("budget mode must be report or enforce");
  if (!isRecord(summary)) fail("benchmark summary must be an object");

  const evaluations = [];
  for (const [profile, definition] of Object.entries(config.profiles)) {
    const profileSummary = summary[profile];
    for (const [metric, budget] of Object.entries(definition.metrics)) {
      const operator = Object.hasOwn(budget, "min") ? "min" : "max";
      const threshold = budget[operator];
      const measured = metricValue(profileSummary, metric);
      const supported = finite(measured);
      const exceeded =
        supported &&
        (operator === "min" ? measured < threshold : measured > threshold);
      evaluations.push({
        profile,
        metric,
        operator,
        threshold,
        actual: supported ? measured : null,
        delta: supported ? measured - threshold : null,
        severity: budget.severity,
        required: budget.required,
        status: supported ? (exceeded ? "exceeded" : "passed") : "unsupported",
      });
    }
  }

  const withinBudgets = evaluations.every(
    ({ required, status }) =>
      status === "passed" || (status === "unsupported" && !required),
  );
  return {
    mode,
    passed: mode === "report" || withinBudgets,
    withinBudgets,
    evaluations,
  };
}

export function formatPerformanceBudgetMarkdown(gate) {
  const rows = gate.evaluations
    .map(
      (item) =>
        `| ${item.profile} | \`${item.metric}\` | ${item.operator} | ${item.actual ?? "unsupported"} | ${item.threshold} | ${item.severity} | ${item.status} |`,
    )
    .join("\n");
  return `## Performance budget evaluations

- Mode: ${gate.mode}
- Within guardrails: ${gate.withinBudgets ? "yes" : "no"}
- Command gate passed: ${gate.passed ? "yes" : "no"}

| Profile | Metric | Direction | Measured | Guardrail | Severity | Status |
| --- | --- | --- | ---: | ---: | --- | --- |
${rows}
`;
}

export function validatePerformanceReport(report) {
  if (!isRecord(report)) fail("report must be an object");
  if (report.schemaVersion !== 2) fail("report schemaVersion must be 2");
  if (!Array.isArray(report.profiles) || !report.profiles.length)
    fail("report profiles must be a non-empty array");
  if (!isRecord(report.summary)) fail("report summary must be an object");
  if (!isRecord(report.budgetGate)) fail("report budgetGate must be an object");
  if (!["report", "enforce"].includes(report.budgetGate.mode))
    fail("report budgetGate mode is invalid");
  if (!Array.isArray(report.budgetGate.evaluations))
    fail("report budget evaluations must be an array");
  if (!report.budgetGate.evaluations.length)
    fail("report must contain at least one budget evaluation");
  for (const evaluation of report.budgetGate.evaluations) {
    if (!isRecord(evaluation)) fail("budget evaluation must be an object");
    for (const field of [
      "profile",
      "metric",
      "operator",
      "threshold",
      "severity",
      "required",
      "status",
    ])
      if (!Object.hasOwn(evaluation, field))
        fail(`budget evaluation is missing ${field}`);
    if (!["passed", "exceeded", "unsupported"].includes(evaluation.status))
      fail("budget evaluation status is invalid");
  }
  return report;
}
