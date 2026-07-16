import fs from "node:fs";

const APPROVED_COST_CLASSES = new Set(["free", "open"]);

export class ProviderPolicyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ProviderPolicyError";
    this.code = code;
  }
}

const fail = (code, message) => { throw new ProviderPolicyError(code, message); };

export function loadProviderPolicy(file) {
  let policy;
  try { policy = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { fail("provider_policy_unreadable", `Provider policy could not be loaded: ${error.message}`); }
  if (policy?.schemaVersion !== "1.0" || !Array.isArray(policy.providers)) fail("provider_policy_invalid", "Provider policy has an unsupported shape");
  const ids = policy.providers.map((provider) => provider?.id);
  if (ids.some((id) => typeof id !== "string" || !id) || new Set(ids).size !== ids.length) fail("provider_policy_invalid", "Provider identities must be present and unique");
  return policy;
}

export function assertProviderAllowed(policy, providerId, { url } = {}) {
  if (policy?.schemaVersion !== "1.0" || !Array.isArray(policy.providers)) fail("provider_policy_invalid", "Provider policy has an unsupported shape");
  const provider = policy.providers.find(({ id }) => id === providerId);
  if (!provider) fail("provider_unapproved", `Provider ${providerId} is not approved`);
  if (!APPROVED_COST_CLASSES.has(provider.costClass)) fail("provider_cost_class_invalid", `Provider ${providerId} is not classified free/open`);
  if (provider.enabled !== true) fail("provider_disabled", `Provider ${providerId} is disabled`);
  if (!provider.owner || !Array.isArray(provider.domains) || provider.domains.length === 0) fail("provider_definition_invalid", `Provider ${providerId} lacks owner/domain evidence`);
  if (url) {
    let hostname;
    try { hostname = new URL(url).hostname.toLowerCase(); }
    catch { fail("provider_url_invalid", `Provider ${providerId} URL is invalid`); }
    const approved = provider.domains.some((domain) => hostname === domain.toLowerCase() || hostname.endsWith(`.${domain.toLowerCase()}`));
    if (!approved) fail("provider_domain_unapproved", `Domain ${hostname} is not approved for ${providerId}`);
  }
  return Object.freeze({ ...provider, domains: Object.freeze([...provider.domains]) });
}

export function providerProvenance(provider, { adapterId = null, adapterVersion = null, retrievedAt } = {}) {
  if (!provider?.id || !APPROVED_COST_CLASSES.has(provider.costClass)) fail("provider_provenance_invalid", "Approved provider required for provenance");
  if (!retrievedAt || Number.isNaN(Date.parse(retrievedAt))) fail("provider_provenance_invalid", "retrievedAt is required");
  return { providerId: provider.id, owner: provider.owner, costClass: provider.costClass, adapterId, adapterVersion, retrievedAt };
}
