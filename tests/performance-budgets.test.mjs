import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluatePerformanceBudgets,
  formatPerformanceBudgetMarkdown,
  validatePerformanceBudgetConfig,
  validatePerformanceReport,
} from "../scripts/lib/frontend-performance-budgets.mjs";

const config = {
  schemaVersion: "1.0",
  label: "test guardrails",
  profiles: {
    desktop: {
      metrics: {
        "network.totalBytes": {
          max: 100,
          severity: "error",
          required: true,
        },
        "motion.averageFps": {
          min: 30,
          severity: "warning",
          required: true,
        },
        "memory.usedJsHeapBytes": {
          max: 500,
          severity: "error",
          required: false,
        },
      },
    },
  },
};

test("budget validation rejects malformed directions and thresholds", () => {
  assert.throws(
    () =>
      validatePerformanceBudgetConfig({
        ...config,
        profiles: {
          desktop: {
            metrics: {
              "motion.averageFps": {
                min: 20,
                max: 60,
                severity: "error",
                required: true,
              },
            },
          },
        },
      }),
    /exactly one of min or max/,
  );
  assert.throws(
    () =>
      validatePerformanceBudgetConfig({
        ...config,
        profiles: {
          desktop: {
            metrics: {
              "motion.averageFps": {
                min: Number.NaN,
                severity: "error",
                required: true,
              },
            },
          },
        },
      }),
    /finite/,
  );
});

test("evaluations account for every declared metric and honor equality", () => {
  const result = evaluatePerformanceBudgets(
    {
      desktop: {
        network: { totalBytes: 100 },
        motion: { averageFps: 30 },
        memory: {},
      },
    },
    config,
    { mode: "enforce" },
  );
  assert.equal(result.evaluations.length, 3);
  assert.deepEqual(
    result.evaluations.map(({ metric, status }) => [metric, status]),
    [
      ["network.totalBytes", "passed"],
      ["motion.averageFps", "passed"],
      ["memory.usedJsHeapBytes", "unsupported"],
    ],
  );
  assert.equal(result.passed, true);
});

test("enforced required breaches and missing measurements fail explicitly", () => {
  const result = evaluatePerformanceBudgets(
    {
      desktop: {
        network: { totalBytes: 101 },
        motion: {},
        memory: { usedJsHeapBytes: 200 },
      },
    },
    config,
    { mode: "enforce" },
  );
  assert.equal(result.passed, false);
  assert.deepEqual(
    result.evaluations.slice(0, 2).map((item) => ({
      actual: item.actual,
      metric: item.metric,
      profile: item.profile,
      severity: item.severity,
      status: item.status,
      threshold: item.threshold,
    })),
    [
      {
        actual: 101,
        metric: "network.totalBytes",
        profile: "desktop",
        severity: "error",
        status: "exceeded",
        threshold: 100,
      },
      {
        actual: null,
        metric: "motion.averageFps",
        profile: "desktop",
        severity: "warning",
        status: "unsupported",
        threshold: 30,
      },
    ],
  );
});

test("report mode records breaches without failing the command contract", () => {
  const result = evaluatePerformanceBudgets(
    {
      desktop: {
        network: { totalBytes: 150 },
        motion: { averageFps: 20 },
        memory: { usedJsHeapBytes: 600 },
      },
    },
    config,
    { mode: "report" },
  );
  assert.equal(result.passed, true);
  assert.equal(result.withinBudgets, false);
  assert.equal(
    result.evaluations.every((item) => item.status === "exceeded"),
    true,
  );
  const markdown = formatPerformanceBudgetMarkdown(result);
  assert.match(markdown, /desktop/);
  assert.match(markdown, /network\.totalBytes/);
  assert.match(markdown, /150/);
  assert.match(markdown, /100/);
});

test("report validation requires version 2 and complete budget accounting", () => {
  const report = {
    schemaVersion: 2,
    profiles: [{ id: "desktop" }],
    summary: { desktop: {} },
    budgetGate: {
      mode: "report",
      passed: true,
      withinBudgets: true,
      evaluations: [
        {
          profile: "desktop",
          metric: "network.totalBytes",
          operator: "max",
          threshold: 100,
          actual: 90,
          delta: -10,
          severity: "error",
          required: true,
          status: "passed",
        },
      ],
    },
  };
  assert.equal(validatePerformanceReport(report), report);
  assert.throws(
    () =>
      validatePerformanceReport({
        ...report,
        budgetGate: { ...report.budgetGate, evaluations: [] },
      }),
    /evaluation/,
  );
});
