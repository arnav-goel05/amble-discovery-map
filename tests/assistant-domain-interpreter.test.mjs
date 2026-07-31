import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { compileSchema } from "../activity-scenes/assistant/capability-result.js";
import { createDomainIntentRouter } from "../activity-scenes/assistant/interpreters/domain-intent-router.js";
import { interpretEventQuery } from "../activity-scenes/assistant/interpreters/event-query-interpreter.js";
import { createFilterOptionCatalog } from "../activity-scenes/events/event-filter-options.js";

const catalog = createFilterOptionCatalog({
  categories: ["Concerts", "Exhibitions"],
  locations: [
    {
      id: "area:marina-bay",
      kind: "area",
      value: "ura-subzone:marina-bay",
      label: "Marina Bay",
      availableCount: 8,
    },
  ],
});

const interpret = (text, overrides = {}) =>
  interpretEventQuery({
    text,
    mode: "replace",
    catalog,
    baseContextRevision: 12,
    catalogRevision: "events:v1",
    ...overrides,
  });

test("domain interpretation and event result contracts compile and stay closed", async () => {
  for (const name of ["domain-interpretation", "event-apply-query-result"]) {
    const schema = JSON.parse(
      await readFile(
        new URL(
          `../specs/004-conversational-voice-map/contracts/${name}.schema.json`,
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const validate = compileSchema(schema, {
      requireClosedRoot: false,
      requireBounds: false,
    });
    assert.equal(validate({ unexpected: true }).valid, false);
  }
});

test("every interpreter outcome validates against the checked-in contract", async () => {
  const schema = JSON.parse(
    await readFile(
      new URL(
        "../specs/004-conversational-voice-map/contracts/domain-interpretation.schema.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const validate = compileSchema(schema, {
    requireClosedRoot: false,
    requireBounds: false,
  });
  for (const output of [
    interpret("free concerts"),
    interpret("today this weekend"),
    interpret(""),
    interpret("free", { baseContextRevision: -1 }),
    interpret("free", { catalogRevision: "" }),
  ])
    assert.deepEqual(validate(output), { valid: true, errors: [] });
});

test("produces one closed atomic proposal for a supported event sentence", () => {
  const result = interpret(
    "free concerts this weekend near Marina Bay with friends",
  );

  assert.deepEqual(result, {
    domain: "event",
    normalizedUtterance:
      "free concerts this weekend near Marina Bay with friends",
    outcome: "applicable",
    clarificationChoices: [],
    proposedCalls: [
      {
        capabilityId: "event.applyquery",
        arguments: {
          text: "free concerts this weekend near Marina Bay with friends",
          mode: "replace",
          baseContextRevision: 12,
          catalogRevision: "events:v1",
        },
      },
    ],
    baseContextRevision: 12,
    catalogRevision: "events:v1",
  });
});

test("returns bounded current-catalogue choices instead of guessing ambiguity", () => {
  const result = interpret("today or this weekend");

  assert.equal(result.outcome, "clarification_required");
  assert.deepEqual(result.proposedCalls, []);
  assert.deepEqual(result.clarificationChoices, [
    { choiceId: "when:this-weekend", label: "This weekend" },
    { choiceId: "when:today", label: "Today" },
  ]);
  assert.ok(result.clarificationChoices.length <= 8);
});

test("rejects unsupported and invalid proposals without executable calls", () => {
  for (const result of [
    interpret("   "),
    interpret("free", { mode: "invalid" }),
    interpret("free", { baseContextRevision: -1 }),
    interpret("free", { catalogRevision: "" }),
    interpret("anything", { mode: "remove" }),
  ]) {
    assert.equal(result.outcome, "unsupported");
    assert.deepEqual(result.proposedCalls, []);
    assert.deepEqual(result.clarificationChoices, []);
  }
});

test("normalizes and bounds utterances before proposal construction", () => {
  const result = interpret(`  ${"romantic ".repeat(100)}free  `);

  assert.ok(result.normalizedUtterance.length <= 500);
  assert.equal(
    result.proposedCalls[0].arguments.text,
    result.normalizedUtterance,
  );
});

test("domain router registers event interpretation and leaves future domains closed", () => {
  const router = createDomainIntentRouter({ event: interpretEventQuery });

  assert.deepEqual(router.domains(), ["event"]);
  assert.equal(
    router.interpret("event", {
      text: "free concerts",
      mode: "replace",
      catalog,
      baseContextRevision: 12,
      catalogRevision: "events:v1",
    }).proposedCalls[0].capabilityId,
    "event.applyquery",
  );
  assert.equal(
    router.interpret("restaurant", {
      text: "noodles",
      baseContextRevision: 12,
    }).outcome,
    "unsupported",
  );
  assert.throws(
    () => router.register("event", interpretEventQuery),
    /already registered/,
  );
});
