import fs from "node:fs";
import path from "node:path";

import { sha256 } from "./background-lite-run.mjs";

export const REQUIRED_BROWSER_PROJECTS = Object.freeze([
  "chromium-desktop",
  "chromium-mobile",
  "webkit-desktop",
  "webkit-mobile",
  "firefox-desktop",
  "firefox-mobile",
]);

const normalizeFile = (filename) =>
  String(filename ?? "")
    .replaceAll(path.sep, "/")
    .replace(/^\.\//u, "");

function collectSpecs(suites, inheritedFile = null, collected = []) {
  for (const suite of suites ?? []) {
    const suiteFile = normalizeFile(suite.file ?? inheritedFile);
    for (const spec of suite.specs ?? [])
      collected.push({ ...spec, file: normalizeFile(spec.file ?? suiteFile) });
    collectSpecs(suite.suites, suiteFile, collected);
  }
  return collected;
}

function finalResult(test) {
  const results = Array.isArray(test.results) ? test.results : [];
  return results.at(-1) ?? null;
}

function testIdentity(spec) {
  return [
    spec.file,
    Number(spec.line ?? 0),
    Number(spec.column ?? 0),
    String(spec.title ?? ""),
  ].join(":");
}

export function assessPlaywrightBrowserEvidence(
  playwrightReport,
  {
    reportPath = null,
    reportSha256 = null,
    testFile = "tests/background-lite-local.spec.mjs",
  } = {},
) {
  const normalizedTarget = normalizeFile(testFile);
  const targetBasename = path.posix.basename(normalizedTarget);
  const configuredProjects = new Map(
    (playwrightReport?.config?.projects ?? []).map((project) => [
      project.name,
      project.id,
    ]),
  );
  const projectIdToName = new Map(
    [...configuredProjects].map(([name, id]) => [id, name]),
  );
  const targetSpecs = collectSpecs(playwrightReport?.suites).filter(
    ({ file }) =>
      file === normalizedTarget ||
      file.endsWith(`/${normalizedTarget}`) ||
      file === targetBasename ||
      file.endsWith(`/${targetBasename}`),
  );
  const testsByProject = new Map(
    REQUIRED_BROWSER_PROJECTS.map((name) => [name, []]),
  );

  for (const spec of targetSpecs) {
    for (const test of spec.tests ?? []) {
      const projectName =
        test.projectName ?? projectIdToName.get(test.projectId) ?? null;
      if (!testsByProject.has(projectName)) continue;
      const result = finalResult(test);
      testsByProject.get(projectName).push({
        testId: testIdentity(spec),
        title: String(spec.title ?? ""),
        expectedStatus: test.expectedStatus ?? null,
        finalStatus: result?.status ?? "missing",
        attempts: test.results?.length ?? 0,
        durationMs: (test.results ?? []).reduce(
          (sum, entry) => sum + Number(entry.duration ?? 0),
          0,
        ),
        errors: (test.results ?? []).flatMap((entry) =>
          entry.error ? [entry.error.message ?? String(entry.error)] : [],
        ),
      });
    }
  }

  const referenceTestIds = [
    ...new Set(
      (testsByProject.get(REQUIRED_BROWSER_PROJECTS[0]) ?? []).map(
        ({ testId }) => testId,
      ),
    ),
  ].sort();
  const projectOutcomes = REQUIRED_BROWSER_PROJECTS.map((projectName) => {
    const tests = testsByProject
      .get(projectName)
      .sort((left, right) => left.testId.localeCompare(right.testId));
    const testIds = [...new Set(tests.map(({ testId }) => testId))].sort();
    const configured = configuredProjects.has(projectName);
    const sameCoverage =
      referenceTestIds.length > 0 &&
      JSON.stringify(testIds) === JSON.stringify(referenceTestIds);
    const passed =
      configured &&
      sameCoverage &&
      tests.every(
        (entry) =>
          entry.expectedStatus === "passed" && entry.finalStatus === "passed",
      );
    return {
      projectName,
      configured,
      status: passed ? "passed" : "failed",
      testCount: tests.length,
      passedCount: tests.filter(
        ({ expectedStatus, finalStatus }) =>
          expectedStatus === "passed" && finalStatus === "passed",
      ).length,
      failedTestIds: tests
        .filter(
          ({ expectedStatus, finalStatus }) =>
            expectedStatus !== "passed" || finalStatus !== "passed",
        )
        .map(({ testId }) => testId),
      sameCoverage,
      tests,
    };
  });
  const reportErrors = (playwrightReport?.errors ?? []).map(
    (error) => error.message ?? String(error),
  );
  const missingProjects = projectOutcomes
    .filter(({ configured }) => !configured)
    .map(({ projectName }) => projectName);
  const failedProjects = projectOutcomes
    .filter(({ status }) => status !== "passed")
    .map(({ projectName }) => projectName);
  const complete =
    targetSpecs.length > 0 &&
    referenceTestIds.length > 0 &&
    missingProjects.length === 0 &&
    failedProjects.length === 0 &&
    reportErrors.length === 0 &&
    Number(playwrightReport?.stats?.unexpected ?? 0) === 0;

  return {
    schemaVersion: "local-background-browser-evidence-v1",
    sourceFormat: "playwright-json-v1",
    reportPath,
    reportSha256,
    testFile: normalizedTarget,
    requiredProjects: [...REQUIRED_BROWSER_PROJECTS],
    configuredProjects: [...configuredProjects.keys()].sort(),
    testCaseCount: referenceTestIds.length,
    totalProjectTestCount: projectOutcomes.reduce(
      (sum, outcome) => sum + outcome.testCount,
      0,
    ),
    projectOutcomes,
    stats: playwrightReport?.stats ?? null,
    reportErrors,
    missingProjects,
    failedProjects,
    complete,
  };
}

export function readPlaywrightBrowserEvidence(filename, options = {}) {
  if (!fs.existsSync(filename)) return null;
  const bytes = fs.readFileSync(filename);
  try {
    return assessPlaywrightBrowserEvidence(JSON.parse(bytes), {
      ...options,
      reportPath: filename,
      reportSha256: `sha256:${sha256(bytes)}`,
    });
  } catch (error) {
    return {
      schemaVersion: "local-background-browser-evidence-v1",
      sourceFormat: "playwright-json-v1",
      reportPath: filename,
      reportSha256: `sha256:${sha256(bytes)}`,
      requiredProjects: [...REQUIRED_BROWSER_PROJECTS],
      projectOutcomes: [],
      reportErrors: [`invalid-playwright-json: ${error.message}`],
      missingProjects: [...REQUIRED_BROWSER_PROJECTS],
      failedProjects: [...REQUIRED_BROWSER_PROJECTS],
      complete: false,
    };
  }
}
