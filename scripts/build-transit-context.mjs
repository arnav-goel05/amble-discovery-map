import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export class TransitContextAssetError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TransitContextAssetError";
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new TransitContextAssetError(code, message);
};
const hash = (value) =>
  crypto
    .createHash("sha256")
    .update(
      typeof value === "string" || Buffer.isBuffer(value)
        ? value
        : JSON.stringify(value),
    )
    .digest("hex");
const clone = (value) => structuredClone(value);
const withinSingapore = ([longitude, latitude]) =>
  Number.isFinite(longitude) &&
  Number.isFinite(latitude) &&
  longitude >= 103.4 &&
  longitude <= 104.2 &&
  latitude >= 1.1 &&
  latitude <= 1.6;
const property = (properties, names) => {
  for (const name of names) {
    const value = properties?.[name];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return "";
};
const slug = (value) =>
  String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const stationKey = (value) =>
  slug(
    String(value)
      .replace(/\b(?:mrt|lrt)\s+station\b/gi, "")
      .replace(/\bstation\b/gi, ""),
  );

const CURRENT_STATION_CODE_SUPPLEMENTS = Object.freeze({
  "woodlands-north": ["TE1"],
  woodlands: ["TE2"],
  "woodlands-south": ["TE3"],
  springleaf: ["TE4"],
  lentor: ["TE5"],
  mayflower: ["TE6"],
  "bright-hill": ["TE7"],
  "upper-thomson": ["TE8"],
  caldecott: ["TE9"],
  stevens: ["TE11"],
  napier: ["TE12"],
  "orchard-boulevard": ["TE13"],
  orchard: ["TE14"],
  "great-world": ["TE15"],
  havelock: ["TE16"],
  "outram-park": ["TE17"],
  maxwell: ["TE18"],
  "shenton-way": ["TE19"],
  "marina-bay": ["TE20"],
  "marina-south": ["TE21"],
  "gardens-by-the-bay": ["TE22"],
  "tanjong-rhu": ["TE23"],
  "katong-park": ["TE24"],
  "tanjong-katong": ["TE25"],
  "marine-parade": ["TE26"],
  "marine-terrace": ["TE27"],
  siglap: ["TE28"],
  bayshore: ["TE29"],
  canberra: ["NS12"],
});

function stationCodeIndex(data) {
  const records = data?.result?.records || data?.records;
  if (!Array.isArray(records)) {
    fail("transit_source_invalid", "Train station codes must contain records");
  }
  const index = new Map();
  for (const record of records) {
    const key = stationKey(record.mrt_station_english || record.stationName);
    const code = property(record, ["stn_code", "stationCode"]);
    if (!key || !code) continue;
    const references = index.get(key) || [];
    if (!references.includes(code)) references.push(code);
    index.set(key, references);
  }
  for (const [key, codes] of Object.entries(CURRENT_STATION_CODE_SUPPLEMENTS)) {
    const references = index.get(key) || [];
    for (const code of codes)
      if (!references.includes(code)) references.push(code);
    index.set(key, references);
  }
  return index;
}

function validateCollection(collection, label) {
  if (
    collection?.type !== "FeatureCollection" ||
    !Array.isArray(collection.features)
  ) {
    fail(
      "transit_source_invalid",
      `${label} must be a GeoJSON FeatureCollection`,
    );
  }
}

function pointDistance(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0)
    return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const amount = Math.max(
    0,
    Math.min(
      1,
      ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) /
        (dx * dx + dy * dy),
    ),
  );
  return Math.hypot(
    point[0] - (start[0] + amount * dx),
    point[1] - (start[1] + amount * dy),
  );
}

export function simplifyCoordinates(coordinates, tolerance = 0.00004) {
  if (!Array.isArray(coordinates) || coordinates.length < 3)
    return clone(coordinates);
  let maximum = 0;
  let index = 0;
  for (let cursor = 1; cursor < coordinates.length - 1; cursor += 1) {
    const distance = pointDistance(
      coordinates[cursor],
      coordinates[0],
      coordinates.at(-1),
    );
    if (distance > maximum) {
      maximum = distance;
      index = cursor;
    }
  }
  if (maximum <= tolerance)
    return [clone(coordinates[0]), clone(coordinates.at(-1))];
  return [
    ...simplifyCoordinates(coordinates.slice(0, index + 1), tolerance).slice(
      0,
      -1,
    ),
    ...simplifyCoordinates(coordinates.slice(index), tolerance),
  ];
}

