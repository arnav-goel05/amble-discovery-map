const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const retryableTransportError = (error) =>
  error instanceof TypeError ||
  ["AbortError", "TimeoutError"].includes(error?.name) ||
  ["UND_ERR_SOCKET", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN"].includes(
    error?.cause?.code ?? error?.code,
  );

function httpError(response, url) {
  const error = new Error(
    `${response.status} ${response.statusText} for ${url}`,
  );
  error.retryable =
    [408, 429].includes(response.status) ||
    (response.status >= 500 && response.status <= 599);
  return error;
}

export async function fetchReleaseBytes({
  url,
  attempts = 3,
  timeoutMs = 120_000,
  fetchImpl = globalThis.fetch,
  sleep = wait,
  onRetry = () => {},
  retryBudget,
} = {}) {
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 8)
    throw new Error("Release fetch attempts must be an integer from 1 to 8");

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw httpError(response, url);
      if (response.headers.get("x-amble-tile-source") !== "r2") {
        const error = new Error(`Release object was not served by R2: ${url}`);
        error.retryable = false;
        throw error;
      }
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      const retryable =
        error?.retryable === true || retryableTransportError(error);
      if (!retryable || attempt === attempts) throw error;
      if (retryBudget) {
        if (retryBudget.remaining < 1) {
          throw new Error(
            `Release hydration retry budget exhausted: ${error.message}`,
            { cause: error },
          );
        }
        retryBudget.remaining -= 1;
      }
      const delayMs = attempt === 1 ? 250 : 1000;
      onRetry({ attempt, attempts, delayMs, error });
      await sleep(delayMs);
    }
  }
  throw lastError;
}
