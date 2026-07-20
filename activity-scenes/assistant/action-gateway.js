import { ActionRegistryError, matchesSchema } from "./action-registry.js";

const fail = (code, message, details) => {
  throw new ActionRegistryError(code, message, details);
};

export function createActionGateway({
  registry,
  confirmationController = null,
  onExecuted = null,
} = {}) {
  if (!registry?.get) throw new TypeError("Action registry is required");

  return Object.freeze({
    async execute(actionId, argumentsValue = {}, context = {}, metadata = {}) {
      const contract = registry.get(actionId);
      const states = new Set(context.states || []);
      if (!contract.eligibleStates.some((state) => states.has(state)))
        fail(
          "action_ineligible",
          `Action ${actionId} is unavailable in the current state`,
        );
      if (!matchesSchema(argumentsValue, contract.argumentSchema))
        fail(
          "invalid_action_arguments",
          `Arguments for ${actionId} do not match its contract`,
        );

      if (contract.confirmationClass === "consequential") {
        if (!confirmationController?.request) {
          return Object.freeze({ status: "confirmation_required", actionId });
        }
        if (metadata.confirmation) {
          confirmationController.consume({
            actionId,
            canonicalArguments: argumentsValue,
            targetId:
              metadata.targetId ??
              argumentsValue.targetId ??
              argumentsValue.itemId ??
              null,
            contextRevision: context.revision,
            confirmationId: metadata.confirmation.confirmationId,
            fingerprint: metadata.confirmation.fingerprint,
          });
        } else {
          const confirmation = confirmationController.request({
            actionId,
            canonicalArguments: argumentsValue,
            targetId:
              metadata.targetId ??
              argumentsValue.targetId ??
              argumentsValue.itemId ??
              null,
            contextRevision: context.revision,
            effectSummary: metadata.effectSummary ?? contract.description,
          });
          return Object.freeze({
            status: "confirmation_required",
            actionId,
            confirmation,
          });
        }
      }

      const result = await contract.execute(
        structuredClone(argumentsValue),
        context,
        metadata,
      );
      if (!matchesSchema(result, contract.resultSchema))
        fail(
          "invalid_action_result",
          `Result for ${actionId} does not match its contract`,
        );
      const output = Object.freeze({
        status: "executed",
        actionId,
        result: structuredClone(result),
      });
      onExecuted?.(output, metadata);
      return output;
    },
    async executeCompound(actions, context = {}, metadata = {}) {
      const results = [];
      for (const action of actions) {
        const result = await this.execute(
          action.actionId,
          action.argumentsValue,
          context,
          {
            ...metadata,
            targetId: action.targetId,
            effectSummary: action.effectSummary,
          },
        );
        results.push(result);
        if (result.status === "confirmation_required") break;
      }
      return results;
    },
  });
}
