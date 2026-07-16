import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { RestaurantService } = require("./lib/restaurant-service.cjs");
const { DEAL_EXTRACTOR_VERSION, WEBSITE_DISCOVERY_VERSION, parseBbox, readJson, writeJsonAtomic } = require("./lib/restaurant-pipeline-core.cjs");

const ROOT = process.cwd();
const OUTPUT_ROOT = path.resolve(process.env.RESTAURANT_PIPELINE_OUTPUT_ROOT || path.join(ROOT, "outputs", "restaurant-pipeline", "runs"));

function args(argv) {
  const parsed = { command: argv[0] || "help" };
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    parsed[key] = argv[index + 1]?.startsWith("--") ? true : argv[++index] ?? true;
  }
  return parsed;
}

function runId(bbox) {
  return `${new Date().toISOString().replace(/[-:.]/g, "").replace("Z", "Z")}-${bbox.key.replaceAll(",", "_")}`;
}

function runDirectory(id) {
  const directory = path.resolve(OUTPUT_ROOT, id);
  if (!directory.startsWith(`${OUTPUT_ROOT}${path.sep}`)) throw new Error("invalid run id");
  return directory;
}

function statePath(id) { return path.join(runDirectory(id), "orchestrator-state.json"); }
function loadState(id) {
  const state = readJson(statePath(id));
  if (!state) throw new Error(`run not found: ${id}`);
  return state;
}
function saveState(state) { writeJsonAtomic(statePath(state.runId), state); }

function resultSummary(state) {
  const stages = Object.values(state.restaurants || {});
  return {
    runId: state.runId,
    complete: state.complete === true,
    status: state.status,
    restaurantCount: stages.length,
    dealsFound: stages.reduce((sum, item) => sum + (item.result?.deals?.length || 0), 0),
    stageCounts: stages.reduce((counts, item) => ({ ...counts, [item.status]: (counts[item.status] || 0) + 1 }), {}),
    output: path.relative(ROOT, runDirectory(state.runId)),
  };
}

function verifyResult(restaurant, result) {
  if (!result || result.restaurantId !== restaurant.id) return "deal result identity mismatch";
  if (!Array.isArray(result.deals) || !Array.isArray(result.pagesInspected)) return "deal result arrays are missing";
  if (!result.evidenceHash || !result.fetchedAt) return "deal result evidence metadata is missing";
  if (result.extractorVersion !== DEAL_EXTRACTOR_VERSION) return "deal result extractor version is stale";
  if (result.discoveryVersion !== WEBSITE_DISCOVERY_VERSION) return "website discovery version is stale";
  for (const deal of result.deals) {
    if (!deal.title || !deal.evidence || !deal.sourceUrl || deal.sourceType !== "official_website") return "deal evidence is incomplete";
  }
  if (result.status === "success" && result.deals.length === 0) return "successful result has no deals";
  if (result.status !== "success" && result.deals.length > 0) return "non-success result contains deals";
  return null;
}

