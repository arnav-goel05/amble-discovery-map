const argument = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
};

const origin = new URL(
  argument("origin", "https://amble.project-hub-arnav.workers.dev"),
);

function firstContentUri(node) {
  if (!node || typeof node !== "object") return null;
  const direct = node.content?.uri || node.content?.url;
  if (typeof direct === "string") return direct;
  for (const child of node.children ?? []) {
    const found = firstContentUri(child);
    if (found) return found;
  }
  return null;
}

async function expectR2(url, { json = false } = {}) {
  const response = await fetch(url, { method: json ? "GET" : "HEAD" });
  if (!response.ok)
    throw new Error(`${response.status} ${response.statusText}: ${url}`);
  const source = response.headers.get("x-amble-tile-source");
  if (source !== "r2")
    throw new Error(
      `Expected R2 delivery for ${url}; received ${source || "no source header"}`,
    );
  return json ? response.json() : null;
}

async function verifyContent(url, depth = 0) {
  if (depth > 8) throw new Error(`Nested tileset depth exceeded for ${url}`);
  if (!url.pathname.endsWith(".json")) {
    await expectR2(url);
    const rangeResponse = await fetch(url, {
      headers: { range: "bytes=0-99" },
    });
    if (
      rangeResponse.status !== 206 ||
      rangeResponse.headers.get("x-amble-tile-source") !== "r2"
    ) {
      throw new Error(
        `Expected an R2 byte-range response for ${url}; received ${rangeResponse.status}`,
      );
    }
    return url;
  }

  const nestedTileset = await expectR2(url, { json: true });
  const nestedContentUri = firstContentUri(nestedTileset.root);
  if (!nestedContentUri) throw new Error(`No content URI found in ${url}`);
  return verifyContent(new URL(nestedContentUri, url), depth + 1);
}

async function verifyTileset(pathname) {
  const tilesetUrl = new URL(pathname, origin);
  const tileset = await expectR2(tilesetUrl, { json: true });
  const contentUri = firstContentUri(tileset.root);
  if (!contentUri) throw new Error(`No content URI found in ${tilesetUrl}`);
  const contentUrl = new URL(contentUri, tilesetUrl);
  const sampleUrl = await verifyContent(contentUrl);
  return { tileset: tilesetUrl.href, sample: sampleUrl.href };
}

const results = await Promise.all([
  verifyTileset("/optimized-tiles/tileset.json"),
  verifyTileset("/poi-tiles/event-venues/tileset.json"),
]);

console.log(
  JSON.stringify({ complete: true, origin: origin.href, results }, null, 2),
);
