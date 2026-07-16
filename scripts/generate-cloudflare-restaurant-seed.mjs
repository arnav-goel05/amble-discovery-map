import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const cacheDir = path.join(root, "outputs/restaurant-pipeline/cache/viewports");
const output = path.join(root, "cloudflare/generated-restaurant-seed.sql");

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const files = (await readdir(cacheDir)).filter((name) => name.endsWith(".json")).sort();
const restaurants = new Map();

for (const name of files) {
  const payload = JSON.parse(await readFile(path.join(cacheDir, name), "utf8"));
  for (const restaurant of payload.restaurants || []) {
    if (!restaurant?.id || !Number.isFinite(restaurant.latitude) || !Number.isFinite(restaurant.longitude)) continue;
    restaurants.set(restaurant.id, restaurant);
  }
}

const seededAt = new Date().toISOString();
const statements = [];
for (const restaurant of [...restaurants.values()].sort((left, right) => left.id.localeCompare(right.id))) {
  statements.push(`INSERT INTO restaurants(id,latitude,longitude,payload,source_updated_at,seeded_at) VALUES(${quote(restaurant.id)},${restaurant.latitude},${restaurant.longitude},${quote(JSON.stringify(restaurant))},${restaurant.sourceUpdatedAt ? quote(restaurant.sourceUpdatedAt) : "NULL"},${quote(seededAt)}) ON CONFLICT(id) DO UPDATE SET latitude=excluded.latitude,longitude=excluded.longitude,payload=excluded.payload,source_updated_at=excluded.source_updated_at,seeded_at=excluded.seeded_at;`);
}
statements.push("");

await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, statements.join("\n"));
console.log(`Generated ${restaurants.size} restaurant rows at ${path.relative(root, output)}`);
