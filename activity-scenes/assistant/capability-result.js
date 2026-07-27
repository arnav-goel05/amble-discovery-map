const DRAFT_2020_12 = "https://json-schema.org/draft/2020-12/schema";
const CAPABILITY_ID = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/;
const RESULT_FIELDS = new Set([
  "capabilityId",
  "kind",
  "status",
  "changed",
  "affectedTargetIds",
  "contextRevision",
  "data",
  "errorCode",
]);
const STATUSES = new Set([
  "completed",
  "empty",
  "unavailable",
  "failed",
  "confirmation_required",
]);
const PUBLIC_ERROR_CODES = new Set([
  null,
  "invalid_arguments",
  "stale_context",
  "unknown_target",
  "unavailable",
  "confirmation_required",
  "execution_failed",
  "result_invalid",
]);
const CALLER_ORIGINS = new Set([
  "direct",
  "voice",
  "same_session_text",
  "mcp_fixture",
]);

export class SchemaContractError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = "SchemaContractError";
    this.code = "invalid_schema_contract";
    this.details = details;
  }
}

export class CapabilityResultError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "CapabilityResultError";
    this.code = code;
    this.details = details;
  }
}

export function normalizeInvocationContext(metadata = {}) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
    throw new CapabilityResultError(
      "invalid_invocation_context",
      "Capability invocation metadata must be an object",
    );
  const inferredOrigin =
    metadata.callerOrigin ??
    (["voice", "assistant"].includes(metadata.source)
      ? "voice"
      : metadata.source === "same_session_text"
        ? "same_session_text"
        : "direct");
  if (!CALLER_ORIGINS.has(inferredOrigin))
    throw new CapabilityResultError(
      "invalid_invocation_context",
      "Capability caller origin is invalid",
    );
  if (
    metadata.sessionId !== undefined &&
    (typeof metadata.sessionId !== "string" ||
      !metadata.sessionId ||
      metadata.sessionId.length > 128)
  )
    throw new CapabilityResultError(
      "invalid_invocation_context",
      "Capability invocation session identity is invalid",
    );
  return Object.freeze({
    ...metadata,
    callerOrigin: inferredOrigin,
  });
}

const schemaFail = (message, path, cause) => {
  throw new SchemaContractError(message, { path, cause });
};

function deepFreeze(value, seen = new WeakSet()) {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function") ||
    seen.has(value)
  )
    return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function schemaTypes(schema) {
  if (schema.type === undefined) return [];
  return Array.isArray(schema.type) ? schema.type : [schema.type];
}

function inspectBounds(schema, path, seen) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema))
    schemaFail("JSON Schema nodes must be objects", path);
  if (seen.has(schema)) return;
  seen.add(schema);
  if (schema.$schema !== undefined && schema.$schema !== DRAFT_2020_12)
    schemaFail("Schema must use JSON Schema Draft 2020-12", path);

  const types = schemaTypes(schema);
  if (types.includes("object") && schema.additionalProperties !== false)
    schemaFail("Object schemas must set additionalProperties to false", path);
  if (
    types.includes("string") &&
    schema.maxLength === undefined &&
    schema.enum === undefined &&
    schema.const === undefined
  )
    schemaFail("String schemas must have maxLength, enum, or const", path);
  if (types.includes("array")) {
    if (schema.maxItems === undefined)
      schemaFail("Array schemas must have maxItems", path);
    if (
      schema.items === undefined &&
      (!Array.isArray(schema.prefixItems) || !schema.prefixItems.length)
    )
      schemaFail("Array schemas must define items or prefixItems", path);
  }

  for (const [keyword, values] of [
    ["properties", schema.properties],
    ["patternProperties", schema.patternProperties],
    ["$defs", schema.$defs],
  ]) {
    for (const [name, child] of Object.entries(values || {}))
      inspectBounds(child, `${path}.${keyword}.${name}`, seen);
  }
  for (const keyword of ["items", "contains", "not", "if", "then", "else"]) {
    if (schema[keyword] && typeof schema[keyword] === "object")
      inspectBounds(schema[keyword], `${path}.${keyword}`, seen);
  }
  for (const keyword of ["prefixItems", "allOf", "anyOf", "oneOf"]) {
    for (const [index, child] of (schema[keyword] || []).entries())
      inspectBounds(child, `${path}.${keyword}[${index}]`, seen);
  }
}

const sameJsonValue = (left, right) =>
  JSON.stringify(left) === JSON.stringify(right);

function resolveLocalReference(root, reference) {
  if (typeof reference !== "string" || !reference.startsWith("#/"))
    schemaFail("Only local JSON Schema references are supported", "$.$ref");
  let current = root;
  for (const rawPart of reference.slice(2).split("/")) {
    const part = rawPart.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!current || typeof current !== "object" || !(part in current))
      schemaFail("JSON Schema reference does not resolve", "$.$ref");
    current = current[part];
  }
  return current;
}

