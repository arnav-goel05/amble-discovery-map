import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildTransitContextAsset,
  publishStagedTransitContext,
  reconcileTransitContextAsset,
  TransitContextAssetError,
} from "../scripts/build-transit-context.mjs";

const policy = JSON.parse(
  fs.readFileSync(new URL("../data/map-context-sources.json", import.meta.url)),
);
const sourceConfigs = {
  exits: policy.datasets.ltaMrtStationExits,
  railLines: policy.datasets.uraRailLines,
  stationNames: policy.datasets.uraRailStationNames,
  stationCodes: policy.datasets.ltaTrainStationCodes,
};
const observedAt = "2026-07-18T01:00:00.000Z";
const generatedAt = "2026-07-18T01:01:00.000Z";

const point = (name, exit, identity, coordinates) => ({
  type: "Feature",
  properties: {
    STATION_NA: `${name} MRT STATION`,
    EXIT_CODE: exit,
    INC_CRC: identity,
    FMEL_UPD_D: "20260718010000",
  },
  geometry: { type: "Point", coordinates },
});
const collection = (features) => ({ type: "FeatureCollection", features });
const sources = () => ({
  exits: collection([
    point("CITY HALL", "Exit A", "exit-city-a", [103.851, 1.293]),
    point("CITY HALL", "Exit B", "exit-city-b", [103.852, 1.294]),
    point("ESPLANADE", "Exit A", "exit-esplanade-a", [103.855, 1.293]),
    point("KALLANG", "Exit A", "exit-kallang-a", [103.871, 1.311]),
  ]),
  lines: collection([
    {
      type: "Feature",
      properties: {
        INC_CRC: "rail-ew-1",
        RAIL_TYPE: "MRT",
        GRND_LEVEL: "UNDERGROUND",
        FMEL_UPD_D: "20260718010000",
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [103.84, 1.29],
          [103.845, 1.295],
          [103.85, 1.3],
          [103.855, 1.305],
          [103.86, 1.31],
        ],
      },
    },
  ]),
  names: collection([
    {
      type: "Feature",
      properties: { STN_NAM: "City Hall", LINE_CODE: "NS25/EW13" },
      geometry: { type: "Point", coordinates: [103.8515, 1.2935] },
    },
    {
      type: "Feature",
      properties: { STN_NAM: "Esplanade", LINE_CODE: "CC3" },
      geometry: { type: "Point", coordinates: [103.855, 1.293] },
    },
    {
      type: "Feature",
      properties: { STN_NAM: "Kallang", LINE_CODE: "EW10" },
      geometry: { type: "Point", coordinates: [103.871, 1.311] },
    },
  ]),
  codes: {
    result: {
      records: [
        { stn_code: "NS25", mrt_station_english: "City Hall" },
        { stn_code: "EW13", mrt_station_english: "City Hall" },
        { stn_code: "CC3", mrt_station_english: "Esplanade" },
        { stn_code: "EW10", mrt_station_english: "Kallang" },
      ],
    },
  },
});

function build(overrides = {}) {
  const source = sources();
  return buildTransitContextAsset({
    stationExitsGeoJson: source.exits,
    railLinesGeoJson: source.lines,
    stationNamesGeoJson: source.names,
    stationCodesData: source.codes,
    sourceBytes: {
      [sourceConfigs.exits.datasetId]: JSON.stringify(source.exits),
      [sourceConfigs.railLines.datasetId]: JSON.stringify(source.lines),
      [sourceConfigs.stationNames.datasetId]: JSON.stringify(source.names),
      [sourceConfigs.stationCodes.datasetId]: JSON.stringify(source.codes),
    },
    sourceConfigs,
    sourceObservedAt: observedAt,
    generatedAt,
    generatorVersion: "1.0.0-test",
    simplificationTolerance: 0.0001,
    ...overrides,
  });
}

test("station exits consolidate by normalized source name and join approved station metadata", () => {
  const { asset, manifest } = build();
  const stations = asset.features.filter(
    ({ properties }) => properties.featureClass === "station",
  );
  assert.deepEqual(
    stations.map(({ properties }) => properties.stationId),
    [
      "mrt-station:city-hall",
      "mrt-station:esplanade",
      "mrt-station:kallang",
    ],
  );
  assert.deepEqual(stations[0].properties.exitIdentities, [
    "exit-city-a",
    "exit-city-b",
  ]);
  assert.deepEqual(stations[0].properties.lineReferences, [
    "EW13",
    "NS25",
    "NS25/EW13",
  ]);
  assert.ok(Math.abs(stations[0].geometry.coordinates[0] - 103.8515) < 1e-12);
  assert.ok(Math.abs(stations[0].geometry.coordinates[1] - 1.2935) < 1e-12);
  assert.equal(manifest.featureCounts.stations, 3);

  const closeButDifferent = sources();
  closeButDifferent.exits.features[2].geometry.coordinates = [103.8516, 1.2936];
  const result = build({
    stationExitsGeoJson: closeButDifferent.exits,
    sourceBytes: {
      [sourceConfigs.exits.datasetId]: JSON.stringify(closeButDifferent.exits),
      [sourceConfigs.railLines.datasetId]: JSON.stringify(
        closeButDifferent.lines,
      ),
      [sourceConfigs.stationNames.datasetId]: JSON.stringify(
        closeButDifferent.names,
      ),
      [sourceConfigs.stationCodes.datasetId]: JSON.stringify(
        closeButDifferent.codes,
      ),
    },
  });
  assert.equal(
    result.asset.features.filter(
      ({ properties }) => properties.featureClass === "station",
    ).length,
    3,
    "nearby exits with conflicting names must not merge by proximity",
  );
});

