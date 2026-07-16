const path = require("node:path");
const fs = require("node:fs");
const {
  collectRestaurantDeals,
  collectRestaurants,
  collectWebsiteCatalog,
  discoverRestaurantWebsite,
  assertRestaurantProviderConfig,
  fresh,
  hash,
  parseBbox,
  readJson,
  writeJsonAtomic,
  DEAL_EXTRACTOR_VERSION,
  WEBSITE_DISCOVERY_VERSION,
} = require("./restaurant-pipeline-core.cjs");

class RestaurantService {
  constructor({
    root = process.cwd(),
    config = readJson(process.env.RESTAURANT_PIPELINE_CONFIG || path.join(root, "data", "restaurant-pipeline-config.json"), {}),
    cacheRoot = process.env.RESTAURANT_PIPELINE_CACHE_ROOT || path.join(root, "outputs", "restaurant-pipeline", "cache"),
    fetchImpl,
    tinyfishSearchImpl,
    tinyfishFetchImpl,
    tinyfishApiKey = process.env.TINYFISH_API_KEY,
    lookup,
    providerPolicy,
  } = {}) {
    this.root = root;
    this.config = config;
    this.cacheRoot = cacheRoot;
    this.fetchImpl = fetchImpl;
    this.tinyfishSearchImpl = tinyfishSearchImpl;
    this.tinyfishFetchImpl = tinyfishFetchImpl;
    this.tinyfishApiKey = tinyfishApiKey;
    this.lookup = lookup;
    const policyPath = path.resolve(root, config.providerPolicy || "data/provider-policy.json");
    this.providerPolicy = providerPolicy || readJson(policyPath, { schemaVersion: "1.0", providers: [] });
    assertRestaurantProviderConfig(config, this.providerPolicy);
    this.restaurants = new Map();
    this.jobs = new Map();
    this.queue = [];
    this.active = 0;
    this.viewportRefreshes = new Map();
    this.catalogPromise = null;
    this.registry = readJson(path.join(root, "data", "restaurant-website-registry.json"), { entries: [] }).entries || [];
  }

  viewportPath(bbox) {
    return path.join(this.cacheRoot, "viewports", `${hash(bbox.key).slice(0, 24)}.json`);
  }

  viewportEnvelope(result) {
    const unavailable = result.cache === "unavailable";
    const stale = ["stale", "stale-overlap"].includes(result.cache);
    const source = result.provider || { id: "openstreetmap-overpass", costClass: "open" };
    const data = unavailable ? null : {
      bbox: result.bbox,
      restaurants: result.restaurants || [],
      cache: result.cache,
      coveringViewport: result.coveringViewport,
      overlappingViewport: result.overlappingViewport,
      viewportCoverage: result.viewportCoverage,
    };
    return {
      ...result,
      status: unavailable ? "unavailable" : "success",
      data,
      stale,
      warning: result.warning || null,
      source,
    };
  }

  dealEnvelope({ restaurantId, status, result = null, error = null, cache = null, progress = null }) {
    const cleanResult = result ? {
      ...result,
      deals: (result.deals || []).filter(({ validUntil }) => !validUntil || Date.parse(validUntil) >= Date.now()),
    } : null;
    const stale = cache === "stale";
    const publicStatus = ["queued", "running"].includes(status)
      ? "pending"
      : (status === "complete"
        ? (["unavailable", "not_available"].includes(cleanResult?.status) ? "unavailable" : "success")
        : (status === "failed" ? "error" : status));
    return {
      schemaVersion: "1.0",
      restaurantId,
      status: publicStatus,
      data: cleanResult,
      result: cleanResult,
      fetchedAt: cleanResult?.fetchedAt || null,
      stale,
      warning: error || cleanResult?.reason || null,
      error,
      cache,
      progress,
      source: cleanResult?.provider || { id: "official-website-direct", costClass: "free" },
    };
  }

