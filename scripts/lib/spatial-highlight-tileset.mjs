const SCHEMA_VERSION = "spatial-highlight-v1";
const SOURCE_TILE_PATTERN = /^(?:tiles\/)?(\d+)\/(\d+)\/(\d+)_(\d+)\.b3dm$/;
const POI_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const POI_FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.b3dm$/;
const CONTENT_URI_PATTERN =
  /^\.\.\/([a-z0-9]+(?:-[a-z0-9]+)*)\/([A-Za-z0-9][A-Za-z0-9._-]*\.b3dm)$/;

function fail(message) {
  throw new Error(`Spatial highlight tileset: ${message}`);
}

function tileUri(tile) {
  return tile?.content?.uri ?? tile?.content?.url ?? null;
}

function normalizedSourceTile(value, context) {
  if (typeof value !== "string") fail(`${context}: missing source tile`);
  const match = value.match(SOURCE_TILE_PATTERN);
  if (!match) fail(`${context}: unsafe or invalid source tile ${value}`);
  return {
    canonical: `${match[1]}/${match[2]}/${match[3]}_${match[4]}.b3dm`,
    spatialKey: `${match[1]}/${match[2]}/${match[3]}`,
    level: Number(match[4]),
  };
}

function validatedRegion(tile, context) {
  const region = tile?.boundingVolume?.region;
  if (
    !Array.isArray(region) ||
    region.length !== 6 ||
    !region.every(Number.isFinite) ||
    region[0] > region[2] ||
    region[1] > region[3] ||
    region[4] > region[5]
  )
    fail(`${context}: invalid six-number bounding region`);
  return [...region];
}

function validatedError(tile, context) {
  const value = tile?.geometricError;
  if (!Number.isFinite(value) || value < 0)
    fail(`${context}: invalid geometric error`);
  return value;
}

function pathKey(path) {
  return path.join(".");
}

export function indexSourceHierarchy(sourceTileset) {
  if (!sourceTileset?.root) fail("source hierarchy has no root");
  const byContent = new Map();
  const byPath = new Map();
  const visit = (tile, path) => {
    byPath.set(pathKey(path), tile);
    const uri = tileUri(tile);
    if (uri) {
      const source = normalizedSourceTile(uri, `source node ${pathKey(path)}`);
      if (byContent.has(source.canonical))
        fail(`duplicate source content ${source.canonical}`);
      byContent.set(source.canonical, { path, source, tile });
    }
    for (const [index, child] of (tile.children ?? []).entries())
      visit(child, [...path, index]);
  };
  visit(sourceTileset.root, []);
  return { byContent, byPath };
}

function validatePoi(poi, seen) {
  if (!poi || !POI_ID_PATTERN.test(poi.id ?? ""))
    fail(`invalid approved POI identity ${poi?.id ?? "(missing)"}`);
  if (seen.has(poi.id)) fail(`duplicate approved POI identity ${poi.id}`);
  seen.add(poi.id);
}

