const REPLY_CLASSES = Object.freeze([
  "affirm",
  "reject",
  "ordinal",
  "exact_name",
  "sole_pronoun",
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
  last: -1,
});

const normalize = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9%'+-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const ordinalIndex = (text, count) => {
  for (const [token, index] of Object.entries(ORDINALS))
    if (new RegExp(`\\b${token.replace(" ", "\\s+")}\\b`).test(text))
      return index === -1 ? count - 1 : index;
  return null;
};

export const pendingDialogueChoiceSpeech = (candidates, actionPhrase) => {
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

export function interpretPendingDialogue(
  pending,
  utterance,
  { contextRevision } = {},
) {
  if (!pending || !Array.isArray(pending.candidates))
    return { status: "unrelated" };
  const text = normalize(utterance);
  const candidateIndex = ordinalIndex(text, pending.candidates.length);
  const normalizedNames = pending.candidates.map(({ label }) =>
    normalize(label),
  );
  const normalizedReplyName = text
    .replace(/^the\s+/, "")
    .replace(/\s+please$/, "");
  const nameMatches = normalizedNames
    .map((name, index) => (name === normalizedReplyName ? index : -1))
    .filter((index) => index >= 0);
  const answerLike =
    AFFIRMATIVE_REPLIES.has(text) ||
    REJECTION_REPLIES.has(text) ||
    SOLE_PRONOUN_REPLIES.has(text) ||
    candidateIndex !== null ||
    nameMatches.length > 0;
  if (pending.status !== "active")
    return answerLike ? { status: pending.status } : { status: "unrelated" };
  if (contextRevision !== pending.contextRevision)
    return answerLike ? { status: "stale" } : { status: "unrelated" };
  if (REJECTION_REPLIES.has(text)) return { status: "rejected" };
  if (
    /\b(?:but|only if|if|as long as|provided that|unless)\b/.test(text) &&
    (candidateIndex !== null ||
      nameMatches.length ||
      AFFIRMATIVE_REPLIES.has(text))
  )
    return { status: "clarified", reason: "mixed_constraint" };
  if (AFFIRMATIVE_REPLIES.has(text))
    return pending.candidates.length === 1
      ? { status: "resolved", candidate: pending.candidates[0] }
      : { status: "clarified", reason: "multiple_candidates" };
  if (candidateIndex !== null)
    return pending.candidates[candidateIndex]
      ? { status: "resolved", candidate: pending.candidates[candidateIndex] }
      : { status: "clarified", reason: "ordinal_out_of_range" };
  if (nameMatches.length === 1)
    return {
      status: "resolved",
      candidate: pending.candidates[nameMatches[0]],
    };
  if (nameMatches.length > 1)
    return { status: "clarified", reason: "duplicate_name" };
  if (SOLE_PRONOUN_REPLIES.has(text))
    return pending.candidates.length === 1
      ? { status: "resolved", candidate: pending.candidates[0] }
      : { status: "clarified", reason: "ambiguous_pronoun" };
  return { status: "unrelated" };
}
