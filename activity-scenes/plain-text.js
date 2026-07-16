function decodeHtmlEntities(value) {
  const template = document.createElement("template");
  template.innerHTML = value;
  return template.content.textContent || "";
}

export function plainText(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const withTextBreaks = trimmed
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n");
  return decodeHtmlEntities(withTextBreaks)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