function makeVenueBranches(venue, sourceIndex) {
  const { poi, fragments, resolveContentUri } = venue;
  if (!Array.isArray(fragments) || fragments.length === 0)
    fail(`${poi.id}: extraction manifest contains no fragments`);
  const groups = new Map();
  for (const fragment of fragments) {
    const source = normalizedSourceTile(
      fragment?.sourceTile,
      `${poi.id} fragment`,
    );
    if (!POI_FILE_PATTERN.test(fragment?.poiFile ?? ""))
      fail(`${poi.id}: unsafe poiFile ${fragment?.poiFile ?? "(missing)"}`);
    if (!/^[a-f0-9]{64}$/i.test(fragment?.poiSha256 ?? ""))
      fail(`${poi.id}: invalid fragment hash for ${fragment.poiFile}`);
    const sourceEntry = sourceIndex.byContent.get(source.canonical);
    if (!sourceEntry)
      fail(`${poi.id}: source tile ${fragment.sourceTile} is not present`);
    const group = groups.get(source.spatialKey) ?? [];
    group.push({ fragment, source, sourceEntry });
    groups.set(source.spatialKey, group);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([spatialKey, entries]) => {
      entries.sort((left, right) => right.source.level - left.source.level);
      const levels = new Set();
      let previousError = Infinity;
      for (const entry of entries) {
        if (levels.has(entry.source.level))
          fail(
            `${poi.id}: duplicate level ${entry.source.level} in ${spatialKey}`,
          );
        levels.add(entry.source.level);
        const context = `${poi.id} ${entry.fragment.sourceTile}`;
        const geometricError = validatedError(entry.sourceEntry.tile, context);
        if (geometricError > previousError)
          fail(`${context}: refinement error increases toward finer content`);
        previousError = geometricError;
      }
      const finest = entries.at(-1);
      const context = `${poi.id} ${finest.fragment.sourceTile}`;
      const contentUri = (
        resolveContentUri ??
        (({ poi: item, fragment }) => `../${item.id}/${fragment.poiFile}`)
      )({ poi, fragment: finest.fragment, source: finest.source });
      const contentMatch = contentUri?.match(CONTENT_URI_PATTERN);
      if (
        !contentMatch ||
        contentMatch[1] !== poi.id ||
        contentMatch[2] !== finest.fragment.poiFile
      )
        fail(`${poi.id}: unsafe content URI ${contentUri}`);
      const node = {
        boundingVolume: {
          region: validatedRegion(finest.sourceEntry.tile, context),
        },
        geometricError: 0,
        refine: "ADD",
        content: { uri: contentUri },
        extras: {
          kind: "highlight-fragment",
          poiId: poi.id,
          sourceTile: finest.fragment.sourceTile,
          level: finest.source.level,
          sourceFragmentCount: entries.length,
        },
      };
      return {
        attachmentPath: entries[0].sourceEntry.path.slice(0, -1),
        node,
        poiId: poi.id,
        spatialKey,
        fragmentCount: 1,
        sourceFragmentCount: entries.length,
      };
    });
}

function cloneSparseHierarchy(sourceRoot, branches) {
  const attachments = new Map();
  const requiredPaths = new Set([""]);
  for (const branch of branches) {
    const key = pathKey(branch.attachmentPath);
    const list = attachments.get(key) ?? [];
    list.push(branch);
    attachments.set(key, list);
    for (let length = 0; length <= branch.attachmentPath.length; length += 1)
      requiredPaths.add(pathKey(branch.attachmentPath.slice(0, length)));
  }

  let spatialNodeCount = 0;
  const clone = (source, path) => {
    spatialNodeCount += 1;
    const node = {
      boundingVolume: {
        region: validatedRegion(source, `spatial node ${pathKey(path)}`),
      },
      geometricError: validatedError(source, `spatial node ${pathKey(path)}`),
      refine: "ADD",
      extras: { kind: "spatial-node" },
    };
    const children = [];
    for (const [index, child] of (source.children ?? []).entries()) {
      const childPath = [...path, index];
      if (requiredPaths.has(pathKey(childPath)))
        children.push(clone(child, childPath));
    }
    const localBranches = [...(attachments.get(pathKey(path)) ?? [])].sort(
      (left, right) =>
        left.poiId.localeCompare(right.poiId) ||
        left.spatialKey.localeCompare(right.spatialKey),
    );
    children.push(...localBranches.map(({ node: branch }) => branch));
    node.children = children;
    return node;
  };
  return { root: clone(sourceRoot, []), spatialNodeCount };
}

function sameSet(left, right) {
  return left.size === right.size && [...left].every((item) => right.has(item));
}

