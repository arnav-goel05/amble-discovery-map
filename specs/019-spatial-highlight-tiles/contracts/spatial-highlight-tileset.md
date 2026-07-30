# Contract: Spatial Highlight Tileset v1

## Top-level shape

```json
{
  "asset": {
    "version": "1.0",
    "generator": "amble-spatial-event-venues"
  },
  "geometricError": 1415.278,
  "root": {
    "boundingVolume": { "region": [0, 0, 0, 0, 0, 0] },
    "geometricError": 1415.278,
    "refine": "ADD",
    "children": []
  },
  "extras": {
    "schemaVersion": "spatial-highlight-v1",
    "layout": "spatial-finest",
    "venueCount": 1,
    "venueIds": ["stable-venue"],
    "fragmentCount": 1,
    "sourceFragmentCount": 6,
    "venueBranchCount": 1,
    "externalTilesetCount": 0
  }
}
```

## Spatial node

A spatial node has a finite region, a non-negative geometric error, `refine: "ADD"`, no content, and one or more spatial or venue-branch children. It exists only when it has a relevant descendant.

## Venue finest-content node

```json
{
  "boundingVolume": { "region": [1, 0.02, 1.01, 0.03, 0, 80] },
  "geometricError": 0,
  "refine": "ADD",
  "content": {
    "uri": "../stable-venue/fragment-0-hash.b3dm"
  },
  "extras": {
    "kind": "highlight-fragment",
    "poiId": "stable-venue",
    "sourceTile": "tiles/5/19/3_0.b3dm",
    "level": 0,
    "sourceFragmentCount": 6
  }
}
```

The content leaf is the minimum-level, finest available fragment for that `poiId` and `spatialKey`. It has zero geometric error and no children. A venue may have more than one independent leaf when it spans source spatial keys.

## Compatibility

- Consumers continue loading a standard 3D Tiles 1.0 document.
- `content.uri` is canonical; validation may read legacy `content.url` inputs but generated output uses `uri`.
- Existing legacy flat snapshot catalogues remain valid migration inputs.
- Generated spatial output never references a venue `tileset.json`.

## Validation result

```json
{
  "valid": true,
  "schemaVersion": "spatial-highlight-v1",
  "venueCount": 136,
  "fragmentCount": 143,
  "sourceFragmentCount": 818,
  "venueBranchCount": 143,
  "spatialNodeCount": 42,
  "externalTilesetCount": 0
}
```

Validation throws a bounded error with stable venue/source identities when invalid; it never publishes a partial result.
