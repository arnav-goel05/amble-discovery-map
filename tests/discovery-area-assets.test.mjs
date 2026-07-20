import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DiscoveryAreaAssetError,
  buildDiscoveryAreaAsset,
  joinCandidatesToDiscoveryAreas,
  publishStagedDiscoveryAreas,
  reconcileDiscoveryAreaAsset,
} from "../scripts/build-discovery-areas.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePolicy = JSON.parse(
  fs.readFileSync(path.join(root, "data/map-context-sources.json"), "utf8"),
);
const sourceConfig = sourcePolicy.datasets.uraSubzones;
const SOURCE_OBSERVED_AT = "2026-07-18T00:00:00.000Z";
const GENERATED_AT = "2026-07-18T00:01:00.000Z";

const square = (west, south, east, north) => [
  [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ],
];

const feature = ({
  code,
  name,
  planningAreaCode,
  planningAreaName,
  coordinates,
  geometryType = "Polygon",
}) => ({
  type: "Feature",
  properties: {
    SUBZONE_C: code,
    SUBZONE_N: name,
    PLN_AREA_C: planningAreaCode,
    PLN_AREA_N: planningAreaName,
    REGION_N: "CENTRAL REGION",
  },
  geometry: { type: geometryType, coordinates },
});

const sourceGeoJson = () => ({
  type: "FeatureCollection",
  features: [
    feature({
      code: "MRS",
      name: "MARINA SOUTH",
      planningAreaCode: "DT",
      planningAreaName: "DOWNTOWN CORE",
      coordinates: square(103.85, 1.27, 103.87, 1.29),
    }),
    feature({
      code: "CTH",
      name: "CITY HALL",
      planningAreaCode: "DT",
      planningAreaName: "DOWNTOWN CORE",
      coordinates: square(103.84, 1.29, 103.86, 1.31),
    }),
  ],
});

const build = (source = sourceGeoJson()) =>
  buildDiscoveryAreaAsset({
    sourceGeoJson: source,
    sourceBytes: JSON.stringify(source),
    sourceConfig,
    sourceObservedAt: SOURCE_OBSERVED_AT,
    generatedAt: GENERATED_AT,
    generatorVersion: "1.0.0-test",
  });

const rejectsWith = (callback, code) =>
  assert.throws(
    callback,
    (error) => error instanceof DiscoveryAreaAssetError && error.code === code,
  );

test("URA source is pinned to the authoritative no-sea GeoJSON dataset", () => {
  assert.deepEqual(sourceConfig, {
    datasetId: "d_8594ae9ff96d0c708bc2af633048edfb",
    title: "Master Plan 2019 Subzone Boundary (No Sea) (GEOJSON)",
    agency: "Urban Redevelopment Authority",
    format: "GeoJSON",
    authoritativeUrl:
      "https://data.gov.sg/datasets/d_8594ae9ff96d0c708bc2af633048edfb/view",
    pollDownloadUrl:
      "https://api-open.data.gov.sg/v1/public/api/datasets/d_8594ae9ff96d0c708bc2af633048edfb/poll-download",
    licence: "Singapore Open Data Licence",
    sourcePeriod: "2021-09",
    catalogueLastUpdatedOn: "2025-12-03",
  });
  assert.equal(
    sourcePolicy.generatedOutputs.discoveryAreas.staging.assetPath,
    "outputs/map-context-staging/discovery-areas.geojson",
  );
  assert.equal(
    sourcePolicy.generatedOutputs.discoveryAreas.final.assetPath,
    "data/discovery-areas.geojson",
  );
});

test("generation validates WGS84 geometry and emits complete provenance", () => {
  const { asset, manifest } = build();

  assert.equal(asset.type, "FeatureCollection");
  assert.deepEqual(
    asset.features.map(({ properties }) => properties.areaId),
    ["ura-subzone:cth", "ura-subzone:mrs"],
  );
  for (const item of asset.features) {
    assert.match(item.properties.areaId, /^ura-subzone:[a-z0-9-]+$/);
    assert.equal(item.properties.sourceDatasetId, sourceConfig.datasetId);
    assert.equal(item.properties.sourceObservedAt, SOURCE_OBSERVED_AT);
    assert.match(item.properties.sourceFeatureHash, /^[a-f0-9]{64}$/);
    assert.match(item.geometry.type, /^(?:Polygon|MultiPolygon)$/);
  }
  assert.equal(manifest.schemaVersion, "1.0");
  assert.equal(manifest.assetId, "discovery-areas-v1");
  assert.equal(manifest.status, "review");
  assert.deepEqual(manifest.sourceDatasetIds, [sourceConfig.datasetId]);
  assert.deepEqual(manifest.authoritativeUrls, [sourceConfig.authoritativeUrl]);
  assert.equal(manifest.licence, "Singapore Open Data Licence");
  assert.equal(manifest.sourceObservedAt, SOURCE_OBSERVED_AT);
  assert.equal(manifest.generatedAt, GENERATED_AT);
  assert.equal(manifest.featureCount, 2);
  assert.match(manifest.sourceHashes[sourceConfig.datasetId], /^[a-f0-9]{64}$/);
  assert.match(manifest.contentHash, /^[a-f0-9]{64}$/);
  assert.equal(manifest.validationReport.valid, true);

  const outsideSingapore = sourceGeoJson();
  outsideSingapore.features[0].geometry.coordinates = square(0, 0, 1, 1);
  rejectsWith(() => build(outsideSingapore), "area_geometry_outside_singapore");
  const invalidRing = sourceGeoJson();
  invalidRing.features[0].geometry.coordinates[0].pop();
  rejectsWith(() => build(invalidRing), "area_geometry_invalid");
});

