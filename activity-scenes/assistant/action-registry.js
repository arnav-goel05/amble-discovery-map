const ACTION_ID = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const VERSION = /^\d+\.\d+$/;
const REQUIRED_FIELDS = [
  "actionId",
  "version",
  "description",
  "argumentSchema",
  "eligibleStates",
  "confirmationClass",
  "contextProvider",
  "resultSchema",
  "execute",
];

export class ActionRegistryError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "ActionRegistryError";
    this.code = code;
    this.details = details;
  }
}

const fail = (code, message, details) => {
  throw new ActionRegistryError(code, message, details);
};

function deepFreeze(value, seen = new WeakSet()) {
  if (
    !value ||
    (typeof value !== "object" && typeof value !== "function") ||
    seen.has(value)
  )
    return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function validObjectSchema(schema) {
  return (
    schema?.type === "object" &&
    schema.additionalProperties === false &&
    schema.properties &&
    typeof schema.properties === "object" &&
    (!schema.required ||
      (Array.isArray(schema.required) &&
        schema.required.every((name) => typeof name === "string")))
  );
}

function validateContract(contract) {
  if (!contract || typeof contract !== "object")
    fail("invalid_action_contract", "Action contract must be an object");
  const missing = REQUIRED_FIELDS.filter(
    (field) => contract[field] === undefined,
  );
  if (missing.length)
    fail(
      "invalid_action_contract",
      `Action contract is missing ${missing.join(", ")}`,
    );
  if (!ACTION_ID.test(contract.actionId) || !VERSION.test(contract.version))
    fail("invalid_action_contract", "Action identity or version is invalid");
  if (
    typeof contract.description !== "string" ||
    !contract.description.trim() ||
    contract.description.length > 160
  )
    fail("invalid_action_contract", "Action description is invalid");
  if (
    !validObjectSchema(contract.argumentSchema) ||
    !validObjectSchema(contract.resultSchema)
  )
    fail("invalid_action_contract", "Action schemas must be closed objects");
  if (
    !Array.isArray(contract.eligibleStates) ||
    !contract.eligibleStates.length ||
    contract.eligibleStates.some((state) => typeof state !== "string" || !state)
  )
    fail("invalid_action_contract", "Action eligible states are invalid");
  if (!new Set(["reversible", "consequential"]).has(contract.confirmationClass))
    fail("invalid_action_contract", "Action confirmation class is invalid");
  if (
    typeof contract.contextProvider !== "string" ||
    !contract.contextProvider ||
    typeof contract.execute !== "function"
  )
    fail(
      "invalid_action_contract",
      "Action context provider or executor is invalid",
    );
}

function primitiveMatches(value, schema) {
  if (schema.const !== undefined && value !== schema.const) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types[0] !== undefined) {
    const matches = types.some((type) => {
      if (type === "null") return value === null;
      if (type === "integer") return Number.isInteger(value);
      if (type === "number")
        return typeof value === "number" && Number.isFinite(value);
      if (type === "array") return Array.isArray(value);
      if (type === "object")
        return (
          value !== null && typeof value === "object" && !Array.isArray(value)
        );
      return typeof value === type;
    });
    if (!matches) return false;
  }
  if (
    typeof value === "number" &&
    ((schema.minimum !== undefined && value < schema.minimum) ||
      (schema.maximum !== undefined && value > schema.maximum))
  )
    return false;
  if (
    typeof value === "string" &&
    ((schema.minLength !== undefined && value.length < schema.minLength) ||
      (schema.maxLength !== undefined && value.length > schema.maxLength) ||
      (schema.pattern && !new RegExp(schema.pattern).test(value)))
  )
    return false;
  if (Array.isArray(value)) {
    if (
      (schema.minItems !== undefined && value.length < schema.minItems) ||
      (schema.maxItems !== undefined && value.length > schema.maxItems)
    )
      return false;
    if (
      schema.uniqueItems &&
      new Set(value.map((item) => JSON.stringify(item))).size !== value.length
    )
      return false;
    if (
      schema.items &&
      value.some((item) => !matchesSchema(item, schema.items))
    )
      return false;
  }
  return true;
}

export function matchesSchema(value, schema) {
  if (!schema || typeof schema !== "object") return false;
  if (schema.oneOf)
    return (
      schema.oneOf.filter((candidate) => matchesSchema(value, candidate))
        .length === 1
    );
  if (!primitiveMatches(value, schema)) return false;
  if (schema.type === "object") {
    const required = schema.required || [];
    if (required.some((name) => value[name] === undefined)) return false;
    if (
      schema.additionalProperties === false &&
      Object.keys(value).some(
        (name) => !Object.hasOwn(schema.properties || {}, name),
      )
    )
      return false;
    for (const [name, child] of Object.entries(value)) {
      if (
        schema.properties?.[name] &&
        !matchesSchema(child, schema.properties[name])
      )
        return false;
    }
  }
  return true;
}

export function createActionRegistry(initialContracts = []) {
  const contracts = new Map();

  const register = (contract) => {
    validateContract(contract);
    if (contracts.has(contract.actionId))
      fail(
        "duplicate_action",
        `Action ${contract.actionId} is already registered`,
      );
    const frozen = deepFreeze({
      ...contract,
      eligibleStates: [...contract.eligibleStates],
      argumentSchema: structuredClone(contract.argumentSchema),
      resultSchema: structuredClone(contract.resultSchema),
    });
    contracts.set(frozen.actionId, frozen);
    return frozen;
  };

  for (const contract of initialContracts) register(contract);

  return Object.freeze({
    register,
    get(actionId) {
      const contract = contracts.get(actionId);
      if (!contract)
        fail("unknown_action", `Action ${actionId} is not registered`);
      return contract;
    },
    ids: () => [...contracts.keys()].sort(),
    available(states = []) {
      const active = new Set(states);
      return [...contracts.values()].filter(({ eligibleStates }) =>
        eligibleStates.some((state) => active.has(state)),
      );
    },
  });
}
