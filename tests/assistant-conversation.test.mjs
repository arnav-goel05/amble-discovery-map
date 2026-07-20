import assert from "node:assert/strict";
import test from "node:test";

import {
  ConversationModelError,
  conversationLimitReason,
  createConversationSession,
  reconcileTranscriptItem,
  stopConversationSession,
  transitionConversationSession,
} from "../activity-scenes/assistant/conversation-model.js";

const at = (seconds) => new Date(Date.UTC(2026, 6, 18, 12, 0, seconds));

function listeningSession(limits = {}) {
  let session = createConversationSession({
    sessionId: "session-1",
    now: at(0),
    limits,
  });
  session = transitionConversationSession(session, "disclosure", {
    now: at(0),
  });
  session = transitionConversationSession(session, "connecting", {
    now: at(0),
  });
  return transitionConversationSession(session, "listening", { now: at(0) });
}

test("transcript deltas reconcile by item identity and finals replace partial text", () => {
  let session = listeningSession();
  session = reconcileTranscriptItem(
    session,
    { type: "transcript.delta", itemId: "user-1", text: "Somewhere " },
    { now: at(1) },
  );
  session = reconcileTranscriptItem(
    session,
    { type: "transcript.delta", itemId: "user-1", text: "calm" },
    { now: at(2) },
  );
  assert.equal(session.transcriptItems.length, 1);
  assert.equal(session.transcriptItems[0].text, "Somewhere calm");
  session = reconcileTranscriptItem(
    session,
    {
      type: "transcript.final",
      itemId: "user-1",
      text: "Somewhere calm for an evening walk.",
    },
    { now: at(3) },
  );
  assert.deepEqual(session.transcriptItems[0], {
    itemId: "user-1",
    role: "user",
    modality: "audio",
    status: "final",
    text: "Somewhere calm for an evening walk.",
    createdAt: at(1).toISOString(),
  });
  assert.equal(
    reconcileTranscriptItem(session, {
      type: "transcript.delta",
      itemId: "user-1",
      text: "late",
    }),
    session,
  );
});

test("assistant identity is stable across partial/final reconciliation and counts one response", () => {
  let session = listeningSession();
  session = reconcileTranscriptItem(session, {
    type: "assistant.text.delta",
    itemId: "assistant-1",
    text: "Can, ",
  });
  session = reconcileTranscriptItem(session, {
    type: "assistant.text.delta",
    itemId: "assistant-1",
    text: "I found City Hall.",
  });
  session = reconcileTranscriptItem(session, {
    type: "assistant.text.done",
    itemId: "assistant-1",
    text: "Can, I found City Hall.",
  });
  assert.equal(session.transcriptItems.length, 1);
  assert.equal(session.transcriptItems[0].modality, "text");
  assert.equal(session.responseCount, 1);
  assert.throws(
    () =>
      reconcileTranscriptItem(session, {
        type: "transcript.final",
        itemId: "assistant-1",
        role: "user",
        text: "conflict",
      }),
    (error) =>
      error instanceof ConversationModelError &&
      error.code === "transcript_identity_conflict",
  );
});

test("conversation lifecycle permits documented cycles and rejects terminal resurrection", () => {
  let session = listeningSession();
  session = transitionConversationSession(session, "processing");
  session = transitionConversationSession(session, "speaking");
  session = transitionConversationSession(session, "listening");
  session = transitionConversationSession(session, "awaiting_confirmation");
  session = transitionConversationSession(session, "listening");
  session = stopConversationSession(session, "user");
  assert.equal(session.state, "stopped");
  assert.throws(
    () => transitionConversationSession(session, "listening"),
    (error) => error.code === "invalid_transition",
  );
});

test("idle, duration, and response limits are deterministic", () => {
  const idle = listeningSession({
    idleSeconds: 10,
    maxSessionSeconds: 30,
    maxResponses: 2,
  });
  assert.equal(conversationLimitReason(idle, { now: at(9) }), null);
  assert.equal(conversationLimitReason(idle, { now: at(10) }), "idle");
  assert.equal(conversationLimitReason(idle, { now: at(30) }), "duration");

  let responses = reconcileTranscriptItem(
    idle,
    { type: "assistant.text.done", itemId: "a-1", text: "One" },
    { now: at(1) },
  );
  responses = reconcileTranscriptItem(
    responses,
    { type: "assistant.text.done", itemId: "a-2", text: "Two" },
    { now: at(1) },
  );
  assert.equal(
    conversationLimitReason(responses, { now: at(1) }),
    "response_limit",
  );
  assert.throws(
    () =>
      reconcileTranscriptItem(
        responses,
        { type: "assistant.text.done", itemId: "a-3", text: "Three" },
        { now: at(2) },
      ),
    (error) => error.code === "response_limit",
  );
});

test("terminal stop clears every session-scoped content field idempotently", () => {
  let session = listeningSession();
  session = reconcileTranscriptItem(session, {
    type: "transcript.final",
    itemId: "user-1",
    text: "near me",
  });
  session = Object.freeze({
    ...session,
    intent: { freeTextSummary: "near me" },
    interfaceContext: { revision: 7 },
    exactLocation: { coordinates: [103.85, 1.29] },
    pendingConfirmationId: "confirmation-1",
  });
  const stopped = stopConversationSession(session, "pagehide");
  assert.deepEqual(stopped.transcriptItems, []);
  assert.equal(stopped.intent, null);
  assert.equal(stopped.interfaceContext, null);
  assert.equal(stopped.exactLocation, null);
  assert.equal(stopped.pendingConfirmationId, null);
  assert.equal(stopConversationSession(stopped, "pagehide"), stopped);
});
