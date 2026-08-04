export const PENDING_DIALOGUE_RESOLUTION_SCHEMA_VERSION = "1.0";

const REPLY_CLASSES = Object.freeze([
  "affirm",
  "reject",
  "ordinal",
  "exact_name",
  "title_fragment",
  "unbound_pronoun",
  "constraint",
]);
const AFFIRMATIVE_REPLIES = new Set([
  "yes",
  "yes please",
  "sure",
  "okay",
  "ok",
  "do it",
  "please do",
  "go ahead",
]);
const REJECTION_REPLIES = new Set([
  "no",
  "no thanks",
  "no thank you",
  "not now",
  "neither",
  "cancel that",
  "never mind",
  "nevermind",
]);
const SOLE_PRONOUN_REPLIES = new Set([
  "it",
  "that",
  "that one",
  "this",
  "this one",
]);
const ORDINALS = Object.freeze({
  first: 0,
  "1st": 0,
  "number one": 0,
  second: 1,
  "2nd": 1,
  "number two": 1,
  third: 2,
  "3rd": 2,
  "number three": 2,
  fourth: 3,
  "4th": 3,
  "number four": 3,
  last: -1,
});
const NON_DISTINCTIVE_TITLE_TOKENS = new Set([
  "a",
  "an",
  "and",
  "at",
  "event",
  "for",
  "in",
  "of",
  "on",
  "one",
  "or",
  "the",
  "to",
  "with",
]);

