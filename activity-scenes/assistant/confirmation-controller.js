export class ConfirmationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ConfirmationError";
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new ConfirmationError(code, message);
};
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
};

function sha256(text) {
  const rightRotate = (value, amount) =>
    (value >>> amount) | (value << (32 - amount));
  const words = [];
  const bytes = new TextEncoder().encode(text);
  const bitLength = bytes.length * 8;
  for (const byte of bytes) words.push(byte);
  words.push(0x80);
  while (words.length % 64 !== 56) words.push(0);
  for (let index = 7; index >= 0; index -= 1)
    words.push(index < 4 ? (bitLength >>> (index * 8)) & 0xff : 0);
  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ];
  const k = [];
  let candidate = 2;
  while (k.length < 64) {
    let prime = true;
    for (let divisor = 2; divisor * divisor <= candidate; divisor += 1)
      if (candidate % divisor === 0) {
        prime = false;
        break;
      }
    if (prime)
      k.push(Math.floor((Math.cbrt(candidate) % 1) * 0x100000000) >>> 0);
    candidate += 1;
  }
  for (let offset = 0; offset < words.length; offset += 64) {
    const w = new Array(64);
    for (let i = 0; i < 16; i += 1)
      w[i] =
        (words[offset + i * 4] << 24) |
        (words[offset + i * 4 + 1] << 16) |
        (words[offset + i * 4 + 2] << 8) |
        words[offset + i * 4 + 3];
    for (let i = 16; i < 64; i += 1) {
      const x = w[i - 15],
        y = w[i - 2];
      const s0 = rightRotate(x, 7) ^ rightRotate(x, 18) ^ (x >>> 3);
      const s1 = rightRotate(y, 17) ^ rightRotate(y, 19) ^ (y >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i += 1) {
      const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + s1 + ch + k[i] + w[i]) >>> 0;
      const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      [hh, g, f, e, d, c, b, a] = [
        g,
        f,
        e,
        (d + t1) >>> 0,
        c,
        b,
        a,
        (t1 + t2) >>> 0,
      ];
    }
    [a, b, c, d, e, f, g, hh].forEach((value, index) => {
      h[index] = (h[index] + value) >>> 0;
    });
  }
  return h.map((value) => value.toString(16).padStart(8, "0")).join("");
}

const fingerprintFor = ({
  actionId,
  canonicalArguments,
  targetId,
  contextRevision,
}) =>
  sha256(
    canonical({
      actionId,
      canonicalArguments,
      targetId: targetId ?? null,
      contextRevision,
    }),
  );
const frozen = (record) =>
  Object.freeze({
    ...record,
    canonicalArguments: Object.freeze(
      structuredClone(record.canonicalArguments),
    ),
  });

export function createConfirmationController({
  now = () => new Date(),
  createId = () => crypto.randomUUID(),
  ttlMs = 25_000,
} = {}) {
  let pending = null;
  const records = new Map();

  const request = (input) => {
    if (pending) {
      records.set(pending.confirmationId, {
        ...pending,
        status: "invalidated",
        invalidationReason: "replacement",
      });
      pending = null;
    }
    const createdAt = now();
    const record = frozen({
      confirmationId: createId(),
      fingerprint: fingerprintFor(input),
      actionId: input.actionId,
      canonicalArguments: input.canonicalArguments,
      targetId: input.targetId ?? null,
      contextRevision: input.contextRevision,
      effectSummary: input.effectSummary,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + ttlMs).toISOString(),
      status: "pending",
    });
    pending = record;
    records.set(record.confirmationId, record);
    return record;
  };

  const resolve = ({
    confirmationId,
    fingerprint,
    decision,
    inputSource,
    inputStatus,
  }) => {
    const record = records.get(confirmationId);
    if (!record || record.fingerprint !== fingerprint)
      fail("confirmation_mismatch", "Confirmation does not match");
    if (Date.parse(record.expiresAt) <= now().getTime()) {
      records.set(confirmationId, { ...record, status: "expired" });
      pending = null;
      fail("confirmation_expired", "Confirmation expired");
    }
    if (inputSource !== "user")
      fail(
        "confirmation_source_invalid",
        "Only the user can confirm an action",
      );
    if (inputStatus !== "final")
      fail("confirmation_input_not_final", "Confirmation input must be final");
    if (
      !pending ||
      pending.confirmationId !== confirmationId ||
      record.status !== "pending"
    )
      fail("confirmation_invalidated", "Confirmation is no longer pending");
    const status = decision === "accepted" ? "accepted" : "rejected";
    const next = frozen({ ...record, status });
    records.set(confirmationId, next);
    pending = status === "accepted" ? next : null;
    return next;
  };

  const consume = (input) => {
    const record = records.get(input.confirmationId);
    if (!record) fail("confirmation_mismatch", "Confirmation does not exist");
    if (record.status === "executed")
      fail("confirmation_replayed", "Confirmation has already been used");
    if (record.status === "invalidated")
      fail("confirmation_invalidated", "Confirmation was invalidated");
    if (record.status === "expired")
      fail("confirmation_expired", "Confirmation expired");
    const expected = fingerprintFor(input);
    if (
      record.fingerprint !== input.fingerprint ||
      expected !== record.fingerprint
    )
      fail("confirmation_mismatch", "Confirmation target or arguments changed");
    if (
      record.status !== "accepted" ||
      !pending ||
      pending.confirmationId !== record.confirmationId
    )
      fail("confirmation_not_accepted", "Confirmation has not been accepted");
    const executed = frozen({ ...record, status: "executed" });
    records.set(record.confirmationId, executed);
    pending = null;
    return executed;
  };

  return Object.freeze({
    request,
    resolve,
    consume,
    getPending: () => pending,
    invalidate(reason = "invalidated") {
      if (!pending) return null;
      const invalidated = frozen({
        ...pending,
        status: "invalidated",
        invalidationReason: reason,
      });
      records.set(pending.confirmationId, invalidated);
      pending = null;
      return invalidated;
    },
  });
}
