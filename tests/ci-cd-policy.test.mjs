import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateCiCdPolicy } from "../scripts/verify-ci-policy.mjs";
import {
  assessReleaseCandidate,
  assessReleaseRefsUnchanged,
} from "../scripts/verify-release-candidate.mjs";

const workflow = async (name) =>
  readFile(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8");
const originals = {
  ci: await workflow("ci.yml"),
  release: await workflow("release-production.yml"),
  uptime: await workflow("production-uptime.yml"),
  incident: JSON.parse(
    await readFile(
      new URL("../data/incident-automation.json", import.meta.url),
      "utf8",
    ),
  ),
  packageJson: JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ),
  cloudflareBuildPhase: await readFile(
    new URL("../scripts/run-cloudflare-build-phase.mjs", import.meta.url),
    "utf8",
  ),
  releaseSkill: await readFile(
    new URL("../.agents/skills/release-production/SKILL.md", import.meta.url),
    "utf8",
  ),
  playwrightConfig: await readFile(
    new URL("../playwright.config.mjs", import.meta.url),
    "utf8",
  ),
  viteConfig: await readFile(
    new URL("../vite.config.cjs", import.meta.url),
    "utf8",
  ),
};
const clone = () => structuredClone(originals);
const main = "1".repeat(40);
const candidate = "2".repeat(40);

test("workflow policy enforces zero-external ordinary CI and bounded operations", () => {
  assert.deepEqual(validateCiCdPolicy(clone()), {
    ordinaryProductionRequests: 0,
    releaseHydrationPasses: 1,
    releasePublicObjectHeads: 0,
    uptimeAttempts: 1,
  });
});

test("ordinary CI rejects production hydration, remote inventory, and deployment", () => {
  for (const forbidden of [
    "npm run geometry:background:hydrate",
    "npm run cloudflare:r2:verify",
    "wrangler deploy",
  ]) {
    const inputs = clone();
    inputs.ci += `\n${forbidden}\n`;
    assert.throws(() => validateCiCdPolicy(inputs), /forbidden/);
  }
});

test("Cloudflare deployment cannot repeat release-only remote geometry verification", () => {
  const inputs = clone();
  inputs.packageJson.scripts["cloudflare:cloud:deploy"] =
    `npm run cloudflare:r2:verify -- --deployment && ${inputs.packageJson.scripts["cloudflare:cloud:deploy"]}`;
  assert.throws(
    () => validateCiCdPolicy(inputs),
    /clean-checkout deployment geometry policy/,
  );
});

test("Cloudflare application deployment cannot upload the integrity Worker", () => {
  const inputs = clone();
  inputs.packageJson.scripts["cloudflare:cloud:deploy"] =
    `npm run cloudflare:tile-integrity:deploy && ${inputs.packageJson.scripts["cloudflare:cloud:deploy"]}`;
  assert.throws(
    () => validateCiCdPolicy(inputs),
    /clean-checkout deployment geometry policy/,
  );
});

test("Cloudflare deploy phase cannot rebuild or repeat GitHub tests", () => {
  for (const command of [
    "npm run cloudflare:prepare",
    "npm run cloudflare:cloud:verify-build",
    "npm run cloudflare:cloud:contracts",
  ]) {
    const inputs = clone();
    inputs.packageJson.scripts["cloudflare:cloud:deploy"] =
      `${command} && ${inputs.packageJson.scripts["cloudflare:cloud:deploy"]}`;
    assert.throws(
      () => validateCiCdPolicy(inputs),
      /deployment phase isolation/,
    );
  }
});

test("Cloudflare build phase routes Workers Builds to compilation, not contracts", () => {
  const inputs = clone();
  inputs.cloudflareBuildPhase = inputs.cloudflareBuildPhase.replace(
    'args: ["run", "cloudflare:cloud:build"]',
    'args: ["run", "cloudflare:cloud:contracts"]',
  );
  assert.throws(
    () => validateCiCdPolicy(inputs),
    /Workers Builds compile-only phase/,
  );
});

test("Cloudflare build phase cannot repeat GitHub verification", () => {
  for (const command of [
    "npm run cloudflare:cloud:verify-build",
    "npm run cloudflare:cloud:contracts",
    "npm run cloudflare:r2:verify",
  ]) {
    const inputs = clone();
    inputs.packageJson.scripts["cloudflare:cloud:build"] += ` && ${command}`;
    assert.throws(
      () => validateCiCdPolicy(inputs),
      /connected build no-duplicate-check policy/,
    );
  }
});

test("Cloudflare clean-checkout build cannot regenerate production geometry", () => {
  for (const command of ["npm run build:poi-tileset", "optimized-tiles"]) {
    const inputs = clone();
    inputs.packageJson.scripts["cloudflare:prepare"] += ` && ${command}`;
    assert.throws(
      () => validateCiCdPolicy(inputs),
      /connected build clean-checkout geometry isolation/,
    );
  }
});

test("release skill uses main normally, develop only for bootstrap, and bounded deployment proof", () => {
  for (const needle of [
    "gh workflow run release-production.yml --ref main",
    "`headSha` identifies the `main` revision",
    "after 25 minutes",
    "TILES_BUCKET",
  ]) {
    const inputs = clone();
    inputs.releaseSkill = inputs.releaseSkill.replace(needle, "removed");
    assert.throws(() => validateCiCdPolicy(inputs));
  }
});

test("ordinary CI formats the complete main-to-candidate release range", () => {
  const perPushOnly = clone();
  perPushOnly.ci = perPushOnly.ci.replace(
    'CI_BASE_SHA="$(git rev-parse origin/main)" npm run format:check',
    "npm run format:check",
  );
  assert.throws(
    () => validateCiCdPolicy(perPushOnly),
    /ordinary CI formatting range/,
  );
});

