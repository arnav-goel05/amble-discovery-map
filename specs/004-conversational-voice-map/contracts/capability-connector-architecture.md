# Capability and Connector Architecture

**Feature**: 004 Conversational Voice Map

**Contract version**: 2.0

**Reviewed**: 2026-07-26

**Constitution**: 2.4.0

## Architectural rule

The capability registry is the only semantic interface between application features and
conversational clients. Direct controls and assistant commands invoke the same registered executor.
Queries read the same authoritative state that direct controls render. A connector adapts one
domain owner to this registry; it does not contain a second implementation of the domain.

Realtime receives application-owned function tools generated from currently eligible capability
contracts. MCP is not used for the in-app path. A disabled MCP foundation projector derives
transport-neutral descriptors from the same contracts but registers no server, route, listener, or
client. A future separately approved MCP server may consume those projections, but every invocation
must return through this registry and gateway and cannot add capabilities or bypass application
policy.

## Deterministic domain interpretation

Connected voice/text utterances enter a bounded, side-effect-free domain router before capability
execution. A domain interpreter returns `applicable`, `clarification_required`, or `unsupported`
plus a base context revision, bounded current-catalogue clarification choices, and closed proposed
capability calls. It never executes a connector.

The first required interpreter is events. It reuses the direct sentence composer's deterministic
classifier and option catalogue. A complete event sentence is committed only through
`event.applyquery`, which validates its base context/catalogue revision and atomically updates the
canonical sentence, ordered What/When/Where/Price phrases, residual query, and results. Ambiguous,
stale, or invalid compound proposals change nothing. `event.setfilter` and `event.removefilter`
remain available for individual direct phrase edits.

## Foundational read capabilities

| Capability       | Connector           | Purpose                                                                                                                   | Maximum result                                                           |
| ---------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `app.inspect`    | `application-state` | Current viewport, filters, selection, overlays, plan summary, coarse location, transit state, and eligible capability IDs | One bounded snapshot                                                     |
| `catalog.search` | `approved-catalog`  | Search approved areas, events, restaurants, plan stops, and conditional saved/game records                                | 20 items plus total/truncation and composite catalogue-revision metadata |
| `catalog.get`    | `approved-catalog`  | Retrieve allowlisted details for known stable target IDs                                                                  | 10 requested targets                                                     |

The provider does not receive an unbounded full-catalogue dump at session admission. Each result
includes an ordered connector provenance vector and a derived `catalogRevision`. Semantic
validation requires `truncated === (total > items.length)` and a non-null cursor exactly when
another page exists.

## Contract registration and result validation

Registration compiles every embedded argument and result schema as JSON Schema Draft 2020-12.
Registration fails unless both roots are closed objects and all strings, arrays, maps, and recursive
branches have explicit bounds or an approved semantic validator. Runtime validates a returned value
against both `capability-result.schema.json` and the invoked capability's specific result schema
before it can enter provider context.

Version-1 voice action definitions are a generated one-way compatibility view of version-2 command
contracts. They cannot register executors, queries, eligibility, or result semantics. The
compatibility view is removed after protocol-1.1 contract, browser, and deployment gates pass.

## Application connector matrix

| Connector ID          | Authoritative owner                                                      | Query/read responsibility                                                                                                                          | Command families                                                    | Eligibility rule                                                                     |
| --------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `approved-catalog`    | Approved snapshot plus registered candidate providers                    | `catalog.search`, `catalog.get`                                                                                                                    | None                                                                | Active approved snapshot or registered current state exists                          |
| `application-state`   | Context coordinator                                                      | `app.inspect`                                                                                                                                      | None                                                                | Application initialized                                                              |
| `events`              | Event discovery/controller and canonical sentence-composer owner         | Approved event projection, canonical composer state, multi-value `what`/`when`/`where`/`price` filters, occurrences, sessions, and visible results | `event.*`, including atomic `event.applyquery`                      | Event UI mounted; target commands require registered results                         |
| `restaurants`         | Restaurant explorer/controller                                           | Current viewport results, filters, approved references/deals                                                                                       | `restaurant.*`                                                      | Explorer mounted; target commands require current approved result                    |
| `map`                 | Map controller and layer managers                                        | Camera, visible layers, focused target                                                                                                             | Camera/layer `map.*`                                                | Map ready and named layer/target available                                           |
| `discovery-areas`     | Area controller                                                          | Current recommendations, reasons, comparison state                                                                                                 | Area `map.*`                                                        | One or more approved recommendations visible                                         |
| `plan`                | Plan controller                                                          | Ordered stops, mode, route availability                                                                                                            | `plan.*`                                                            | Plan mounted; target commands require current plan state                             |
| `location`            | Shared location controller                                               | Permission, freshness, coarse area; exact coordinates excluded                                                                                     | Location-related `plan.*`; visibility delegates from map capability | Browser capability present; exact use requires confirmation                          |
| `transit`             | Transit layer/controller                                                 | MRT visibility and explicit constraint state                                                                                                       | Visibility delegates from map capability                            | Approved asset loaded                                                                |
| `overlay-navigation`  | Overlay coordinator, attribution controller, and external-route resolver | Active overlay, attribution state, and approved external link kinds                                                                                | `navigation.*`, attribution, confirmed external domain actions      | Matching overlay/target/link exists                                                  |
| `tour`                | Feature-tour controller                                                  | Current step and availability                                                                                                                      | `tour.*`                                                            | Tour control exists; step commands require open tour                                 |
| `conditional-content` | Real saved/game controllers                                              | Saved/game state only when registered                                                                                                              | `saved.*`, `game.*`                                                 | Extension point is not registered until real data and matching direct controls exist |

