import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

import { canonicalizePipelineValue } from "./equivalence.mjs";

const sha = (value) => createHash("sha256").update(String(value)).digest("hex");
const atomicJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, path);
};
const bounded = (value) => {
  const serialized = JSON.stringify(value);
  if (serialized.length > 64_000)
    throw new Error("Delivery result exceeds the bounded receipt contract");
  return JSON.parse(serialized);
};

export function deliveryIdentity({
  operation,
  payload,
  destination,
  contractVersion,
}) {
  const payloadHash = sha(JSON.stringify(canonicalizePipelineValue(payload)));
  const destinationHash = sha(destination ?? "local");
  return {
    operation,
    contractVersion,
    payloadHash,
    destinationHash,
    receiptId: sha(
      JSON.stringify({
        operation,
        contractVersion,
        payloadHash,
        destinationHash,
      }),
    ),
  };
}

export async function runIdempotentDelivery({
  receiptRoot,
  operation,
  payload,
  destination,
  contractVersion = "1.0",
  execute,
  now = () => new Date().toISOString(),
  clock = () => Date.now(),
}) {
  const identity = deliveryIdentity({
    operation,
    payload,
    destination,
    contractVersion,
  });
  const path = join(
    resolve(receiptRoot),
    operation.replace(/[^a-zA-Z0-9._-]/g, "_"),
    `${identity.receiptId}.json`,
  );
  if (existsSync(path)) {
    try {
      const receipt = JSON.parse(readFileSync(path, "utf8"));
      if (
        receipt.status === "success" &&
        receipt.payloadHash === identity.payloadHash &&
        receipt.destinationHash === identity.destinationHash &&
        receipt.contractVersion === contractVersion
      )
        return {
          reused: true,
          value: receipt.result,
          receipt,
          path,
          metrics: {
            durationMs: 0,
            blockingMs: 0,
            cacheHits: 1,
            reasonCode: "delivery_receipt_reused",
          },
        };
    } catch {
      // Corrupt or partial receipts are safely replaced by a real execution.
    }
  }
  let value;
  const startedAt = clock();
  try {
    value = bounded(await execute());
  } catch (error) {
    const receipt = {
      schemaVersion: "1.0",
      ...identity,
      status: "failed",
      result: {
        reasonCode: "delivery_execution_failed",
        error: String(error?.message ?? error).slice(0, 1000),
      },
      completedAt: now(),
    };
    atomicJson(path, receipt);
    throw error;
  }
  const durationMs = Math.max(0, clock() - startedAt);
  const successful = value?.status !== "failed";
  const receipt = {
    schemaVersion: "1.0",
    ...identity,
    status: successful ? "success" : "failed",
    result: value,
    completedAt: now(),
  };
  atomicJson(path, receipt);
  return {
    reused: false,
    value,
    receipt,
    path,
    metrics: {
      durationMs,
      blockingMs: durationMs,
      cacheMisses: 1,
      reasonCode: successful
        ? "delivery_executed"
        : "delivery_execution_failed",
    },
  };
}
