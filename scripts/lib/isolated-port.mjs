import crypto from "node:crypto";

export function stableIsolatedPort(
  identity,
  { base = 40_000, span = 10_000 } = {},
) {
  if (typeof identity !== "string" || !identity)
    throw new Error("An isolated-port identity is required");
  if (
    !Number.isInteger(base) ||
    !Number.isInteger(span) ||
    base < 1 ||
    span < 1
  )
    throw new Error("The isolated-port range must use positive integers");
  if (base + span > 65_536)
    throw new Error("The isolated-port range exceeds the TCP port limit");
  const offset =
    Number.parseInt(
      crypto.createHash("sha256").update(identity).digest("hex").slice(0, 8),
      16,
    ) % span;
  return base + offset;
}
