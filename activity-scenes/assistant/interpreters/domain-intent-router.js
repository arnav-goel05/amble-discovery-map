const DOMAIN = /^[a-z][a-z0-9-]{0,63}$/;

export function createDomainIntentRouter(initialInterpreters = {}) {
  const interpreters = new Map();

  const register = (domain, interpreter) => {
    if (!DOMAIN.test(domain) || typeof interpreter !== "function")
      throw new TypeError("A valid domain and interpreter are required");
    if (interpreters.has(domain))
      throw new TypeError(`Interpreter ${domain} is already registered`);
    interpreters.set(domain, interpreter);
    return () => interpreters.delete(domain);
  };

  for (const [domain, interpreter] of Object.entries(initialInterpreters))
    register(domain, interpreter);

  return Object.freeze({
    register,
    domains: () => Object.freeze([...interpreters.keys()].sort()),
    interpret(domain, input = {}) {
      const interpreter = interpreters.get(domain);
      if (!interpreter)
        return Object.freeze({
          domain,
          normalizedUtterance: String(input.text ?? "")
            .trim()
            .slice(0, 500),
          outcome: "unsupported",
          clarificationChoices: [],
          proposedCalls: [],
          baseContextRevision: Number.isInteger(input.baseContextRevision)
            ? input.baseContextRevision
            : 0,
          catalogRevision: input.catalogRevision ?? null,
        });
      return interpreter(input);
    },
  });
}
