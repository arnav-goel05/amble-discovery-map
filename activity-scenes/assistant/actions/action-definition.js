export const types = Object.freeze({
  id: { type: "string", minLength: 1, maxLength: 256 },
  text: { type: "string", minLength: 0, maxLength: 500 },
  boolean: { type: "boolean" },
  integer: { type: "integer", minimum: 0, maximum: 100 },
  number: { type: "number", minimum: -360, maximum: 360 },
});

export const objectSchema = (
  properties = {},
  required = Object.keys(properties),
) => ({ type: "object", additionalProperties: false, properties, required });
export const optional = (properties = {}) => objectSchema(properties, []);

const resultSchema = objectSchema({
  actionId: types.id,
  changed: types.boolean,
});

function commandExecutor(definition, { dispatch = null, commands = {} } = {}) {
  return async (argumentsValue, context, metadata) => {
    const command = commands[definition.actionId];
    const executor =
      typeof command === "function"
        ? command
        : (command?.execute ?? command?.direct);
    if (typeof dispatch !== "function" && typeof executor !== "function")
      throw new Error(`Direct command ${definition.actionId} is unavailable`);
    const value = await (dispatch
      ? dispatch(
          definition.actionId,
          structuredClone(argumentsValue),
          context,
          metadata,
        )
      : executor(structuredClone(argumentsValue), context, metadata));
    return {
      actionId: definition.actionId,
      changed: value?.changed !== false,
    };
  };
}

export function actionContracts(
  definitions,
  { dispatch = null, commands = {} } = {},
) {
  return definitions.map((definition) => ({
    actionId: definition.actionId,
    version: "1.0",
    description: definition.description,
    argumentSchema: definition.argumentSchema || objectSchema(),
    eligibleStates: definition.eligibleStates || ["application_ready"],
    confirmationClass: definition.confirmationClass || "reversible",
    contextProvider: definition.contextProvider,
    resultSchema,
    execute: commandExecutor(definition, { dispatch, commands }),
  }));
}

export function capabilityContracts(
  definitions,
  { connectorId, dispatch = null, commands = {} } = {},
) {
  if (typeof connectorId !== "string" || !connectorId)
    throw new TypeError("connectorId is required for capability contracts");
  return definitions.map((definition) => ({
    contract: {
      capabilityId: definition.actionId,
      version: "2.0",
      kind: "command",
      description: definition.description,
      connectorId,
      argumentSchema: definition.argumentSchema || objectSchema(),
      eligibleStates: definition.eligibleStates || ["application_ready"],
      confirmationClass: definition.confirmationClass || "reversible",
      contextProvider: definition.contextProvider,
      resultSchema,
      ...(definition.undoActionId
        ? { undoCapabilityId: definition.undoActionId }
        : {}),
    },
    runtime: {
      execute: commandExecutor(definition, { dispatch, commands }),
    },
  }));
}

export function registerContracts(registry, contracts) {
  for (const definition of contracts)
    registry.register(
      definition.contract || definition,
      definition.runtime || undefined,
    );
  return contracts;
}

export function parityCases(definitions) {
  return definitions.map((definition) => ({
    actionId: definition.actionId,
    argumentsValue: structuredClone(definition.sampleArguments || {}),
    context: {
      states: [...(definition.eligibleStates || ["application_ready"])],
      revision: 1,
    },
    result: { actionId: definition.actionId, changed: true },
  }));
}