function valueMatchesType(value, type) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object")
    return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number")
    return typeof value === "number" && Number.isFinite(value);
  return typeof value === type;
}

function validateSchemaValue(schema, value, root, instancePath, errors) {
  if (schema === true) return true;
  if (schema === false) {
    errors.push({ instancePath, keyword: "falseSchema" });
    return false;
  }
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    errors.push({ instancePath, keyword: "schema" });
    return false;
  }
  if (schema.$ref)
    return validateSchemaValue(
      resolveLocalReference(root, schema.$ref),
      value,
      root,
      instancePath,
      errors,
    );

  let valid = true;
  const record = (keyword) => {
    valid = false;
    errors.push({ instancePath, keyword });
  };
  if (schema.const !== undefined && !sameJsonValue(value, schema.const))
    record("const");
  if (
    Array.isArray(schema.enum) &&
    !schema.enum.some((candidate) => sameJsonValue(value, candidate))
  )
    record("enum");

  const types = schemaTypes(schema);
  if (types.length && !types.some((type) => valueMatchesType(value, type))) {
    record("type");
    return false;
  }

  for (const child of schema.allOf || [])
    if (!validateSchemaValue(child, value, root, instancePath, errors))
      valid = false;
  for (const keyword of ["anyOf", "oneOf"]) {
    if (!Array.isArray(schema[keyword])) continue;
    let matches = 0;
    for (const child of schema[keyword]) {
      const childErrors = [];
      if (validateSchemaValue(child, value, root, instancePath, childErrors))
        matches += 1;
    }
    if (
      (keyword === "anyOf" && matches === 0) ||
      (keyword === "oneOf" && matches !== 1)
    )
      record(keyword);
  }
  if (schema.not) {
    const childErrors = [];
    if (validateSchemaValue(schema.not, value, root, instancePath, childErrors))
      record("not");
  }
  if (schema.if) {
    const conditionErrors = [];
    const condition = validateSchemaValue(
      schema.if,
      value,
      root,
      instancePath,
      conditionErrors,
    );
    const branch = condition ? schema.then : schema.else;
    if (
      branch &&
      !validateSchemaValue(branch, value, root, instancePath, errors)
    )
      valid = false;
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength)
      record("minLength");
    if (schema.maxLength !== undefined && value.length > schema.maxLength)
      record("maxLength");
    if (schema.pattern !== undefined) {
      try {
        if (!new RegExp(schema.pattern).test(value)) record("pattern");
      } catch {
        schemaFail("JSON Schema pattern is invalid", "$.pattern");
      }
    }
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    if (schema.minimum !== undefined && value < schema.minimum)
      record("minimum");
    if (schema.maximum !== undefined && value > schema.maximum)
      record("maximum");
    if (
      schema.exclusiveMinimum !== undefined &&
      value <= schema.exclusiveMinimum
    )
      record("exclusiveMinimum");
    if (
      schema.exclusiveMaximum !== undefined &&
      value >= schema.exclusiveMaximum
    )
      record("exclusiveMaximum");
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems)
      record("minItems");
    if (schema.maxItems !== undefined && value.length > schema.maxItems)
      record("maxItems");
    if (
      schema.uniqueItems &&
      new Set(value.map((item) => JSON.stringify(item))).size !== value.length
    )
      record("uniqueItems");
    for (const [index, child] of (schema.prefixItems || []).entries()) {
      if (
        index < value.length &&
        !validateSchemaValue(
          child,
          value[index],
          root,
          `${instancePath}/${index}`,
          errors,
        )
      )
        valid = false;
    }
    if (schema.items && !Array.isArray(schema.items))
      for (const [index, item] of value.entries())
        if (
          !validateSchemaValue(
            schema.items,
            item,
            root,
            `${instancePath}/${index}`,
            errors,
          )
        )
          valid = false;
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const properties = schema.properties || {};
    const required = schema.required || [];
    for (const name of required)
      if (!Object.hasOwn(value, name)) record("required");
    if (
      schema.maxProperties !== undefined &&
      Object.keys(value).length > schema.maxProperties
    )
      record("maxProperties");
    for (const [name, childValue] of Object.entries(value)) {
      const childPath = `${instancePath}/${name.replaceAll("~", "~0").replaceAll("/", "~1")}`;
      if (properties[name]) {
        if (
          !validateSchemaValue(
            properties[name],
            childValue,
            root,
            childPath,
            errors,
          )
        )
          valid = false;
        continue;
      }
      let matchedPattern = false;
      for (const [pattern, childSchema] of Object.entries(
        schema.patternProperties || {},
      )) {
        if (!new RegExp(pattern).test(name)) continue;
        matchedPattern = true;
        if (
          !validateSchemaValue(childSchema, childValue, root, childPath, errors)
        )
          valid = false;
      }
      if (!matchedPattern && schema.additionalProperties === false)
        record("additionalProperties");
    }
    if (schema.propertyNames)
      for (const name of Object.keys(value))
        if (
          !validateSchemaValue(
            schema.propertyNames,
            name,
            root,
            `${instancePath}/${name}`,
            errors,
          )
        )
          valid = false;
  }
  return valid;
}

