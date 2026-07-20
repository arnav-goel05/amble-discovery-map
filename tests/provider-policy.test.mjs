import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ProviderPolicyError,
  assertAuthorityUrlAllowed,
  assertPaidExceptionAllowed,
  assertProviderAllowed,
  isPrivateAddress,
  loadEventAuthorityRegistry,
  loadProviderPolicy,
  providerProvenance,
} from "../scripts/lib/provider-policy.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const policy = loadProviderPolicy(path.join(root, "data/provider-policy.json"));
const authorityRegistry = loadEventAuthorityRegistry(path.join(root, "data/event-authority-registry.json"));

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

test("the exact feature 004 OpenAI exception uses a separate paid assertion", () => {
  const provider = assertPaidExceptionAllowed(policy, "openai-realtime", {
    featureId: "004-conversational-voice-map",
    url: "https://api.openai.com/v1/realtime",
  });

  assert.equal(provider.id, "openai-realtime");
  assert.equal(provider.costClass, "paid-exception");
  assert.equal(provider.featureId, "004-conversational-voice-map");
  assert.throws(
    () =>
      assertProviderAllowed(policy, "openai-realtime", {
        url: "https://api.openai.com/v1/realtime",
      }),
    (error) =>
      error instanceof ProviderPolicyError &&
      error.code === "provider_cost_class_invalid",
  );
});

test("paid exception assertion rejects every other feature, provider, and domain", () => {
  const unrelatedPaidPolicy = {
    schemaVersion: "1.0",
    providers: [
      {
        id: "unrelated-paid",
        owner: "Fixture owner",
        enabled: true,
        costClass: "paid-exception",
        featureId: "004-conversational-voice-map",
        domains: ["example.test"],
      },
    ],
  };

  assert.throws(
    () =>
      assertPaidExceptionAllowed(policy, "openai-realtime", {
        featureId: "005-unrelated-feature",
        url: "https://api.openai.com/v1/realtime",
      }),
    (error) =>
      error instanceof ProviderPolicyError &&
      error.code === "provider_paid_exception_scope_invalid",
  );
  assert.throws(
    () =>
      assertPaidExceptionAllowed(policy, "openai-realtime", {
        featureId: "004-conversational-voice-map",
        url: "https://lookalike.example/v1/realtime",
      }),
    (error) =>
      error instanceof ProviderPolicyError &&
      error.code === "provider_domain_unapproved",
  );
  assert.throws(
    () =>
      assertPaidExceptionAllowed(unrelatedPaidPolicy, "unrelated-paid", {
        featureId: "004-conversational-voice-map",
      }),
    (error) =>
      error instanceof ProviderPolicyError &&
      error.code === "provider_paid_exception_invalid",
  );
  assert.throws(
    () =>
      assertPaidExceptionAllowed(policy, "unknown-paid", {
        featureId: "004-conversational-voice-map",
      }),
    (error) =>
      error instanceof ProviderPolicyError && error.code === "provider_unapproved",
  );
});

test("provider provenance is explicit and contains no credentials", () => {
  const provenance = providerProvenance(assertProviderAllowed(policy, "sistic"), { retrievedAt: "2026-07-14T00:00:00.000Z", adapterId: "sistic-official-listing-v1", adapterVersion: "1.0" });
  assert.deepEqual(provenance, { providerId: "sistic", owner: "SISTIC.com Pte Ltd", costClass: "free", adapterId: "sistic-official-listing-v1", adapterVersion: "1.0", retrievedAt: "2026-07-14T00:00:00.000Z" });
});

test("event authority registry approves reviewed event paths and reviews unknown domains", () => {
  assert.equal(assertAuthorityUrlAllowed(authorityRegistry, "https://www.sistic.com.sg/event-details/show").authorityId, "sistic");
  assert.throws(() => assertAuthorityUrlAllowed(authorityRegistry, "https://unknown-organizer.example/events/show"), (error) => error.code === "authority_domain_review");
  assert.throws(() => assertAuthorityUrlAllowed(authorityRegistry, "https://user:pass@peatix.com/event/show"), (error) => error.code === "authority_url_unsafe");
  assert.equal(isPrivateAddress("127.0.0.1"), true);
  assert.equal(isPrivateAddress("103.1.2.3"), false);
});
