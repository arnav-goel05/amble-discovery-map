function plainText(value) {
  return String(value ?? "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>|<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}

function primaryDetailText(value) {
  const text = plainText(value);
  return text
    .split(
      /(?:^|\n)\s*(?:#{1,6}\s*)?(?:similar experiences|discover our top experiences|nearby|recommended|related|you may also like)\s*(?:\n|$)/i,
    )[0]
    .trim();
}

export function collectLocationStrings(
  value,
  output = [],
  depth = 0,
  key = "",
) {
  if (
    depth > 10 ||
    output.length >= 80 ||
    value === null ||
    value === undefined
  )
    return output;
  if (
    /nearby|recommended|related|similar|you may also like|articles?_events?|events?_articles?/i.test(
      key,
    )
  )
    return output;
  if (typeof value === "string") {
    const text = primaryDetailText(value);
    if (
      /\bSingapore\s+\d{6}\b|\b(?:starting point|address|location|visit us at)\b/i.test(
        text,
      )
    )
      output.push(text);
  } else if (Array.isArray(value)) {
    for (const item of value)
      collectLocationStrings(item, output, depth + 1, key);
  } else if (typeof value === "object") {
    for (const [name, item] of Object.entries(value))
      collectLocationStrings(item, output, depth + 1, name);
  }
  return output;
}

export function extractAddressEvidence(values) {
  const text = (Array.isArray(values) ? values : [values])
    .map(plainText)
    .filter(Boolean)
    .join("\n");
  const postalCodes = [
    ...new Set(
      [...text.matchAll(/\bSingapore\s+(\d{6})\b/gi)].map((match) => match[1]),
    ),
  ];
  const candidates = [];
  const add = (value) => {
    const cleaned = String(value ?? "")
      .replace(/^[\s:;,-]+|[\s;,.]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (
      cleaned &&
      cleaned.length <= 240 &&
      !candidates.some((item) => item.toLowerCase() === cleaned.toLowerCase())
    )
      candidates.push(cleaned);
  };
  const patterns = [
    /(?:starting point|visit us at|address|location)\s*:?\s*([^\n]{3,210}?\bSingapore\s+\d{6})/gi,
    /((?:[A-Za-zÀ-ž0-9'’&.@() -]+:\s*)?\d{1,4}[A-Za-z]?\s+[^\n]{2,150}?\bSingapore\s+\d{6})/gi,
  ];
  for (const pattern of patterns)
    for (const match of text.matchAll(pattern)) add(match[1]);
  const addressCandidates = candidates.filter(
    (candidate) =>
      !candidates.some(
        (other) =>
          other !== candidate &&
          candidate.toLowerCase().includes(other.toLowerCase()) &&
          other.length + 8 < candidate.length,
      ),
  );
  const units = [
    ...new Set(
      [...text.matchAll(/#\s*\d{1,3}\s*-\s*[a-z0-9]{1,5}/gi)].map((match) =>
        match[0].replace(/\s+/g, ""),
      ),
    ),
  ];
  return { postalCodes, addressCandidates, units };
}

export function preferAuthoritativeRecovery(
  sourceValues = [],
  deterministicValues = [],
  reviewedValues = [],
) {
  if (reviewedValues?.length) return [...reviewedValues];
  if (deterministicValues?.length) return [...deterministicValues];
  return [...sourceValues];
}
