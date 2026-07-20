import {
  createDiscoveryIntent,
  refineDiscoveryIntent,
} from "./conversation-model.js";
import { validateDiscoveryResult } from "./discovery-model.js";
import { matchLocalDiscovery } from "./local-discovery.js";
import { createAssistantView } from "./assistant-view.js";
import { createAreaController } from "./area-controller.js";
import { createActionGateway } from "./action-gateway.js";
import { createActionRegistry } from "./action-registry.js";
import { createPublicActionContracts } from "./actions/index.js";
import { createAudioController } from "./audio-controller.js";
import { createRealtimeRelayClient } from "./realtime-relay-client.js";
import { createConfirmationController } from "./confirmation-controller.js";
import { createInterfaceContext } from "./interface-context.js";
import {
  createBrowserPcmCapture,
  createBrowserPcmPlayback,
} from "./browser-audio-io.js";

const EMPTY_ENVELOPE = Object.freeze({
  schemaVersion: "1.0",
  sourceSnapshotId: "empty",
  generatedAt: new Date(0).toISOString(),
  candidates: [],
  sources: [],
});
export const ASSISTANT_OWNED_ACTION_IDS = Object.freeze([
  "map.openarea",
  "map.selectarea",
  "map.compareareas",
  "map.dismissarea",
  "navigation.openassistant",
  "navigation.closeassistant",
]);

