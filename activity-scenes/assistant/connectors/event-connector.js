import eventApplyQueryResultSchema from "../../../specs/004-conversational-voice-map/contracts/event-apply-query-result.schema.json" with { type: "json" };

const CANONICAL_CAPABILITY_IDS = Object.freeze([
  "event.applyquery",
  "event.search",
  "event.setfilter",
  "event.removefilter",
  "event.clearfilters",
  "event.selectresult",
  "event.opendetail",
  "event.selectoccurrence",
  "event.setsessionsexpanded",
  "event.previousevent",
  "event.nextevent",
  "event.closedetail",
  "event.addtoplan",
  "event.openreference",
  "event.opendirections",
]);
const LEGACY_ALIAS_IDS = Object.freeze([
  "event.setcategory",
  "event.setdaterange",
  "event.setpricerange",
]);
const SUPPORTED_CAPABILITY_IDS = new Set([
  ...CANONICAL_CAPABILITY_IDS,
  ...LEGACY_ALIAS_IDS,
]);
const FACETS = new Set(["what", "when", "where", "price"]);
const SINGLE_VALUE_FACETS = new Set(["when", "where", "price"]);
const ID = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,255}$/;
const MAX_EVENTS = 50;
const MAX_OCCURRENCES = 20;
const MAX_FILTER_OPTIONS = 100;
const MAX_FILTER_TOKENS = 20;
const FACET_SELECTION_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["label", "evidence"],
  properties: {
    label: { type: "string", minLength: 1, maxLength: 160 },
    evidence: { type: "string", minLength: 1, maxLength: 160 },
  },
});
const EVENT_FACET_PROPOSAL_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["what", "when", "where", "price", "residualQuery", "unresolved"],
  properties: {
    what: {
      type: "array",
      maxItems: 6,
      uniqueItems: true,
      items: FACET_SELECTION_SCHEMA,
    },
    when: { anyOf: [FACET_SELECTION_SCHEMA, { type: "null" }] },
    where: { anyOf: [FACET_SELECTION_SCHEMA, { type: "null" }] },
    price: { anyOf: [FACET_SELECTION_SCHEMA, { type: "null" }] },
    residualQuery: { type: "string", maxLength: 200 },
    unresolved: {
      type: "array",
      maxItems: 4,
      uniqueItems: true,
      items: { enum: ["what", "when", "where", "price"] },
    },
  },
});
const EVENT_APPLY_QUERY_ARGUMENT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["text", "mode", "baseContextRevision", "catalogRevision"],
  properties: {
    text: { type: "string", minLength: 1, maxLength: 500 },
    mode: { enum: ["replace", "refine", "remove"] },
    baseContextRevision: {
      type: "integer",
      minimum: 0,
      maximum: Number.MAX_SAFE_INTEGER,
    },
    catalogRevision: { type: "string", minLength: 1, maxLength: 160 },
    facetProposal: EVENT_FACET_PROPOSAL_SCHEMA,
  },
});

export const EVENT_APPLY_QUERY_CAPABILITY_CONTRACT = Object.freeze({
  capabilityId: "event.applyquery",
  version: "2.0",
  kind: "command",
  description:
    "Apply the complete spoken event request atomically, whether it contains one or several filters.",
  connectorId: "events",
  argumentSchema: EVENT_APPLY_QUERY_ARGUMENT_SCHEMA,
  eligibleStates: ["application_ready"],
  confirmationClass: "reversible",
  contextProvider: "eventContext",
  resultSchema: eventApplyQueryResultSchema,
});

export class EventConnectorError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "EventConnectorError";
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new EventConnectorError(code, message);
};
const boundedText = (value, maximum = 200) =>
  typeof value === "string" ? value.slice(0, maximum) : "";
const stableId = (value) =>
  typeof value === "string" && ID.test(value) ? value : null;
const optionId = (value) =>
  stableId(value?.filterId ?? value?.optionId ?? value?.id ?? value);
const facetOf = (value) => value?.facet ?? value?.dimension ?? null;

function projectFilterOptions(values) {
  const seen = new Set();
  const options = [];
  for (const value of Array.isArray(values) ? values : []) {
    const filterId = optionId(value);
    const facet = facetOf(value);
    if (!filterId || !FACETS.has(facet) || seen.has(filterId)) continue;
    seen.add(filterId);
    options.push(
      Object.freeze({
        filterId,
        facet,
        label: boundedText(value?.label),
        kind: boundedText(value?.kind, 64),
        value: boundedText(value?.value, 256),
      }),
    );
    if (options.length === MAX_FILTER_OPTIONS) break;
  }
  return options;
}