async function execute(state, { refresh = false, retryUnavailable = false } = {}) {
  const service = new RestaurantService({ root: ROOT });
  let restaurants = readJson(path.join(runDirectory(state.runId), "restaurants.json"))?.restaurants;
  if (!Array.isArray(restaurants)) {
    state.status = "collecting";
    saveState(state);
    const collected = await service.search(state.bbox, { refresh });
    restaurants = collected.restaurants;
    writeJsonAtomic(path.join(runDirectory(state.runId), "restaurants.json"), collected);
    state.collection = { status: "success", count: restaurants.length, fetchedAt: collected.fetchedAt, endpoint: collected.endpoint, attempts: collected.attempts };
    state.restaurants = Object.fromEntries(restaurants.map((restaurant) => [restaurant.id, { name: restaurant.name, status: "pending", result: null, error: null }]));
    saveState(state);
  } else {
    service.remember(restaurants);
  }

  state.status = "enriching";
  state.complete = false;
  saveState(state);
  const scheduled = [];
  for (const restaurant of restaurants) {
    const stage = state.restaurants[restaurant.id] || { name: restaurant.name, status: "pending", result: null, error: null };
    state.restaurants[restaurant.id] = stage;
    const isValidComplete = stage.status === "complete" && !verifyResult(restaurant, stage.result);
    const retryableUnavailable = retryUnavailable && ["unavailable"].includes(stage.result?.status);
    if (isValidComplete && !retryableUnavailable && !refresh) continue;
    const wasFailed = stage.status === "failed";
    stage.status = "queued";
    stage.error = null;
    service.enqueue(restaurant.id, { refresh: refresh || retryableUnavailable || wasFailed });
    scheduled.push(restaurant.id);
  }
  saveState(state);

  const statuses = await service.waitFor(scheduled);
  for (const status of statuses) {
    const stage = state.restaurants[status.restaurantId];
    stage.status = status.result ? "complete" : status.status;
    stage.result = status.result;
    stage.error = status.error;
    if (status.result) writeJsonAtomic(path.join(runDirectory(state.runId), "deals", `${status.restaurantId}.json`), status.result);
  }

  state.status = "verifying";
  saveState(state);
  const failures = [];
  for (const restaurant of restaurants) {
    const stage = state.restaurants[restaurant.id];
    const error = stage.status !== "complete" ? (stage.error || `stage ended ${stage.status}`) : verifyResult(restaurant, stage.result);
    if (error) {
      stage.status = "failed";
      stage.error = error;
      failures.push({ restaurantId: restaurant.id, error });
    }
  }
  state.verification = { status: failures.length ? "failed" : "success", failures, verifiedAt: new Date().toISOString() };
  state.status = failures.length ? "continuation_required" : "complete";
  state.complete = failures.length === 0;
  state.updatedAt = new Date().toISOString();
  saveState(state);
  writeJsonAtomic(path.join(runDirectory(state.runId), "summary.json"), resultSummary(state));
  return state;
}

async function start(options) {
  if (!options.bbox) throw new Error("start requires --bbox south,west,north,east");
  const bbox = parseBbox(options.bbox);
  const id = options.run || runId(bbox);
  const directory = runDirectory(id);
  if (fs.existsSync(statePath(id))) throw new Error(`run already exists: ${id}`);
  fs.mkdirSync(directory, { recursive: true });
  const state = {
    schemaVersion: "1.0",
    runId: id,
    bbox: bbox.key,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "initialized",
    complete: false,
    collection: { status: "pending" },
    restaurants: {},
    verification: { status: "pending", failures: [] },
  };
  saveState(state);
  return execute(state, { refresh: options.refresh === true || options.refresh === "true" });
}

async function resume(options) {
  if (!options.run) throw new Error("resume requires --run <run-id>");
  const state = loadState(options.run);
  return execute(state, {
    refresh: options.refresh === true || options.refresh === "true",
    retryUnavailable: options["retry-unavailable"] === true || options["retry-unavailable"] === "true",
  });
}

const options = args(process.argv.slice(2));
try {
  let state;
  if (options.command === "start") state = await start(options);
  else if (options.command === "resume") state = await resume(options);
  else if (options.command === "status") state = loadState(options.run);
  else {
    process.stdout.write("Usage:\n  npm run restaurant-pipeline -- start --bbox south,west,north,east\n  npm run restaurant-pipeline -- resume --run <run-id> [--retry-unavailable]\n  npm run restaurant-pipeline -- status --run <run-id>\n");
    process.exit(options.command === "help" ? 0 : 2);
  }
  process.stdout.write(`${JSON.stringify(resultSummary(state), null, 2)}\n`);
  if (!state.complete && options.command !== "status") process.exitCode = 3;
} catch (error) {
  process.stderr.write(`${JSON.stringify({ error: error.message }, null, 2)}\n`);
  process.exitCode = 1;
}
