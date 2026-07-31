import assert from "node:assert/strict";
import test from "node:test";

import {
  CapabilityResultError,
  createCapabilityResultValidator,
  normalizeInvocationContext,
} from "../activity-scenes/assistant/capability-result.js";

const closed = (properties = {}, required = Object.keys(properties)) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required,
});

const contract = (overrides = {}) => ({
  capabilityId: "map.zoomin",
  kind: "command",
  resultSchema: closed({
    zoom: { type: "number", minimum: 0, maximum: 24 },
  }),
  ...overrides,
});

const result = (overrides = {}) => ({
  capabilityId: "map.zoomin",
  kind: "command",
  status: "completed",
  changed: true,
  affectedTargetIds: [],
  contextRevision: 4,
  data: { zoom: 12 },
  errorCode: null,
  ...overrides,
});

test("validates the common envelope and capability-specific data schema", () => {
  const validate = createCapabilityResultValidator(contract());
  const value = validate(result(), { proposalRevision: 3 });

  assert.deepEqual(value, result());
  assert.throws(() => {
    value.data.zoom = 15;
  }, TypeError);
  assert.throws(
    () => validate(result({ data: { zoom: "far" } }), { proposalRevision: 3 }),
    (error) =>
      error instanceof CapabilityResultError &&
      error.code === "result_schema_mismatch",
  );
});

test("changed commands require a strictly newer context revision", () => {
  const validate = createCapabilityResultValidator(contract());

  assert.throws(
    () => validate(result({ contextRevision: 3 }), { proposalRevision: 3 }),
    (error) => error.code === "stale_result_context",
  );
  assert.doesNotThrow(() =>
    validate(result({ changed: false, contextRevision: 3 }), {
      proposalRevision: 3,
    }),
  );
});

test("query results require changed null and still validate their data", () => {
  const validate = createCapabilityResultValidator(
    contract({
      capabilityId: "catalog.search",
      kind: "query",
      resultSchema: closed({
        items: {
          type: "array",
          maxItems: 2,
          items: { type: "string", maxLength: 20 },
        },
      }),
    }),
  );

  assert.doesNotThrow(() =>
    validate({
      capabilityId: "catalog.search",
      kind: "query",
      status: "completed",
      changed: null,
      affectedTargetIds: ["event:1"],
      contextRevision: 8,
      data: { items: ["event:1"] },
      errorCode: null,
    }),
  );
  assert.throws(
    () =>
      validate({
        capabilityId: "catalog.search",
        kind: "query",
        status: "completed",
        changed: false,
        affectedTargetIds: [],
        contextRevision: 8,
        data: { items: [] },
        errorCode: null,
      }),
    (error) => error.code === "invalid_result_envelope",
  );
});

test("rejects unknown fields, duplicate targets, and non-public errors", () => {
  const validate = createCapabilityResultValidator(contract());

  for (const invalid of [
    result({ debug: "raw provider payload" }),
    result({ affectedTargetIds: ["event:1", "event:1"] }),
    result({ status: "failed", errorCode: "stack_trace" }),
  ]) {
    assert.throws(
      () => validate(invalid, { proposalRevision: 3 }),
      (error) => error.code === "invalid_result_envelope",
    );
  }
});

test("non-completed results cannot smuggle capability-specific data", () => {
  const validate = createCapabilityResultValidator(contract());

  assert.throws(
    () =>
      validate(
        result({
          status: "unavailable",
          changed: false,
          contextRevision: 3,
          data: { zoom: 12 },
          errorCode: "unavailable",
        }),
        { proposalRevision: 3 },
      ),
    (error) => error.code === "invalid_result_envelope",
  );
});

test("caller origin is bounded diagnostic metadata and legacy sources normalize deterministically", () => {
  assert.deepEqual(normalizeInvocationContext({ source: "assistant" }), {
    source: "assistant",
    callerOrigin: "voice",
  });
  assert.deepEqual(
    normalizeInvocationContext({
      callerOrigin: "mcp_fixture",
      proposalRevision: 4,
    }),
    {
      callerOrigin: "mcp_fixture",
      proposalRevision: 4,
    },
  );
  assert.throws(
    () => normalizeInvocationContext({ callerOrigin: "admin_override" }),
    (error) =>
      error instanceof CapabilityResultError &&
      error.code === "invalid_invocation_context",
  );
  assert.throws(
    () => normalizeInvocationContext({ sessionId: "x".repeat(129) }),
    (error) => error.code === "invalid_invocation_context",
  );
});