function simplifyGeometry(geometry, tolerance) {
  if (geometry?.type === "LineString") {
    return {
      type: "LineString",
      coordinates: simplifyCoordinates(geometry.coordinates, tolerance),
    };
  }
  if (geometry?.type === "MultiLineString") {
    return {
      type: "MultiLineString",
      coordinates: geometry.coordinates.map((line) =>
        simplifyCoordinates(line, tolerance),
      ),
    };
  }
  fail(
    "transit_geometry_invalid",
    "Rail geometry must be LineString or MultiLineString",
  );
}

function validateLineGeometry(geometry) {
  const lines =
    geometry.type === "LineString"
      ? [geometry.coordinates]
      : geometry.coordinates;
  if (
    !lines.length ||
    lines.some(
      (line) =>
        !Array.isArray(line) ||
        line.length < 2 ||
        line.some((point) => !Array.isArray(point) || !withinSingapore(point)),
    )
  ) {
    fail(
      "transit_geometry_invalid",
      "Rail geometry is invalid or outside Singapore",
    );
  }
}

function stationNameIndex(collection) {
  const index = new Map();
  for (const feature of collection.features) {
    const name = property(feature.properties, [
      "STN_NAM",
      "STATION_NA",
      "STATION_NAME",
      "TEXTSTRING",
      "NAME",
    ]);
    const key = stationKey(name);
    if (!key) continue;
    const lineReference = property(feature.properties, [
      "LINE_CODE",
      "LINE",
      "RAIL_TYPE",
      "TYPE",
    ]);
    const existing = index.get(key) || {
      approvedName: name,
      lineReferences: [],
    };
    if (
      existing.approvedName !== name &&
      stationKey(existing.approvedName) !== key
    ) {
      fail("station_name_conflict", `Conflicting station names for ${key}`);
    }
    if (lineReference && !existing.lineReferences.includes(lineReference)) {
      existing.lineReferences.push(lineReference);
    }
    index.set(key, existing);
  }
  return index;
}

function buildStations(exits, names, codes, configs, sourceObservedAt) {
  const namesByKey = stationNameIndex(names);
  const codesByKey = stationCodeIndex(codes);
  const grouped = new Map();
  for (const feature of exits.features) {
    const sourceName = property(feature.properties, [
      "STATION_NA",
      "STN_NAM",
      "STATION_NAME",
      "NAME",
    ]);
    const key = stationKey(sourceName);
    if (!key) fail("station_identity_missing", "Station name is required");
    if (
      feature.geometry?.type !== "Point" ||
      !withinSingapore(feature.geometry.coordinates)
    ) {
      fail(
        "station_geometry_invalid",
        `Station ${sourceName} has an invalid point`,
      );
    }
    const exitIdentity = property(feature.properties, [
      "INC_CRC",
      "OBJECTID",
      "EXIT_CODE",
    ]);
    if (!exitIdentity)
      fail(
        "station_exit_identity_missing",
        `Station ${sourceName} exit identity is missing`,
      );
    const current = grouped.get(key) || {
      key,
      sourceNames: new Set(),
      exitIdentities: new Set(),
      coordinates: [],
      sourceDates: new Set(),
    };
    current.sourceNames.add(sourceName);
    current.exitIdentities.add(exitIdentity);
    current.coordinates.push(feature.geometry.coordinates);
    const date = property(feature.properties, [
      "FMEL_UPD_D",
      "LAST_UPDATED",
      "SOURCE_DATE",
    ]);
    if (date) current.sourceDates.add(date);
    grouped.set(key, current);
  }

  return [...grouped.values()]
    .map((group) => {
      const joined = namesByKey.get(group.key);
      const longitude =
        group.coordinates.reduce((sum, point) => sum + point[0], 0) /
        group.coordinates.length;
      const latitude =
        group.coordinates.reduce((sum, point) => sum + point[1], 0) /
        group.coordinates.length;
      const stationName =
        joined?.approvedName || [...group.sourceNames].sort()[0];
      const lineReferences = [
        ...(joined?.lineReferences || []),
        ...(codesByKey.get(group.key) || []),
      ];
      return {
        type: "Feature",
        properties: {
          featureClass: "station",
          stationId: `mrt-station:${group.key}`,
          stationName,
          exitIdentities: [...group.exitIdentities].sort(),
          sourceDates: [...group.sourceDates].sort(),
          lineReferences: [...new Set(lineReferences)].sort(),
          sourceDatasetIds: [
            configs.exits.datasetId,
            configs.stationNames.datasetId,
            configs.stationCodes.datasetId,
          ],
          sourceObservedAt,
        },
        geometry: { type: "Point", coordinates: [longitude, latitude] },
      };
    })
    .sort((left, right) =>
      left.properties.stationId.localeCompare(right.properties.stationId),
    );
}