function projectFilterTokens(values, knownOptions) {
  const tokens = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const filterId = optionId(value);
    const option = knownOptions.get(filterId);
    if (!filterId || !option || seen.has(filterId)) continue;
    seen.add(filterId);
    tokens.push(
      Object.freeze({
        filterId,
        facet: option.facet,
        label: boundedText(value?.label || option.label),
        parameters: Object.freeze({
          start: boundedText(value?.parameters?.start, 10),
          end: boundedText(value?.parameters?.end, 10),
        }),
      }),
    );
    if (tokens.length === MAX_FILTER_TOKENS) break;
  }
  return tokens;
}

function projectReferences(event) {
  const references = [];
  const seen = new Set();
  for (const [index, value] of (Array.isArray(event?.sourceOffers)
    ? event.sourceOffers
    : []
  ).entries()) {
    const referenceId =
      stableId(value?.referenceId ?? value?.id) ?? `reference:${index + 1}`;
    if (seen.has(referenceId)) continue;
    seen.add(referenceId);
    references.push(referenceId);
    if (references.length === 10) break;
  }
  return references;
}

function projectEvents(values) {
  const events = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const eventId = stableId(
      value?.candidateId ?? value?.targetId ?? value?.eventId ?? value?.id,
    );
    if (!eventId || seen.has(eventId)) continue;
    seen.add(eventId);
    const occurrenceIds = [];
    const seenOccurrences = new Set();
    for (const occurrence of value?.occurrences ??
      value?.sessions ??
      value?.occurrenceIds ??
      []) {
      const occurrenceId = stableId(
        typeof occurrence === "string"
          ? occurrence
          : (occurrence?.occurrenceId ??
              occurrence?.sessionId ??
              occurrence?.id),
      );
      if (!occurrenceId || seenOccurrences.has(occurrenceId)) continue;
      seenOccurrences.add(occurrenceId);
      occurrenceIds.push(occurrenceId);
      if (occurrenceIds.length === MAX_OCCURRENCES) break;
    }
    events.push(
      Object.freeze({
        eventId,
        title: boundedText(value?.title),
        occurrenceIds: Object.freeze(occurrenceIds),
        referenceIds: Object.freeze(projectReferences(value)),
        routable:
          value?.routable === true ||
          (value?.publicPlacement !== "off_map" &&
            Boolean(value?.landmarkId ?? value?.anchor)),
      }),
    );
    if (events.length === MAX_EVENTS) break;
  }
  return events;
}

function modelState(discoveryModel, ownerState) {
  if (typeof discoveryModel?.queryState !== "function") return {};
  return discoveryModel.queryState({
    query: ownerState.query,
    filterTokens: ownerState.filterTokens ?? ownerState.tokens,
  });
}

