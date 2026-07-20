import {
  actionContracts,
  objectSchema,
  optional,
  parityCases,
  registerContracts,
  types,
} from "./action-definition.js";

export const EVENT_ACTION_DEFINITIONS = Object.freeze([
  {
    actionId: "event.search",
    description: "Search visible approved events",
    contextProvider: "eventContext",
    argumentSchema: objectSchema({ query: types.text }),
    sampleArguments: { query: "music" },
  },
  {
    actionId: "event.setcategory",
    description: "Set or clear the event category",
    contextProvider: "eventContext",
    argumentSchema: optional({ categoryId: types.id }),
    sampleArguments: { categoryId: "performance" },
  },
  {
    actionId: "event.setdaterange",
    description: "Set or clear the event date range",
    contextProvider: "eventContext",
    argumentSchema: optional({ startDate: types.id, endDate: types.id }),
    sampleArguments: { startDate: "2026-07-18", endDate: "2026-07-19" },
  },
  {
    actionId: "event.setpricerange",
    description: "Set or clear the event price band",
    contextProvider: "eventContext",
    argumentSchema: optional({ priceBand: types.id }),
    sampleArguments: { priceBand: "free" },
  },
  {
    actionId: "event.clearfilters",
    description: "Clear all event filters",
    contextProvider: "eventContext",
  },
  {
    actionId: "event.selectresult",
    description: "Select an event result",
    contextProvider: "eventContext",
    argumentSchema: objectSchema({ eventId: types.id }),
    sampleArguments: { eventId: "event:fixture" },
  },
  {
    actionId: "event.opendetail",
    description: "Open an event detail",
    contextProvider: "eventContext",
    argumentSchema: objectSchema({ eventId: types.id }),
    sampleArguments: { eventId: "event:fixture" },
  },
  {
    actionId: "event.previousevent",
    description: "Show the previous event detail",
    contextProvider: "overlayContext",
  },
  {
    actionId: "event.nextevent",
    description: "Show the next event detail",
    contextProvider: "overlayContext",
  },
  {
    actionId: "event.closedetail",
    description: "Close the event detail",
    contextProvider: "overlayContext",
  },
  {
    actionId: "event.addtoplan",
    description: "Add an event to the plan",
    contextProvider: "eventContext",
    argumentSchema: objectSchema({ eventId: types.id }),
    sampleArguments: { eventId: "event:fixture" },
  },
  {
    actionId: "event.openreference",
    description: "Open an approved event reference",
    contextProvider: "eventContext",
    confirmationClass: "consequential",
    argumentSchema: optional({ eventId: types.id, referenceId: types.id }),
    sampleArguments: { eventId: "event:fixture", referenceId: "official" },
  },
  {
    actionId: "event.opendirections",
    description: "Open directions to an event",
    contextProvider: "eventContext",
    confirmationClass: "consequential",
    argumentSchema: objectSchema({ eventId: types.id }),
    sampleArguments: { eventId: "event:fixture" },
  },
]);

export const createEventActionContracts = (options = {}) =>
  actionContracts(EVENT_ACTION_DEFINITIONS, options);
export const registerEventActions = (registry, options = {}) =>
  registerContracts(registry, createEventActionContracts(options));
export const EVENT_ACTION_PARITY_CASES = parityCases(EVENT_ACTION_DEFINITIONS);
