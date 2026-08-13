import assert from "node:assert/strict";
import test from "node:test";

import { fetchReleaseBytes } from "../scripts/lib/background-release-fetch.mjs";

const response = ({ status = 200, bytes = "b3dm", source = "r2" } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: status === 200 ? "OK" : "Unavailable",
  headers: new Headers({ "x-amble-tile-source": source }),
  async arrayBuffer() {
    return Buffer.from(bytes);
  },
});

test("release fetch retries transient transport failures with bounded backoff", async () => {
  let calls = 0;
  const delays = [];
  const retries = [];
  const bytes = await fetchReleaseBytes({
    url: "https://example.test/optimized-tiles/1.b3dm",
    fetchImpl: async () => {
      calls += 1;
      if (calls < 3) throw new TypeError("terminated");
      return response();
    },
    sleep: async (delay) => delays.push(delay),
    onRetry: (retry) => retries.push(retry.attempt),
  });
  assert.equal(bytes.toString("ascii"), "b3dm");
  assert.equal(calls, 3);
  assert.deepEqual(delays, [250, 1000]);
  assert.deepEqual(retries, [1, 2]);
});

test("release fetch retries interrupted response bodies and retryable HTTP status", async () => {
  let calls = 0;
  const bytes = await fetchReleaseBytes({
    url: "https://example.test/optimized-tiles/2.b3dm",
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return response({ status: 503 });
      if (calls === 2)
        return {
          ...response(),
          async arrayBuffer() {
            throw new TypeError("terminated");
          },
        };
      return response({ bytes: "recovered" });
    },
    sleep: async () => {},
  });
  assert.equal(bytes.toString(), "recovered");
  assert.equal(calls, 3);
});

test("release fetch fails immediately for missing or non-R2 objects", async () => {
  for (const invalidResponse of [
    response({ status: 404 }),
    response({ source: "unexpected" }),
  ]) {
    let calls = 0;
    await assert.rejects(
      fetchReleaseBytes({
        url: "https://example.test/optimized-tiles/missing.b3dm",
        fetchImpl: async () => {
          calls += 1;
          return invalidResponse;
        },
        sleep: async () => {},
      }),
    );
    assert.equal(calls, 1);
  }
});

test("release fetch stops after its configured attempt budget", async () => {
  let calls = 0;
  await assert.rejects(
    fetchReleaseBytes({
      url: "https://example.test/optimized-tiles/3.b3dm",
      attempts: 3,
      fetchImpl: async () => {
        calls += 1;
        throw new TypeError("terminated");
      },
      sleep: async () => {},
    }),
    /terminated/,
  );
  assert.equal(calls, 3);
});

test("release fetch shares a bounded retry budget across objects", async () => {
  const retryBudget = { remaining: 1 };
  const failingFetch = async () => {
    throw new TypeError("terminated");
  };
  await assert.rejects(
    fetchReleaseBytes({
      url: "https://example.test/optimized-tiles/4.b3dm",
      fetchImpl: failingFetch,
      retryBudget,
      sleep: async () => {},
    }),
  );
  assert.equal(retryBudget.remaining, 0);
  await assert.rejects(
    fetchReleaseBytes({
      url: "https://example.test/optimized-tiles/5.b3dm",
      fetchImpl: failingFetch,
      retryBudget,
      sleep: async () => {},
    }),
    /retry budget exhausted/,
  );
});

test("release fetch creates a fresh timeout signal for every attempt", async () => {
  const signals = [];
  await fetchReleaseBytes({
    url: "https://example.test/optimized-tiles/6.b3dm",
    fetchImpl: async (_url, options) => {
      signals.push(options.signal);
      if (signals.length === 1) throw new TypeError("terminated");
      return response();
    },
    sleep: async () => {},
  });
  assert.equal(signals.length, 2);
  assert.notEqual(signals[0], signals[1]);
});