function projectSnapshot(ownerState, discoveryState, revision) {
  const options = projectFilterOptions(
    ownerState.filterOptions ?? discoveryState.filterOptions,
  );
  const optionsById = new Map(
    options.map((option) => [option.filterId, option]),
  );
  const filterTokens = projectFilterTokens(
    ownerState.filterTokens ?? ownerState.tokens ?? discoveryState.filterTokens,
    optionsById,
  );
  const events = projectEvents(
    ownerState.events ?? ownerState.results ?? discoveryState.events,
  );
  const eventIds = new Set(events.map(({ eventId }) => eventId));
  const selectedEventId = eventIds.has(ownerState.selectedEventId)
    ? ownerState.selectedEventId
    : null;
  const selectedEvent = events.find(
    ({ eventId }) => eventId === selectedEventId,
  );
  const selectedOccurrenceId = selectedEvent?.occurrenceIds.includes(
    ownerState.selectedOccurrenceId,
  )
    ? ownerState.selectedOccurrenceId
    : null;
  const activeFilters = Object.freeze({
    eventQuery: boundedText(ownerState.query ?? discoveryState.query, 500),
    eventWhat: Object.freeze(
      filterTokens
        .filter(({ facet }) => facet === "what")
        .map(({ filterId }) => filterId),
    ),
    eventWhen: Object.freeze(
      filterTokens
        .filter(({ facet }) => facet === "when")
        .map(({ filterId }) => filterId),
    ),
    eventWhere: Object.freeze(
      filterTokens
        .filter(({ facet }) => facet === "where")
        .map(({ filterId }) => filterId),
    ),
    eventPrice: Object.freeze(
      filterTokens
        .filter(({ facet }) => facet === "price")
        .map(({ filterId }) => filterId),
    ),
    eventComposerState: Object.freeze({
      canonicalSentence: boundedText(
        ownerState.eventComposerState?.canonicalSentence,
        500,
      ),
      residualQuery: boundedText(
        ownerState.eventComposerState?.residualQuery ??
          ownerState.query ??
          discoveryState.query,
        500,
      ),
      phrases: Object.freeze(
        (ownerState.eventComposerState?.phrases ?? [])
          .slice(0, 24)
          .map((phrase) =>
            Object.freeze({
              phraseId: boundedText(phrase?.phraseId, 120),
              facet: FACETS.has(phrase?.facet) ? phrase.facet : "what",
              valueId: boundedText(phrase?.valueId, 120),
              label: boundedText(phrase?.label, 160),
            }),
          )
          .filter(
            ({ phraseId, valueId, label }) => phraseId && valueId && label,
          ),
      ),
      catalogRevision: boundedText(
        ownerState.eventComposerState?.catalogRevision,
        160,
      ),
      contextRevision: Number.isInteger(
        ownerState.eventComposerState?.contextRevision,
      )
        ? Math.max(0, ownerState.eventComposerState.contextRevision)
        : Math.max(0, Number(ownerState.revision) || 0),
    }),
  });
  return Object.freeze({
    revision,
    query: activeFilters.eventQuery,
    resultsOpen: ownerState.resultsOpen === true,
    detailOpen: ownerState.detailOpen === true && Boolean(selectedEventId),
    filterOptions: Object.freeze(options),
    eventFacetCatalog: Object.freeze({
      catalogRevision: activeFilters.eventComposerState.catalogRevision,
      ...Object.fromEntries(
        ["what", "when", "where", "price"].map((facet) => [
          facet,
          Object.freeze(
            options
              .filter((option) => option.facet === facet)
              .map((option) => option.label),
          ),
        ]),
      ),
    }),
    filterTokens: Object.freeze(filterTokens),
    events: Object.freeze(events),
    visibleTargets: Object.freeze(
      events.map(({ eventId, title }) =>
        Object.freeze({ targetId: eventId, type: "event", label: title }),
      ),
    ),
    selectedEventId,
    selectedTargetIds: Object.freeze(selectedEventId ? [selectedEventId] : []),
    focusedTargetId: selectedEventId,
    activeFilters,
    ...(ownerState.detailOpen === true && selectedEventId
      ? { activeOverlayId: "event-details" }
      : ownerState.resultsOpen === true
        ? { activeOverlayId: "event-search" }
        : {}),
    selectedOccurrenceId,
    sessionsExpanded:
      ownerState.sessionsExpanded === true &&
      (selectedEvent?.occurrenceIds.length ?? 0) > 1,
    hasPrevious: ownerState.hasPrevious === true,
    hasNext: ownerState.hasNext === true,
    planCanAdd: ownerState.planCanAdd !== false,
    availableCapabilityIds: CANONICAL_CAPABILITY_IDS,
  });
}

function contextPatch(snapshot) {
  return Object.freeze({
    event: Object.freeze({
      query: snapshot.query,
      filterTokens: snapshot.filterTokens,
      resultIds: Object.freeze(snapshot.events.map(({ eventId }) => eventId)),
      selectedEventId: snapshot.selectedEventId,
      selectedOccurrenceId: snapshot.selectedOccurrenceId,
      sessionsExpanded: snapshot.sessionsExpanded,
    }),
    visibleTargets: snapshot.visibleTargets,
    focusedTargetId: snapshot.selectedEventId,
    selectedTargetIds: Object.freeze(
      snapshot.selectedEventId ? [snapshot.selectedEventId] : [],
    ),
    activeOverlayId: snapshot.detailOpen
      ? "event-details"
      : snapshot.resultsOpen
        ? "event-search"
        : null,
    eventFacetCatalog: snapshot.eventFacetCatalog,
  });
}

