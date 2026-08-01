import { expect } from "playwright/test";

const ASSET_PATH = /\.(?:b3dm|glb|gltf|json)(?:$|[?#])/iu;
const HTML_CONTENT_TYPE = /(?:text\/html|application\/xhtml\+xml)/iu;

function errorText(error) {
  return error?.stack || error?.message || String(error);
}

export function installBrowserRenderGuard(
  page,
  { allowConsoleError = () => false } = {},
) {
  const failures = new Map();
  const record = (kind, message) => {
    const normalized = String(message).split("\n", 1)[0];
    const key = `${kind}:${normalized}`;
    const existing = failures.get(key);
    if (existing) existing.count += 1;
    else failures.set(key, { kind, message: normalized, count: 1 });
  };

  page.on("pageerror", (error) => {
    record("pageerror", errorText(error));
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (allowConsoleError(text, message)) return;
    record("console.error", text);
  });
  page.on("response", (response) => {
    const url = response.url();
    if (!ASSET_PATH.test(url)) return;
    const contentType = response.headers()["content-type"] ?? "";
    if (response.ok() && !HTML_CONTENT_TYPE.test(contentType)) return;
    record(
      HTML_CONTENT_TYPE.test(contentType)
        ? "asset-html-fallback"
        : "asset-response",
      `${response.status()} ${contentType || "unknown content type"} ${url}`,
    );
  });

  return {
    get failures() {
      return [...failures.values()];
    },
    assertClean() {
      const entries = [...failures.values()];
      expect(entries, JSON.stringify(entries, null, 2)).toEqual([]);
    },
  };
}
