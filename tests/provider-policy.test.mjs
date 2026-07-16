import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ProviderPolicyError, assertProviderAllowed, loadProviderPolicy, providerProvenance } from "../scripts/lib/provider-policy.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const policy = loadProviderPolicy(path.join(root, "data/provider-policy.json"));

test("approved free and open providers accept only their approved domains", () => {
  assert.equal(assertProviderAllowed(policy, "catch-sg", { url: "https://www.catch.sg/api/events/SearchListEvent" }).costClass, "free");
  assert.equal(assertProviderAllowed(policy, "openstreetmap-overpass", { url: "https://overpass-api.de/api/interpreter" }).costClass, "open");
  assert.throws(() => assertProviderAllowed(policy, "catch-sg", { url: "https://lookalike.example/events" }), (error) => error instanceof ProviderPolicyError && error.code === "provider_domain_unapproved");
});

test("unknown, absent-cost, disabled, and paid providers fail closed", () => {
  assert.throws(() => assertProviderAllowed(policy, "google-maps"), (error) => error.code === "provider_unapproved");
  assert.throws(() => assertProviderAllowed({ schemaVersion: "1.0", providers: [{ id: "bad", enabled: true, domains: ["example.test"] }] }, "bad"), (error) => error.code === "provider_cost_class_invalid");
  assert.throws(() => assertProviderAllowed({ schemaVersion: "1.0", providers: [{ id: "paid", enabled: true, costClass: "paid", domains: ["example.test"] }] }, "paid"), (error) => error.code === "provider_cost_class_invalid");
});

test("provider provenance is explicit and contains no credentials", () => {
  const provenance = providerProvenance(assertProviderAllowed(policy, "sistic"), { retrievedAt: "2026-07-14T00:00:00.000Z", adapterId: "sistic-official-listing-v1", adapterVersion: "1.0" });
  assert.deepEqual(provenance, { providerId: "sistic", owner: "SISTIC.com Pte Ltd", costClass: "free", adapterId: "sistic-official-listing-v1", adapterVersion: "1.0", retrievedAt: "2026-07-14T00:00:00.000Z" });
});
