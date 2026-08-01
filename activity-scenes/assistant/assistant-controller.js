import {
  createDiscoveryIntent,
  refineDiscoveryIntent,
} from "./conversation-model.js";
import { validateDiscoveryResult } from "./discovery-model.js";
import { createAssistantView } from "./assistant-view.js";
import { createAreaController } from "./area-controller.js";
import { createActionGateway } from "./action-gateway.js";
import { createCapabilityRegistry } from "./capability-registry.js";
import { createPublicActionContracts } from "./actions/index.js";
import { createContextCoordinator } from "./context-coordinator.js";
import {
  createApplicationStateConnector,
  createApprovedCatalogConnector,
  createDiscoveryAreaConnector,
  createEventApplyQueryCapabilityDefinition,
  createEventConnector,
  createLegacyCommandCapabilityDefinitions,
  createLegacyConnectorDescriptors,
  createLocationConnector,
  createMapConnector,
  createOverlayNavigationConnector,
  createPlanConnector,
  createRestaurantConnector,
  createTourConnector,
  createTransitConnector,
} from "./connectors/index.js";
import { createFoundationalQueryDefinitions } from "./queries/index.js";
import { createAudioController } from "./audio-controller.js";
import { createRealtimeRelayClient } from "./realtime-relay-client.js";
import { createSessionLifecycleRouter } from "./session-lifecycle-router.js";
import { createDomainIntentRouter } from "./interpreters/domain-intent-router.js";
import { interpretEventQuery } from "./interpreters/event-query-interpreter.js";
import { interpretObviousCommand } from "./interpreters/obvious-command-interpreter.js";
import { selectCapabilityTurnScope } from "./capability-turn-scope.js";
import { normalizeOptionLabel } from "../events/event-filter-options.js";
import { createConfirmationController } from "./confirmation-controller.js";
import { createInterfaceContext } from "./interface-context.js";
import {
  createBrowserPcmCapture,
  createBrowserPcmPlayback,
  createPostPlaybackSpeechGuard,
} from "./browser-audio-io.js";
export { ASSISTANT_OWNED_ACTION_IDS } from "./assistant-owned-actions.js";