test("staged event-pipeline browser verification uses the compact geometry fixture", () => {
  for (const required of [
    "geometry:fixture:prepare",
    "PLAYWRIGHT_GEOMETRY_FIXTURE=1",
  ]) {
    const inputs = clone();
    inputs.packageJson.scripts["test:event-pipeline-browser"] =
      inputs.packageJson.scripts["test:event-pipeline-browser"].replace(
        required,
        "removed",
      );
    assert.throws(() => validateCiCdPolicy(inputs), /event-pipeline.*fixture/i);
  }
});

test("browser CI cannot silently fall back from the materialized fixture", () => {
  const missingRoot = clone();
  missingRoot.playwrightConfig = missingRoot.playwrightConfig.replace(
    "CI_GEOMETRY_ROOT=outputs/ci-geometry",
    "",
  );
  assert.throws(
    () => validateCiCdPolicy(missingRoot),
    /browser fixture isolation/,
  );
  const fallback = clone();
  fallback.playwrightConfig = fallback.playwrightConfig.replace(
    "TILE_FALLBACK_ORIGIN=''",
    "TILE_FALLBACK_ORIGIN=https://amblefinds.com",
  );
  assert.throws(
    () => validateCiCdPolicy(fallback),
    /browser production fallback/,
  );
  const snapshotRoot = clone();
  snapshotRoot.viteConfig = snapshotRoot.viteConfig.replace(
    "approvedSnapshotApiPlugin({ root: configuredGeometryRoot })",
    "approvedSnapshotApiPlugin()",
  );
  assert.throws(
    () => validateCiCdPolicy(snapshotRoot),
    /snapshot fixture root/,
  );
});

test("release rejects automatic triggers, high-cardinality probes, and direct deploy", () => {
  for (const forbidden of [
    "\n  push:\n",
    "--object-heads",
    "wrangler deploy",
  ]) {
    const inputs = clone();
    inputs.release += forbidden;
    assert.throws(() => validateCiCdPolicy(inputs));
  }
});

test("Cloudflare deployment performs one post-deployment smoke attempt", () => {
  const duplicate = clone();
  duplicate.packageJson.scripts["cloudflare:cloud:deploy"] +=
    " && npm run test:render-smoke:production";
  assert.throws(
    () => validateCiCdPolicy(duplicate),
    /single post-deployment check/,
  );
  const retry = clone();
  retry.packageJson.scripts["cloudflare:cloud:smoke"] =
    retry.packageJson.scripts["cloudflare:cloud:smoke"].replace(
      "PRODUCTION_SMOKE_ATTEMPTS=1",
      "PRODUCTION_SMOKE_ATTEMPTS=3",
    );
  assert.throws(
    () => validateCiCdPolicy(retry),
    /post-deployment request budget/,
  );
});

test("uptime remains daily, single-attempt, deduplicated, and non-mutating", () => {
  for (const mutation of [
    ['cron: "0 1 * * *"', 'cron: "*/5 * * * *"'],
    ["PRODUCTION_SMOKE_ATTEMPTS: 1", "PRODUCTION_SMOKE_ATTEMPTS: 2"],
    [
      "Fail unhealthy monitor",
      "wrangler deploy\n      - name: Fail unhealthy monitor",
    ],
  ]) {
    const inputs = clone();
    inputs.uptime = inputs.uptime.replace(...mutation);
    assert.throws(() => validateCiCdPolicy(inputs));
  }
});

test("incident automation is daily, single-pass, develop-only, and cannot release", () => {
  const attempts = clone();
  attempts.incident.productionDiagnosticAttempts = 2;
  assert.throws(() => validateCiCdPolicy(attempts), /exactly one diagnostic/);
  const release = clone();
  release.incident.prohibited = release.incident.prohibited.filter(
    (operation) => operation !== "main-update",
  );
  assert.throws(
    () => validateCiCdPolicy(release),
    /missing prohibition main-update/,
  );
});

test("release candidate must be the exact full develop head and fast-forward main", () => {
  assert.deepEqual(
    assessReleaseCandidate({
      candidateSha: candidate,
      developSha: candidate,
      mainSha: main,
      mainIsAncestor: true,
    }),
    {
      schemaVersion: 1,
      candidateSha: candidate,
      developSha: candidate,
      mainSha: main,
    },
  );
  assert.throws(
    () =>
      assessReleaseCandidate({
        candidateSha: "short",
        developSha: "short",
        mainSha: main,
        mainIsAncestor: true,
      }),
    /full 40-character/,
  );
  assert.throws(
    () =>
      assessReleaseCandidate({
        candidateSha: candidate,
        developSha: "3".repeat(40),
        mainSha: main,
        mainIsAncestor: true,
      }),
    /not the current origin\/develop head/,
  );
  assert.throws(
    () =>
      assessReleaseCandidate({
        candidateSha: candidate,
        developSha: candidate,
        mainSha: main,
        mainIsAncestor: false,
      }),
    /cannot fast-forward/,
  );
});

test("release revalidation rejects either remote ref changing during tests", () => {
  const state = {
    candidateSha: candidate,
    developSha: candidate,
    mainSha: main,
  };
  assert.deepEqual(
    assessReleaseRefsUnchanged({
      state,
      candidateSha: candidate,
      developSha: candidate,
      mainSha: main,
      mainIsAncestor: true,
    }),
    {
      schemaVersion: 1,
      candidateSha: candidate,
      developSha: candidate,
      mainSha: main,
    },
  );
  assert.throws(
    () =>
      assessReleaseRefsUnchanged({
        state,
        candidateSha: candidate,
        developSha: candidate,
        mainSha: "4".repeat(40),
        mainIsAncestor: true,
      }),
    /origin\/main changed/,
  );
});