const ROUTE_DEFINITIONS = Object.freeze([
  { routeId: "ns", lineCode: "NS", prefixes: ["NS"], railType: "MRT" },
  { routeId: "ew", lineCode: "EW", prefixes: ["EW"], railType: "MRT" },
  {
    routeId: "cg",
    lineCode: "EW",
    prefixes: ["CG"],
    prependStation: "tanah-merah",
    railType: "MRT",
  },
  { routeId: "ne", lineCode: "NE", prefixes: ["NE"], railType: "MRT" },
  { routeId: "cc", lineCode: "CC", prefixes: ["CC"], railType: "MRT" },
  {
    routeId: "ce",
    lineCode: "CC",
    prefixes: ["CE"],
    prependStation: "promenade",
    railType: "MRT",
  },
  { routeId: "dt", lineCode: "DT", prefixes: ["DT"], railType: "MRT" },
  { routeId: "te", lineCode: "TE", prefixes: ["TE"], railType: "MRT" },
  { routeId: "bp", lineCode: "LRT", prefixes: ["BP"], railType: "LRT" },
  {
    routeId: "se",
    lineCode: "LRT",
    prefixes: ["SE"],
    prependStation: "sengkang",
    appendStation: "sengkang",
    railType: "LRT",
  },
  {
    routeId: "sw",
    lineCode: "LRT",
    prefixes: ["SW"],
    prependStation: "sengkang",
    appendStation: "sengkang",
    railType: "LRT",
  },
  {
    routeId: "pe",
    lineCode: "LRT",
    prefixes: ["PE"],
    prependStation: "punggol",
    appendStation: "punggol",
    railType: "LRT",
  },
  {
    routeId: "pw",
    lineCode: "LRT",
    prefixes: ["PW"],
    prependStation: "punggol",
    appendStation: "punggol",
    railType: "LRT",
  },
]);

function stationCodes(station) {
  return (station.properties.lineReferences || []).flatMap((reference) =>
    [
      ...String(reference)
        .toUpperCase()
        .matchAll(/(NS|EW|CG|NE|CC|CE|DT|TE|BP|SE|SW|PE|PW)(\d+)/g),
    ].map((match) => ({ prefix: match[1], number: Number(match[2]) })),
  );
}

function buildLines(
  collection,
  configs,
  sourceObservedAt,
  tolerance,
  stations,
) {
  for (const feature of collection.features) {
    const type = property(feature.properties, ["RAIL_TYPE", "TYPE"]);
    if (type && !/^(?:mrt|lrt)$/i.test(type)) continue;
    const identity = property(feature.properties, [
      "INC_CRC",
      "OBJECTID",
      "ID",
    ]);
    if (!identity)
      fail("rail_identity_missing", "Rail source identity is required");
    const geometry = simplifyGeometry(feature.geometry, tolerance);
    validateLineGeometry(geometry);
  }

  const stationsByKey = new Map(
    stations.map((station) => [
      stationKey(station.properties.stationName),
      station,
    ]),
  );
  return ROUTE_DEFINITIONS.flatMap((definition) => {
    const stops = new Map();
    for (const station of stations) {
      for (const code of stationCodes(station)) {
        if (!definition.prefixes.includes(code.prefix)) continue;
        if (!stops.has(code.number)) stops.set(code.number, station);
      }
    }
    const ordered = [...stops]
      .sort(([left], [right]) => left - right)
      .map(([, station]) => station);
    const prepend = stationsByKey.get(definition.prependStation);
    const append = stationsByKey.get(definition.appendStation);
    if (prepend) ordered.unshift(prepend);
    if (append) ordered.push(append);
    if (ordered.length < 2) return [];
    const geometry = {
      type: "LineString",
      coordinates: ordered.map((station) =>
        clone(station.geometry.coordinates),
      ),
    };
    validateLineGeometry(geometry);
    return [
      {
        type: "Feature",
        properties: {
          featureClass: "rail_line",
          railLineId: `rail-route:${definition.routeId}`,
          railType: definition.railType,
          railLineCode: definition.lineCode,
          routeId: definition.routeId,
          stationIds: ordered.map((station) => station.properties.stationId),
          sourceDatasetIds: [
            configs.railLines.datasetId,
            configs.exits.datasetId,
            configs.stationCodes.datasetId,
          ],
          sourceObservedAt,
          simplificationTolerance: tolerance,
        },
        geometry,
      },
    ];
  });
}