export function createAssistantController({
  getCandidateEnvelope,
  getTransitStations = () => [],
  onSelectCandidate,
  areaLayerManager = null,
  dispatchAction = null,
  locationController = null,
  relayClientFactory = createRealtimeRelayClient,
  audioControllerFactory = createAudioController,
  captureFactory = createBrowserPcmCapture,
  audioPlayback = createBrowserPcmPlayback(),
} = {}) {
  let relay = null;
  let audioController = null;
  let sessionStarted = false;
  let relayReady = false;
  let localMode = false;
  let muted = false;
  let turn = 0;
  let activeTurnId = null;
  let turnReady = false;
  let commitPending = false;
  let queuedAudio = [];
  let bargeInPending = false;
  let bargeInSpeechEnded = false;
  let explicitBargeIn = false;
  let pendingAction = null;
  let intent = createDiscoveryIntent();

  const envelope = () =>
    getCandidateEnvelope?.() ||
    globalThis.__ASSISTANT_APPROVED_CANDIDATES__ ||
    EMPTY_ENVELOPE;

  const confirmationController = createConfirmationController();
  const interfaceContext = createInterfaceContext({
    visibleTargets: [],
    selectedTargetIds: [],
    activeOverlayId: null,
    locationState: locationController?.snapshot?.() || undefined,
    transitVisible: document.body.dataset.transitVisible !== "false",
    transitConstraintActive: false,
    availableActionIds: [],
  });

  const areaController = createAreaController({
    getCandidates: () => envelope().candidates,
    layerManager: areaLayerManager,
  });

  function applicationStates() {
    const states = new Set(["application_ready", "map_ready"]);
    if (areaController.snapshot().areas.length)
      states.add("area_recommendations_visible");
    if (document.body.dataset.restaurantCount !== "0")
      states.add("restaurant_ready");
    if (document.body.dataset.planBuilder === "mounted")
      states.add("plan_ready");
    if (document.body.dataset.restaurantDetailOpen === "true")
      states.add("overlay_open");
    return [...states];
  }

  function syncContext(patch = {}) {
    const states = applicationStates();
    const snapshot = interfaceContext.update({
      ...patch,
      availableActionIds: registry
        ? registry.available(states).map(({ actionId }) => actionId)
        : patch.availableActionIds || [],
    });
    if (relayReady) relay?.updateContext?.(snapshot);
    return snapshot;
  }

  function openArea(areaId) {
    const drillDown = areaController.openArea(areaId);
    if (!drillDown) return false;
    document.body.dataset.selectedDiscoveryArea = areaId;
    view.selectArea(areaId, drillDown.candidates);
    syncContext({
      visibleTargets: drillDown.candidates.map((candidate) => ({
        targetId: candidate.candidateId,
        type: candidate.candidateType,
        label: candidate.attributes?.name || candidate.candidateId,
      })),
      selectedTargetIds: [],
      focusedTargetId: null,
      activeOverlayId: "assistant",
    });
    return true;
  }

  const registry = createActionRegistry(
    createPublicActionContracts({
      dispatch(actionId, argumentsValue, context, metadata) {
        if (actionId === "map.openarea" || actionId === "map.selectarea")
          return { changed: openArea(argumentsValue.areaId) };
        if (actionId === "map.compareareas") {
          const compared = areaController.compareAreas(argumentsValue.areaIds);
          view.showAreaComparison?.(compared);
          return { changed: compared.length >= 2 };
        }
        if (actionId === "map.dismissarea") {
          const changed = areaController.dismissArea(argumentsValue.areaId);
          if (changed) view.removeArea?.(argumentsValue.areaId);
          return { changed };
        }
        if (actionId === "navigation.closeassistant") {
          view.setOpen(false);
          return { changed: true };
        }
        if (actionId === "navigation.openassistant") {
          view.setOpen(true);
          return { changed: true };
        }
        return (
          dispatchAction?.(actionId, argumentsValue, context, metadata) ?? {
            changed: false,
          }
        );
      },
    }),
  );
  syncContext({ availableActionIds: registry.ids() });
  const gateway = createActionGateway({ registry, confirmationController });

  const handleDiscovery = (result) => {
    try {
      const validated = validateDiscoveryResult(result, envelope());
      areaController.reconcile(validated.areas);
      view.renderDiscovery(validated);
      syncContext({
        visibleTargets: validated.areas.map((area) => ({
          targetId: area.areaId,
          type: "area",
          label: area.areaId.replace(/^ura-subzone:/, "").replaceAll("-", " "),
        })),
        activeOverlayId: "assistant",
      });
    } catch {
      view.showError(
        "That suggestion was not grounded in approved map options. Try refining your request.",
      );
    }
  };

  async function executeProposedAction(message, confirmation = null) {
    let output;
    try {
      const context = interfaceContext.snapshot();
      output = await gateway.execute(
        message.actionId,
        message.canonicalArguments ?? message.arguments ?? {},
        {
          ...context,
          states: applicationStates(),
          revision: context.revision,
        },
        {
          source: "voice",
          targetId: message.targetId,
          effectSummary: message.effectSummary,
          confirmation,
        },
      );
      if (output.status === "confirmation_required") {
        pendingAction = { message, confirmation: output.confirmation };
        view.showConfirmation(output.confirmation);
        return output;
      }
    } catch (error) {
      output = {
        status: "failed",
        actionId: message.actionId,
        error: error.code || "action_failed",
      };
    }
    relay?.returnActionResult?.({
      callId: message.callId,
      actionId: message.actionId,
      ok: output.status === "executed",
      result: output,
    });
    return output;
  }

  async function resolveConfirmation(record, decision) {
    if (
      !pendingAction ||
      record.confirmationId !== pendingAction.confirmation.confirmationId
    )
      return;
    const resolved = confirmationController.resolve({
      confirmationId: record.confirmationId,
      fingerprint: record.fingerprint,
      decision,
      inputSource: "user",
      inputStatus: "final",
    });
    view.clearConfirmation();
    const action = pendingAction;
    pendingAction = null;
    if (resolved.status === "accepted")
      await executeProposedAction(action.message, {
        confirmationId: record.confirmationId,
        fingerprint: record.fingerprint,
      });
  }

  const onRelayEvent = (message) => {
    if (message.type === "session.state") {
      relayReady = message.state === "listening";
      view.setVoiceState(message.state);
      if (relayReady) relay.updateContext?.(interfaceContext.snapshot());
      if (relayReady && bargeInPending) {
        const commitAfterReady = bargeInSpeechEnded;
        bargeInPending = false;
        bargeInSpeechEnded = false;
        startReservedAudioTurn({
          preserveQueuedAudio: true,
          commitAfterReady,
        });
      }
    }
    if (message.type === "turn.ready" && message.turnId === activeTurnId) {
      turnReady = true;
      for (const audio of queuedAudio) relay.appendAudio(activeTurnId, audio);
      queuedAudio = [];
      if (commitPending) finishAudioTurn();
    }
    if (
      [
        "transcript.delta",
        "transcript.final",
        "assistant.text.delta",
        "assistant.text.done",
      ].includes(message.type)
    )
      view.reconcileTranscript(message);
    if (
      message.type === "transcript.final" &&
      message.role === "user" &&
      message.text
    )
      recordUserRequest(message.text);
    if (
      message.type === "action.proposed" &&
      message.actionId === "discovery.presentareas"
    )
      handleDiscovery(
        message.canonicalArguments?.result ?? message.arguments?.result,
      );
    else if (message.type === "action.proposed")
      void executeProposedAction(message);
    if (message.type === "error")
      view.showError(
        message.message || "Voice is unavailable. Please try again.",
      );
    if (message.type === "session.stopped")
      stopVoice(message.reason, { notifyRelay: false });
  };

  function startReservedAudioTurn({
    preserveQueuedAudio = false,
    commitAfterReady = false,
  } = {}) {
    if (!relayReady || muted || activeTurnId) return false;
    activeTurnId = `audio-${++turn}`;
    turnReady = false;
    commitPending = commitAfterReady;
    if (!preserveQueuedAudio) queuedAudio = [];
    relay.cancelPlayback();
    relay.requestTurn(activeTurnId);
    view.setVoiceState("listening");
    return true;
  }

  function beginAudioTurn() {
    if (muted || activeTurnId) return false;
    if (relayReady) return startReservedAudioTurn();
    if (!explicitBargeIn) return false;
    if (!sessionStarted || bargeInPending) return false;
    bargeInPending = true;
    bargeInSpeechEnded = false;
    queuedAudio = [];
    relay?.cancelPlayback?.();
    try {
      relay?.cancelResponse?.();
    } catch {
      bargeInPending = false;
      return false;
    }
    view.setVoiceState("listening");
    return true;
  }

  function finishAudioTurn() {
    if (bargeInPending) {
      bargeInSpeechEnded = true;
      explicitBargeIn = false;
      return false;
    }
    if (!activeTurnId) return false;
    if (!turnReady) {
      commitPending = true;
      return false;
    }
    relayReady = false;
    relay.commitAudio(activeTurnId);
    activeTurnId = null;
    turnReady = false;
    commitPending = false;
    queuedAudio = [];
    explicitBargeIn = false;
    view.setVoiceState("processing");
    return true;
  }

  function createSessionAudioController() {
    return audioControllerFactory({
      captureFactory,
      onChunk(audio) {
        if (muted) return;
        if (bargeInPending && !activeTurnId) {
          if (queuedAudio.length < 32) queuedAudio.push(audio);
          return;
        }
        if (!activeTurnId) return;
        if (turnReady) relay.appendAudio(activeTurnId, audio);
        else if (queuedAudio.length < 8) queuedAudio.push(audio);
      },
      onSpeechStart: beginAudioTurn,
      onSpeechEnd: finishAudioTurn,
      cancelPlayback: () => relay?.cancelPlayback?.(),
      onStateChange(snapshot) {
        if (snapshot.state === "listening" && muted)
          view.setVoiceState("muted");
      },
      onTerminal(reason) {
        if (reason === "permission" && sessionStarted) {
          stopVoice("permission");
          view.showError(
            "Microphone permission ended. Allow microphone access and try again.",
          );
        }
      },
    });
  }

  const startVoice = async ({ disclosureAccepted = false } = {}) => {
    if (sessionStarted) return;
    sessionStarted = true;
    localMode = false;
    relayReady = false;
    view.setVoiceState("connecting");
    try {
      relay = relayClientFactory({
        audioPlayback,
        onEvent: onRelayEvent,
        onStateChange: ({ state }) => view.setVoiceState(state),
      });
      await relay.admit({ disclosureAccepted });
      relay.connect();
      audioController = createSessionAudioController();
      await audioController.start({ disclosureAccepted });
    } catch (error) {
      if (audioController?.snapshot().state !== "stopped")
        audioController?.stop(
          error?.code === "permission" ? "permission" : "provider",
        );
      relay?.stop?.(error?.code === "permission" ? "permission" : "provider");
      relay = null;
      audioController = null;
      sessionStarted = false;
      localMode = true;
      view.setVoiceState("degraded");
      view.showError(
        error.message || "Voice could not connect. Please try again.",
      );
    }
  };

  const recordUserRequest = (text) => {
    intent = intent.freeTextSummary
      ? refineDiscoveryIntent(intent, { freeTextSummary: text })
      : createDiscoveryIntent({
          freeTextSummary: text,
          interests: text.split(/\s+/),
          specificity: "area",
        });
    if (/\b(?:mrt|train|public transport|transit)\b/i.test(text)) {
      intent = refineDiscoveryIntent(intent, {
        transitConstraint: { mode: "mrt", explicitlyRequested: true },
      });
      document.body.dataset.transitConstraintActive = "true";
      syncContext({ transitConstraintActive: true });
    }
  };

  const submitText = (text) => {
    view.appendTranscript("user", text);
    recordUserRequest(text);
    if (relayReady) {
      relay.submitText(`text-${++turn}`, text);
      return;
    }
    localMode = true;
    handleDiscovery(
      matchLocalDiscovery(intent, envelope(), {
        transitStations: getTransitStations(),
      }),
    );
    view.showLocalFallback();
  };

  const view = createAssistantView({
    onStartVoice: startVoice,
    onStopVoice: (reason) => stopVoice(reason),
    onPushToTalkStart: () => {
      explicitBargeIn = true;
      if (audioController?.beginPushToTalk() === false) explicitBargeIn = false;
    },
    onPushToTalkEnd: () => {
      audioController?.endPushToTalk();
      explicitBargeIn = false;
    },
    onInterrupt: () => {
      confirmationController.invalidate("interruption");
      pendingAction = null;
      view.clearConfirmation();
      relay?.cancelPlayback?.();
      explicitBargeIn = true;
      if (audioController?.setVadState("speech_started") === false)
        explicitBargeIn = false;
    },
    onToggleMute: (nextMuted) => {
      muted = nextMuted;
      audioController?.setMuted?.(muted);
      view.setVoiceState(muted ? "muted" : "listening");
    },
    onConfirmation: resolveConfirmation,
    onSelectArea: openArea,
    onCompareAreas: (areaIds) => {
      const compared = areaController.compareAreas(areaIds);
      view.showAreaComparison(compared);
    },
    onDismissArea: (areaId) => {
      if (areaController.dismissArea(areaId)) view.removeArea(areaId);
    },
    onSelectCandidate: (candidateId, areaId) => {
      onSelectCandidate?.(candidateId, areaId);
      syncContext({
        focusedTargetId: candidateId,
        selectedTargetIds: [candidateId],
      });
    },
    onClarification: submitText,
  });

  function stopVoice(reason = "user", { notifyRelay = true } = {}) {
    if (!sessionStarted && !relay && !audioController) return;
    if (notifyRelay) relay?.stop?.(reason);
    if (audioController?.snapshot().state !== "stopped")
      audioController?.stop(reason);
    relay = null;
    audioController = null;
    sessionStarted = false;
    relayReady = false;
    activeTurnId = null;
    queuedAudio = [];
    bargeInPending = false;
    bargeInSpeechEnded = false;
    explicitBargeIn = false;
    pendingAction = null;
    confirmationController.invalidate(reason);
    view.clearSession();
    view.setVoiceState("stopped");
    intent = createDiscoveryIntent();
    delete document.body.dataset.transitConstraintActive;
    syncContext({
      visibleTargets: [],
      focusedTargetId: null,
      selectedTargetIds: [],
      activeOverlayId: null,
      transitConstraintActive: false,
      locationState: locationController?.snapshot?.() || undefined,
    });
  }

  const onPageHide = () => stopVoice("pagehide");
  window.addEventListener("pagehide", onPageHide);

  return Object.freeze({
    id: "conversational-assistant",
    get intent() {
      return intent;
    },
    get localMode() {
      return localMode;
    },
    refreshCandidates: envelope,
    startVoice,
    stopVoice,
    submitText,
    contextSnapshot: () => interfaceContext.snapshot(),
    executeAction: (actionId, argumentsValue = {}, context = {}) =>
      gateway.execute(
        actionId,
        argumentsValue,
        {
          ...interfaceContext.snapshot(),
          ...context,
          states: context.states || applicationStates(),
        },
        { source: "direct" },
      ),
    finalize() {
      stopVoice("pagehide");
      window.removeEventListener("pagehide", onPageHide);
      audioPlayback?.close?.();
      view.destroy();
    },
  });
}