export function validateSpatialHighlightTileset(pois, tileset) {
  if (!Array.isArray(pois)) throw new TypeError("POIs must be an array");
  const expectedIds = pois.map((poi) => poi.id);
  const expected = new Set(expectedIds);
  if (expected.size !== expectedIds.length)
    fail("approved POI catalogue contains duplicate identities");
  if (
    tileset?.extras?.schemaVersion !== SCHEMA_VERSION ||
    tileset?.extras?.layout !== "spatial-finest"
  )
    fail("missing spatial-highlight-v1 layout metadata");
  const declaredIds = tileset.extras.venueIds;
  if (!Array.isArray(declaredIds))
    fail("declared venue catalogue does not match approved POIs");
  const declared = new Set(declaredIds);
  if (
    declared.size !== declaredIds.length ||
    !sameSet(expected, declared) ||
    tileset.extras.venueCount !== expected.size
  )
    fail("declared venue catalogue does not match approved POIs");

  const reachable = new Set();
  let fragmentCount = 0;
  let branchCount = 0;
  let sourceFragmentCount = 0;
  let spatialNodeCount = 0;
  let externalTilesetCount = 0;
  const visit = (tile, parentPoiId = null, parentError = Infinity) => {
    validatedRegion(tile, tile?.extras?.sourcePath ?? "generated node");
    validatedError(tile, tile?.extras?.sourcePath ?? "generated node");
    const uri = tileUri(tile);
    const poiId = tile?.extras?.poiId ?? null;
    if (tile?.extras?.kind === "spatial-node") spatialNodeCount += 1;
    if (uri) {
      if (/\.json(?:[?#]|$)/i.test(uri)) externalTilesetCount += 1;
      const contentMatch = uri.match(CONTENT_URI_PATTERN);
      if (!contentMatch) fail(`unsafe content URI ${uri}`);
      if (tile?.extras?.kind !== "highlight-fragment" || !expected.has(poiId))
        fail(`content ${uri} has no approved stable POI identity`);
      if (contentMatch[1] !== poiId)
        fail(`${poiId}: content URI belongs to ${contentMatch[1]}`);
      const source = normalizedSourceTile(
        tile?.extras?.sourceTile,
        `${poiId} generated fragment`,
      );
      if (source.level !== tile?.extras?.level)
        fail(`${poiId}: generated fragment level does not match source tile`);
      if (tile.refine !== "ADD")
        fail(`${poiId}: highlight fragment must refine with ADD`);
      if (tile.geometricError !== 0)
        fail(`${poiId}: finest highlight fragment must have zero error`);
      if ((tile.children?.length ?? 0) !== 0)
        fail(`${poiId}: finest highlight fragment cannot have LOD children`);
      if (
        !Number.isInteger(tile.extras.sourceFragmentCount) ||
        tile.extras.sourceFragmentCount < 1
      )
        fail(`${poiId}: invalid source fragment count`);
      if (parentPoiId === poiId && tile.geometricError > parentError)
        fail(`${poiId}: refinement error increases toward finer content`);
      reachable.add(poiId);
      fragmentCount += 1;
      sourceFragmentCount += tile.extras.sourceFragmentCount;
      if (parentPoiId !== poiId) branchCount += 1;
    }
    for (const child of tile.children ?? [])
      visit(child, poiId, tile.geometricError);
  };
  visit(tileset.root);

  if (!sameSet(expected, reachable))
    fail("reachable fragment identities do not match approved POIs");
  const measures = {
    fragmentCount,
    sourceFragmentCount,
    venueBranchCount: branchCount,
    spatialNodeCount,
    externalTilesetCount,
  };
  for (const [key, actual] of Object.entries(measures))
    if (tileset.extras[key] !== actual)
      fail(`${key} metadata ${tileset.extras[key]} does not match ${actual}`);
  if (externalTilesetCount !== 0)
    fail("external venue tilesets are not allowed");
  return {
    valid: true,
    schemaVersion: SCHEMA_VERSION,
    venueCount: expected.size,
    ...measures,
  };
}

export function buildSpatialHighlightTileset({ sourceTileset, venues }) {
  if (!Array.isArray(venues)) throw new TypeError("Venues must be an array");
  const sourceIndex = indexSourceHierarchy(sourceTileset);
  const seenPois = new Set();
  const branches = [];
  for (const venue of [...venues].sort((left, right) =>
    left.poi.id.localeCompare(right.poi.id),
  )) {
    validatePoi(venue.poi, seenPois);
    branches.push(...makeVenueBranches(venue, sourceIndex));
  }
  const { root, spatialNodeCount } = cloneSparseHierarchy(
    sourceTileset.root,
    branches,
  );
  const venueIds = [...seenPois].sort();
  const tileset = {
    asset: { version: "1.0", generator: "amble-spatial-event-venues" },
    geometricError: validatedError(sourceTileset.root, "source root"),
    root,
    extras: {
      schemaVersion: SCHEMA_VERSION,
      layout: "spatial-finest",
      venueCount: venueIds.length,
      venueIds,
      fragmentCount: branches.reduce(
        (total, branch) => total + branch.fragmentCount,
        0,
      ),
      sourceFragmentCount: branches.reduce(
        (total, branch) => total + branch.sourceFragmentCount,
        0,
      ),
      venueBranchCount: branches.length,
      spatialNodeCount,
      externalTilesetCount: 0,
    },
  };
  validateSpatialHighlightTileset(
    venues.map(({ poi }) => poi),
    tileset,
  );
  return tileset;
}
