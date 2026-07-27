import { ActionRegistryError, matchesSchema } from "./action-registry.js";
import { normalizeInvocationContext } from "./capability-result.js";

const fail = (code, message, details) => {
  throw new ActionRegistryError(code, message, details);
};

const canonical = (value) => JSON.stringify(value);

function targetId(argumentsValue, metadata) {
  return (
    metadata.targetId ??
    metadata.targetIds?.[0] ??
    argumentsValue.targetId ??
    argumentsValue.itemId ??
    null
  );
}

function registeredTargets(context) {
  return new Set([
    ...(context.registeredTargetIds || []),
    ...(context.selectedTargetIds || []),
    ...(context.focusedTargetId ? [context.focusedTargetId] : []),
    ...(context.visibleTargets || []).map((target) =>
      typeof target === "string" ? target : target.targetId,
    ),
  ]);
}

function validateProposalTargets(context, metadata) {
  const proposed = [
    ...(metadata.targetIds || []),
    ...(metadata.targetId ? [metadata.targetId] : []),
  ];
  if (!proposed.length) return;
  const registered = registeredTargets(context);
  if (
    registered.size &&
    proposed.some((id) => typeof id !== "string" || !id || !registered.has(id))
  )
    fail(
      "unknown_target",
      "Capability proposal contains an unregistered target",
      { targetIds: proposed },
    );
}

