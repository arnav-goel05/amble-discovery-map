import fs from "node:fs";
import net from "node:net";

const APPROVED_COST_CLASSES = new Set(["free", "open"]);

export class ProviderPolicyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ProviderPolicyError";
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new ProviderPolicyError(code, message);
};

export function loadProviderPolicy(file) {
  let policy;
  try {
    policy = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail(
      "provider_policy_unreadable",
      `Provider policy could not be loaded: ${error.message}`,
    );
  }
  if (policy?.schemaVersion !== "1.0" || !Array.isArray(policy.providers))
    fail("provider_policy_invalid", "Provider policy has an unsupported shape");
  const ids = policy.providers.map((provider) => provider?.id);
  if (
    ids.some((id) => typeof id !== "string" || !id) ||
    new Set(ids).size !== ids.length
  )
    fail(
      "provider_policy_invalid",
      "Provider identities must be present and unique",
    );
  return policy;
}

export function assertProviderAllowed(policy, providerId, { url } = {}) {
  if (policy?.schemaVersion !== "1.0" || !Array.isArray(policy.providers))
    fail("provider_policy_invalid", "Provider policy has an unsupported shape");
  const provider = policy.providers.find(({ id }) => id === providerId);
  if (!provider)
    fail("provider_unapproved", `Provider ${providerId} is not approved`);
  if (!APPROVED_COST_CLASSES.has(provider.costClass))
    fail(
      "provider_cost_class_invalid",
      `Provider ${providerId} is not classified free/open`,
    );
  if (provider.enabled !== true)
    fail("provider_disabled", `Provider ${providerId} is disabled`);
  if (
    !provider.owner ||
    !Array.isArray(provider.domains) ||
    provider.domains.length === 0
  )
    fail(
      "provider_definition_invalid",
      `Provider ${providerId} lacks owner/domain evidence`,
    );
  if (url) {
    let hostname;
    try {
      hostname = new URL(url).hostname.toLowerCase();
    } catch {
      fail("provider_url_invalid", `Provider ${providerId} URL is invalid`);
    }
    const approved = provider.domains.some(
      (domain) =>
        hostname === domain.toLowerCase() ||
        hostname.endsWith(`.${domain.toLowerCase()}`),
    );
    if (!approved)
      fail(
        "provider_domain_unapproved",
        `Domain ${hostname} is not approved for ${providerId}`,
      );
  }
  return Object.freeze({
    ...provider,
    domains: Object.freeze([...provider.domains]),
  });
}

export function assertPaidExceptionAllowed(
  policy,
  providerId,
  { featureId, url } = {},
) {
  if (policy?.schemaVersion !== "1.0" || !Array.isArray(policy.providers))
    fail("provider_policy_invalid", "Provider policy has an unsupported shape");
  const provider = policy.providers.find(({ id }) => id === providerId);
  if (!provider)
    fail("provider_unapproved", `Provider ${providerId} is not approved`);
  if (
    providerId !== "openai-realtime" ||
    provider.costClass !== "paid-exception" ||
    provider.featureId !== "004-conversational-voice-map" ||
    provider.policyFile !== "data/realtime-voice-policy.json"
  ) {
    fail(
      "provider_paid_exception_invalid",
      `Provider ${providerId} is not the reviewed paid exception`,
    );
  }
  if (
    provider.enabled !== true ||
    provider.owner !== "OpenAI" ||
    !Array.isArray(provider.domains) ||
    provider.domains.length !== 1 ||
    provider.domains[0] !== "api.openai.com"
  ) {
    fail(
      "provider_paid_exception_invalid",
      `Provider ${providerId} has invalid exception evidence`,
    );
  }
  if (featureId !== provider.featureId)
    fail(
      "provider_paid_exception_scope_invalid",
      `Provider ${providerId} is not approved for feature ${featureId}`,
    );
  if (url) {
    let hostname;
    try {
      hostname = new URL(url).hostname.toLowerCase();
    } catch {
      fail("provider_url_invalid", `Provider ${providerId} URL is invalid`);
    }
    if (hostname !== "api.openai.com")
      fail(
        "provider_domain_unapproved",
        `Domain ${hostname} is not approved for ${providerId}`,
      );
  }
  return Object.freeze({
    ...provider,
    domains: Object.freeze([...provider.domains]),
  });
}

export function providerProvenance(
  provider,
  { adapterId = null, adapterVersion = null, retrievedAt } = {},
) {
  if (!provider?.id || !APPROVED_COST_CLASSES.has(provider.costClass))
    fail(
      "provider_provenance_invalid",
      "Approved provider required for provenance",
    );
  if (!retrievedAt || Number.isNaN(Date.parse(retrievedAt)))
    fail("provider_provenance_invalid", "retrievedAt is required");
  return {
    providerId: provider.id,
    owner: provider.owner,
    costClass: provider.costClass,
    adapterId,
    adapterVersion,
    retrievedAt,
  };
}

export function loadEventAuthorityRegistry(file) {
  let registry;
  try {
    registry = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail(
      "authority_registry_unreadable",
      `Event authority registry could not be loaded: ${error.message}`,
    );
  }
  if (registry?.schemaVersion !== "1.0" || !Array.isArray(registry.entries))
    fail(
      "authority_registry_invalid",
      "Event authority registry has an unsupported shape",
    );
  const ids = new Set();
  for (const entry of registry.entries) {
    if (
      !entry?.authorityId ||
      ids.has(entry.authorityId) ||
      entry.status !== "approved" ||
      !entry.owner ||
      ![
        "organizer",
        "venue",
        "institution",
        "government",
        "authorized_ticketing",
      ].includes(entry.authorityType) ||
      !Array.isArray(entry.domains) ||
      entry.domains.length === 0 ||
      !Array.isArray(entry.detailPathPatterns)
    ) {
      fail(
        "authority_registry_invalid",
        "Authority entries require unique identity, approved status, owner, type, domains, and detail paths",
      );
    }
    for (const pattern of entry.detailPathPatterns) {
      try {
        new RegExp(pattern);
      } catch {
        fail(
          "authority_registry_invalid",
          `Invalid detail path pattern for ${entry.authorityId}`,
        );
      }
    }
    ids.add(entry.authorityId);
  }
  return registry;
}

export function isPrivateAddress(address) {
  if (!net.isIP(address)) return false;
  if (
    address === "::" ||
    address === "::1" ||
    address.startsWith("fe80:") ||
    address.startsWith("fc") ||
    address.startsWith("fd")
  )
    return true;
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  return false;
}

export function assertAuthorityUrlAllowed(registry, value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("authority_url_invalid", "Authority URL is invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    isPrivateAddress(url.hostname)
  )
    fail(
      "authority_url_unsafe",
      "Authority URL must be public HTTPS without credentials",
    );
  const hostname = url.hostname.toLowerCase();
  const entry = registry?.entries?.find(
    (candidate) =>
      candidate.domains.some(
        (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
      ) &&
      candidate.detailPathPatterns.some((pattern) =>
        new RegExp(pattern).test(url.pathname),
      ),
  );
  if (!entry)
    fail(
      "authority_domain_review",
      `Authority URL ${hostname}${url.pathname} is not in the reviewed registry`,
    );
  return {
    url: url.href,
    authorityId: entry.authorityId,
    owner: entry.owner,
    authorityType: entry.authorityType,
  };
}