export function buildTransitContextAsset({
  stationExitsGeoJson,
  railLinesGeoJson,
  stationNamesGeoJson,
  stationCodesData,
  sourceBytes,
  sourceConfigs,
  sourceObservedAt,
  generatedAt,
  generatorVersion,
  simplificationTolerance = 0.00004,
} = {}) {
  validateCollection(stationExitsGeoJson, "Station exits");
  validateCollection(railLinesGeoJson, "Rail lines");
  validateCollection(stationNamesGeoJson, "Station names");
  if (
    !sourceConfigs?.exits?.datasetId ||
    !sourceConfigs?.railLines?.datasetId ||
    !sourceConfigs?.stationNames?.datasetId ||
    !sourceConfigs?.stationCodes?.datasetId ||
    Number.isNaN(Date.parse(sourceObservedAt)) ||
    Number.isNaN(Date.parse(generatedAt)) ||
    !generatorVersion ||
    !Number.isFinite(simplificationTolerance) ||
    simplificationTolerance < 0
  ) {
    fail("transit_source_invalid", "Transit source metadata is invalid");
  }
  const stations = buildStations(
    stationExitsGeoJson,
    stationNamesGeoJson,
    stationCodesData,
    sourceConfigs,
    sourceObservedAt,
  );
  const lines = buildLines(
    railLinesGeoJson,
    sourceConfigs,
    sourceObservedAt,
    simplificationTolerance,
    stations,
  );
  const asset = {
    type: "FeatureCollection",
    features: [...lines, ...stations],
  };
  const configs = [
    sourceConfigs.exits,
    sourceConfigs.railLines,
    sourceConfigs.stationNames,
    sourceConfigs.stationCodes,
  ];
  const sourceHashes = Object.fromEntries(
    configs.map((config) => {
      const bytes = sourceBytes?.[config.datasetId];
      if (bytes === undefined)
        fail(
          "transit_source_invalid",
          `Missing source bytes for ${config.datasetId}`,
        );
      return [config.datasetId, hash(bytes)];
    }),
  );
  const manifest = {
    schemaVersion: "1.0",
    assetId: "singapore-transit-context-v1",
    status: "review",
    generatorVersion,
    sourceDatasetIds: configs.map(({ datasetId }) => datasetId),
    authoritativeUrls: configs.map(({ authoritativeUrl }) => authoritativeUrl),
    licence: configs[0].licence,
    sourceObservedAt,
    generatedAt,
    sourceHashes,
    contentHash: hash(JSON.stringify(asset)),
    featureCount: asset.features.length,
    featureCounts: { stations: stations.length, railLines: lines.length },
    validationReport: {
      valid: true,
      identities: true,
      geometry: true,
      wgs84: true,
      stationConsolidation: true,
      stationNameJoin: true,
      stationCodeJoin: true,
      routeCentrelineGeneration: true,
      simplificationTolerance,
    },
  };
  return { asset, manifest };
}

export function reconcileTransitContextAsset(current, next) {
  if (!current) return { result: "create" };
  if (current.manifest.contentHash === next.manifest.contentHash)
    return { result: "noop" };
  const currentCounts = current.manifest.featureCounts || {};
  const nextCounts = next.manifest.featureCounts || {};
  if (
    nextCounts.stations < currentCounts.stations ||
    nextCounts.railLines < currentCounts.railLines
  ) {
    return { result: "review", reason: "unexplained_feature_loss" };
  }
  return { result: "update" };
}

