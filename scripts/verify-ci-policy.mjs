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
  cloudflareBuildPhase,
  releaseSkill,
  playwrightConfig,
  viteConfig,
}) {
  requireText(ci, "branches-ignore: [main]", "ordinary CI trigger");
  forbidText(ci, "pull_request:", "ordinary CI trigger");
  requireText(ci, "CI_EXTERNAL_SERVICES: forbidden", "ordinary CI environment");
  requireText(ci, 'TILE_FALLBACK_ORIGIN: ""', "ordinary CI environment");
  requireText(ci, "cancel-in-progress: true", "ordinary CI concurrency");
  requireText(
    ci,
    'CI_BASE_SHA="$(git rev-parse origin/main)" npm run format:check',
    "ordinary CI formatting range",
  );
  requireText(
    ci,
    "CI_HEAD_SHA: ${{ github.sha }}",
    "ordinary CI formatting range",
  );
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
    "cloudflare:cloud:contracts",
    "build:ci",
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
  requireText(
    release,
    "Hydration retry GET budget: 32",
    "release hydration retry budget",
  );
  for (const command of [
    "verify-release-candidate.mjs prepare",
    "test:unit",
    "test:event-sources",
    "test:poi-separation",
    "cloudflare:r2:verify -- --local-only",
    "cloudflare:r2:verify -- --pre-deploy",
    "cloudflare:prepare",
    "cloudflare:cloud:contracts",
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
    const build = packageJson.scripts?.["cloudflare:cloud:build"] ?? "";
    const prepare = packageJson.scripts?.["cloudflare:prepare"] ?? "";
    const connectedBuild = packageJson.scripts?.["cloudflare:cloud:test"] ?? "";
    const smoke = packageJson.scripts?.["cloudflare:cloud:smoke"] ?? "";
    const releaseUi = packageJson.scripts?.["test:ui:release"] ?? "";
    const eventPipelineBrowser =
      packageJson.scripts?.["test:event-pipeline-browser"] ?? "";
    const releaseBenchmark = packageJson.scripts?.["benchmark:release"] ?? "";
    requireText(
      releaseBenchmark,
      "geometry:fixture:prepare",
      "release performance fixture materialization",
    );
    requireText(
      releaseBenchmark,
      "PLAYWRIGHT_GEOMETRY_FIXTURE=1",
      "release performance fixture isolation",
    );
    requireText(
      eventPipelineBrowser,
      "geometry:fixture:prepare",
      "staged event-pipeline fixture materialization",
    );
    requireText(
      eventPipelineBrowser,
      "PLAYWRIGHT_GEOMETRY_FIXTURE=1",
      "staged event-pipeline browser fixture isolation",
    );
    requireText(
      deploy,
      "npm run cloudflare:cloud:smoke",
      "production deploy post-check",
    );
    requireText(
      deploy,
      "wrangler deploy --config wrangler.cloud.jsonc",
      "single application upload",
    );
    if (occurrenceCount(deploy, "wrangler deploy") !== 1)
      throw new Error(
        "single application upload: expected one Wrangler deploy",
      );
    for (const command of [
      "cloudflare:prepare",
      "cloudflare:cloud:verify-build",
      "cloudflare:cloud:contracts",
      "cloudflare:cloud:test",
    ])
      forbidText(deploy, command, "deployment phase isolation");
    requireText(build, "cloudflare:prepare", "connected build compilation");
    for (const command of ["build:poi-tileset", "optimized-tiles"])
      forbidText(
        prepare,
        command,
        "connected build clean-checkout geometry isolation",
      );
    for (const command of [
      "cloudflare:cloud:verify-build",
      "cloudflare:cloud:contracts",
      "cloudflare:r2:verify",
    ])
      forbidText(build, command, "connected build no-duplicate-check policy");
    requireText(
      connectedBuild,
      "run-cloudflare-build-phase.mjs",
      "Workers Builds compatibility command",
    );
    for (const command of [
      "cloudflare:r2:verify",
      "cloudflare:tile-integrity:deploy",
      "geometry:background:hydrate",
      "geometry:background:sync",
      "geometry:poi:sync",
    ])
      forbidText(deploy, command, "clean-checkout deployment geometry policy");
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
      "test:ui:release:chromium",
      "test:ui:release:devices",
      "test:ui:release:compact",
    ])
      requireText(releaseUi, `npm run ${scriptName}`, "release UI isolation");
    requireText(
      packageJson.scripts?.["test:ui:release:chromium"] ?? "",
      "--project chromium-desktop",
      "release Chromium coverage",
    );
    requireText(
      packageJson.scripts?.["test:ui:release:chromium"] ?? "",
      "PLAYWRIGHT_SKIP_DEVICE_SUPPORT=1",
      "release device-process isolation",
    );
    for (const project of [
      "chromium-desktop",
      "chromium-mobile",
      "webkit-desktop",
      "webkit-mobile",
      "firefox-desktop",
      "firefox-mobile",
    ])
      requireText(
        packageJson.scripts?.["test:ui:release:devices"] ?? "",
        `--project ${project}`,
        "release device coverage",
      );
    for (const [scriptName, project] of [
      ["test:ui:release:compact:chromium", "chromium-compact"],
      ["test:ui:release:compact:webkit", "webkit-compact"],
      ["test:ui:release:compact:firefox", "firefox-compact"],
    ]) {
      requireText(
        packageJson.scripts?.["test:ui:release:compact"] ?? "",
        `npm run ${scriptName}`,
        "release compact-process isolation",
      );
      requireText(
        packageJson.scripts?.[scriptName] ?? "",
        `--project ${project}`,
        "release compact coverage",
      );
      requireText(
        packageJson.scripts?.[scriptName] ?? "",
        "--grep",
        "bounded representative compact coverage",
      );
      requireText(
        packageJson.scripts?.[scriptName] ?? "",
        "PLAYWRIGHT_GEOMETRY_FIXTURE=1",
        "release compact fixture isolation",
      );
    }
    requireText(
      packageJson.scripts?.["test:ui:release:compact"] ?? "",
      "geometry:fixture:prepare",
      "release compact fixture materialization",
    );
    for (const scriptName of [
      "test:ui:release:compact:chromium",
      "test:ui:release:compact:webkit",
    ]) {
      for (const journey of [
        "anonymous startup renders",
        "intro waits for initial 3D content",
        "users build, reorder, and route",
        "vague voice discovery presents",
      ])
        requireText(
          packageJson.scripts?.[scriptName] ?? "",
          journey,
          "representative event, intro, plan, and voice coverage",
        );
    }
    for (const journey of [
      "intro waits for initial 3D content",
      "users build, reorder, and route",
    ])
      requireText(
        packageJson.scripts?.["test:ui:release:compact:firefox"] ?? "",
        journey,
        "Firefox-supported representative coverage",
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

  if (cloudflareBuildPhase) {
    requireText(
      cloudflareBuildPhase,
      'workersCi === "1"',
      "Workers Builds routing",
    );
    requireText(
      cloudflareBuildPhase,
      'args: ["run", "cloudflare:cloud:build"]',
      "Workers Builds compile-only phase",
    );
    requireText(
      cloudflareBuildPhase,
      'args: ["run", "cloudflare:cloud:contracts"]',
      "local Cloudflare contract phase",
    );
  }

  if (releaseSkill) {
    requireText(
      releaseSkill,
      "gh workflow run release-production.yml --ref main",
      "standard release skill dispatch",
    );
    requireText(
      releaseSkill,
      "gh workflow run release-production.yml --ref develop",
      "bootstrap release skill dispatch",
    );
    requireText(
      releaseSkill,
      "`headSha` identifies the `main` revision",
      "release run lookup identity",
    );
    requireText(releaseSkill, "after 25 minutes", "Cloudflare timeout bound");
    for (const binding of ["ASSETS", "RUNTIME_DB", "TILES_BUCKET"])
      requireText(releaseSkill, binding, "deployed application bindings");
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
    cloudflareBuildPhase,
    releaseSkill,
    playwrightConfig,
    viteConfig,
  ] = await Promise.all([
    read("ci.yml"),
    read("release-production.yml"),
    read("production-uptime.yml"),
    readFile(path.join(root, "data/incident-automation.json"), "utf8"),
    readFile(path.join(root, "package.json"), "utf8"),
    readFile(path.join(root, "scripts/run-cloudflare-build-phase.mjs"), "utf8"),
    readFile(
      path.join(root, ".agents/skills/release-production/SKILL.md"),
      "utf8",
    ),
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
        cloudflareBuildPhase,
        releaseSkill,
        playwrightConfig,
        viteConfig,
      }),
      null,
      2,
    ),
  );
}