test("rail lines retain identity while runtime geometry is simplified and validated", () => {
  const { asset, manifest } = build();
  const line = asset.features.find(
    ({ properties }) => properties.featureClass === "rail_line",
  );
  assert.equal(line.properties.railLineId, "rail-route:ew");
  assert.equal(line.properties.railType, "MRT");
  assert.equal(line.properties.railLineCode, "EW");
  assert.equal(line.properties.simplificationTolerance, 0.0001);
  assert.deepEqual(line.geometry.coordinates[0], [103.871, 1.311]);
  assert.ok(
    Math.abs(line.geometry.coordinates[1][0] - 103.8515) < 1e-12 &&
      Math.abs(line.geometry.coordinates[1][1] - 1.2935) < 1e-12,
  );
  assert.equal(manifest.validationReport.geometry, true);
  assert.equal(manifest.validationReport.simplificationTolerance, 0.0001);

  const invalid = sources();
  invalid.lines.features[0].geometry.coordinates[0] = [0, 0];
  assert.throws(
    () =>
      buildTransitContextAsset({
        ...buildArguments(invalid),
        simplificationTolerance: 0.0001,
      }),
    (error) =>
      error instanceof TransitContextAssetError &&
      error.code === "transit_geometry_invalid",
  );
});

function buildArguments(source) {
  return {
    stationExitsGeoJson: source.exits,
    railLinesGeoJson: source.lines,
    stationNamesGeoJson: source.names,
    stationCodesData: source.codes,
    sourceBytes: {
      [sourceConfigs.exits.datasetId]: JSON.stringify(source.exits),
      [sourceConfigs.railLines.datasetId]: JSON.stringify(source.lines),
      [sourceConfigs.stationNames.datasetId]: JSON.stringify(source.names),
      [sourceConfigs.stationCodes.datasetId]: JSON.stringify(source.codes),
    },
    sourceConfigs,
    sourceObservedAt: observedAt,
    generatedAt,
    generatorVersion: "1.0.0-test",
  };
}

test("manifest hashes every authoritative response and the canonical runtime asset", () => {
  const { manifest } = build();
  assert.equal(manifest.schemaVersion, "1.0");
  assert.equal(manifest.assetId, "singapore-transit-context-v1");
  assert.equal(manifest.status, "review");
  assert.deepEqual(manifest.sourceDatasetIds, [
    sourceConfigs.exits.datasetId,
    sourceConfigs.railLines.datasetId,
    sourceConfigs.stationNames.datasetId,
    sourceConfigs.stationCodes.datasetId,
  ]);
  assert.equal(manifest.licence, "Singapore Open Data Licence");
  assert.equal(manifest.sourceObservedAt, observedAt);
  assert.equal(manifest.generatedAt, generatedAt);
  for (const sourceHash of Object.values(manifest.sourceHashes))
    assert.match(sourceHash, /^[a-f0-9]{64}$/);
  assert.match(manifest.contentHash, /^[a-f0-9]{64}$/);
  assert.equal(manifest.featureCount, 4);
});

test("reconciliation classifies create, noop, update, and unexplained feature loss", () => {
  const current = build();
  assert.equal(reconcileTransitContextAsset(null, current).result, "create");
  assert.equal(reconcileTransitContextAsset(current, build()).result, "noop");
  const update = build();
  update.manifest.contentHash = "changed";
  update.manifest.featureCounts.stations += 1;
  assert.equal(reconcileTransitContextAsset(current, update).result, "update");
  const loss = build();
  loss.manifest.contentHash = "changed";
  loss.manifest.featureCounts.stations -= 1;
  assert.deepEqual(reconcileTransitContextAsset(current, loss), {
    result: "review",
    reason: "unexplained_feature_loss",
  });
});

test("staged publication preserves approved files until all gates pass", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "transit-context-"));
  try {
    const staging = {
      assetPath: path.join(directory, "staging", "transit-context.geojson"),
      manifestPath: path.join(
        directory,
        "staging",
        "transit-context-manifest.json",
      ),
    };
    const final = {
      assetPath: path.join(directory, "approved", "transit-context.geojson"),
      manifestPath: path.join(
        directory,
        "approved",
        "transit-context-manifest.json",
      ),
    };
    fs.mkdirSync(path.dirname(staging.assetPath), { recursive: true });
    fs.mkdirSync(path.dirname(final.assetPath), { recursive: true });
    const staged = build();
    fs.writeFileSync(staging.assetPath, JSON.stringify(staged.asset));
    fs.writeFileSync(staging.manifestPath, JSON.stringify(staged.manifest));
    fs.writeFileSync(final.assetPath, "approved-before");
    fs.writeFileSync(final.manifestPath, "manifest-before");
    assert.deepEqual(
      publishStagedTransitContext({
        staging,
        final,
        requiredGates: { schema: true, geometry: true, mapRender: false },
      }),
      { published: false, result: "review", failedGates: ["mapRender"] },
    );
    assert.equal(fs.readFileSync(final.assetPath, "utf8"), "approved-before");
    const published = publishStagedTransitContext({
      staging,
      final,
      requiredGates: { schema: true, geometry: true, mapRender: true },
    });
    assert.deepEqual(published, {
      published: true,
      result: "create",
      failedGates: [],
    });
    assert.equal(
      JSON.parse(fs.readFileSync(final.manifestPath)).status,
      "approved",
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
