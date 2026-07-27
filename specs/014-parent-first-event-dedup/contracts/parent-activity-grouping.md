# Contract: Parent Activity Grouping and Repair

## Projection Input

The activity projector accepts normalized event occurrences containing stable occurrence and source-parent identities, schedule evidence, venue resolution, source URLs, and provenance.

## Projection Output

The projector returns:

- `activities`: schema-versioned activity records with sessions, venue groups, and offers;
- `reviews`: isolated unresolved grouping items;
- `decisions`: deterministic reconciliation plus parent-candidate decisions;
- counts for input occurrences, activities, sessions, venue groups, offers, parent merges, and reviews.

Every input occurrence must be represented exactly once in an activity or explicit review accounting.

## Accepted Parent Merge

A merge requires:

1. compatible non-generic normalized titles; and
2. at least one strong corroborator:
   - same single-product identity;
   - compatible organizer evidence;
   - same approved venue plus compatible schedule coverage;
   - existing approved shared activity membership.

Different source parents may contribute many child sessions. This one-to-many relationship is not sibling ambiguity.

## Rejected or Reviewed Parent Merge

- Conflicting edition or organizer evidence keeps parents distinct.
- Conflicting approved venues create `parent_venue_conflict` review evidence.
- Generic titles without stronger identity remain distinct.
- Collection/editorial landing-page URLs do not count as single-product identity.

## Repair Command

The existing snapshot migration command gains a parent-dedup repair mode.

```text
npm run event-snapshot:migrate-activities -- --repair-parent-dedup
npm run event-snapshot:migrate-activities -- --repair-parent-dedup --activate
```

Without `--activate`, the command stages and validates a new immutable snapshot. With `--activate`, it atomically updates `data/approved-snapshot.json` only after successful validation.

The command:

- performs no source collection or network request;
- reads the current active snapshot and its internal event catalogue;
- preserves the current snapshot for rollback;
- reports before/after activity, session, venue-group, offer, merge, and review counts;
- is idempotent for identical source content.
