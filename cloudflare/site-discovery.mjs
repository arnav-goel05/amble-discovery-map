export const SITE_IDENTITY = Object.freeze({
  schemaVersion: "1.0",
  canonicalOrigin: "https://amblefinds.com",
  canonicalHomepage: "https://amblefinds.com/",
  workerAliasHost: "amble.amble-sg.workers.dev",
  siteName: "Amble",
  publisherName: "Amble",
  language: "en-SG",
  locale: "en_SG",
  title: "Amble: See What’s Happening in Singapore",
  description:
    "Explore Singapore in 3D and discover events happening across the city. Amble turns what’s on into an interactive desktop map.",
  websiteId: "https://amblefinds.com/#website",
  organizationId: "https://amblefinds.com/#organization",
  logoUrl: "https://amblefinds.com/brand/event-map-logo.png",
  socialImage: Object.freeze({
    url: "https://amblefinds.com/brand/amble-social-card.png",
    width: 1200,
    height: 630,
    maxBytes: 512_000,
    alt: "Amble interactive 3D events map of Singapore",
  }),
  discovery: Object.freeze({
    robotsPath: "/robots.txt",
    sitemapPath: "/sitemap.xml",
    cacheControl: "public, max-age=3600, must-revalidate",
  }),
});

export const CRAWLER_POLICIES = Object.freeze(
  [
    [
      "Googlebot",
      "traditional-search",
      "allow",
      "https://developers.google.com/crawling/docs/crawlers-fetchers/overview-google-crawlers",
    ],
    [
      "Bingbot",
      "traditional-search",
      "allow",
      "https://www.bing.com/webmasters/help/webmaster-guidelines-30fba23a",
    ],
    [
      "OAI-SearchBot",
      "answer-search",
      "allow",
      "https://developers.openai.com/api/docs/bots",
    ],
    [
      "ChatGPT-User",
      "user-retrieval",
      "allow",
      "https://developers.openai.com/api/docs/bots",
    ],
    [
      "GPTBot",
      "model-training",
      "disallow",
      "https://developers.openai.com/api/docs/bots",
    ],
    [
      "Claude-SearchBot",
      "answer-search",
      "allow",
      "https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler",
    ],
    [
      "Claude-User",
      "user-retrieval",
      "allow",
      "https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler",
    ],
    [
      "ClaudeBot",
      "model-training",
      "disallow",
      "https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler",
    ],
    [
      "PerplexityBot",
      "answer-search",
      "allow",
      "https://docs.perplexity.ai/docs/resources/perplexity-crawlers",
    ],
    [
      "Perplexity-User",
      "user-retrieval",
      "allow",
      "https://docs.perplexity.ai/docs/resources/perplexity-crawlers",
    ],
    [
      "Google-Extended",
      "model-training",
      "disallow",
      "https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers#google-extended",
    ],
    ["CCBot", "model-training", "disallow", "https://commoncrawl.org/ccbot"],
  ].map(([agent, purpose, access, evidenceUrl]) =>
    Object.freeze({
      agent,
      purpose,
      access,
      evidenceUrl,
      reviewedAt: "2026-07-17",
      edgeEnforcement: "not-available",
    }),
  ),
);

export function siteIdentity() {
  return {
    ...SITE_IDENTITY,
    socialImage: { ...SITE_IDENTITY.socialImage },
    discovery: { ...SITE_IDENTITY.discovery },
    crawlers: CRAWLER_POLICIES.map((policy) => ({ ...policy })),
  };
}

export function validateSiteIdentity(value) {
  if (!value || value.schemaVersion !== "1.0")
    throw new Error("site identity schemaVersion must be 1.0");
  if (
    value.canonicalOrigin !== SITE_IDENTITY.canonicalOrigin ||
    value.canonicalHomepage !== SITE_IDENTITY.canonicalHomepage
  )
    throw new Error("canonical site identity is invalid");
  if (
    value.workerAliasHost !== SITE_IDENTITY.workerAliasHost ||
    value.workerAliasHost.startsWith("*.")
  )
    throw new Error("worker alias host must be exact");
  if (value.siteName !== "Amble" || value.publisherName !== "Amble")
    throw new Error("site and publisher names must be Amble");
  if (!Array.isArray(value.crawlers) || !value.crawlers.length)
    throw new Error("crawler policies are required");
  const agents = new Set();
  for (const policy of value.crawlers) {
    if (agents.has(policy.agent))
      throw new Error(`duplicate crawler: ${policy.agent}`);
    agents.add(policy.agent);
    if (!["allow", "disallow"].includes(policy.access))
      throw new Error(`invalid crawler access: ${policy.access}`);
    if (
      ![
        "traditional-search",
        "answer-search",
        "user-retrieval",
        "model-training",
      ].includes(policy.purpose)
    )
      throw new Error(`invalid crawler purpose: ${policy.purpose}`);
    if (!/^https:\/\//.test(policy.evidenceUrl || ""))
      throw new Error(`crawler evidence URL is invalid: ${policy.agent}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(policy.reviewedAt || ""))
      throw new Error(`crawler review date is invalid: ${policy.agent}`);
    if (
      !["voluntary", "verified-bot-rule", "not-available"].includes(
        policy.edgeEnforcement,
      )
    )
      throw new Error(`crawler enforcement is invalid: ${policy.agent}`);
  }
  return value;
}

export function canonicalRedirect(url) {
  const alias =
    url.hostname === "www.amblefinds.com" ||
    url.hostname === SITE_IDENTITY.workerAliasHost;
  const insecure =
    url.hostname === "amblefinds.com" && url.protocol === "http:";
  const indexPath =
    url.hostname === "amblefinds.com" && url.pathname === "/index.html";
  if (!alias && !insecure && !indexPath) return null;
  const target = new URL(
    url.pathname + url.search,
    SITE_IDENTITY.canonicalOrigin,
  );
  if (indexPath) target.pathname = "/";
  return target.href;
}

export function renderRobots() {
  const groups = [
    "User-agent: *",
    "Content-signal: search=yes, ai-input=yes, ai-train=no",
    "Allow: /",
    "Disallow: /admin.html",
    "Disallow: /api/admin/",
    "",
  ];
  for (const { agent, access } of CRAWLER_POLICIES) {
    groups.push(
      `User-agent: ${agent}`,
      `${access === "allow" ? "Allow" : "Disallow"}: /`,
      "",
    );
  }
  groups.push(
    `Sitemap: ${SITE_IDENTITY.canonicalOrigin}${SITE_IDENTITY.discovery.sitemapPath}`,
    "",
  );
  return groups.join("\n");
}

export function renderSitemap() {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${SITE_IDENTITY.canonicalHomepage}</loc></url>\n</urlset>\n`;
}

export function discoveryResponse(request) {
  const url = new URL(request.url);
  const isRobots = url.pathname === SITE_IDENTITY.discovery.robotsPath;
  const isSitemap = url.pathname === SITE_IDENTITY.discovery.sitemapPath;
  if (!isRobots && !isSitemap) return null;
  const headers = {
    allow: "GET, HEAD",
    "cache-control": SITE_IDENTITY.discovery.cacheControl,
    "content-type": isRobots
      ? "text/plain; charset=utf-8"
      : "application/xml; charset=utf-8",
  };
  if (!["GET", "HEAD"].includes(request.method))
    return new Response("Method not allowed\n", { status: 405, headers });
  const body =
    request.method === "HEAD"
      ? null
      : isRobots
        ? renderRobots()
        : renderSitemap();
  return new Response(body, { status: 200, headers });
}