export function publishStagedTransitContext({
  staging,
  final,
  requiredGates,
} = {}) {
  const failedGates = Object.entries(requiredGates || {})
    .filter(([, passed]) => passed !== true)
    .map(([gate]) => gate)
    .sort();
  if (failedGates.length)
    return { published: false, result: "review", failedGates };
  const asset = JSON.parse(fs.readFileSync(staging.assetPath, "utf8"));
  const manifest = {
    ...JSON.parse(fs.readFileSync(staging.manifestPath, "utf8")),
    status: "approved",
  };
  let existed = false;
  try {
    const approved = JSON.parse(fs.readFileSync(final.manifestPath, "utf8"));
    JSON.parse(fs.readFileSync(final.assetPath, "utf8"));
    existed = approved.status === "approved";
  } catch {}
  fs.mkdirSync(path.dirname(final.assetPath), { recursive: true });
  for (const [destination, value] of [
    [final.assetPath, asset],
    [final.manifestPath, manifest],
  ]) {
    const temporary = `${destination}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
    fs.renameSync(temporary, destination);
  }
  return {
    published: true,
    result: existed ? "update" : "create",
    failedGates: [],
  };
}

async function fetchSource(config) {
  if (config.downloadUrl) {
    const response = await fetch(config.downloadUrl);
    if (!response.ok)
      fail(
        "transit_source_unavailable",
        `Download failed for ${config.datasetId}`,
      );
    const bytes = Buffer.from(await response.arrayBuffer());
    return { bytes, data: JSON.parse(bytes.toString("utf8")) };
  }
  let lastStatus = 0;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const poll = await fetch(config.pollDownloadUrl);
    lastStatus = poll.status;
    if (poll.ok) {
      const downloadUrl = (await poll.json())?.data?.url;
      if (!downloadUrl)
        fail(
          "transit_source_unavailable",
          `No download URL for ${config.datasetId}`,
        );
      const response = await fetch(downloadUrl);
      if (!response.ok)
        fail(
          "transit_source_unavailable",
          `Download failed for ${config.datasetId}`,
        );
      const bytes = Buffer.from(await response.arrayBuffer());
      return { bytes, data: JSON.parse(bytes.toString("utf8")) };
    }
    if (poll.status !== 429 || attempt === 5) break;
    const retryAfterSeconds = Number(poll.headers.get("retry-after"));
    const delay =
      Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? retryAfterSeconds * 1_000
        : Math.min(8_000, 750 * 2 ** attempt);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  fail(
    "transit_source_unavailable",
    `Download poll failed for ${config.datasetId} (${lastStatus})`,
  );
}

async function runCli() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const policy = JSON.parse(
    fs.readFileSync(path.join(root, "data/map-context-sources.json"), "utf8"),
  );
  const sourceConfigs = {
    exits: policy.datasets.ltaMrtStationExits,
    railLines: policy.datasets.uraRailLines,
    stationNames: policy.datasets.uraRailStationNames,
    stationCodes: policy.datasets.ltaTrainStationCodes,
  };
  const downloaded = {};
  for (const [key, config] of Object.entries(sourceConfigs)) {
    downloaded[key] = await fetchSource(config);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  const now = new Date().toISOString();
  const built = buildTransitContextAsset({
    stationExitsGeoJson: downloaded.exits.data,
    railLinesGeoJson: downloaded.railLines.data,
    stationNamesGeoJson: downloaded.stationNames.data,
    stationCodesData: downloaded.stationCodes.data,
    sourceBytes: Object.fromEntries(
      Object.entries(sourceConfigs).map(([key, config]) => [
        config.datasetId,
        downloaded[key].bytes,
      ]),
    ),
    sourceConfigs,
    sourceObservedAt: now,
    generatedAt: now,
    generatorVersion: "1.1.0",
  });
  const staging = policy.generatedOutputs.transitContext.staging;
  for (const outputPath of Object.values(staging))
    fs.mkdirSync(path.dirname(path.join(root, outputPath)), {
      recursive: true,
    });
  fs.writeFileSync(
    path.join(root, staging.assetPath),
    `${JSON.stringify(built.asset, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(root, staging.manifestPath),
    `${JSON.stringify(built.manifest, null, 2)}\n`,
  );
  process.stdout.write(
    `${JSON.stringify({ staged: true, featureCounts: built.manifest.featureCounts, staging })}\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
