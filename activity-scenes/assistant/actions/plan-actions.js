import {
  actionContracts,
  objectSchema,
  optional,
  parityCases,
  registerContracts,
  types,
} from "./action-definition.js";

export const PLAN_ACTION_DEFINITIONS = Object.freeze([
  {
    actionId: "plan.open",
    description: "Open the current plan",
    contextProvider: "planContext",
  },
  {
    actionId: "plan.close",
    description: "Close the current plan",
    contextProvider: "overlayContext",
  },
  {
    actionId: "plan.uselocation",
    description: "Use precise current location for this session",
    contextProvider: "locationContext",
    confirmationClass: "consequential",
  },
  {
    actionId: "plan.focuslocation",
    description: "Focus the current location",
    contextProvider: "locationContext",
  },
  {
    actionId: "plan.settravelmode",
    description: "Set plan travel mode",
    contextProvider: "planContext",
    argumentSchema: objectSchema({
      mode: { enum: ["walking", "driving", "bicycling", "transit"] },
    }),
    sampleArguments: { mode: "walking" },
  },
  {
    actionId: "plan.addstop",
    description: "Add a visible target to the plan",
    contextProvider: "selectionContext",
    argumentSchema: objectSchema({ targetId: types.id }),
    sampleArguments: { targetId: "event:fixture" },
  },
  {
    actionId: "plan.removestop",
    description: "Remove a plan stop",
    contextProvider: "planContext",
    confirmationClass: "consequential",
    argumentSchema: objectSchema({ stopId: types.id }),
    sampleArguments: { stopId: "stop:fixture" },
  },
  {
    actionId: "plan.reorderstop",
    description: "Reorder a plan stop",
    contextProvider: "planContext",
    argumentSchema: objectSchema({ stopId: types.id, toIndex: types.integer }),
    sampleArguments: { stopId: "stop:fixture", toIndex: 0 },
  },
  {
    actionId: "plan.focusstop",
    description: "Focus a plan stop",
    contextProvider: "planContext",
    argumentSchema: objectSchema({ stopId: types.id }),
    sampleArguments: { stopId: "stop:fixture" },
  },
  {
    actionId: "plan.openroute",
    description: "Open an approved plan route",
    contextProvider: "planContext",
    confirmationClass: "consequential",
    argumentSchema: optional({ segmentIndex: types.integer }),
    sampleArguments: { segmentIndex: 0 },
  },
]);

export const createPlanActionContracts = (options = {}) =>
  actionContracts(PLAN_ACTION_DEFINITIONS, options);
export const registerPlanActions = (registry, options = {}) =>
  registerContracts(registry, createPlanActionContracts(options));
export const PLAN_ACTION_PARITY_CASES = parityCases(PLAN_ACTION_DEFINITIONS);