const normalize = (value) =>
  String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\p{M}+/gu, "")
    .replace(/[’']/g, "")
    .replace(/[-‐‑‒–—―/]+/g, " ")
    .replace(/[^a-z0-9%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const exactKeys = (value, expected) => {
  const keys = Object.keys(value).sort();
  return (
    keys.length === expected.length &&
    keys.every((key, index) => key === [...expected].sort()[index])
  );
};

export function validatePendingDialogueResolutionOutcome(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.schemaVersion !== PENDING_DIALOGUE_RESOLUTION_SCHEMA_VERSION
  )
    return { valid: false };
  if (value.status === "resolved")
    return {
      valid:
        exactKeys(value, ["schemaVersion", "status", "candidate"]) &&
        value.candidate !== null &&
        typeof value.candidate === "object" &&
        !Array.isArray(value.candidate),
    };
  if (value.status === "clarified") {
    const expectedKeys = ["schemaVersion", "status", "reason"];
    if ("candidateIndexes" in value) expectedKeys.push("candidateIndexes");
    return {
      valid:
        exactKeys(value, expectedKeys) &&
        typeof value.reason === "string" &&
        value.reason.length > 0 &&
        value.reason.length <= 128 &&
        (!("candidateIndexes" in value) ||
          (Array.isArray(value.candidateIndexes) &&
            value.candidateIndexes.length > 0 &&
            value.candidateIndexes.length <= 3 &&
            value.candidateIndexes.every(
              (index) => Number.isInteger(index) && index >= 0 && index <= 2,
            ) &&
            new Set(value.candidateIndexes).size ===
              value.candidateIndexes.length)),
    };
  }
  if (value.status === "rejected" || value.status === "stale")
    return {
      valid: exactKeys(value, ["schemaVersion", "status"]),
    };
  if (value.status === "unrecognized")
    return {
      valid:
        exactKeys(value, ["schemaVersion", "status", "answerLike"]) &&
        typeof value.answerLike === "boolean",
    };
  return { valid: false };
}

const resolutionOutcome = (status, fields = {}) => {
  const outcome = Object.freeze({
    schemaVersion: PENDING_DIALOGUE_RESOLUTION_SCHEMA_VERSION,
    status,
    ...fields,
  });
  if (!validatePendingDialogueResolutionOutcome(outcome).valid)
    throw new TypeError("Invalid pending dialogue resolution outcome");
  return outcome;
};

const ordinalIndex = (text, count) => {
  for (const [token, index] of Object.entries(ORDINALS))
    if (new RegExp(`\\b${token.replace(" ", "\\s+")}\\b`).test(text))
      return index === -1 ? count - 1 : index;
  return null;
};

const candidateEvidence = (text) => {
  let evidence = text;
  const withoutPrefix = evidence.replace(
    /^(?:(?:please|okay|ok)\s+)*(?:(?:can|could|would|will)\s+you\s+)?(?:add|open|select|choose|pick|take|show)\s+(?:me\s+)?(?:the\s+)?/,
    "",
  );
  const selectionShaped = withoutPrefix !== evidence;
  evidence = withoutPrefix
    .replace(/^the\s+/, "")
    .replace(/\s+(?:to|in)\s+(?:my|the)\s+(?:plan|itinerary)$/, "")
    .replace(/\s+please$/, "")
    .trim();
  const tokens = evidence.split(" ").filter(Boolean);
  return {
    evidence,
    selectionShaped,
    distinctive: tokens.some(
      (token) => !NON_DISTINCTIVE_TITLE_TOKENS.has(token),
    ),
  };
};

const containsTokenSpan = (label, evidence) =>
  ` ${label} `.includes(` ${evidence} `);

export const pendingDialogueChoiceSpeech = (candidates, actionPhrase) => {
  if (candidates.length === 1)
    return `Would you like me to ${actionPhrase} ${candidates[0].label}?`;
  const ordinalLabels = ["first", "second", "third"];
  const clauses = candidates.map(
    ({ label }, index) => `${ordinalLabels[index]}, ${label}`,
  );
  const choices =
    clauses.length === 2
      ? `${clauses[0]}; or ${clauses[1]}`
      : `${clauses.slice(0, -1).join("; ")}; or ${clauses.at(-1)}`;
  return `Which would you like me to ${actionPhrase}: ${choices}?`;
};

export function createPendingDialogue({
  dialogueId,
  capabilityId,
  candidates,
  contextRevision,
  nowMs,
  kind = null,
  clarificationSpeech = null,
} = {}) {
  if (
    typeof dialogueId !== "string" ||
    !dialogueId ||
    typeof capabilityId !== "string" ||
    !/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/.test(capabilityId) ||
    !Number.isInteger(contextRevision) ||
    contextRevision < 0 ||
    !Number.isFinite(nowMs)
  )
    return null;
  const boundedCandidates = [];
  const identities = new Set();
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const targetId = String(candidate?.targetId ?? "").slice(0, 256);
    const label = String(candidate?.label ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);
    const argumentsValue = candidate?.arguments;
    if (
      !targetId ||
      !label ||
      !argumentsValue ||
      typeof argumentsValue !== "object" ||
      Array.isArray(argumentsValue) ||
      identities.has(targetId)
    )
      continue;
    identities.add(targetId);
    boundedCandidates.push(
      Object.freeze({
        targetId,
        label,
        arguments: Object.freeze(structuredClone(argumentsValue)),
      }),
    );
    if (boundedCandidates.length === 3) break;
  }
  if (!boundedCandidates.length) return null;
  return Object.freeze({
    dialogueId: dialogueId.slice(0, 128),
    kind:
      kind ??
      (boundedCandidates.length === 1 ? "single_offer" : "candidate_choice"),
    capabilityId,
    candidates: Object.freeze(boundedCandidates),
    applicableCandidateIndexes: Object.freeze(
      boundedCandidates.map((_, index) => index),
    ),
    expectedReplies: REPLY_CLASSES,
    contextRevision,
    createdAtMs: nowMs,
    status: "active",
    clarificationSpeech:
      typeof clarificationSpeech === "string"
        ? clarificationSpeech.slice(0, 800)
        : null,
  });
}

export function narrowPendingDialogueChoices(pending, candidateIndexes) {
  if (
    !pending ||
    !Array.isArray(pending.candidates) ||
    !Array.isArray(candidateIndexes) ||
    !candidateIndexes.length
  )
    return null;
  const indexes = candidateIndexes.map(Number);
  if (
    indexes.some(
      (index) =>
        !Number.isInteger(index) ||
        index < 0 ||
        index >= pending.candidates.length,
    ) ||
    new Set(indexes).size !== indexes.length
  )
    return null;
  return Object.freeze({
    ...pending,
    applicableCandidateIndexes: Object.freeze(indexes),
  });
}

export function interpretPendingDialogue(
  pending,
  utterance,
  { contextRevision } = {},
) {
  if (!pending || !Array.isArray(pending.candidates))
    return resolutionOutcome("unrecognized", { answerLike: false });
  const text = normalize(utterance);
  const applicableCandidateIndexes = Array.isArray(
    pending.applicableCandidateIndexes,
  )
    ? pending.applicableCandidateIndexes
    : pending.candidates.map((_, index) => index);
  const candidateIndex = ordinalIndex(text, applicableCandidateIndexes.length);
  const { evidence, selectionShaped, distinctive } = candidateEvidence(text);
  const nameMatches = distinctive
    ? applicableCandidateIndexes.filter((index) => {
        const normalizedName = normalize(pending.candidates[index]?.label);
        return (
          normalizedName === evidence ||
          containsTokenSpan(normalizedName, evidence)
        );
      })
    : [];
  const answerLike =
    AFFIRMATIVE_REPLIES.has(text) ||
    REJECTION_REPLIES.has(text) ||
    SOLE_PRONOUN_REPLIES.has(text) ||
    selectionShaped ||
    candidateIndex !== null ||
    nameMatches.length > 0;
  if (pending.status !== "active")
    return pending.status === "stale" && answerLike
      ? resolutionOutcome("stale")
      : resolutionOutcome("unrecognized", { answerLike: false });
  if (contextRevision !== pending.contextRevision)
    return answerLike
      ? resolutionOutcome("stale")
      : resolutionOutcome("unrecognized", { answerLike: false });
  if (REJECTION_REPLIES.has(text)) return resolutionOutcome("rejected");
  if (
    /\b(?:but|only if|if|as long as|provided that|unless)\b/.test(text) &&
    (candidateIndex !== null ||
      nameMatches.length ||
      AFFIRMATIVE_REPLIES.has(text))
  )
    return resolutionOutcome("clarified", { reason: "mixed_constraint" });
  if (AFFIRMATIVE_REPLIES.has(text))
    return applicableCandidateIndexes.length === 1
      ? resolutionOutcome("resolved", {
          candidate: pending.candidates[applicableCandidateIndexes[0]],
        })
      : resolutionOutcome("clarified", { reason: "multiple_candidates" });
  if (candidateIndex !== null)
    return applicableCandidateIndexes[candidateIndex] !== undefined
      ? resolutionOutcome("resolved", {
          candidate:
            pending.candidates[applicableCandidateIndexes[candidateIndex]],
        })
      : resolutionOutcome("clarified", {
          reason: "ordinal_out_of_range",
        });
  if (SOLE_PRONOUN_REPLIES.has(text))
    return resolutionOutcome("clarified", { reason: "ambiguous_pronoun" });
  if (nameMatches.length === 1)
    return resolutionOutcome("resolved", {
      candidate: pending.candidates[nameMatches[0]],
    });
  if (nameMatches.length > 1)
    return resolutionOutcome("clarified", {
      reason: "multiple_name_matches",
      candidateIndexes: nameMatches,
    });
  if (selectionShaped)
    return resolutionOutcome("unrecognized", { answerLike: true });
  return resolutionOutcome("unrecognized", { answerLike: false });
}
