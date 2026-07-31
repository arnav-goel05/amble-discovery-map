import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

import { OUT_OF_SCOPE_RESPONSE } from "../cloudflare/realtime-relay.mjs";

const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const {
  createLocalVoiceBudgetRepository,
} = require("./lib/voice-budget-repository.cjs");
const readBudgetLedger = () => {
  const repository = createLocalVoiceBudgetRepository();
  try {
    return repository.getLedger();
  } finally {
    repository.close();
  }
};
const probe = path.join(root, "outputs/live-voice-probe/run.mjs");
const cases = [
  ["typed-conversation", "typed-conversation"],
  ["typed-transit", "typed-transit-layer-control"],
  ["typed-restaurant", "typed-restaurant-discovery"],
  ["typed-event", "typed-compound-event"],
  ["map", "map-control"],
  ["transit-1", "transit-layer-control"],
  ["transit-2", "transit-layer-control"],
  ["restaurant-1", "restaurant-discovery"],
  ["restaurant-2", "restaurant-discovery"],
  ["unsupported", "unsupported-general-knowledge"],
  ["event-1", "compound-event"],
  ["event-follow-up", "event-follow-up-sequence"],
  ["category-price-location-1", "category-price-location"],
  ["category-price-location-2", "category-price-location"],
  ["ambiguous-date", "ambiguous-date"],
  ["event-2", "compound-event"],
];

const exactSpeechFor = (turn) => {
  if (turn.name === "unsupported-general-knowledge")
    return OUT_OF_SCOPE_RESPONSE;
  return null;
};

const normalizedWords = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, " ")
    .trim();

const groundedSpeechIssues = (turn) => {
  if (!turn.capabilityId) return [];
  if (turn.assistantText.length !== 1)
    return ["capability_response_must_be_one_message"];
  const speech = normalizedWords(turn.assistantText[0]);
  const outcome = turn.applicationOutcome ?? {};
  if (turn.capabilityId === "event.applyquery") {
    if (outcome.outcome === "clarification_required") {
      const labels = (outcome.clarificationChoices ?? []).map(({ label }) =>
        normalizedWords(label),
      );
      return labels.length && labels.every((label) => speech.includes(label))
        ? []
        : ["event_clarification_not_grounded"];
    }
    return Number.isInteger(outcome.resultCount) &&
      speech.includes(String(outcome.resultCount)) &&
      /\bevents?\b/.test(speech)
      ? []
      : ["event_result_count_not_grounded"];
  }
  if (turn.capabilityId === "restaurant.search") {
    const meaningful = normalizedWords(turn.proposal?.query)
      .split(" ")
      .filter((word) => word.length > 3);
    return meaningful.every((word) => speech.includes(word))
      ? []
      : ["restaurant_query_not_grounded"];
  }
  if (turn.capabilityId === "map.zoomin")
    return /\bzoom(?:ed)?\b/.test(speech) && /\bin\b/.test(speech)
      ? []
      : ["zoom_in_outcome_not_grounded"];
  if (turn.capabilityId === "map.zoomout")
    return /\bzoom(?:ed)?\b/.test(speech) && /\bout\b/.test(speech)
      ? []
      : ["zoom_out_outcome_not_grounded"];
  if (turn.capabilityId === "map.setlayervisibility") {
    const hidden = turn.proposal?.visible === false;
    const stateMatches = hidden
      ? /\b(hid|hidden|off|disabled|turned off)\b/.test(speech)
      : /\b(show|shown|on|enabled|turned on)\b/.test(speech);
    const layerMatches =
      turn.proposal?.layer === "mrtLines"
        ? /\b(mrt|train)\b/.test(speech) && /\blines?\b/.test(speech)
        : turn.proposal?.layer === "mrtStations"
          ? /\b(mrt|train)\b/.test(speech) && /\bstations?\b/.test(speech)
          : true;
    return stateMatches && layerMatches
      ? []
      : ["layer_visibility_outcome_not_grounded"];
  }
  return [];
};