const EMPTY_ENVELOPE = Object.freeze({
  schemaVersion: "1.0",
  sourceSnapshotId: "empty",
  generatedAt: new Date(0).toISOString(),
  candidates: [],
  sources: [],
});
export function createAssistantController({
  voiceUiEnabled = true,
  getCandidateEnvelope,
  getTransitStations = () => [],
  onSelectCandidate,
  map = null,
  areaLayerManager = null,
  locationLayers = null,
  transitLayers = null,
  eventController = null,
  restaurantController = null,
  planningController = null,
  featureTour = null,
  mapGuidanceController = null,
  experienceIntro = null,
  dispatchAction = null,
  locationController = null,
  relayClientFactory = createRealtimeRelayClient,
  audioControllerFactory = createAudioController,
  captureFactory = createBrowserPcmCapture,
  audioPlayback = createBrowserPcmPlayback(),
  postPlaybackSpeechGuard = createPostPlaybackSpeechGuard(),
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
  let confirmationTimer = null;
  let activeCatalogPage = null;
  let lifecyclePending = false;
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
    assistantPresentation: null,
    locationState: locationController?.snapshot?.() || undefined,
    transitVisible: document.body.dataset.transitVisible !== "false",
    transitConstraintActive: false,
    availableActionIds: [],
  });
  const contextListeners = new Set();
  const interfaceContextSource = Object.freeze({
    connectorId: "interface-context",
    snapshot() {
      const snapshot = interfaceContext.snapshot();
      return {
        ...snapshot,
        location: snapshot.locationState,
        transit: {
          visible: snapshot.transitVisible,
          constraintActive: snapshot.transitConstraintActive,
        },
        availableCapabilityIds: snapshot.availableActionIds,
      };
    },
    subscribe(listener) {
      contextListeners.add(listener);
      return () => contextListeners.delete(listener);
    },
  });
  const approvedCatalogConnector = createApprovedCatalogConnector({
    providers: [
      {
        connectorId: "approved-candidates",
        snapshot() {
          const current = envelope();
          return {
            revision: current.sourceSnapshotId,
            candidates: current.candidates,
          };
        },
      },
    ],
  });

  const areaController = createAreaController({
    getCandidates: () => envelope().candidates,
    layerManager: areaLayerManager,
  });
  const discoveryAreaOwner = Object.freeze({
    snapshot: () => areaController.snapshot(),
    subscribe: (...argumentsValue) =>
      areaController.subscribe(...argumentsValue),
    handleAction(capabilityId, argumentsValue) {
      if (capabilityId === "map.openarea" || capabilityId === "map.selectarea")
        return openArea(argumentsValue.areaId);
      if (capabilityId === "map.compareareas") {
        const compared = areaController.compareAreas(argumentsValue.areaIds);
        view.showAreaComparison?.(compared);
        return compared;
      }
      if (capabilityId === "map.dismissarea") {
        const changed = areaController.dismissArea(argumentsValue.areaId);
        if (changed) view.removeArea?.(argumentsValue.areaId);
        return changed;
      }
      return null;
    },
  });
  const discoveryAreaConnector = createDiscoveryAreaConnector({
    areaController: discoveryAreaOwner,
    areaLayerManager,
  });
  const locationConnector =
    locationController && locationLayers
      ? createLocationConnector({
          locationController,
          locationLayerManager: locationLayers,
          initialVisible: document.body.dataset.locationVisible !== "false",
        })
      : null;
  const transitConnector = transitLayers
    ? createTransitConnector({
        transitLayerManager: transitLayers,
        initialVisibility: {
          mrtStations: document.body.dataset.transitVisible !== "false",
          mrtLines: document.body.dataset.transitVisible !== "false",
        },
        initialConstraintActive:
          document.body.dataset.transitConstraintActive === "true",
      })
    : null;
  const eventConnector = eventController
    ? createEventConnector({ eventController })
    : null;
  const domainIntentRouter = createDomainIntentRouter({
    event: interpretEventQuery,
  });
  const restaurantConnector = restaurantController
    ? createRestaurantConnector({ restaurantController })
    : null;
  const planConnector = planningController
    ? createPlanConnector({
        planController: {
          snapshot: () => ({
            ...planningController.snapshot(),
            addableTargetIds: envelope()
              .candidates.filter(({ candidateType }) =>
                ["event", "restaurant"].includes(candidateType),
              )
              .map(({ candidateId }) => candidateId),
          }),
          subscribe: (...argumentsValue) =>
            planningController.subscribe(...argumentsValue),
          dispatch: (...argumentsValue) =>
            planningController.dispatch(...argumentsValue),
        },
      })
    : null;
  const tourConnector = featureTour
    ? createTourConnector({ tourController: featureTour })
    : null;
  let assistantNavigationOwner = null;
  const navigationListeners = new Set();
  const navigationUnsubscribers = [];
  const publishNavigation = () => {
    const snapshot = navigationOwner.snapshot();
    for (const listener of navigationListeners) listener(snapshot);
  };
  const navigationOwner = {
    attachAssistant(owner) {
      assistantNavigationOwner = owner;
      navigationUnsubscribers.push(owner.subscribe(publishNavigation));
      publishNavigation();
    },
    snapshot() {
      const guidance = mapGuidanceController?.snapshot?.() || {};
      const assistant = assistantNavigationOwner?.snapshot?.() || {};
      const eventState = eventController?.snapshot?.() || {};
      const restaurantState = restaurantController?.snapshot?.() || {};
      const planState = planningController?.snapshot?.() || {};
      const approvedLinks = {};
      for (const event of eventState.events || []) {
        const kinds = [];
        if (event.sourceOffers?.length) kinds.push("reference");
        if (event.routable) kinds.push("directions");
        if (kinds.length) approvedLinks[event.eventId] = kinds;
      }
      const selectedRestaurantId = restaurantState.selectedRestaurantId;
      if (selectedRestaurantId) {
        const kinds = [];
        if (restaurantState.referenceAvailable) kinds.push("reference");
        if (restaurantState.directionsAvailable) kinds.push("directions");
        if (restaurantState.deals?.[selectedRestaurantId]?.length)
          kinds.push("deal");
        if (kinds.length) approvedLinks[selectedRestaurantId] = kinds;
      }
      if (planState.routeAvailable && planState.planId)
        approvedLinks[planState.planId] = ["route"];
      const attributionOpen = guidance.attributionOpen === true;
      const assistantOpen = assistant.assistantOpen === true;
      return {
        introVisible: Boolean(
          document.getElementById("experience-intro") &&
          document.body.dataset.experienceIntro !== "dismissed",
        ),
        assistantOpen,
        attributionOpen,
        activeOverlayId: assistantOpen
          ? "assistant"
          : attributionOpen
            ? "map-attribution"
            : null,
        closableOverlayIds: [
          ...(assistantOpen ? ["assistant"] : []),
          ...(attributionOpen ? ["map-attribution"] : []),
        ],
        attributionReferenceIds: guidance.attributionReferenceIds || [],
        approvedLinks,
      };
    },
    subscribe(listener, { emitCurrent = false } = {}) {
      navigationListeners.add(listener);
      if (emitCurrent) listener(this.snapshot());
      return () => navigationListeners.delete(listener);
    },
    dispatch(capabilityId, args = {}) {
      let changed = false;
      if (capabilityId === "navigation.enterexperience")
        changed = experienceIntro?.enter?.() !== false;
      else if (
        capabilityId === "navigation.openassistant" ||
        capabilityId === "navigation.closeassistant"
      ) {
        changed =
          assistantNavigationOwner?.dispatch?.(capabilityId, args) !== false;
        if (changed && capabilityId === "navigation.closeassistant")
          syncContext({ assistantPresentation: null });
      } else if (capabilityId === "navigation.closeoverlay") {
        const overlayId = args.overlayId || this.snapshot().activeOverlayId;
        if (overlayId === "assistant")
          changed =
            assistantNavigationOwner?.dispatch?.(
              "navigation.closeassistant",
              {},
            ) !== false;
        else if (overlayId === "map-attribution")
          changed =
            mapGuidanceController?.dispatch?.(
              "navigation.closeattribution",
              {},
            ) !== false;
      } else if (
        capabilityId === "navigation.openattribution" ||
        capabilityId === "navigation.closeattribution" ||
        capabilityId === "navigation.openattributionreference"
      )
        changed =
          mapGuidanceController?.dispatch?.(capabilityId, args) !== false;
      else if (capabilityId === "navigation.openexternal") {
        if (args.targetId?.startsWith("event:"))
          changed =
            eventController?.dispatch?.(
              args.linkKind === "directions"
                ? "event.opendirections"
                : "event.openreference",
              { eventId: args.targetId },
            ) !== false;
        else if (args.targetId?.startsWith("restaurant:")) {
          const state = restaurantController?.snapshot?.() || {};
          const dealId = state.deals?.[args.targetId]?.[0];
          const actionId =
            args.linkKind === "directions"
              ? "restaurant.opendirections"
              : args.linkKind === "deal"
                ? "restaurant.opendealreference"
                : "restaurant.openreference";
          changed =
            restaurantController?.dispatch?.(actionId, {
              restaurantId: args.targetId,
              ...(dealId ? { dealId } : {}),
            }) !== false;
        } else if (args.linkKind === "route")
          changed =
            planningController?.dispatch?.("plan.openroute", {}) !== false;
      }
      if (changed) publishNavigation();
      return changed;
    },
    destroy() {
      for (const unsubscribe of navigationUnsubscribers.splice(0))
        unsubscribe();
      navigationListeners.clear();
    },
  };
  for (const owner of [
    mapGuidanceController,
    eventController,
    restaurantController,
    planningController,
  ])
    if (typeof owner?.subscribe === "function")
      navigationUnsubscribers.push(owner.subscribe(publishNavigation));
  const overlayNavigationConnector = createOverlayNavigationConnector({
    navigationController: navigationOwner,
  });
  const mapConnector = map
    ? createMapConnector({
        map,
        discoveryAreaLayers: areaLayerManager,
        locationLayers: locationConnector ?? locationLayers,
        transitLayers: transitConnector ?? transitLayers,
        getVisibleTargets: () =>
          interfaceContext.snapshot().visibleTargets || [],
        getFocusedTargetId: () =>
          interfaceContext.snapshot().focusedTargetId || null,
        focusTarget: (targetId) => {
          if (targetId.startsWith("ura-subzone:"))
            return Boolean(areaController.openArea(targetId));
          return onSelectCandidate?.(targetId) !== false;
        },
      })
    : null;
  const contextCoordinator = createContextCoordinator({
    connectors: [
      interfaceContextSource,
      discoveryAreaConnector,
      ...(eventConnector ? [eventConnector] : []),
      ...(locationConnector ? [locationConnector] : []),
      ...(mapConnector ? [mapConnector] : []),
      overlayNavigationConnector,
      ...(planConnector ? [planConnector] : []),
      ...(restaurantConnector ? [restaurantConnector] : []),
      ...(tourConnector ? [tourConnector] : []),
      ...(transitConnector ? [transitConnector] : []),
    ],
  });
  const contextReady = contextCoordinator.start();
  let lastPublishedContextRevision = null;
  let contextPublicationQueue = Promise.resolve();
  const unsubscribeContextPublication = contextCoordinator.subscribe(() => {
    if (sessionStarted && relay) void publishCapabilityContext();
  });
  const applicationStateConnector = createApplicationStateConnector({
    coordinator: contextCoordinator,
  });

  function applicationStates() {
    const states = new Set([
      "application_initialized",
      "application_ready",
      "map_ready",
    ]);
    if (approvedCatalogConnector.availability() === "available")
      states.add("approved_catalog_available");
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
      availableActionIds: capabilityRegistry
        ? capabilityRegistry
            .available({ states })
            .map(({ capabilityId }) => capabilityId)
        : patch.availableActionIds || [],
    });
    for (const listener of contextListeners) listener(snapshot);
    if (sessionStarted && relay) void publishCapabilityContext();
    return snapshot;
  }

  function publishCapabilityContext({ force = false } = {}) {
    contextPublicationQueue = contextPublicationQueue
      .catch(() => undefined)
      .then(async () => {
        await contextReady;
        await contextCoordinator.waitForIdle();
        if (!sessionStarted || !relay) return;
        const snapshot = contextCoordinator.snapshot();
        if (!force && snapshot.revision === lastPublishedContextRevision)
          return;
        await invalidatePendingActionForContext(snapshot.revision);
        relay?.updateContext?.(snapshot);
        lastPublishedContextRevision = snapshot.revision;
      })
      .catch(() => {
        // Session cleanup can destroy the coordinator while publication settles.
      });
    return contextPublicationQueue;
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

  const legacyActionContracts = createPublicActionContracts({
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
  });
  const connectorExecutors = new Map([
    ...discoveryAreaConnector.capabilityIds.map((capabilityId) => [
      capabilityId,
      discoveryAreaConnector,
    ]),
    ...(eventConnector
      ? [...eventConnector.capabilityIds, ...eventConnector.legacyAliasIds].map(
          (capabilityId) => [capabilityId, eventConnector],
        )
      : []),
    ...(mapConnector
      ? mapConnector.capabilityIds.map((capabilityId) => [
          capabilityId,
          mapConnector,
        ])
      : []),
    ...overlayNavigationConnector.capabilityIds.map((capabilityId) => [
      capabilityId,
      overlayNavigationConnector,
    ]),
    ...(locationConnector
      ? locationConnector.capabilityIds.map((capabilityId) => [
          capabilityId,
          locationConnector,
        ])
      : []),
    ...(planConnector
      ? planConnector.capabilityIds
          .filter(
            (capabilityId) =>
              !["plan.focuslocation", "plan.uselocation"].includes(
                capabilityId,
              ),
          )
          .map((capabilityId) => [capabilityId, planConnector])
      : []),
    ...(restaurantConnector
      ? restaurantConnector.capabilityIds.map((capabilityId) => [
          capabilityId,
          restaurantConnector,
        ])
      : []),
    ...(tourConnector
      ? tourConnector.capabilityIds.map((capabilityId) => [
          capabilityId,
          tourConnector,
        ])
      : []),
  ]);
  const legacyCommandDefinitions = createLegacyCommandCapabilityDefinitions(
    legacyActionContracts,
  )
    .filter(({ contract }) => contract.connectorId !== "conditional-content")
    .map((definition) => {
      const connector = connectorExecutors.get(
        definition.contract.capabilityId,
      );
      if (!connector) return definition;
      return {
        contract: definition.contract,
        runtime: {
          async execute(argumentsValue, context, metadata) {
            const result = await connector.execute(
              definition.contract.capabilityId,
              argumentsValue,
              context,
              metadata,
            );
            return {
              ...result,
              data: {
                actionId: definition.contract.capabilityId,
                changed: result.changed,
              },
            };
          },
        },
      };
    });
  const foundationalQueries = createFoundationalQueryDefinitions({
    applicationStateConnector,
    approvedCatalogConnector,
    ready: contextReady,
  });
  const eventQueryDefinitions = eventConnector
    ? [createEventApplyQueryCapabilityDefinition(eventConnector)]
    : [];
  const capabilityRegistry = createCapabilityRegistry({
    connectors: [
      applicationStateConnector,
      approvedCatalogConnector,
      {
        connectorId: discoveryAreaConnector.connectorId,
      },
      ...(eventConnector
        ? [
            {
              connectorId: eventConnector.connectorId,
            },
          ]
        : []),
      ...(mapConnector
        ? [
            {
              connectorId: mapConnector.connectorId,
            },
          ]
        : []),
      {
        connectorId: overlayNavigationConnector.connectorId,
      },
      ...(locationConnector
        ? [
            {
              connectorId: locationConnector.connectorId,
            },
          ]
        : []),
      ...(transitConnector
        ? [
            {
              connectorId: transitConnector.connectorId,
            },
          ]
        : []),
      ...(planConnector
        ? [
            {
              connectorId: planConnector.connectorId,
            },
          ]
        : []),
      ...(restaurantConnector
        ? [
            {
              connectorId: restaurantConnector.connectorId,
            },
          ]
        : []),
      ...(tourConnector
        ? [
            {
              connectorId: tourConnector.connectorId,
            },
          ]
        : []),
      ...createLegacyConnectorDescriptors(legacyCommandDefinitions).filter(
        ({ connectorId }) =>
          connectorId !== discoveryAreaConnector.connectorId &&
          connectorId !== eventConnector?.connectorId &&
          connectorId !== mapConnector?.connectorId &&
          connectorId !== overlayNavigationConnector.connectorId &&
          connectorId !== locationConnector?.connectorId &&
          connectorId !== transitConnector?.connectorId &&
          connectorId !== planConnector?.connectorId &&
          connectorId !== restaurantConnector?.connectorId &&
          connectorId !== tourConnector?.connectorId,
      ),
    ],
    capabilities: [
      ...foundationalQueries,
      ...eventQueryDefinitions,
      ...legacyCommandDefinitions,
    ],
  });
  syncContext({ availableActionIds: capabilityRegistry.ids() });
  const capabilityGateway = createActionGateway({
    registry: capabilityRegistry,
    confirmationController,
  });
  const releasePendingConfirmation = (action = pendingAction) =>
    capabilityGateway.releasePendingConfirmation(
      action?.confirmation
        ? {
            confirmationId: action.confirmation.confirmationId,
            fingerprint: action.confirmation.fingerprint,
          }
        : {},
    );
  const clearConfirmationTimer = () => {
    if (confirmationTimer !== null) clearTimeout(confirmationTimer);
    confirmationTimer = null;
  };
  const isRelayAction = (action) =>
    action?.message?.source !== "direct" &&
    typeof action?.message?.callId === "string" &&
    Boolean(relay);
  const terminalConfirmationResult = async (action) => {
    const error = new Error("Confirmation was not accepted");
    error.code = "confirmation_required";
    return failureResult(action.message, error);
  };
  const reportRejectedConfirmation = async (action) => {
    if (!isRelayAction(action)) return;
    relay?.returnConfirmation?.({
      callId: action.message.callId,
      confirmationId: action.confirmation.confirmationId,
      fingerprint: action.confirmation.fingerprint,
      finalUserInput: true,
      decision: "rejected",
    });
    relay?.returnCapabilityResult?.({
      callId: action.message.callId,
      capabilityId: action.message.capabilityId,
      kind: action.message.kind,
      result: await terminalConfirmationResult(action),
    });
  };
  const expirePendingAction = async () => {
    const action = pendingAction;
    if (!action || !confirmationController.expirePending?.()) return;
    clearConfirmationTimer();
    releasePendingConfirmation(action);
    pendingAction = null;
    view.clearConfirmation();
    await reportRejectedConfirmation(action);
  };
  const scheduleConfirmationExpiry = (action) => {
    clearConfirmationTimer();
    confirmationTimer = setTimeout(
      () => void expirePendingAction(),
      Math.max(0, Date.parse(action.confirmation.expiresAt) - Date.now()),
    );
  };
  const invalidatePendingActionForContext = async (contextRevision) => {
    const action = pendingAction;
    if (
      !isRelayAction(action) ||
      action.message.contextRevision === contextRevision
    )
      return;
    confirmationController.invalidate("context_change");
    clearConfirmationTimer();
    releasePendingConfirmation(action);
    pendingAction = null;
    view.clearConfirmation();
    await reportRejectedConfirmation(action);
  };

  const handleDiscovery = (result, source = envelope()) => {
    try {
      const validated = validateDiscoveryResult(result, source, {
        catalogRevision: Array.isArray(source?.items)
          ? source.catalogRevision
          : null,
      });
      areaController.reconcile(validated.areas);
      view.renderDiscovery(validated);
      syncContext({
        visibleTargets: validated.areas.map((area) => ({
          targetId: area.areaId,
          type: "area",
          label: area.areaId.replace(/^ura-subzone:/, "").replaceAll("-", " "),
        })),
        activeOverlayId: "assistant",
        assistantPresentation: validated.mode,
      });
      return validated;
    } catch {
      view.showError(
        "That suggestion was not grounded in approved map options. Try refining your request.",
      );
      return null;
    }
  };

  async function invokeCapability(
    capabilityId,
    argumentsValue = {},
    context = {},
    metadata = {},
  ) {
    await contextReady;
    await contextCoordinator.waitForIdle();
    const snapshot = contextCoordinator.snapshot();
    if (
      metadata.proposalRevision !== undefined &&
      metadata.proposalRevision !== snapshot.revision
    ) {
      const error = new Error(
        `Capability ${capabilityId} was proposed against stale context`,
      );
      error.code = "stale_context";
      throw error;
    }
    return capabilityRegistry.invoke(
      capabilityId,
      argumentsValue,
      {
        ...snapshot,
        ...context,
        states: context.states || applicationStates(),
        revision: context.revision ?? snapshot.revision,
      },
      metadata,
    );
  }

  function rememberCatalogResult(capabilityId, result) {
    const data = result?.data;
    if (!data?.catalogRevision || !Array.isArray(data.items)) return;
    if (
      capabilityId === "catalog.search" ||
      activeCatalogPage?.catalogRevision !== data.catalogRevision
    ) {
      activeCatalogPage = structuredClone(data);
      return;
    }
    const items = new Map(
      activeCatalogPage.items.map((item) => [item.targetId, item]),
    );
    for (const item of data.items) items.set(item.targetId, item);
    activeCatalogPage = {
      ...activeCatalogPage,
      sources: structuredClone(data.sources),
      items: [...items.values()].slice(0, 30),
    };
  }

  function publicErrorCode(error) {
    if (
      [
        "invalid_action_arguments",
        "invalid_capability_arguments",
        "catalog_search_arguments_invalid",
        "catalog_get_arguments_invalid",
      ].includes(error?.code)
    )
      return "invalid_arguments";
    if (error?.code === "stale_context") return "stale_context";
    if (error?.code === "unknown_target") return "unknown_target";
    if (error?.code === "confirmation_required") return "confirmation_required";
    if (
      [
        "action_ineligible",
        "capability_ineligible",
        "catalog_unavailable",
      ].includes(error?.code)
    )
      return "unavailable";
    if (
      [
        "invalid_action_result",
        "invalid_result_envelope",
        "result_schema_mismatch",
      ].includes(error?.code)
    )
      return "result_invalid";
    return "execution_failed";
  }

  async function failureResult(message, error) {
    await contextReady.catch(() => null);
    await contextCoordinator.waitForIdle().catch(() => null);
    const contextRevision = (() => {
      try {
        return Math.max(
          contextCoordinator.snapshot().revision,
          message.contextRevision || 0,
        );
      } catch {
        return Math.max(0, message.contextRevision || 0);
      }
    })();
    const errorCode = publicErrorCode(error);
    return Object.freeze({
      capabilityId: message.capabilityId,
      kind: message.kind,
      status: errorCode === "unavailable" ? "unavailable" : "failed",
      changed: message.kind === "query" ? null : false,
      affectedTargetIds: [],
      contextRevision,
      data: null,
      errorCode,
    });
  }

  async function executeProposedCapability(message, confirmation = null) {
    let output;
    try {
      if (lifecyclePending) {
        const error = new Error(
          "Capability calls are blocked during a local lifecycle transition",
        );
        error.code = "capability_ineligible";
        throw error;
      }
      let argumentsValue =
        message.arguments ?? message.canonicalArguments ?? {};
      if (message.capabilityId === "event.applyquery") {
        const eventState = eventConnector?.snapshot();
        const all = (eventState?.filterOptions ?? []).map((option) => ({
          id: option.filterId,
          dimension: option.facet,
          value: option.value,
          label: option.label,
          kind: option.kind,
          searchableLabel: normalizeOptionLabel(option.label),
        }));
        const groups = Object.fromEntries(
          ["what", "when", "where", "price"].map((dimension) => [
            dimension,
            all.filter((option) => option.dimension === dimension),
          ]),
        );
        const interpretation = domainIntentRouter.interpret("event", {
          ...argumentsValue,
          catalog: { all, groups },
        });
        if (
          interpretation.outcome === "clarification_required" &&
          argumentsValue.facetProposal
        ) {
          // The event owner returns the browser-visible clarification result
          // without mutating state.
        } else if (
          interpretation.outcome !== "applicable" ||
          interpretation.proposedCalls.length !== 1
        ) {
          const error = new Error(
            interpretation.outcome === "clarification_required"
              ? "Event query requires clarification"
              : "Event query is unsupported",
          );
          error.code = "invalid_action_result";
          throw error;
        } else argumentsValue = interpretation.proposedCalls[0].arguments;
      }
      if (message.capabilityId === "discovery.presentareas") {
        if (!activeCatalogPage)
          throw Object.assign(
            new Error("Approved catalogue page unavailable"),
            {
              code: "catalog_unavailable",
            },
          );
        const validated = handleDiscovery(
          argumentsValue.result,
          activeCatalogPage,
        );
        if (!validated)
          throw Object.assign(new Error("Discovery result is invalid"), {
            code: "invalid_action_result",
          });
        await contextCoordinator.waitForIdle();
        const contextRevision = contextCoordinator.snapshot().revision;
        output = Object.freeze({
          capabilityId: message.capabilityId,
          kind: "command",
          status: "completed",
          changed: true,
          affectedTargetIds: validated.areas.map(({ areaId }) => areaId),
          contextRevision,
          data: {
            actionId: message.capabilityId,
            changed: true,
          },
          errorCode: null,
        });
      } else if (
        message.kind === "query" &&
        ["app.inspect", "catalog.search", "catalog.get"].includes(
          message.capabilityId,
        )
      ) {
        const queryArguments =
          message.capabilityId === "catalog.search" &&
          argumentsValue.cursor === null
            ? Object.fromEntries(
                Object.entries(argumentsValue).filter(
                  ([field]) => field !== "cursor",
                ),
              )
            : argumentsValue;
        output = await invokeCapability(
          message.capabilityId,
          queryArguments,
          {},
          {
            source: message.source || "voice",
            callId: message.callId,
            proposalRevision: message.contextRevision,
          },
        );
        rememberCatalogResult(message.capabilityId, output);
      } else {
        await contextReady;
        await contextCoordinator.waitForIdle();
        const context = contextCoordinator.snapshot();
        output = await capabilityGateway.execute(
          message.capabilityId,
          argumentsValue,
          {
            ...context,
            states: applicationStates(),
          },
          {
            source: message.source || "voice",
            callId: message.callId,
            proposalRevision: message.contextRevision,
            targetId: message.targetId,
            targetIds: message.targetIds,
            effectSummary: message.effectSummary,
            confirmation,
          },
        );
        if (
          output.status === "completed" &&
          output.kind === "command" &&
          output.affectedTargetIds.length === 0
        ) {
          const affectedTargetId =
            message.targetId ??
            argumentsValue.targetId ??
            argumentsValue.areaId ??
            argumentsValue.itemId ??
            null;
          if (affectedTargetId)
            output = Object.freeze({
              ...output,
              affectedTargetIds: [affectedTargetId],
            });
        }
      }
      if (output.status === "confirmation_required") {
        pendingAction = { message, confirmation: output.confirmation };
        if (isRelayAction(pendingAction))
          relay?.requestConfirmation?.({
            callId: message.callId,
            capabilityId: message.capabilityId,
            confirmationId: output.confirmation.confirmationId,
            fingerprint: output.confirmation.fingerprint,
            targetId: output.confirmation.targetId,
            effectSummary: output.confirmation.effectSummary,
            expiresAt: output.confirmation.expiresAt,
          });
        else {
          view.showConfirmation(output.confirmation);
          scheduleConfirmationExpiry(pendingAction);
        }
        return output;
      }
    } catch (error) {
      const failedConfirmation = confirmation ?? output?.confirmation ?? null;
      if (failedConfirmation) {
        capabilityGateway.releasePendingConfirmation(failedConfirmation);
        confirmationController.invalidate(error?.code || "execution_failed");
        if (
          pendingAction?.confirmation.confirmationId ===
          failedConfirmation.confirmationId
        )
          pendingAction = null;
      }
      output = await failureResult(message, error);
    }
    relay?.returnCapabilityResult?.({
      callId: message.callId,
      capabilityId: message.capabilityId,
      kind: message.kind,
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
    let resolved;
    try {
      resolved = confirmationController.resolve({
        confirmationId: record.confirmationId,
        fingerprint: record.fingerprint,
        decision,
        inputSource: "user",
        inputStatus: "final",
      });
    } catch (error) {
      if (error?.code !== "confirmation_expired") throw error;
      const action = pendingAction;
      clearConfirmationTimer();
      releasePendingConfirmation();
      pendingAction = null;
      view.clearConfirmation();
      await reportRejectedConfirmation(action);
      return;
    }
    clearConfirmationTimer();
    view.clearConfirmation();
    const action = pendingAction;
    pendingAction = null;
    if (isRelayAction(action))
      relay?.returnConfirmation?.({
        callId: action.message.callId,
        confirmationId: record.confirmationId,
        fingerprint: record.fingerprint,
        finalUserInput: true,
        decision: resolved.status === "accepted" ? "accepted" : "rejected",
      });
    if (resolved.status === "accepted") {
      await executeProposedCapability(action.message, {
        confirmationId: record.confirmationId,
        fingerprint: record.fingerprint,
      });
    } else {
      releasePendingConfirmation(action);
      if (isRelayAction(action))
        relay?.returnCapabilityResult?.({
          callId: action.message.callId,
          capabilityId: action.message.capabilityId,
          kind: action.message.kind,
          result: await terminalConfirmationResult(action),
        });
    }
  }

  const onRelayEvent = (message) => {
    if (message.type === "session.state") {
      postPlaybackSpeechGuard.observeState(message.state);
      relayReady = message.state === "listening";
      if (["processing", "speaking"].includes(message.state) && activeTurnId) {
        activeTurnId = null;
        turnReady = false;
        commitPending = false;
        queuedAudio = [];
      }
      view.setVoiceState(message.state);
      if (relayReady) void publishCapabilityContext({ force: true });
      if (relayReady && bargeInPending) {
        const commitAfterReady = bargeInSpeechEnded;
        bargeInPending = false;
        bargeInSpeechEnded = false;
        startReservedAudioTurn({
          preserveQueuedAudio: true,
          commitAfterReady,
        });
      } else if (relayReady && !muted && !activeTurnId) {
        startReservedAudioTurn();
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
    ) {
      if (lifecycleRouter.recognize(message.text))
        void routeLifecycle(message.text, {
          source: "user_utterance",
          inputStatus: "final",
        });
      else {
        recordUserRequest(message.text);
        void routeAndReportObviousCommand(message.text, "voice");
      }
    }
    if (message.type === "capability.proposed")
      void executeProposedCapability(message);
    if (
      message.type === "confirmation.required" &&
      pendingAction?.message.callId === message.callId &&
      pendingAction.confirmation.confirmationId === message.confirmationId &&
      pendingAction.confirmation.fingerprint === message.fingerprint
    ) {
      view.showConfirmation(pendingAction.confirmation);
      scheduleConfirmationExpiry(pendingAction);
    }
    if (message.type === "error")
      terminateVoiceUnavailable(message.reason || message.code || "provider", {
        notifyRelay: false,
      });
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
    if (relayReady) {
      if (!postPlaybackSpeechGuard.allowsSpeech()) return false;
      return startReservedAudioTurn();
    }
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
      const reason =
        error?.code === "permission"
          ? "permission"
          : ["usage_limit", "voice_disabled"].includes(error?.code)
            ? error.code
            : "provider";
      stopVoice(reason);
      if (reason === "permission") {
        view.setVoiceState("degraded");
        view.showError(
          "Microphone permission ended. Allow microphone access and try again.",
        );
      } else terminateVoiceUnavailable(reason);
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
      void transitConnector?.setConstraintActive(true, {
        explicitlyRequested: true,
      });
      syncContext({ transitConstraintActive: true });
    }
  };

  const submitText = (text) => {
    if (relayReady) {
      view.appendTranscript("user", text);
      recordUserRequest(text);
      try {
        relay?.submitText(`text-${++turn}`, text);
      } catch {
        terminateVoiceUnavailable("protocol");
        return;
      }
      void routeAndReportObviousCommand(text, "same_session_text");
      return;
    }
    terminateVoiceUnavailable("unavailable");
  };

  const executeDirectCapability = async (
    capabilityId,
    argumentsValue = {},
    { source = "direct" } = {},
  ) => {
    await contextReady;
    if (
      capabilityRegistry.get(capabilityId).confirmationClass ===
        "consequential" &&
      view.snapshot().assistantOpen !== true
    ) {
      view.setOpen(true);
    }
    await contextCoordinator.waitForIdle();
    const context = contextCoordinator.snapshot();
    const callId = `direct-${capabilityId}-${Date.now().toString(36)}`;
    const output = await capabilityGateway.execute(
      capabilityId,
      argumentsValue,
      {
        ...context,
        states: applicationStates(),
      },
      {
        source,
        callId,
        proposalRevision: context.revision,
      },
    );
    if (output.status === "confirmation_required") {
      pendingAction = {
        message: {
          callId,
          capabilityId,
          kind: "command",
          arguments: structuredClone(argumentsValue),
          contextRevision: context.revision,
          source,
        },
        confirmation: output.confirmation,
      };
      view.showConfirmation(output.confirmation);
    }
    return output;
  };

  const routeObviousCommand = async (text, source) => {
    await contextReady;
    await contextCoordinator.waitForIdle();
    const context = contextCoordinator.snapshot();
    const eventState = eventConnector?.snapshot();
    const composerState = eventState?.activeFilters?.eventComposerState;
    let proposal = interpretObviousCommand({
      text,
      baseContextRevision:
        composerState?.contextRevision ?? context.revision ?? 0,
      catalogRevision: composerState?.catalogRevision ?? null,
    });
    if (!proposal) {
      const scope = selectCapabilityTurnScope({
        utterance: text,
        availableCapabilityIds: context.availableCapabilityIds ?? [],
        activeOverlayId: context.activeOverlayId ?? null,
        baseContextRevision: context.revision ?? 0,
        catalogRevision: composerState?.catalogRevision ?? null,
      });
      if (scope.deterministicCapabilityId)
        proposal = {
          capabilityId: scope.deterministicCapabilityId,
          arguments: scope.deterministicArguments,
        };
    }
    if (!proposal) return null;
    const contract = capabilityRegistry.get(proposal.capabilityId);
    const message = {
      capabilityId: proposal.capabilityId,
      kind: contract.kind,
      contextRevision: context.revision,
    };
    try {
      return {
        proposal,
        result: await executeDirectCapability(
          proposal.capabilityId,
          proposal.arguments,
          { source },
        ),
      };
    } catch (error) {
      return { proposal, result: await failureResult(message, error) };
    }
  };
  const routeAndReportObviousCommand = async (text, source) => {
    let routed;
    try {
      routed = await routeObviousCommand(text, source);
    } catch (error) {
      const proposal = interpretObviousCommand({
        text,
        baseContextRevision: 0,
        catalogRevision: "deterministic-failure",
      });
      if (!proposal) return null;
      const contract = capabilityRegistry.get(proposal.capabilityId);
      routed = {
        proposal,
        result: await failureResult(
          {
            capabilityId: proposal.capabilityId,
            kind: contract.kind,
            contextRevision: 0,
          },
          error,
        ),
      };
    }
    if (!routed) return null;
    try {
      relay?.returnDeterministicResult?.({
        capabilityId: routed.proposal.capabilityId,
        kind: routed.result.kind,
        result: routed.result,
      });
    } catch {
      if (sessionStarted) terminateVoiceUnavailable("protocol");
    }
    return routed.result;
  };

  const interruptSession = () => {
    const action = pendingAction;
    confirmationController.invalidate("interruption");
    clearConfirmationTimer();
    releasePendingConfirmation(action);
    pendingAction = null;
    view.clearConfirmation();
    if (action) void reportRejectedConfirmation(action);
    relay?.cancelPlayback?.();
    explicitBargeIn = true;
    if (audioController?.setVadState("speech_started") === false)
      explicitBargeIn = false;
    return true;
  };
  const setSessionMuted = (nextMuted) => {
    muted = nextMuted;
    audioController?.setMuted?.(muted);
    view.setVoiceState(muted ? "muted" : "listening");
    return true;
  };
  const lifecycleRouter = createSessionLifecycleRouter({
    snapshot: () => ({ active: sessionStarted, muted }),
    stop: (reason) => {
      stopVoice(reason);
      return true;
    },
    setMuted: setSessionMuted,
    interrupt: interruptSession,
  });
  const routeLifecycle = async (intentValue, options) => {
    lifecyclePending = true;
    try {
      return await lifecycleRouter.route(intentValue, options);
    } finally {
      lifecyclePending = false;
    }
  };

  const view = createAssistantView({
    voiceUiEnabled,
    executeCapability: executeDirectCapability,
    onStartVoice: startVoice,
    onSubmitText: submitText,
    onStopVoice: () =>
      void routeLifecycle("session.stop", { source: "browser_control" }),
    onPushToTalkStart: () => {
      explicitBargeIn = true;
      if (audioController?.beginPushToTalk() === false) explicitBargeIn = false;
    },
    onPushToTalkEnd: () => {
      audioController?.endPushToTalk();
      explicitBargeIn = false;
    },
    onInterrupt: () =>
      void routeLifecycle("session.interrupt", {
        source: "browser_control",
      }),
    onToggleMute: (nextMuted) =>
      void routeLifecycle(nextMuted ? "session.mute" : "session.unmute", {
        source: "browser_control",
      }),
    onConfirmation: resolveConfirmation,
    onSelectArea: (areaId) =>
      void executeDirectCapability("map.openarea", { areaId }),
    onCompareAreas: (areaIds) =>
      void executeDirectCapability("map.compareareas", { areaIds }),
    onDismissArea: (areaId) =>
      void executeDirectCapability("map.dismissarea", { areaId }),
    onSelectCandidate: (candidateId, areaId) => {
      onSelectCandidate?.(candidateId, areaId);
      syncContext({
        focusedTargetId: candidateId,
        selectedTargetIds: [candidateId],
      });
    },
    onClarification: submitText,
  });
  navigationOwner.attachAssistant(view);

  function stopVoice(reason = "user", { notifyRelay = true } = {}) {
    if (!sessionStarted && !relay && !audioController && !pendingAction) return;
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
    releasePendingConfirmation();
    clearConfirmationTimer();
    pendingAction = null;
    activeCatalogPage = null;
    confirmationController.invalidate(reason);
    view.clearSession();
    view.setVoiceState("stopped");
    intent = createDiscoveryIntent();
    delete document.body.dataset.transitConstraintActive;
    void transitConnector?.setConstraintActive(false, {
      explicitlyRequested: true,
    });
    syncContext({
      visibleTargets: [],
      focusedTargetId: null,
      selectedTargetIds: [],
      activeOverlayId: null,
      assistantPresentation: null,
      transitConstraintActive: false,
      locationState: locationController?.snapshot?.() || undefined,
    });
  }

  function terminateVoiceUnavailable(
    reason = "provider",
    { notifyRelay = true } = {},
  ) {
    stopVoice(reason, { notifyRelay });
    localMode = false;
    view.setVoiceState("degraded");
    view.showVoiceUnavailable();
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
      capabilityGateway.execute(
        actionId,
        argumentsValue,
        {
          ...interfaceContext.snapshot(),
          ...context,
          states: context.states || applicationStates(),
        },
        { source: "direct", callerOrigin: "direct_ui" },
      ),
    invokeCapability,
    executeCapability: executeDirectCapability,
    availableCapabilities: () =>
      capabilityRegistry.available({ states: applicationStates() }),
    capabilityContextSnapshot: () => contextCoordinator.snapshot(),
    finalize() {
      stopVoice("pagehide");
      window.removeEventListener("pagehide", onPageHide);
      unsubscribeContextPublication();
      contextCoordinator.destroy();
      approvedCatalogConnector.destroy();
      discoveryAreaConnector.destroy();
      eventConnector?.destroy();
      locationConnector?.destroy();
      mapConnector?.destroy();
      overlayNavigationConnector.destroy();
      navigationOwner.destroy();
      planConnector?.destroy();
      restaurantConnector?.destroy();
      tourConnector?.destroy();
      transitConnector?.destroy();
      contextListeners.clear();
      audioPlayback?.close?.();
      view.destroy();
    },
  });
}
