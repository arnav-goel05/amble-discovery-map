export class ApiClientError extends Error {
  constructor(code, message, { status = 0, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "ApiClientError";
    this.code = code;
    this.status = status;
  }
}

function validateEnvelope(payload, response) {
  if (!payload || payload.schemaVersion !== "1.0") throw new ApiClientError("response_contract_invalid", "The service returned an unsupported response.", { status: response.status });
  if (payload.error) throw new ApiClientError(payload.error.code || "request_failed", payload.error.message || "The request failed.", { status: response.status });
  if (!("data" in payload) || typeof payload.stale !== "boolean" || typeof payload.fetchedAt !== "string") throw new ApiClientError("response_contract_invalid", "The service returned an incomplete response.", { status: response.status });
  return payload;
}

export async function requestJson(url, { fetchImpl = fetch, timeoutMs = 12_000, ...options } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      ...options,
      headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
      credentials: "same-origin",
      signal: options.signal ?? controller.signal,
    });
    let payload;
    try { payload = await response.json(); }
    catch (cause) { throw new ApiClientError("response_json_invalid", "The service returned an unreadable response.", { status: response.status, cause }); }
    if (!response.ok && !payload?.error) throw new ApiClientError("request_failed", "The request failed.", { status: response.status });
    return validateEnvelope(payload, response);
  } catch (error) {
    if (error instanceof ApiClientError) throw error;
    if (error?.name === "AbortError") throw new ApiClientError("request_timeout", "The request timed out.", { cause: error });
    throw new ApiClientError("service_unavailable", "The service is unavailable.", { cause: error });
  } finally { clearTimeout(timeout); }
}

export async function loadPublicSnapshot(options = {}) {
  const snapshot = await requestJson("/api/snapshot", options);
  const [landmarks, pois, events] = await Promise.all([
    requestJson(snapshot.data.landmarksRef, options),
    requestJson(snapshot.data.poisRef, options),
    snapshot.data.eventsRef ? requestJson(snapshot.data.eventsRef, options) : Promise.resolve({ data: { schemaVersion: "3.0", mapped: [], offMap: [], counts: { active: 0, mapped: 0, offMap: 0 } } }),
  ]);
  return {
    metadata: snapshot.data,
    landmarks: landmarks.data,
    pois: pois.data,
    events: events.data,
    stale: snapshot.stale,
    warning: snapshot.warning,
  };
}
