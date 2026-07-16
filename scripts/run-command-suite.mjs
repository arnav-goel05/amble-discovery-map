import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function runCommandSuite(commands, {
  cwd = process.cwd(),
  env = process.env,
  spawn = spawnSync,
  stdio = "inherit",
} = {}) {
  if (!Array.isArray(commands) || commands.length === 0) {
    throw new TypeError("commands must be a non-empty array");
  }

  const results = [];
  for (const entry of commands) {
    if (!entry || typeof entry.command !== "string" || entry.command.length === 0) {
      throw new TypeError("each suite entry requires a command");
    }
    const args = Array.isArray(entry.args) ? entry.args.map(String) : [];
    const result = spawn(entry.command, args, {
      cwd,
      env: { ...env, ...(entry.env || {}) },
      shell: false,
      stdio,
    });
    const status = Number.isInteger(result.status) ? result.status : 1;
    results.push({ name: entry.name || entry.command, status, signal: result.signal || null });
    if (status !== 0) {
      return { ok: false, status, results };
    }
  }
  return { ok: true, status: 0, results };
}

function parseCli(argv) {
  if (argv.length === 0) throw new Error("provide one or more commands separated by --next");
  const commands = [];
  let current = [];
  for (const value of argv) {
    if (value === "--next") {
      if (current.length === 0) throw new Error("empty command before --next");
      commands.push({ command: current[0], args: current.slice(1) });
      current = [];
    } else current.push(value);
  }
  if (current.length) commands.push({ command: current[0], args: current.slice(1) });
  return commands;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  try {
    const result = runCommandSuite(parseCli(process.argv.slice(2)));
    process.exitCode = result.status;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