  restaurantsForViewport(restaurants, bbox) {
    const centerLatitude = (bbox.south + bbox.north) / 2;
    const centerLongitude = (bbox.west + bbox.east) / 2;
    const longitudeScale = Math.cos(centerLatitude * Math.PI / 180);
    const limit = Math.max(1, Number(this.config.maxViewportRestaurants || 250));
    return restaurants
      .filter(({ latitude, longitude }) => (
        Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude))
        && latitude >= bbox.south && latitude <= bbox.north
        && longitude >= bbox.west && longitude <= bbox.east
      ))
      .sort((left, right) => {
        const leftDistance = (left.latitude - centerLatitude) ** 2
          + ((left.longitude - centerLongitude) * longitudeScale) ** 2;
        const rightDistance = (right.latitude - centerLatitude) ** 2
          + ((right.longitude - centerLongitude) * longitudeScale) ** 2;
        return leftDistance - rightDistance || String(left.name || "").localeCompare(String(right.name || ""));
      })
      .slice(0, limit);
  }

  cachedViewports(ttl) {
    const directory = path.join(this.cacheRoot, "viewports");
    let files;
    try { files = fs.readdirSync(directory); } catch { return []; }
    return files
      .filter((file) => file.endsWith(".json"))
      .map((file) => readJson(path.join(directory, file)))
      .filter((entry) => entry?.bbox && Array.isArray(entry.restaurants) && fresh(entry.fetchedAt, ttl));
  }

  coveringViewport(bbox, ttl) {
    const candidates = this.cachedViewports(ttl)
      .filter(({ bbox: cached }) => cached.south <= bbox.south && cached.west <= bbox.west && cached.north >= bbox.north && cached.east >= bbox.east)
      .sort((left, right) => {
        const leftArea = (left.bbox.north - left.bbox.south) * (left.bbox.east - left.bbox.west);
        const rightArea = (right.bbox.north - right.bbox.south) * (right.bbox.east - right.bbox.west);
        return leftArea - rightArea || Date.parse(right.fetchedAt) - Date.parse(left.fetchedAt);
      });
    const covering = candidates[0];
    if (!covering) return null;
    return {
      ...covering,
      bbox: { south: bbox.south, west: bbox.west, north: bbox.north, east: bbox.east },
      restaurants: this.restaurantsForViewport(covering.restaurants, bbox),
      coveringViewport: covering.bbox,
    };
  }

  overlappingViewport(bbox, ttl, minCoverage = 0.5) {
    const requestedArea = (bbox.north - bbox.south) * (bbox.east - bbox.west);
    const candidates = this.cachedViewports(ttl)
      .map((entry) => {
        const latitudeOverlap = Math.max(0, Math.min(entry.bbox.north, bbox.north) - Math.max(entry.bbox.south, bbox.south));
        const longitudeOverlap = Math.max(0, Math.min(entry.bbox.east, bbox.east) - Math.max(entry.bbox.west, bbox.west));
        return { entry, coverage: latitudeOverlap * longitudeOverlap / requestedArea };
      })
      .filter(({ coverage }) => coverage >= minCoverage)
      .sort((left, right) => right.coverage - left.coverage || Date.parse(right.entry.fetchedAt) - Date.parse(left.entry.fetchedAt));
    for (const { entry, coverage } of candidates) {
      const restaurants = this.restaurantsForViewport(entry.restaurants, bbox);
      if (restaurants.length) return {
        ...entry,
        bbox: { south: bbox.south, west: bbox.west, north: bbox.north, east: bbox.east },
        restaurants,
        overlappingViewport: entry.bbox,
        viewportCoverage: coverage,
      };
    }
    return null;
  }

  dealPath(id) {
    return path.join(this.cacheRoot, "deals", `${hash(id).slice(0, 24)}.json`);
  }

  websiteCatalogPath() {
    return path.join(this.cacheRoot, "website-catalog.json");
  }

  async websiteCatalog() {
    if (this.catalogPromise) return this.catalogPromise;
    this.catalogPromise = (async () => {
      const cachePath = this.websiteCatalogPath();
      const cached = readJson(cachePath);
      const ttl = Number(this.config.websiteCatalogCacheTtlHours || 168) * 3_600_000;
      if (cached?.discoveryVersion === WEBSITE_DISCOVERY_VERSION && cached?.entries?.length > 0 && fresh(cached.fetchedAt, ttl)) return cached;
      try {
        const catalog = await collectWebsiteCatalog({ endpoints: this.config.overpassEndpoints || [], fetchImpl: this.fetchImpl });
        writeJsonAtomic(cachePath, catalog);
        return catalog;
      } catch (error) {
        if (cached?.entries?.length) return { ...cached, stale: true, warning: error.message };
        return { discoveryVersion: WEBSITE_DISCOVERY_VERSION, fetchedAt: new Date().toISOString(), entries: [], warning: error.message };
      }
    })();
    return this.catalogPromise;
  }

  async enrichWebsite(restaurant, { allowTinyfish = false, onProgress = () => {} } = {}) {
    if (restaurant.website) {
      const discovery = await discoverRestaurantWebsite(restaurant, {
        registry: this.registry,
        fetchImpl: this.fetchImpl,
        tinyfishSearchImpl: allowTinyfish ? this.tinyfishSearchImpl : undefined,
        tinyfishFetchImpl: allowTinyfish ? this.tinyfishFetchImpl : undefined,
        tinyfishApiKey: allowTinyfish ? this.tinyfishApiKey : null,
        tinyfishSearchConfig: allowTinyfish ? this.config.websiteDiscovery?.tinyfishSearch || null : null,
        tinyfishFetchConfig: allowTinyfish ? this.config.dealRetrieval?.tinyfish || null : null,
        lookup: this.lookup,
        onProgress,
      });
      return { ...restaurant, website: discovery.website, websiteDiscovery: discovery };
    }
    const discovery = await discoverRestaurantWebsite(restaurant, {
      catalog: await this.websiteCatalog(),
      registry: this.registry,
      fetchImpl: this.fetchImpl,
      tinyfishSearchImpl: allowTinyfish ? this.tinyfishSearchImpl : undefined,
      tinyfishFetchImpl: allowTinyfish ? this.tinyfishFetchImpl : undefined,
      tinyfishApiKey: allowTinyfish ? this.tinyfishApiKey : null,
      tinyfishSearchConfig: allowTinyfish ? this.config.websiteDiscovery?.tinyfishSearch || null : null,
      tinyfishFetchConfig: allowTinyfish ? this.config.dealRetrieval?.tinyfish || null : null,
      lookup: this.lookup,
      onProgress,
    });
    return { ...restaurant, website: discovery.website, websiteDiscovery: discovery };
  }

  remember(restaurants) {
    for (const restaurant of restaurants) this.restaurants.set(restaurant.id, restaurant);
  }

  refreshViewport(bbox, cachePath) {
    const existing = this.viewportRefreshes.get(bbox.key);
    if (existing) return existing;
    const refresh = collectRestaurants({
      bbox,
      endpoints: this.config.overpassEndpoints || [],
      fetchImpl: this.fetchImpl,
      providerPolicy: this.providerPolicy,
    }).then((result) => {
      writeJsonAtomic(cachePath, result);
      this.remember(this.restaurantsForViewport(result.restaurants, bbox));
      return result;
    }).catch(() => null).finally(() => {
      this.viewportRefreshes.delete(bbox.key);
    });
    this.viewportRefreshes.set(bbox.key, refresh);
    return refresh;
  }

  async search(bboxInput, { refresh = false } = {}) {
    const bbox = parseBbox(bboxInput);
    const cachePath = this.viewportPath(bbox);
    const cached = readJson(cachePath);
    const ttl = Number(this.config.viewportCacheTtlMinutes || 30) * 60_000;
    if (!refresh && cached?.restaurants && fresh(cached.fetchedAt, ttl)) {
      const restaurants = this.restaurantsForViewport(cached.restaurants, bbox);
      this.remember(restaurants);
      return this.viewportEnvelope({ ...cached, restaurants, cache: "hit" });
    }
    if (!refresh) {
      const covering = this.coveringViewport(bbox, ttl);
      if (covering) {
        this.remember(covering.restaurants);
        return this.viewportEnvelope({ ...covering, cache: "covering-hit" });
      }
      const overlapping = this.overlappingViewport(bbox, ttl);
      if (overlapping) {
        this.remember(overlapping.restaurants);
        return this.viewportEnvelope({ ...overlapping, cache: "overlap-hit" });
      }
      if (cached?.restaurants) {
        const restaurants = this.restaurantsForViewport(cached.restaurants, bbox);
        if (restaurants.length) {
          this.remember(restaurants);
          this.refreshViewport(bbox, cachePath);
          return this.viewportEnvelope({ ...cached, restaurants, cache: "stale", warning: "Refreshing saved restaurant data in the background." });
        }
      }
      const staleOverlap = this.overlappingViewport(bbox, Number.POSITIVE_INFINITY, 0.05);
      if (staleOverlap) {
        this.remember(staleOverlap.restaurants);
        this.refreshViewport(bbox, cachePath);
        return this.viewportEnvelope({ ...staleOverlap, cache: "stale-overlap", warning: "Refreshing saved restaurant data in the background." });
      }
    }
    try {
      const result = await collectRestaurants({
        bbox,
        endpoints: this.config.overpassEndpoints || [],
        fetchImpl: this.fetchImpl,
        providerPolicy: this.providerPolicy,
      });
      writeJsonAtomic(cachePath, result);
      const restaurants = this.restaurantsForViewport(result.restaurants, bbox);
      this.remember(restaurants);
      return this.viewportEnvelope({ ...result, restaurants, cache: "miss" });
    } catch (error) {
      if (cached?.restaurants) {
        const restaurants = this.restaurantsForViewport(cached.restaurants, bbox);
        this.remember(restaurants);
        return this.viewportEnvelope({ ...cached, restaurants, cache: "stale", warning: error.message, attempts: error.attempts || cached.attempts || [] });
      }
      const fallback = this.overlappingViewport(bbox, Number.POSITIVE_INFINITY, 0.05);
      if (fallback) {
        this.remember(fallback.restaurants);
        return this.viewportEnvelope({ ...fallback, cache: "stale-overlap", warning: error.message, attempts: error.attempts || fallback.attempts || [] });
      }
      return this.viewportEnvelope({
        schemaVersion: "1.0",
        bbox: { south: bbox.south, west: bbox.west, north: bbox.north, east: bbox.east },
        fetchedAt: new Date().toISOString(),
        source: "OpenStreetMap / Overpass",
        restaurants: [],
        cache: "unavailable",
        warning: error.message,
        attempts: error.attempts || [],
      });
    }
  }

  cacheTtl(result) {
    if (result?.status === "success") return Number(this.config.dealCacheTtlHours || 24) * 3_600_000;
    if (result?.status === "no_deals_found" || result?.status === "not_available") {
      return Number(this.config.noDealsCacheTtlHours || 12) * 3_600_000;
    }
    return Number(this.config.failedDealCacheTtlMinutes || 30) * 60_000;
  }

  dealStatus(id) {
    const job = this.jobs.get(id);
    if (job) return this.dealEnvelope({ restaurantId: id, status: job.status, result: job.result || null, error: job.error || null, progress: job.progress || null });
    const cached = readJson(this.dealPath(id));
    if (cached?.extractorVersion === DEAL_EXTRACTOR_VERSION && cached?.discoveryVersion === WEBSITE_DISCOVERY_VERSION && fresh(cached.fetchedAt, this.cacheTtl(cached))) return this.dealEnvelope({ restaurantId: id, status: "complete", result: cached, cache: "hit" });
    return this.dealEnvelope({ restaurantId: id, status: "idle", result: cached || null, cache: cached ? "stale" : "miss" });
  }

  enqueue(id, { refresh = false, priority = false, allowTinyfish = false } = {}) {
    const restaurant = this.restaurants.get(id);
    if (!restaurant) return this.dealEnvelope({ restaurantId: id, status: "error", error: "Search this viewport before requesting deal enrichment." });
    const existing = this.jobs.get(id);
    if (existing && ["queued", "running"].includes(existing.status)) return this.dealStatus(id);
    const cached = readJson(this.dealPath(id));
    if (!refresh && cached?.extractorVersion === DEAL_EXTRACTOR_VERSION && cached?.discoveryVersion === WEBSITE_DISCOVERY_VERSION && fresh(cached.fetchedAt, this.cacheTtl(cached))) {
      return this.dealEnvelope({ restaurantId: id, status: "complete", result: cached, cache: "hit" });
    }
    const job = { restaurant, status: "queued", result: null, error: null, allowTinyfish, progress: { stage: "queued", label: "Preparing restaurant lookup…" } };
    this.jobs.set(id, job);
    if (priority) this.queue.unshift(job);
    else this.queue.push(job);
    this.drain();
    return this.dealStatus(id);
  }

  enqueueMany(ids, options) {
    return [...new Set(ids)].map((id) => this.enqueue(id, options));
  }

  drain() {
    const concurrency = Math.max(1, Number(this.config.dealConcurrency || 2));
    while (this.active < concurrency && this.queue.length) {
      const job = this.queue.shift();
      this.active += 1;
      job.status = "running";
      const onProgress = (progress) => { job.progress = progress; };
      onProgress({ stage: "finding_website", label: "Finding and verifying the official website…" });
      this.enrichWebsite(job.restaurant, { allowTinyfish: job.allowTinyfish, onProgress })
        .then((restaurant) => collectRestaurantDeals(restaurant, {
          fetchImpl: this.fetchImpl,
          tinyfishFetchImpl: this.tinyfishFetchImpl,
          tinyfishApiKey: job.allowTinyfish ? this.tinyfishApiKey : null,
          tinyfishConfig: job.allowTinyfish && this.config.dealRetrieval?.mode === "direct_http_with_tinyfish_fetch"
            ? this.config.dealRetrieval.tinyfish
            : null,
          lookup: this.lookup,
          onProgress,
        }))
        .then((result) => {
          job.result = result;
          job.status = "complete";
          job.progress = null;
          writeJsonAtomic(this.dealPath(job.restaurant.id), result);
        })
        .catch((error) => {
          job.status = "failed";
          job.error = error.message;
          job.progress = null;
        })
        .finally(() => {
          this.active -= 1;
          this.drain();
        });
    }
  }

  async waitFor(ids, { pollMs = 25 } = {}) {
    const wanted = [...new Set(ids)];
    while (wanted.some((id) => this.dealStatus(id).status === "pending")) {
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    return wanted.map((id) => this.dealStatus(id));
  }
}

module.exports = { RestaurantService };
