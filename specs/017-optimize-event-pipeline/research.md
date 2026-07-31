# Research: Event Pipeline Optimization

## Baseline evidence

The latest representative full run took about 2h29m. It collected roughly 32k occurrences,
normalized about 422 MB of event/exclusion JSON, resolved 302 venue branches, generated a
multi-gigabyte frontend workspace, and completed with a safely published partial snapshot.
The previous run took about 4h11m and failed late, after most expensive work had completed.

Observed waste:

- collection is predominantly serial across six independent sources;
- rendered-detail fallback is invoked even when direct extraction is already complete for
  some configured source paths;
- 57 missing-venue searches recovered 8 venues while 49 negative results were not reusable
  beyond the same run;
- normalization writes two approximately 200 MB pretty-printed JSON documents;
- successful venue-resolution cache reuse already reduced the venue phase substantially,
  demonstrating that evidence-keyed reuse is effective;
- a small geometry change can trigger broad extraction and copy several gigabytes;
- build, POI separation, and event UI checks can execute in both staged publication and the
  later verification path;
- retries recreate frontend staging and lose reusable generated artifacts;
- finalization, admin reconciliation, and dashboard sync can repeat after retries;
- pipeline verification executes against the live repository, so concurrent workspace
  changes can alter a run without changing its run identity.

## Decisions

### 1. Canonical equivalence is the activation gate

**Decision**: Compare stable identities, fields, evidence, decisions, relationships, source
accounting, venue outcomes, activities, sessions, offers, POIs, landmarks, and gate results
after removing only explicitly documented volatile fields and normalizing ordering.
Unchanged binary/generated assets must retain hashes.

**Rationale**: Count-only comparisons can hide identity, evidence, placement, or lifecycle
regressions. Byte equality is too strict for timestamps and deterministic reorderings.

**Rejected**: Count-only parity; manual spot checks; accepting small unexplained diffs.

### 2. Stage reuse is content-addressed by complete inputs

**Decision**: A checkpoint key combines stage contract version, code identity, configuration,
policy, adapter versions, execution context, upstream artifact hashes, and stage-specific
dependencies. Reuse is permitted only for a terminal successful checkpoint whose referenced
outputs still match their hashes.

**Rationale**: Status-only resume can reuse stale work. Run-ID-only caching prevents safe
cross-retry reuse.

**Rejected**: File-exists checks; modification-time checks; event/source name allowlists.

### 3. Verification remains one authoritative barrier

**Decision**: Stage frontend assembly and verification as separable checkpointed operations,
but publication consumes one required gate set. A gate can be reused only when its command,
environment contract, code/config identity, and every input artifact hash match.

**Rationale**: Removing duplicate invocations is safe only if no quality gate is removed or
implicitly trusted.

**Rejected**: Dropping the later verifier without recording equivalent gate evidence;
rerunning every gate after any unrelated correction.

### 4. Recovery cache is evidence-keyed and persistent

**Decision**: Store positive and negative recovery results outside a single run, keyed by
normalized evidence plus policy/adapter/geographic context. Invalidate immediately on any
declared input change. Otherwise expire negative results after 7 days for events within
30 days and 30 days for later/undated events.

**Rationale**: Most searches repeat a durable “not found” outcome, but locations can be
published close to an event date.

**Rejected**: Permanent negative cache; URL-only cache; source-specific TTLs.

### 5. Independent work is bounded, not globally serial

**Decision**: Permit concurrency only for independent source or recovery work with
per-adapter limits, deterministic result ordering, atomic checkpoints, and isolated failure.
Manual ambiguity becomes a terminal held/review branch rather than a synchronous global wait.

**Rationale**: Provider latency should not block unrelated work, but unbounded concurrency
can violate rate limits and make retries nondeterministic.

**Rejected**: Unlimited `Promise.all`; globally serial work; automatic ambiguity approval.

### 6. Geometry and frontend artifacts are immutable and incremental

**Decision**: Plan changed POIs and proven background dependencies from content hashes.
Reuse unchanged asset trees by immutable reference or hard link/copy-on-write where the
platform supports it. Never delete the previous verified staging tree before a replacement
is verified.

**Rationale**: The frontend workspace dominates disk writes even when only a few POIs change.

**Rejected**: Re-extracting all geometry; mutating active assets in place; trusting names
instead of geometry/content hashes.

### 7. Finalization and delivery use content receipts

**Decision**: Admin reconciliation, publication, status materialization, and dashboard sync
write a receipt keyed by normalized payload, destination, schema, and operation version.
Unchanged retries reuse the receipt while still reporting the prior outcome.

**Rationale**: Finalization must be safely repeatable and observable.

**Rejected**: Timestamp-only “already ran” flags; globally skipping delivery without
content comparison.

### 8. Compact storage is deferred behind parity proof

**Decision**: First add byte metrics and canonical readers. Any switch from pretty JSON to
JSONL, compression, or database-backed intermediates is a later category only if every
consumer and recovery path is proven lossless.

**Rationale**: It can save substantial I/O, but has a larger compatibility surface than
checkpointing and should not be bundled with correctness-sensitive orchestration changes.

**Rejected**: Immediate format migration as the first optimization.

## Full-run decision

Saved-run replay, deterministic fixtures, staged snapshot construction, and existing release
gates can prove the planned categories initially. A new full live collection is necessary
only if the final convergence audit finds a behavior depending on live provider timing,
credential boundaries, or complete assembled snapshot publication that these tests cannot
represent.