test("SUBZONE_C produces unique stable identity independent of source order", () => {
  const first = build(sourceGeoJson()).asset;
  const reversedSource = sourceGeoJson();
  reversedSource.features.reverse();
  const second = build(reversedSource).asset;

  assert.deepEqual(first, second);

  const duplicate = sourceGeoJson();
  duplicate.features[1].properties.SUBZONE_C = "MRS";
  rejectsWith(() => build(duplicate), "area_identity_duplicate");
  const missing = sourceGeoJson();
  delete missing.features[0].properties.SUBZONE_C;
  rejectsWith(() => build(missing), "area_identity_missing");
});

test("candidate coordinates join deterministically and unresolved points enter review", () => {
  const { asset } = build();
  const result = joinCandidatesToDiscoveryAreas(
    [
      {
        candidateId: "candidate:marina",
        coordinates: [103.86, 1.28],
      },
      {
        candidateId: "candidate:city-hall",
        coordinates: [103.85, 1.3],
      },
      {
        candidateId: "candidate:outside",
        coordinates: [103.7, 1.4],
      },
    ],
    asset,
  );

  assert.deepEqual(result.joined, [
    { candidateId: "candidate:city-hall", areaId: "ura-subzone:cth" },
    { candidateId: "candidate:marina", areaId: "ura-subzone:mrs" },
  ]);
  assert.deepEqual(result.review, [
    {
      candidateId: "candidate:outside",
      reason: "area_not_resolved",
    },
  ]);
});

test("reconciliation classifies create, update, noop, and unexplained feature loss", () => {
  const current = build();
  assert.equal(reconcileDiscoveryAreaAsset(null, current).result, "create");
  assert.equal(reconcileDiscoveryAreaAsset(current, build()).result, "noop");

  const changedSource = sourceGeoJson();
  changedSource.features[0].properties.SUBZONE_N = "MARINA SOUTH UPDATED";
  assert.equal(
    reconcileDiscoveryAreaAsset(current, build(changedSource)).result,
    "update",
  );

  const featureLoss = sourceGeoJson();
  featureLoss.features.pop();
  const review = reconcileDiscoveryAreaAsset(current, build(featureLoss));
  assert.equal(review.result, "review");
  assert.equal(review.reason, "unexplained_feature_loss");
});

test("publication uses staged paths and preserves the approved pair until every gate passes", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "discovery-area-publication-"),
  );
  try {
    const staging = {
      assetPath: path.join(directory, "staging", "discovery-areas.geojson"),
      manifestPath: path.join(
        directory,
        "staging",
        "discovery-areas-manifest.json",
      ),
    };
    const final = {
      assetPath: path.join(directory, "approved", "discovery-areas.geojson"),
      manifestPath: path.join(
        directory,
        "approved",
        "discovery-areas-manifest.json",
      ),
    };
    fs.mkdirSync(path.dirname(staging.assetPath), { recursive: true });
    fs.mkdirSync(path.dirname(final.assetPath), { recursive: true });
    const staged = build();
    fs.writeFileSync(staging.assetPath, JSON.stringify(staged.asset));
    fs.writeFileSync(staging.manifestPath, JSON.stringify(staged.manifest));
    fs.writeFileSync(final.assetPath, "approved-asset-before");
    fs.writeFileSync(final.manifestPath, "approved-manifest-before");

    const requiredGates = {
      schema: true,
      identity: true,
      geometry: true,
      provenance: true,
      build: true,
      mapRender: true,
      performance: false,
    };
    assert.deepEqual(
      publishStagedDiscoveryAreas({ staging, final, requiredGates }),
      { published: false, result: "review", failedGates: ["performance"] },
    );
    assert.equal(
      fs.readFileSync(final.assetPath, "utf8"),
      "approved-asset-before",
    );
    assert.equal(
      fs.readFileSync(final.manifestPath, "utf8"),
      "approved-manifest-before",
    );

    const published = publishStagedDiscoveryAreas({
      staging,
      final,
      requiredGates: { ...requiredGates, performance: true },
    });
    assert.deepEqual(published, {
      published: true,
      result: "create",
      failedGates: [],
    });
    assert.deepEqual(
      JSON.parse(fs.readFileSync(final.assetPath, "utf8")),
      staged.asset,
    );
    assert.equal(
      JSON.parse(fs.readFileSync(final.manifestPath, "utf8")).status,
      "approved",
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