export function compileSchema(
  schema,
  { requireClosedRoot = true, requireBounds = true } = {},
) {
  const root = structuredClone(schema);
  if (
    !root ||
    typeof root !== "object" ||
    Array.isArray(root) ||
    (requireClosedRoot &&
      (root.type !== "object" || root.additionalProperties !== false))
  )
    schemaFail("Schema root must be a closed object", "$");
  if (requireBounds) inspectBounds(root, "$", new WeakSet());
  else if (root.$schema !== undefined && root.$schema !== DRAFT_2020_12)
    schemaFail("Schema must use JSON Schema Draft 2020-12", "$");

  return Object.freeze((value) => {
    const errors = [];
    const valid = validateSchemaValue(root, value, root, "", errors);
    return Object.freeze({
      valid,
      errors: valid ? [] : structuredClone(errors),
    });
  });
}

function failEnvelope(message) {
  throw new CapabilityResultError("invalid_result_envelope", message);
}

function assertEnvelope(result, contract, proposalRevision) {
  if (!result || typeof result !== "object" || Array.isArray(result))
    failEnvelope("Capability result must be an object");
  if (
    Object.keys(result).some((field) => !RESULT_FIELDS.has(field)) ||
    [...RESULT_FIELDS].some((field) => !Object.hasOwn(result, field))
  )
    failEnvelope("Capability result fields do not match the common envelope");
  if (
    result.capabilityId !== contract.capabilityId ||
    result.kind !== contract.kind ||
    !CAPABILITY_ID.test(result.capabilityId)
  )
    failEnvelope("Capability result identity does not match its contract");
  if (!STATUSES.has(result.status) || !PUBLIC_ERROR_CODES.has(result.errorCode))
    failEnvelope("Capability result status or public error is invalid");
  if (
    (result.kind === "query" && result.changed !== null) ||
    (result.kind === "command" && typeof result.changed !== "boolean")
  )
    failEnvelope("Capability result changed state is invalid");
  if (
    !Array.isArray(result.affectedTargetIds) ||
    result.affectedTargetIds.length > 20 ||
    new Set(result.affectedTargetIds).size !==
      result.affectedTargetIds.length ||
    result.affectedTargetIds.some(
      (id) => typeof id !== "string" || !id || id.length > 256,
    ) ||
    !Number.isInteger(result.contextRevision) ||
    result.contextRevision < 0
  )
    failEnvelope("Capability result targets or context revision are invalid");

  const expectedError = {
    completed: null,
    empty: null,
    unavailable: "unavailable",
    confirmation_required: "confirmation_required",
  }[result.status];
  if (
    (expectedError !== undefined && result.errorCode !== expectedError) ||
    (result.status === "failed" && result.errorCode === null)
  )
    failEnvelope("Capability result error does not match its status");
  if (
    ["unavailable", "failed", "confirmation_required"].includes(
      result.status,
    ) &&
    result.data !== null
  )
    failEnvelope("Non-data results must not include capability data");
  if (
    result.data !== null &&
    (typeof result.data !== "object" || Array.isArray(result.data))
  )
    failEnvelope("Capability result data must be an object or null");
  if (result.status === "completed" && result.data === null)
    failEnvelope("Completed capability results require data");
  if (
    Number.isInteger(proposalRevision) &&
    result.kind === "command" &&
    result.changed &&
    result.contextRevision <= proposalRevision
  )
    throw new CapabilityResultError(
      "stale_result_context",
      "Changed commands require a newer context revision",
    );
  if (
    Number.isInteger(proposalRevision) &&
    result.contextRevision < proposalRevision
  )
    throw new CapabilityResultError(
      "stale_result_context",
      "Capability result context predates its proposal",
    );
}

export function createCapabilityResultValidator(contract) {
  if (
    !contract ||
    typeof contract !== "object" ||
    typeof contract.capabilityId !== "string" ||
    !["query", "command"].includes(contract.kind)
  )
    throw new CapabilityResultError(
      "invalid_result_contract",
      "Capability result validator requires a typed contract",
    );
  const validateData = compileSchema(contract.resultSchema);

  return Object.freeze((result, { proposalRevision } = {}) => {
    assertEnvelope(result, contract, proposalRevision);
    if (result.data !== null) {
      const validation = validateData(result.data);
      if (!validation.valid)
        throw new CapabilityResultError(
          "result_schema_mismatch",
          `Result data for ${contract.capabilityId} violates its schema`,
          validation.errors,
        );
    }
    return deepFreeze(structuredClone(result));
  });
}

export function validateCapabilityResult(contract, result, options) {
  return createCapabilityResultValidator(contract)(result, options);
}
