import assert from "node:assert/strict";
import test from "node:test";

import { createActionGateway } from "../activity-scenes/assistant/action-gateway.js";
import { createActionRegistry } from "../activity-scenes/assistant/action-registry.js";
import {
  ConfirmationError,
  createConfirmationController,
} from "../activity-scenes/assistant/confirmation-controller.js";
import { deterministicClock } from "./helpers/baseline-fixtures.mjs";

const objectSchema = (properties, required = Object.keys(properties)) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required,
});

function action(overrides = {}) {
  return {
    actionId: "map.zoom_in",
    version: "1.0",
    description: "Zoom the map in",
    argumentSchema: objectSchema({
      steps: { type: "integer", minimum: 1, maximum: 3 },
    }),
    eligibleStates: ["map_ready"],
    confirmationClass: "reversible",
    contextProvider: "map",
    resultSchema: objectSchema({ zoom: { type: "number" } }),
    execute: ({ steps }, context) => ({ zoom: context.zoom + steps }),
    ...overrides,
  };
}

function consequentialAction(execute) {
  return action({
    actionId: "saved.delete_item",
    description: "Delete a saved item",
    argumentSchema: objectSchema({ itemId: { type: "string", minLength: 1 } }),
    confirmationClass: "consequential",
    contextProvider: "saved-content",
    resultSchema: objectSchema({ deletedItemId: { type: "string" } }),
    execute,
  });
}

function confirmationFixture() {
  const clock = deterministicClock("2026-07-18T12:00:00.000Z");
  let nextId = 1;
  const controller = createConfirmationController({
    now: clock.now,
    createId: () => `confirmation-${nextId++}`,
    ttlMs: 25_000,
  });
  return { clock, controller };
}

const context = {
  states: ["map_ready"],
  revision: 7,
  zoom: 12,
  visibleTargets: [{ id: "saved-001", type: "saved-item" }],
};

const confirmationRequest = (overrides = {}) => ({
  actionId: "saved.delete_item",
  canonicalArguments: { itemId: "saved-001" },
  targetId: "saved-001",
  contextRevision: 7,
  effectSummary: "Delete Saved place from this device.",
  ...overrides,
});

const accept = (controller, pending, overrides = {}) =>
  controller.resolve({
    confirmationId: pending.confirmationId,
    fingerprint: pending.fingerprint,
    decision: "accepted",
    inputSource: "user",
    inputStatus: "final",
    ...overrides,
  });

const throwsConfirmation = (callback, code) =>
  assert.throws(
    callback,
    (error) => error instanceof ConfirmationError && error.code === code,
  );

test("reversible actions execute immediately while consequential actions expose an exact preview", async () => {
  let destructiveEffects = 0;
  const { controller } = confirmationFixture();
  const gateway = createActionGateway({
    registry: createActionRegistry([
      action(),
      consequentialAction(({ itemId }) => {
        destructiveEffects += 1;
        return { deletedItemId: itemId };
      }),
    ]),
    confirmationController: controller,
  });

  assert.deepEqual(
    await gateway.execute("map.zoom_in", { steps: 2 }, context, {
      source: "voice",
    }),
    {
      status: "executed",
      actionId: "map.zoom_in",
      result: { zoom: 14 },
    },
  );
  const result = await gateway.execute(
    "saved.delete_item",
    { itemId: "saved-001" },
    context,
    {
      source: "voice",
      targetId: "saved-001",
      effectSummary: "Delete Saved place from this device.",
    },
  );

  assert.equal(result.status, "confirmation_required");
  assert.equal(result.confirmation.actionId, "saved.delete_item");
  assert.deepEqual(result.confirmation.canonicalArguments, {
    itemId: "saved-001",
  });
  assert.equal(
    result.confirmation.effectSummary,
    "Delete Saved place from this device.",
  );
  assert.equal(destructiveEffects, 0);
});

