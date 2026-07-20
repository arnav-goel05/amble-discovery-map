export function isPreciseProviderPin(place, best, second) {
  return Boolean(
    place?.sourceCoordinate &&
    best &&
    ((best.distanceMeters <= 2 &&
      (!second || second.distanceMeters - best.distanceMeters >= 5)) ||
      (best.distanceMeters <= 35 &&
        (!second || second.distanceMeters - best.distanceMeters >= 30))),
  );
}

export function coordinateBuildingChoice(place, buildings) {
  const ordered = [...(buildings ?? [])].sort(
    (a, b) => a.distanceMeters - b.distanceMeters,
  );
  return {
    building: ordered[0] ?? null,
    precise: isPreciseProviderPin(place, ordered[0], ordered[1]),
  };
}

function coordinateDistance(left, right) {
  const radians = (value) => (value * Math.PI) / 180;
  const dLat = radians(right.lat - left.lat),
    dLng = radians(right.lng - left.lng);
  const value =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(left.lat)) *
      Math.cos(radians(right.lat)) *
      Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export function consolidateCoordinateCandidates(
  candidates,
  toleranceMeters = 25,
) {
  const valid = [
    ...new Map(
      (candidates ?? [])
        .filter(
          (item) =>
            Number.isFinite(Number(item?.lat)) &&
            Number.isFinite(Number(item?.lng)) &&
            !(Number(item.lat) === 0 && Number(item.lng) === 0),
        )
        .map((item) => [
          `${Number(item.lat).toFixed(7)},${Number(item.lng).toFixed(7)}`,
          { ...item, lat: Number(item.lat), lng: Number(item.lng) },
        ]),
    ).values(),
  ];
  if (valid.length < 2) return valid;
  const equivalent = valid.every((left, index) =>
    valid
      .slice(index + 1)
      .every((right) => coordinateDistance(left, right) <= toleranceMeters),
  );
  if (!equivalent) return valid;
  const priority = (item) =>
    /(?:venue|official|provider)/i.test(item.source ?? "")
      ? 0
      : /onemap/i.test(item.source ?? "")
        ? 2
        : 1;
  return [valid.toSorted((left, right) => priority(left) - priority(right))[0]];
}

export function groupExactOneMapRows(rows, cleanTilePath = (value) => value) {
  const groups = new Map();
  for (const row of rows) {
    const identity = row.gml_id || row.source_id;
    const group = groups.get(identity) ?? {
      key: `exact:${identity}`,
      name: row.name,
      acceptedGmlNames: [row.name],
      gmlIds: [identity],
      latitude: row.latitude,
      longitude: row.longitude,
      distanceMeters: 0,
      sourceTiles: new Map(),
    };
    if (row.tile_path) {
      const tilePath = cleanTilePath(row.tile_path);
      group.sourceTiles.set(tilePath, [
        ...new Set([...(group.sourceTiles.get(tilePath) || []), row.batch_id]),
      ]);
    }
    groups.set(identity, group);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    sourceTiles: [...group.sourceTiles].map(([tilePath, batchIds]) => ({
      tilePath,
      batchIds,
    })),
  }));
}

export function preferPristineOneMapRows(
  rows,
  cleanTilePath = (value) => value,
) {
  const eligible = (rows ?? []).filter(
    (row) =>
      !String(row.tile_path ?? "").startsWith("public/poi-tiles/") ||
      String(row.tile_path).startsWith("public/poi-tiles/source/"),
  );
  const pristinePaths = new Set(
    eligible
      .filter((row) =>
        String(row.tile_path ?? "").startsWith("public/poi-tiles/source/"),
      )
      .map((row) => cleanTilePath(row.tile_path)),
  );
  return eligible.filter(
    (row) =>
      String(row.tile_path ?? "").startsWith("public/poi-tiles/source/") ||
      !pristinePaths.has(cleanTilePath(row.tile_path)),
  );
}

function normalizedWords(value = "") {
  return String(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function buildingNameVariants(value) {
  const name = normalizedWords(value);
  return [...new Set([name, name.replace(/^the\s+/, "")])].filter(
    (variant) => variant.length >= 4,
  );
}

export function selectAddressNamedBuilding(
  addressCandidates,
  buildings,
  maximumDistanceMeters = 150,
) {
  const addresses = (addressCandidates ?? [])
    .map(normalizedWords)
    .filter(Boolean);
  const matches = (buildings ?? []).filter((building) => {
    const names = buildingNameVariants(building?.name);
    if (
      !names.length ||
      !Number.isFinite(building?.distanceMeters) ||
      building.distanceMeters > maximumDistanceMeters
    )
      return false;
    return addresses.some((address) =>
      names.some((name) => ` ${address} `.includes(` ${name} `)),
    );
  });
  if (matches.length === 1 && matches[0].gmlIds?.length) return matches[0];
  const exactNames = new Set(
    matches.map((building) => normalizedWords(building.name)),
  );
  const groupDiameter = matches.reduce(
    (maximum, left, index) =>
      Math.max(
        maximum,
        ...matches
          .slice(index + 1)
          .map((right) =>
            coordinateDistance(
              { lat: left.latitude, lng: left.longitude },
              { lat: right.latitude, lng: right.longitude },
            ),
          ),
        0,
      ),
    0,
  );
  if (
    matches.length < 2 ||
    exactNames.size !== 1 ||
    groupDiameter > 100 ||
    matches.some(
      (building) => !building.gmlIds?.length || !building.sourceTiles?.length,
    )
  )
    return null;
  const tiles = new Map();
  for (const building of matches)
    for (const tile of building.sourceTiles) {
      const tilePath = tile.tilePath ?? tile.path;
      tiles.set(tilePath, [
        ...new Set([...(tiles.get(tilePath) ?? []), ...(tile.batchIds ?? [])]),
      ]);
    }
  return {
    ...matches[0],
    key: `authoritative-group:${[...exactNames][0]}`,
    gmlIds: [...new Set(matches.flatMap((building) => building.gmlIds))],
    latitude:
      matches.reduce((sum, building) => sum + building.latitude, 0) /
      matches.length,
    longitude:
      matches.reduce((sum, building) => sum + building.longitude, 0) /
      matches.length,
    distanceMeters: Math.min(
      ...matches.map((building) => building.distanceMeters),
    ),
    sourceTiles: [...tiles].map(([tilePath, batchIds]) => ({
      tilePath,
      batchIds,
    })),
    geometryGroup: true,
  };
}
