const { RestaurantService } = require("./lib/restaurant-service.cjs");

function json(response, status, payload) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(`${JSON.stringify(payload)}\n`);
}

async function body(request, maxBytes = 64_000) {
  let value = "";
  for await (const chunk of request) {
    value += chunk;
    if (Buffer.byteLength(value) > maxBytes) throw new Error("request body is too large");
  }
  return value ? JSON.parse(value) : {};
}

function restaurantApiPlugin(options = {}) {
  const service = options.service || new RestaurantService(options);
  const middleware = async (request, response, next) => {
    const url = new URL(request.url, "http://localhost");
    try {
      if (request.method === "GET" && url.pathname === "/api/restaurants") {
        const result = await service.search(url.searchParams.get("bbox"), { refresh: url.searchParams.get("refresh") === "1" });
        return json(response, result.status === "unavailable" ? 503 : 200, result);
      }
      if (request.method === "POST" && url.pathname === "/api/restaurant-deals/batch") {
        const payload = await body(request);
        const ids = payload.restaurantIds || payload.ids;
        if (!Array.isArray(ids) || ids.length > 250 || ids.some((id) => !/^osm-(?:node|way|relation)-\d+$/.test(String(id)))) {
          return json(response, 400, { schemaVersion: "1.0", error: { code: "invalid_restaurant_ids", message: "restaurantIds must contain at most 250 mapped restaurant IDs." } });
        }
        return json(response, 202, { schemaVersion: "1.0", jobs: service.enqueueMany([...new Set(ids)], { refresh: payload.refresh === true }) });
      }
      if (request.method === "GET" && url.pathname === "/api/restaurant-deals") {
        const id = url.searchParams.get("id");
        if (!id) return json(response, 400, { schemaVersion: "1.0", error: { code: "restaurant_id_required", message: "A restaurant ID is required." } });
        const status = service.dealStatus(id);
        if (status.status === "idle") service.enqueue(id, { priority: true, allowTinyfish: true });
        return json(response, 200, service.dealStatus(id));
      }
      return next();
    } catch (error) {
      const validation = /bbox|viewport|restaurantIds|required|body/i.test(error.message);
      return json(response, validation ? 400 : 502, {
        schemaVersion: "1.0",
        error: {
          code: validation ? "invalid_restaurant_request" : "restaurant_service_unavailable",
          message: validation ? String(error.message).slice(0, 180) : "Restaurant data is temporarily unavailable.",
        },
      });
    }
  };
  return {
    name: "restaurant-viewport-api",
    middleware,
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
    api: service,
  };
}

module.exports = { restaurantApiPlugin };
