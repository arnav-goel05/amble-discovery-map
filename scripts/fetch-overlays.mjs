import fs from "fs";
import path from "path";

const OVERPASS_URL = process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter";
const OUTPUT_DIR = "public/data";
const SINGAPORE_AREA_ID = 3600536780;

const QUERIES = {
  parks: `
    [out:json][timeout:180];
    area(id:${SINGAPORE_AREA_ID})->.sg;
    (
      way(area.sg)["leisure"~"^(park|garden|nature_reserve|recreation_ground)$"];
      way(area.sg)["landuse"~"^(forest|grass|meadow|recreation_ground|village_green)$"];
      way(area.sg)["natural"~"^(wood|grassland|scrub)$"];
    );
    out tags geom;
  `,
  water: `
    [out:json][timeout:180];
    area(id:${SINGAPORE_AREA_ID})->.sg;
    (
      way(area.sg)["natural"="water"];
      way(area.sg)["landuse"="reservoir"];
      way(area.sg)["water"~"^(reservoir|lake|pond|basin|canal|river)$"];
      way(area.sg)["waterway"~"^(riverbank|dock|canal|river|stream)$"];
    );
    out tags geom;
  `,
};

function isClosedRing(coordinates) {
  if (coordinates.length < 4) return false;
  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  return first[0] === last[0] && first[1] === last[1];
}

function elementToFeature(element, kind) {
  const coordinates = (element.geometry || []).map((point) => [point.lon, point.lat]);
  if (coordinates.length < 2) return null;

  const closed = isClosedRing(coordinates);
  const geometry = closed
    ? { type: "Polygon", coordinates: [coordinates] }
    : { type: "LineString", coordinates };

  return {
    type: "Feature",
    properties: {
      id: String(element.id),
      kind,
      name: element.tags?.name || "",
      source: "OpenStreetMap / Overpass",
      tags: element.tags || {},
    },
    geometry,
  };
}

async function fetchOverlay(kind, query) {
  const response = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "User-Agent": "kent-ridge-student-map/0.1 local overlay fetch",
    },
    body: new URLSearchParams({ data: query }),
  });

  if (!response.ok) throw new Error(`Overpass ${kind} failed: ${response.status}`);
  const data = await response.json();
  const features = data.elements.map((element) => elementToFeature(element, kind)).filter(Boolean);
  const geojson = {
    type: "FeatureCollection",
    metadata: {
      source: "OpenStreetMap / Overpass",
      kind,
      generatedAt: new Date().toISOString(),
      count: features.length,
    },
    features,
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_DIR, `${kind}.geojson`), `${JSON.stringify(geojson)}\n`);
  console.log(`${kind}: wrote ${features.length} features`);
}

for (const [kind, query] of Object.entries(QUERIES)) {
  await fetchOverlay(kind, query);
}
