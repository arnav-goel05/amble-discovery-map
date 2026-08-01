#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FULL_SHA = /^[a-f0-9]{40}$/u;

export function assessReleaseCandidate({
  candidateSha,
  developSha,
  mainSha,
  mainIsAncestor,
}) {
  if (!FULL_SHA.test(candidateSha ?? ""))
    throw new Error(
      "candidate_sha must be a full 40-character lowercase commit SHA",
    );
  if (candidateSha !== developSha)
    throw new Error("Release candidate is not the current origin/develop head");
  if (!FULL_SHA.test(mainSha ?? ""))
    throw new Error("origin/main did not resolve to a full commit SHA");
  if (!mainIsAncestor)
    throw new Error("origin/main cannot fast-forward to the release candidate");
  return { schemaVersion: 1, candidateSha, developSha, mainSha };
}

export function assessReleaseRefsUnchanged({
  state,
  candidateSha,
  developSha,
  mainSha,
  mainIsAncestor,
}) {
  const current = assessReleaseCandidate({
    candidateSha,
    developSha,
    mainSha,
    mainIsAncestor,
  });
  if (state.candidateSha !== current.candidateSha)
    throw new Error("Candidate identity changed during release");
  if (state.developSha !== current.developSha)
    throw new Error("origin/develop changed during release");
  if (state.mainSha !== current.mainSha)
    throw new Error("origin/main changed during release");
  return current;
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function option(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function currentRefs(candidateSha) {
  const developSha = git("rev-parse", "origin/develop^{commit}");
  const mainSha = git("rev-parse", "origin/main^{commit}");
  let mainIsAncestor = true;
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", mainSha, candidateSha]);
  } catch {
    mainIsAncestor = false;
  }
  return { candidateSha, developSha, mainSha, mainIsAncestor };
}

const isCli =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const mode = process.argv[2];
  const candidateSha = option("candidate");
  const stateFile = path.resolve(
    option("state-file", "/tmp/amble-release-candidate.json"),
  );
  git(
    "fetch",
    "--force",
    "origin",
    "develop:refs/remotes/origin/develop",
    "main:refs/remotes/origin/main",
  );
  if (mode === "prepare") {
    const state = assessReleaseCandidate(currentRefs(candidateSha));
    writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, {
      mode: 0o600,
    });
    console.log(JSON.stringify({ ...state, stateFile }));
  } else if (mode === "revalidate") {
    const state = JSON.parse(readFileSync(stateFile, "utf8"));
    console.log(
      JSON.stringify(
        assessReleaseRefsUnchanged({ state, ...currentRefs(candidateSha) }),
      ),
    );
  } else {
    throw new Error(
      "Usage: verify-release-candidate.mjs prepare|revalidate --candidate <sha> [--state-file <path>]",
    );
  }
}
