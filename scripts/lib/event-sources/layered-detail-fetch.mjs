import { createHash } from "node:crypto";
import { extractEventPageEvidence } from "./event-field-extraction.mjs";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const DIRECT_STAGES = new Set(["detail", "discovery_detail", "authority_confirmation"]);

function hasUsableDirectEventEvidence(result) {
  if (result?.retrievalMethod !== "direct_html") return true;
  const html = String(result.text ?? "");
  const extracted = extractEventPageEvidence({
    html,
    finalUrl: result.final_url ?? result.url ?? null,
  }).fields;
  const explicitOffMap =
    /\b(?:secret (?:venue|location)|venue (?:tba|to be announced)|location (?:tba|to be announced)|multiple locations|various venues)\b/i.test(
      html,
    );
  if (
    extracted.title &&
    extracted.schedule &&
    (extracted.venue || extracted.address || explicitOffMap)
  )
    return true;
  const visible = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (
    visible.length >= 300 &&
    /\b(?:venue|location)\s*[:\-]/i.test(visible) &&
    /\b\d{1,2}\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i.test(
      visible,
    )
  );
}

export function createLayeredDetailFetchClient({ directClient, fallbackClient, logger = () => {} } = {}) {
  if (!directClient?.fetchBatch || !fallbackClient?.fetchBatch)
    throw new Error("Layered detail retrieval requires direct and fallback clients");
  async function fetchBatch(urls, context = {}) {
    if (!DIRECT_STAGES.has(context.stage)) return fallbackClient.fetchBatch(urls, context);
    const direct = await directClient.fetchBatch(urls, context);
    const usableDirectResults = direct.results.filter(hasUsableDirectEventEvidence);
    const completed = new Set(
      usableDirectResults.map((item) => item.url ?? item.final_url).filter(Boolean),
    );
    const failedUrls = urls.filter((url) => !completed.has(url));
    if (!failedUrls.length) return direct;
    logger({ action: "detail_retrieval_fallback", sourceName: context.sourceName, stage: context.stage, entityId: context.entityId, requested: urls.length, fallback: failedUrls.length, directFailureCodes: [...new Set(direct.errors.map((item) => item.code))] });
    const fallback = await fallbackClient.fetchBatch(failedUrls, context);
    const fallbackCompleted = new Set(fallback.results.map((item) => item.url ?? item.final_url).filter(Boolean));
    return {
      urls,
      results: [...usableDirectResults, ...fallback.results],
      errors: [
        ...direct.errors.filter((item) => !fallbackCompleted.has(item.url)),
        ...fallback.errors,
      ],
      payloadHash: sha(`${direct.payloadHash}\n${fallback.payloadHash}`),
      layers: { direct: direct.payloadHash, fallback: fallback.payloadHash },
    };
  }
  return { fetchBatch };
}