const validateTurn = (turn) => {
  const issues = [];
  if (turn.terminalReason) issues.push(`terminal:${turn.terminalReason}`);
  if (!Array.isArray(turn.states) || !turn.states.includes("listening"))
    issues.push("did_not_return_to_listening");
  if (!Array.isArray(turn.assistantText) || !turn.assistantText.length)
    issues.push("missing_assistant_response");
  const expectedSpeech = exactSpeechFor(turn);
  if (
    expectedSpeech &&
    (turn.assistantText.length !== 1 ||
      turn.assistantText[0] !== expectedSpeech)
  )
    issues.push(
      `unexpected_speech:${JSON.stringify({
        expected: expectedSpeech,
        actual: turn.assistantText,
      })}`,
    );
  issues.push(...groundedSpeechIssues(turn));
  if (turn.name === "typed-conversation" && turn.capabilityId !== null)
    issues.push("typed_help_mutated_application");
  if (
    turn.name === "unsupported-general-knowledge" &&
    turn.capabilityId !== null
  )
    issues.push("unsupported_request_mutated_application");
  return issues;
};

const matrix = {
  schemaVersion: "1.0",
  startedAt: new Date().toISOString(),
  budgetBefore: readBudgetLedger(),
  attempts: [],
};

for (const [attemptName, probeCase] of cases) {
  const execution = spawnSync(
    process.execPath,
    ["--env-file-if-exists=.env.local", probe],
    {
      cwd: root,
      env: { ...process.env, PROBE_CASE: probeCase },
      encoding: "utf8",
      timeout: 90_000,
      maxBuffer: 4 * 1_024 * 1_024,
    },
  );
  let report = null;
  try {
    report = JSON.parse(execution.stdout);
  } catch {}
  const issues = [];
  if (execution.error) issues.push(`process:${execution.error.message}`);
  if (execution.status !== 0)
    issues.push(`exit:${execution.status ?? "unknown"}`);
  if (!report) issues.push("missing_machine_report");
  if (report?.terminal === "error")
    issues.push(`probe:${report.error?.message ?? "unknown"}`);
  for (const turn of report?.turns ?? [])
    issues.push(...validateTurn(turn).map((issue) => `${turn.name}:${issue}`));
  if (!report?.turns?.length) issues.push("no_completed_turn");
  matrix.attempts.push({
    attemptName,
    probeCase,
    passed: issues.length === 0,
    issues,
    report,
  });
  if (issues.length) break;
}

matrix.finishedAt = new Date().toISOString();
matrix.budgetAfter = readBudgetLedger();
matrix.spendDeltaMicroUsd =
  matrix.budgetAfter.spentMicroUsd - matrix.budgetBefore.spentMicroUsd;
matrix.completedAttempts = matrix.attempts.length;
matrix.expectedAttempts = cases.length;
matrix.passed =
  matrix.completedAttempts === cases.length &&
  matrix.attempts.every(({ passed }) => passed);

const outputDirectory = path.join(root, "outputs/live-voice-matrix");
await fs.mkdir(outputDirectory, { recursive: true });
const outputPath = path.join(
  outputDirectory,
  `matrix-${new Date().toISOString().replaceAll(/[:.]/g, "")}.json`,
);
await fs.writeFile(outputPath, `${JSON.stringify(matrix, null, 2)}\n`);
console.log(
  JSON.stringify({
    passed: matrix.passed,
    completedAttempts: matrix.completedAttempts,
    expectedAttempts: matrix.expectedAttempts,
    spendDeltaMicroUsd: matrix.spendDeltaMicroUsd,
    outputPath,
    failures: matrix.attempts
      .filter(({ passed }) => !passed)
      .map(({ attemptName, issues }) => ({ attemptName, issues })),
  }),
);
if (!matrix.passed) process.exitCode = 1;