function aliasCommand(capabilityId, args, snapshot) {
  if (capabilityId === "event.setcategory") {
    const option = snapshot.filterOptions.find(
      ({ facet, value }) => facet === "what" && value === args.categoryId,
    );
    return {
      capabilityId: "event.setfilter",
      args: {
        facet: "what",
        values: args.categoryId ? [option?.filterId].filter(Boolean) : [],
      },
    };
  }
  if (capabilityId === "event.setdaterange")
    return {
      capabilityId: "event.setfilter",
      args: {
        facet: "when",
        values:
          args.startDate || args.endDate
            ? [
                {
                  filterId: "when:custom",
                  parameters: {
                    start: args.startDate || "",
                    end: args.endDate || "",
                  },
                },
              ]
            : [],
      },
    };
  if (capabilityId === "event.setpricerange")
    return {
      capabilityId: "event.setfilter",
      args: {
        facet: "price",
        values: args.priceBand ? [`price:${args.priceBand}`] : [],
      },
    };
  return { capabilityId, args };
}

export function createEventConnector({
  eventController,
  eventDiscoveryModel = null,
  discoveryModel = eventDiscoveryModel,
} = {}) {
  if (
    typeof eventController?.snapshot !== "function" ||
    typeof eventController?.subscribe !== "function" ||
    typeof eventController?.dispatch !== "function"
  )
    fail(
      "event_owner_invalid",
      "Event connector requires the shared event owner",
    );
  const listeners = new Set();
  let destroyed = false;
  let revision = 0;
  const snapshot = () => {
    if (destroyed)
      fail("event_connector_destroyed", "Event connector is destroyed");
    const ownerState = eventController.snapshot();
    if (!ownerState || typeof ownerState !== "object")
      fail("event_owner_snapshot_invalid", "Event owner snapshot is invalid");
    return projectSnapshot(
      ownerState,
      modelState(discoveryModel, ownerState),
      revision,
    );
  };
  const publish = () => {
    revision += 1;
    const current = snapshot();
    for (const listener of listeners) listener(current);
  };
  const unsubscribeOwner = eventController.subscribe(publish, {
    emitCurrent: false,
  });
  if (typeof unsubscribeOwner !== "function")
    fail("event_owner_subscription_invalid", "Event owner cleanup is invalid");
  const isEligible = (capabilityId, args = {}) => {
    if (!SUPPORTED_CAPABILITY_IDS.has(capabilityId)) return false;
    const current = snapshot();
    if (
      capabilityId === "event.setcategory" &&
      args.categoryId &&
      !current.filterOptions.some(
        ({ facet, value }) => facet === "what" && value === args.categoryId,
      )
    )
      return false;
    if (capabilityId === "event.setdaterange") {
      const dates = [args.startDate, args.endDate].filter(Boolean);
      if (dates.some((value) => !/^\d{4}-\d{2}-\d{2}$/.test(value)))
        return false;
      if (args.startDate && args.endDate && args.startDate > args.endDate)
        return false;
    }
    const normalized = aliasCommand(capabilityId, args, current);
    const id = normalized.capabilityId;
    const values = normalized.args.values ?? [];
    const eventsById = new Map(
      current.events.map((event) => [event.eventId, event]),
    );
    const event = eventsById.get(args.eventId);
    if (id === "event.search") return true;
    if (id === "event.applyquery")
      return (
        typeof normalized.args.text === "string" &&
        normalized.args.text.trim().length > 0 &&
        normalized.args.text.length <= 500 &&
        ["replace", "refine", "remove"].includes(normalized.args.mode) &&
        Number.isInteger(normalized.args.baseContextRevision) &&
        normalized.args.baseContextRevision >= 0 &&
        normalized.args.catalogRevision ===
          current.activeFilters.eventComposerState.catalogRevision
      );
    if (id === "event.setfilter") {
      if (!FACETS.has(normalized.args.facet) || !Array.isArray(values))
        return false;
      if (
        values.length > MAX_FILTER_TOKENS ||
        (SINGLE_VALUE_FACETS.has(normalized.args.facet) && values.length > 1)
      )
        return false;
      const ids = values.map(optionId);
      return (
        ids.every(Boolean) &&
        new Set(ids).size === ids.length &&
        ids.every((filterId) =>
          current.filterOptions.some(
            (option) =>
              option.filterId === filterId &&
              option.facet === normalized.args.facet,
          ),
        )
      );
    }
    if (id === "event.removefilter")
      return current.filterTokens.some(
        ({ filterId }) => filterId === args.filterId,
      );
    if (id === "event.clearfilters")
      return Boolean(current.query || current.filterTokens.length);
    if (id === "event.selectresult" || id === "event.opendetail")
      return Boolean(event);
    if (id === "event.selectoccurrence")
      return (
        current.detailOpen &&
        event?.occurrenceIds.length > 1 &&
        event?.occurrenceIds.includes(args.occurrenceId) === true
      );
    if (id === "event.setsessionsexpanded")
      return (
        current.detailOpen &&
        event?.eventId === current.selectedEventId &&
        event.occurrenceIds.length > 1 &&
        typeof args.expanded === "boolean"
      );
    if (id === "event.previousevent")
      return current.detailOpen && current.hasPrevious;
    if (id === "event.nextevent") return current.detailOpen && current.hasNext;
    if (id === "event.closedetail") return current.detailOpen;
    if (id === "event.addtoplan") return Boolean(event) && current.planCanAdd;
    if (id === "event.openreference")
      return (
        Boolean(event) &&
        event.referenceIds.length > 0 &&
        (args.referenceId === undefined ||
          event.referenceIds.includes(args.referenceId))
      );
    return Boolean(event?.routable);
  };
  const execute = async (capabilityId, args = {}, context = {}) => {
    if (!SUPPORTED_CAPABILITY_IDS.has(capabilityId))
      fail(
        "event_capability_unsupported",
        `Event connector does not support ${capabilityId}`,
      );
    const before = snapshot();
    if (
      capabilityId === "event.applyquery" &&
      args.baseContextRevision !== context.revision
    )
      fail(
        "stale_context",
        "Event sentence was proposed against stale application context",
      );
    if (!isEligible(capabilityId, args))
      fail(
        "event_capability_unavailable",
        "Event capability is unavailable in the current approved context",
      );
    const command = aliasCommand(capabilityId, structuredClone(args), before);
    const ownerResult = await eventController.dispatch(
      command.capabilityId,
      capabilityId === "event.applyquery"
        ? {
            ...structuredClone(command.args),
            baseContextRevision:
              before.activeFilters.eventComposerState.contextRevision,
          }
        : structuredClone(command.args),
    );
    const changed =
      capabilityId === "event.applyquery"
        ? ownerResult?.changed === true
        : ownerResult !== false;
    const current = snapshot();
    const affectedTargetId =
      args.eventId ?? current.selectedEventId ?? before.selectedEventId;
    const patch = contextPatch(current);
    const topEvents = current.events.slice(0, 3).map(({ eventId, title }) =>
      Object.freeze({
        eventId: boundedText(eventId, 200),
        title: boundedText(title.replace(/\s+/g, " ").trim(), 160),
      }),
    );
    return Object.freeze({
      changed,
      affectedTargetIds: Object.freeze(
        changed && affectedTargetId ? [affectedTargetId] : [],
      ),
      contextPatch: patch,
      data:
        capabilityId === "event.applyquery"
          ? Object.freeze({
              ...structuredClone(ownerResult?.data),
              topEvents: Object.freeze(topEvents),
              canAddToPlan: current.planCanAdd,
            })
          : Object.freeze({
              state: current,
              contextPatch: patch,
              delegatedCapabilityId: command.capabilityId,
            }),
    });
  };
  return Object.freeze({
    connectorId: "events",
    capabilityIds: CANONICAL_CAPABILITY_IDS,
    legacyAliasIds: LEGACY_ALIAS_IDS,
    availability: () => (destroyed ? "disabled" : "available"),
    snapshot,
    subscribe(listener, { emitCurrent = false } = {}) {
      if (typeof listener !== "function")
        fail("event_subscriber_invalid", "Subscriber is invalid");
      listeners.add(listener);
      if (emitCurrent) listener(snapshot());
      return () => listeners.delete(listener);
    },
    isEligible,
    execute,
    destroy() {
      if (destroyed) return;
      unsubscribeOwner();
      listeners.clear();
      destroyed = true;
    },
  });
}

export function createEventApplyQueryCapabilityDefinition(eventConnector) {
  if (typeof eventConnector?.execute !== "function")
    throw new TypeError("Event connector is required");
  return Object.freeze({
    contract: EVENT_APPLY_QUERY_CAPABILITY_CONTRACT,
    runtime: Object.freeze({
      execute: (argumentsValue, context, metadata) =>
        eventConnector.execute(
          "event.applyquery",
          argumentsValue,
          context,
          metadata,
        ),
    }),
  });
}