test("a later final user acceptance is single-use and permits the matching action", async () => {
  let destructiveEffects = 0;
  const { controller } = confirmationFixture();
  const gateway = createActionGateway({
    registry: createActionRegistry([
      consequentialAction(({ itemId }) => {
        destructiveEffects += 1;
        return { deletedItemId: itemId };
      }),
    ]),
    confirmationController: controller,
  });
  const first = await gateway.execute(
    "saved.delete_item",
    { itemId: "saved-001" },
    context,
    {
      source: "voice",
      targetId: "saved-001",
      effectSummary: "Delete Saved place from this device.",
    },
  );
  assert.equal(accept(controller, first.confirmation).status, "accepted");

  const executed = await gateway.execute(
    "saved.delete_item",
    { itemId: "saved-001" },
    context,
    {
      source: "voice",
      confirmation: {
        confirmationId: first.confirmation.confirmationId,
        fingerprint: first.confirmation.fingerprint,
      },
    },
  );

  assert.equal(executed.status, "executed");
  assert.equal(destructiveEffects, 1);
  await assert.rejects(
    gateway.execute("saved.delete_item", { itemId: "saved-001" }, context, {
      source: "voice",
      confirmation: {
        confirmationId: first.confirmation.confirmationId,
        fingerprint: first.confirmation.fingerprint,
      },
    }),
    (error) => error.code === "confirmation_replayed",
  );
  assert.equal(destructiveEffects, 1);
});

test("compound commands stop at a consequential action and preserve completed safe effects", async () => {
  let destructiveEffects = 0;
  const { controller } = confirmationFixture();
  const gateway = createActionGateway({
    registry: createActionRegistry([
      action(),
      consequentialAction(({ itemId }) => {
        destructiveEffects += 1;
        return { deletedItemId: itemId };
      }),
    ]),
    confirmationController: controller,
  });

  const results = await gateway.executeCompound(
    [
      { actionId: "map.zoom_in", argumentsValue: { steps: 1 } },
      {
        actionId: "saved.delete_item",
        argumentsValue: { itemId: "saved-001" },
        targetId: "saved-001",
        effectSummary: "Delete Saved place from this device.",
      },
      { actionId: "map.zoom_in", argumentsValue: { steps: 2 } },
    ],
    context,
    { source: "voice" },
  );

  assert.deepEqual(
    results.map(({ status }) => status),
    ["executed", "confirmation_required"],
  );
  assert.equal(destructiveEffects, 0);
});

test("pending confirmations expire after exactly twenty-five seconds", () => {
  const { clock, controller } = confirmationFixture();
  const pending = controller.request(confirmationRequest());
  clock.advance(24_999);
  assert.equal(controller.getPending().status, "pending");
  clock.advance(1);

  throwsConfirmation(() => accept(controller, pending), "confirmation_expired");
  assert.equal(controller.getPending(), null);
});

test("argument, target, or context changes cannot reuse an accepted fingerprint", () => {
  for (const changed of [
    { canonicalArguments: { itemId: "saved-002" } },
    { targetId: "saved-002" },
    { contextRevision: 8 },
  ]) {
    const { controller } = confirmationFixture();
    const pending = controller.request(confirmationRequest());
    accept(controller, pending);
    throwsConfirmation(
      () =>
        controller.consume({
          ...confirmationRequest(),
          ...changed,
          confirmationId: pending.confirmationId,
          fingerprint: pending.fingerprint,
        }),
      "confirmation_mismatch",
    );
  }
});

test("interruption invalidates pending confirmation with zero side effects", () => {
  const { controller } = confirmationFixture();
  const pending = controller.request(confirmationRequest());
  assert.equal(controller.invalidate("interruption").status, "invalidated");

  throwsConfirmation(
    () =>
      controller.consume({
        ...confirmationRequest(),
        confirmationId: pending.confirmationId,
        fingerprint: pending.fingerprint,
      }),
    "confirmation_invalidated",
  );
});

test("model output can neither accept nor self-confirm a consequential action", () => {
  const { controller } = confirmationFixture();
  const pending = controller.request(confirmationRequest());

  throwsConfirmation(
    () =>
      accept(controller, pending, {
        inputSource: "model",
        inputStatus: "final",
      }),
    "confirmation_source_invalid",
  );
  throwsConfirmation(
    () =>
      accept(controller, pending, {
        inputSource: "user",
        inputStatus: "partial",
      }),
    "confirmation_input_not_final",
  );
});

test("confirmation fingerprints are deterministic, immutable, and bind canonical arguments", () => {
  const { controller } = confirmationFixture();
  const first = controller.request(
    confirmationRequest({
      canonicalArguments: { itemId: "saved-001", reason: "cleanup" },
    }),
  );
  controller.invalidate("replacement");
  const reordered = controller.request(
    confirmationRequest({
      canonicalArguments: { reason: "cleanup", itemId: "saved-001" },
    }),
  );

  assert.match(first.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(reordered.fingerprint, first.fingerprint);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.canonicalArguments), true);
});
