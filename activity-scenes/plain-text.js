function decodeHtmlEntities(value) {
  if (globalThis.document?.createElement) {
    const template = document.createElement("template");
    template.innerHTML = value;
    return template.content.textContent || "";
  }
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(
    /&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi,
    (entity, decimal, hexadecimal, name) => {
      const codePoint = Number.parseInt(
        decimal ?? hexadecimal,
        hexadecimal ? 16 : 10,
      );
      if (Number.isInteger(codePoint))
        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return entity;
        }
      return named[name?.toLowerCase()] ?? entity;
    },
  );
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
