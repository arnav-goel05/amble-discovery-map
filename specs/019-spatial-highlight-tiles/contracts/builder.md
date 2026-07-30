# Contract: Spatial Highlight Builder

## Library input

```js
buildCombinedPoiTileset({
  pois,
  outputPath,
  sourceTilesetPath,
  resolveTilesetPath,
  resolveContentUri,
});
```

- `pois`: Approved POI catalogue.
- `outputPath`: Candidate destination.
- `sourceTilesetPath`: Optimized hierarchy supplying spatial/refinement evidence.
- `resolveTilesetPath(poi)`: Resolves the existing per-venue tileset; its sibling extraction manifest and fragment directory are used as evidence/assets.
- `resolveContentUri(poi, fragment, context)`: Optional staging-aware direct B3DM URI resolver.

## Success result

Returns the validated spatial tileset with:

- exact approved venue parity;
- deterministic hierarchy and direct content URIs;
- structured counts in `extras`;
- an atomic `create`, `update`, or byte-equivalent `noop` write outcome available to the CLI.

## Failure behavior

Generation fails before replacement when any of the following occurs:

- duplicate or invalid approved identity;
- missing/mismatched extraction manifest;
- no fragments for an approved venue;
- unsafe source or output URI;
- missing extracted B3DM;
- source tile absent from the optimized hierarchy;
- invalid bounds or geometric error;
- duplicate fragment identity;
- invalid source-level ordering or finest-content selection;
- mismatch between approved, declared, and reachable venue sets.

The existing output remains byte-for-byte unchanged.

## CLI

```bash
npm run build:poi-tileset
node scripts/build-combined-poi-tileset.mjs --output <path>
```

The command prints operation and bounded structural metrics. It performs no network access, event collection, venue resolution, or geometry extraction.