function createLegacyExecutor({
  registry,
  confirmationController,
  onExecuted,
}) {
  return async (actionId, argumentsValue, context, metadata) => {
    let consumedConfirmation = null;
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
      if (!confirmationController?.request)
        return Object.freeze({ status: "confirmation_required", actionId });
      if (metadata.confirmation) {
        consumedConfirmation = confirmationController.consume({
          callId: metadata.callId,
          actionId,
          canonicalArguments: argumentsValue,
          targetId: targetId(argumentsValue, metadata),
          contextRevision: context.revision,
          confirmationId: metadata.confirmation.confirmationId,
          fingerprint: metadata.confirmation.fingerprint,
        });
        if (
          consumedConfirmation?.status === "executed" &&
          consumedConfirmation.terminalResult
        )
          return structuredClone(consumedConfirmation.terminalResult);
      } else {
        const confirmation = confirmationController.request({
          callId: metadata.callId,
          actionId,
          canonicalArguments: argumentsValue,
          targetId: targetId(argumentsValue, metadata),
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
    if (consumedConfirmation)
      confirmationController.completeExecution?.({
        confirmationId: consumedConfirmation.confirmationId,
        fingerprint: consumedConfirmation.fingerprint,
        terminalResult: output,
      });
    onExecuted?.(output, metadata);
    return output;
  };
}

export function createActionGateway({
  registry,
  confirmationController = null,
  onExecuted = null,
} = {}) {
  if (!registry?.get) throw new TypeError("Action registry is required");
  const v2 = Boolean(registry.invoke && registry.isEligible);
  const executeLegacy = createLegacyExecutor({
    registry,
    confirmationController,
    onExecuted,
  });
  let pendingConfirmation = null;
  let executionTail = Promise.resolve();

  const executeV2 = async (capabilityId, argumentsValue, context, metadata) => {
    const invocation = normalizeInvocationContext(metadata);
    let consumedConfirmation = null;
    const contract = registry.get(capabilityId);
    const proposalRevision =
      invocation.proposalRevision === undefined
        ? context.revision
        : invocation.proposalRevision;
    if (
      !Number.isInteger(proposalRevision) ||
      proposalRevision < 0 ||
      proposalRevision !== context.revision
    )
      fail(
        "stale_context",
        `Capability ${capabilityId} was proposed against stale context`,
        { proposalRevision, contextRevision: context.revision },
      );
    if (!registry.isEligible(capabilityId, context))
      fail(
        "capability_ineligible",
        `Capability ${capabilityId} is unavailable in the current state`,
      );
    if (!matchesSchema(argumentsValue, contract.argumentSchema))
      fail(
        "invalid_capability_arguments",
        `Arguments for ${capabilityId} do not match its contract`,
      );
    validateProposalTargets(context, invocation);

    const expiredConfirmation = confirmationController?.expirePending?.();
    if (
      expiredConfirmation &&
      pendingConfirmation?.confirmationId ===
        expiredConfirmation.confirmationId &&
      pendingConfirmation.fingerprint === expiredConfirmation.fingerprint
    )
      pendingConfirmation = null;

    if (pendingConfirmation) {
      const matches =
        invocation.confirmation &&
        pendingConfirmation.capabilityId === capabilityId &&
        pendingConfirmation.argumentsKey === canonical(argumentsValue) &&
        pendingConfirmation.proposalRevision === proposalRevision;
      if (!matches)
        fail(
          "dependent_call_blocked",
          `Capability ${pendingConfirmation.capabilityId} is awaiting confirmation`,
        );
    }

    if (
      contract.kind === "command" &&
      contract.confirmationClass === "consequential"
    ) {
      if (!confirmationController?.request)
        return Object.freeze({
          status: "confirmation_required",
          capabilityId,
          actionId: capabilityId,
        });
      if (invocation.confirmation) {
        consumedConfirmation = confirmationController.consume({
          callId: invocation.callId,
          actionId: capabilityId,
          capabilityId,
          canonicalArguments: argumentsValue,
          targetId: targetId(argumentsValue, invocation),
          contextRevision: proposalRevision,
          confirmationId: invocation.confirmation.confirmationId,
          fingerprint: invocation.confirmation.fingerprint,
        });
        pendingConfirmation = null;
        if (
          consumedConfirmation?.status === "executed" &&
          consumedConfirmation.terminalResult
        )
          return structuredClone(consumedConfirmation.terminalResult);
      } else {
        const confirmation = confirmationController.request({
          callId: invocation.callId,
          actionId: capabilityId,
          capabilityId,
          canonicalArguments: argumentsValue,
          targetId: targetId(argumentsValue, invocation),
          contextRevision: proposalRevision,
          effectSummary: invocation.effectSummary ?? contract.description,
        });
        pendingConfirmation = {
          capabilityId,
          argumentsKey: canonical(argumentsValue),
          proposalRevision,
          confirmationId: confirmation.confirmationId,
          fingerprint: confirmation.fingerprint,
        };
        return Object.freeze({
          status: "confirmation_required",
          capabilityId,
          actionId: capabilityId,
          confirmation,
        });
      }
    }

    const output = await registry.invoke(
      capabilityId,
      structuredClone(argumentsValue),
      context,
      { ...invocation, proposalRevision },
    );
    if (consumedConfirmation)
      confirmationController.completeExecution?.({
        confirmationId: consumedConfirmation.confirmationId,
        fingerprint: consumedConfirmation.fingerprint,
        terminalResult: output,
      });
    onExecuted?.(output, invocation);
    return output;
  };

  const execute = (
    actionId,
    argumentsValue = {},
    context = {},
    metadata = {},
  ) => {
    if (!v2) return executeLegacy(actionId, argumentsValue, context, metadata);
    const operation = () =>
      executeV2(actionId, argumentsValue, context, metadata);
    const result = executionTail.then(operation, operation);
    executionTail = result.catch(() => {});
    return result;
  };

  return Object.freeze({
    execute,
    releasePendingConfirmation({ confirmationId, fingerprint } = {}) {
      if (
        !pendingConfirmation ||
        pendingConfirmation.confirmationId !== confirmationId ||
        pendingConfirmation.fingerprint !== fingerprint
      )
        return false;
      pendingConfirmation = null;
      return true;
    },
    async executeCompound(actions, context = {}, metadata = {}) {
      const results = [];
      for (const action of actions) {
        const result = await execute(
          action.actionId ?? action.capabilityId,
          action.argumentsValue,
          context,
          {
            ...metadata,
            targetId: action.targetId,
            targetIds: action.targetIds,
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