The first eleven rows are active application connector families. `conditional-content` is a
contracted extension point, not an instantiated first-release connector while saved/game data and
direct launchers are absent.

## Cross-cutting application services

The context coordinator and confirmation gateway are shared services, not connectors. The context
coordinator consumes connector snapshots/subscriptions and owns canonical revision publication.
The confirmation gateway owns fingerprinting, expiry, replay rejection, and accepted-to-executed
transition. Neither service owns domain business logic.

Consent, push-to-talk, confirmation buttons, and microphone lifecycle remain protected browser
controls. A deterministic local lifecycle router may recognize `session.stop`, `session.mute`,
`session.unmute`, and `session.interrupt`; these are not Realtime model tools. Consent and
confirmation are never model-invokable.

## Infrastructure adapters

| Adapter                        | Responsibility                                                                             | Capability semantics                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Realtime provider connector    | Server-owned OpenAI WebSocket, instructions, tool definitions, and function-call lifecycle | Must not execute domain logic                                                                                         |
| Browser audio connector        | Explicit microphone capture, PCM playback, interruption, and cleanup                       | No catalogue or command access                                                                                        |
| Budget repository connector    | Reserve, settle, hold, kill switch, and cumulative cap                                     | May stop Realtime work; cannot change domain results                                                                  |
| Deterministic non-voice access | Ordinary composer, search, and direct controls when Realtime is unavailable                | Uses the same catalogue projection and direct command executors; never consumes captured speech or impersonates voice |

The MCP foundation projector is a disabled protocol adapter, not an active infrastructure
connector. It has no network or authentication responsibility.

## Protocol adapter foundation

Both Realtime function definitions and MCP foundation descriptors are derived views of registered
version-2 contracts:

| Registry field        | Realtime projection                     | MCP foundation projection                                    |
| --------------------- | --------------------------------------- | ------------------------------------------------------------ |
| Capability ID/version | Function identity and protocol metadata | Deterministic tool/resource descriptor identity and metadata |
| Description           | Bounded function description            | Bounded tool/resource description                            |
| Argument schema       | Function parameter schema               | Tool input schema                                            |
| Result schema         | Structured function result validation   | Structured tool/resource result mapping                      |
| Kind/eligibility      | Active tool list filtering              | Eligible descriptor filtering                                |

Commands project as tools. Bounded idempotent queries project as tools and may additionally expose
read-only resource templates only when the same registered arguments and result schema are
preserved. A projection contains no executor. Fixture invocation resolves its capability ID through
the existing gateway with caller-origin metadata that has no authority.

For this release, every MCP foundation descriptor has `enabled: false`. There is no MCP SDK/runtime
dependency, server, listener, route, client, credential, authorization surface, session isolation,
rate limit, remote confirmation flow, or deployment.

## Explicitly excluded connectors

No Gmail, Outlook, Google Calendar, Slack, Teams, SharePoint, Box, Notion, booking, payment,
messaging, or transport-provider connector is included. Amble has no matching anonymous public
feature, consent flow, account lifecycle, or constitutional paid-service exception.

Open-web search is not a conversational connector. Runtime catalogue queries use approved
application data. Existing offline/operational collection pipelines remain separate.

An active MCP transport is also excluded. Adding one requires a separately approved specification
for external identity, authorization, rate limits, isolation, confirmation, exposure/logging, and
operations.

## Command completion sequence

1. The current context revision determines capability eligibility.
2. A direct control, deterministic interpreter, or model proposes an eligible capability with
   closed arguments. `event.applyquery` proposals include their base context and catalogue revision.
3. The gateway validates contract, arguments, target, revision, and confirmation policy.
4. The connector invokes the direct-control executor.
5. The connector emits its authoritative state change.
6. The context coordinator publishes a new canonical revision.
7. The result validator returns status, changed state, affected IDs, bounded data, and the new
   revision.
8. Realtime receives the result and updated eligible tool list before a dependent call proceeds.

If steps 4–7 cannot establish an observable outcome, the result is `failed` or `unavailable`; the
assistant cannot claim success.

For a compound `event.applyquery`, steps 3–6 form one domain transaction: either the complete
composer state is published at one new revision or no query/filter state changes.

For `changed: true`, `contextRevision` MUST be greater than the proposal revision. Equality is valid
only for schema-valid `changed: false`, `empty`, `unavailable`, or `failed` results.

Layer visibility commands are owned semantically by `map` but delegate to the `location` or
`transit` controller. Delegation MUST honor both `visible: true` and `visible: false`; a connector
cannot force a layer visible while reporting success for a hide request.

## Environment parity

Local, test, preview, and production use the same capability definitions, JSON Schemas, projections,
eligibility functions, and parity fixtures. Environment adapters may differ only in approved data
source and policy:

- local/test may use deterministic approved fixtures;
- preview may use a staged approved snapshot;
- production uses the active approved snapshot and runtime repositories.

The release gate compares capability IDs, versions, kinds, argument/result schemas, eligibility for
shared fixtures, and observable outcomes. A production-only capability or result field fails the
gate.

The same gate compiles Realtime and MCP-foundation projections from the registry and verifies
identity/schema/result parity. Production inspection additionally fails if any MCP transport route,
listener, runtime dependency, credential, or registered external client is present.
