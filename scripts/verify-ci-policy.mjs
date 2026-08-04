#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function requireText(text, needle, context) {
  if (!text.includes(needle)) throw new Error(`${context}: missing ${needle}`);
}

function forbidText(text, needle, context) {
  if (text.includes(needle)) throw new Error(`${context}: forbidden ${needle}`);
}

function occurrenceCount(text, needle) {
  return text.split(needle).length - 1;
}

export function validateCiCdPolicy({
  ci,
  release,
  uptime,
  incident,
  packageJson,
  playwrightConfig,
  viteConfig,
}) {
  requireText(ci, "branches-ignore: [main]", "ordinary CI trigger");
  forbidText(ci, "pull_request:", "ordinary CI trigger");
  requireText(ci, "CI_EXTERNAL_SERVICES: forbidden", "ordinary CI environment");
  requireText(ci, 'TILE_FALLBACK_ORIGIN: ""', "ordinary CI environment");
  requireText(ci, "cancel-in-progress: true", "ordinary CI concurrency");
  for (const command of [
    "geometry:background:hydrate",
    "geometry:background:audit",
    "geometry:background:sync",
    "geometry:poi:audit",
    "geometry:poi:sync",
    "cloudflare:r2:verify",
    "cloudflare:cloud:deploy",
    "wrangler deploy",
    "--object-heads",
  ])
    forbidText(ci, command, "ordinary CI zero-external policy");
  for (const command of [
    "geometry:fixture:verify",
    "test:unit",
    "test:event-sources",
    "verify:voice-actions",
    "verify:voice-capabilities",
    "cloudflare:cloud:test",
    "build:ci",
    "test:ui:ci",
    "test:ui:mobile",
    "test:ui:voice-ci",
  ])
    requireText(ci, command, "ordinary CI coverage");

  requireText(release, "workflow_dispatch:", "release trigger");
  forbidText(release, "\n  push:", "release trigger");
  forbidText(release, "pull_request:", "release trigger");
  requireText(release, "candidate_sha:", "release input");
  requireText(
    release,
    "CI_BASE_SHA=$(git rev-parse origin/main)",
    "release formatting range",
  );
  forbidText(
    release,
    "CI_BASE_SHA: ${{ inputs.candidate_sha }}",
    "release formatting range",
  );
  if (occurrenceCount(release, "geometry:background:hydrate") !== 1)
    throw new Error(
      "release budget: production geometry hydration must appear exactly once",
    );
  for (const command of [
    "verify-release-candidate.mjs prepare",
    "test:unit",
    "test:event-sources",
    "test:poi-separation",
    "cloudflare:r2:verify -- --local-only",
    "cloudflare:r2:verify",
    "cloudflare:prepare",
    "test:ui:release",
    "benchmark:release",
    "verify-release-candidate.mjs revalidate",
    'git push origin "$RELEASE_CANDIDATE_SHA:refs/heads/main"',
  ])
    requireText(release, command, "release gate");
  forbidText(release, "--object-heads", "release request budget");
  forbidText(release, "cloudflare:cloud:deploy", "deployment exclusivity");
  forbidText(release, "wrangler deploy", "deployment exclusivity");
  forbidText(release, "--force", "release branch safety");

  if (packageJson) {
    const deploy = packageJson.scripts?.["cloudflare:cloud:deploy"] ?? "";
    const smoke = packageJson.scripts?.["cloudflare:cloud:smoke"] ?? "";
    requireText(
      deploy,
      "npm run cloudflare:cloud:smoke",
      "production deploy post-check",
    );
    forbidText(
      deploy,
      "test:render-smoke:production",
      "single post-deployment check",
    );
    requireText(
      smoke,
      "PRODUCTION_SMOKE_ATTEMPTS=1",
      "post-deployment request budget",
    );
    requireText(
      smoke,
      "PRODUCTION_SMOKE_REQUIRED_SUCCESSES=1",
      "post-deployment success budget",
    );
    for (const scriptName of [
      "test:ui:ci",
      "test:ui:mobile",
      "test:ui:voice-ci",
    ])
      requireText(
        packageJson.scripts?.[scriptName] ?? "",
        "geometry:fixture:prepare",
        `${scriptName} fixture materialization`,
      );
  }

  if (playwrightConfig) {
    requireText(
      playwrightConfig,
      "CI_GEOMETRY_ROOT=outputs/ci-geometry",
      "browser fixture isolation",
    );
    requireText(
      playwrightConfig,
      "VITE_AMBLE_E2E_OFFLINE_MAP=1",
      "browser network isolation",
    );
    requireText(
      playwrightConfig,
      "TILE_FALLBACK_ORIGIN=''",
      "browser production fallback",
    );
    for (const productionHost of ["amblefinds.com", "workers.dev"])
      forbidText(
        playwrightConfig,
        productionHost,
        "browser production fallback",
      );
  }
  if (viteConfig) {
    requireText(
      viteConfig,
      "process.env.CI_GEOMETRY_ROOT",
      "Vite fixture root",
    );
    requireText(
      viteConfig,
      "approvedSnapshotApiPlugin({ root: configuredGeometryRoot })",
      "Vite snapshot fixture root",
    );
  }

  requireText(uptime, 'cron: "0 1 * * *"', "uptime schedule");
  requireText(uptime, "PRODUCTION_SMOKE_ATTEMPTS: 1", "uptime request budget");
  requireText(
    uptime,
    "PRODUCTION_SMOKE_REQUIRED_SUCCESSES: 1",
    "uptime success budget",
  );
  requireText(
    uptime,
    "[uptime] amblefinds.com is unhealthy",
    "uptime issue identity",
  );
  requireText(
    uptime,
    "No immediate retry, rollback, or redeployment",
    "uptime failure behavior",
  );
  for (const command of [
    "cloudflare:cloud:deploy",
    "wrangler deploy",
    "git push",
  ])
    forbidText(uptime, command, "uptime mutation policy");

  if (incident) {
    if (
      incident.timezone !== "Asia/Singapore" ||
      incident.schedule !== "daily-09:15"
    )
      throw new Error(
        "incident automation: expected daily 09:15 Asia/Singapore schedule",
      );
    if (incident.issueTitle !== "[uptime] amblefinds.com is unhealthy")
      throw new Error("incident automation: outage issue identity drifted");
    if (incident.productionDiagnosticAttempts !== 1)
      throw new Error(
        "incident automation: exactly one diagnostic attempt is required",
      );
    if (incident.allowedCodeBranch !== "develop")
      throw new Error("incident automation: fixes must target develop");
    for (const operation of [
      "create-branch",
      "pull-request",
      "main-update",
      "release-dispatch",
      "deployment",
      "rollback",
      "live-paid-provider",
      "diagnostic-retry",
    ])
      if (!incident.prohibited?.includes(operation))
        throw new Error(
          `incident automation: missing prohibition ${operation}`,
        );
  }

  return {
    ordinaryProductionRequests: 0,
    releaseHydrationPasses: 1,
    releasePublicObjectHeads: 0,
    uptimeAttempts: 1,
  };
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isCli =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const read = (name) =>
    readFile(path.join(root, ".github/workflows", name), "utf8");
  const [
    ci,
    release,
    uptime,
    incidentText,
    packageText,
    playwrightConfig,
    viteConfig,
  ] = await Promise.all([
    read("ci.yml"),
    read("release-production.yml"),
    read("production-uptime.yml"),
    readFile(path.join(root, "data/incident-automation.json"), "utf8"),
    readFile(path.join(root, "package.json"), "utf8"),
    readFile(path.join(root, "playwright.config.mjs"), "utf8"),
    readFile(path.join(root, "vite.config.cjs"), "utf8"),
  ]);
  console.log(
    JSON.stringify(
      validateCiCdPolicy({
        ci,
        release,
        uptime,
        incident: JSON.parse(incidentText),
        packageJson: JSON.parse(packageText),
        playwrightConfig,
        viteConfig,
      }),
      null,
      2,
    ),
  );
}
