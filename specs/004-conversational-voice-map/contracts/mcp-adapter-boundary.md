# MCP Adapter Foundation Boundary

**Feature**: 004 Conversational Voice Map

**Status**: Design contract only; disabled and non-networked

## Purpose

The foundation proves that Amble's version-2 capability registry is transport-neutral. It derives
MCP-shaped descriptors from the same contracts used to generate Realtime function tools. It does
not create a second registry, executor, API, or application backend.

## Projection rules

1. One projection references exactly one registered capability ID and version.
2. Name and description are deterministic bounded derivatives of the registered contract.
3. `inputSchema` is the registered closed argument schema.
4. `resultSchema` is the registered capability-specific result schema wrapped by the common
   capability-result envelope at invocation time.
5. Commands project as tools. Safe bounded queries project as tools and may later also project as
   read-only resource templates without changing their arguments or results.
6. Ineligible capabilities are absent rather than advertised as synthetic placeholders.
7. Caller-origin metadata is diagnostic only.

## Invocation rule

A fixture invocation resolves the projected capability ID through the existing capability gateway.
The gateway performs the same schema validation, context-revision check, eligibility, target
validation, confirmation, connector execution, result validation, and context publication used by
direct and Realtime callers. Projection code cannot invoke a connector directly.

## Disabled-first invariant

Every first-release MCP projection has `enabled: false`. The application registers no MCP route,
listener, server, client, credential, SDK/runtime dependency, external authorization surface,
session manager, rate limiter, or remote confirmation flow.

Enabling a transport requires a separate approved specification covering external identity and
permissions, per-client capability eligibility, rate limits, session isolation, confirmation UX,
data exposure and logging, deployment, revocation, and operations.

## Verification

- Compile every projection against `mcp-tool-projection.schema.json`.
- Compare ID, version, kind, descriptions, argument schema, result schema, confirmation class, and
  eligible-state behavior with the source registry contract.
- Route fixture invocations through the shared gateway and compare structured outcomes with direct
  and Realtime fixtures.
- Inspect production routes, listeners, dependencies, environment bindings, and bundles to prove
  the foundation is disabled and non-networked.
