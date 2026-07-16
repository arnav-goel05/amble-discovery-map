import assert from "node:assert/strict";
import test from "node:test";
import { runCommandSuite } from "../scripts/run-command-suite.mjs";

test("command suite runs entries sequentially and merges environment", () => {
  const calls = [];
  const result = runCommandSuite([
    { name: "first", command: "node", args: ["first"], env: { FIRST: "1" } },
    { name: "second", command: "node", args: ["second"] },
  ], {
    env: { SHARED: "yes" },
    spawn(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0, signal: null };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.results.map(({ name, status }) => ({ name, status })), [
    { name: "first", status: 0 },
    { name: "second", status: 0 },
  ]);
  assert.deepEqual(calls.map(({ args }) => args), [["first"], ["second"]]);
  assert.equal(calls[0].options.env.SHARED, "yes");
  assert.equal(calls[0].options.env.FIRST, "1");
});

test("command suite stops at the first failed child and propagates its status", () => {
  const calls = [];
  const result = runCommandSuite([
    { command: "node", args: ["one"] },
    { command: "node", args: ["two"] },
    { command: "node", args: ["three"] },
  ], {
    spawn(command, args) {
      calls.push([command, ...args]);
      return { status: args[0] === "two" ? 7 : 0, signal: null };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 7);
  assert.deepEqual(calls, [["node", "one"], ["node", "two"]]);
});

test("command suite rejects empty or malformed definitions", () => {
  assert.throws(() => runCommandSuite([]), /non-empty array/);
  assert.throws(() => runCommandSuite([{}]), /requires a command/);
});
