const GROUP_ORDER = ["what", "when", "where", "price"];
const SINGLE_VALUE_DIMENSIONS = new Set(["when", "where", "price"]);

export const normalizeOptionLabel = (value) =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

const optionSlug = (value) => normalizeOptionLabel(value).replaceAll(" ", "-");

const fixedOption = (dimension, value, label, kind = dimension) => ({
  id: `${dimension}:${value}`,
  dimension,
  value,
  label,
  kind,
  searchableLabel: normalizeOptionLabel(label),
  availableCount: null,
});

const WHEN_OPTIONS = [
  fixedOption("when", "today", "Today"),
  fixedOption("when", "this-weekend", "This weekend"),
  fixedOption("when", "7-days", "Next 7 days"),
  fixedOption("when", "30-days", "Next 30 days"),
  fixedOption("when", "custom", "Choose dates", "custom"),
];

const WHERE_OPTIONS = [
  fixedOption("where", "near-me", "Near me", "radius"),
  fixedOption("where", "map-area", "Current map area", "bounds"),
  fixedOption("where", "anywhere", "Anywhere in Singapore", "anywhere"),
  fixedOption("where", "mystery-location", "Mystery Location", "placement"),
];

const PRICE_OPTIONS = [
  fixedOption("price", "free", "Free"),
  fixedOption("price", "under-25", "Under $25"),
  fixedOption("price", "25-50", "$25–$50"),
  fixedOption("price", "50-100", "$50–$100"),
  fixedOption("price", "100-plus", "Over $100"),
];

const safeCount = (value) => {
  const count = Number(value);
  return Number.isInteger(count) && count >= 0 ? count : null;
};

const sourceLocationOption = (location) => {
  const label = String(location?.label ?? "").trim();
  const kind = String(location?.kind ?? "").trim();
  const value = String(location?.value ?? "").trim();
  if (!label || !["area", "landmark", "venue"].includes(kind) || !value)
    return null;
  return {
    id: String(location.id || `${kind}:${optionSlug(value)}`),
    dimension: "where",
    value,
    label,
    kind,
    searchableLabel: normalizeOptionLabel(label),
    availableCount: safeCount(location.availableCount),
  };
};

export function createFilterOptionCatalog({
  categories = [],
  locations = [],
} = {}) {
  const what = [...new Set(categories.map((value) => String(value).trim()))]
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right))
    .map((label) => ({
      id: `what:${optionSlug(label)}`,
      dimension: "what",
      value: label,
      label,
      kind: "category",
      searchableLabel: normalizeOptionLabel(label),
      availableCount: null,
    }));
  const seenLocationIds = new Set();
  const sourceLocations = locations
    .map(sourceLocationOption)
    .filter(Boolean)
    .filter(({ id }) => {
      if (seenLocationIds.has(id)) return false;
      seenLocationIds.add(id);
      return true;
    })
    .sort(
      (left, right) =>
        (right.availableCount ?? 0) - (left.availableCount ?? 0) ||
        left.label.localeCompare(right.label),
    );
  const groups = {
    what,
    when: WHEN_OPTIONS.map((item) => ({ ...item })),
    where: [...WHERE_OPTIONS.map((item) => ({ ...item })), ...sourceLocations],
    price: PRICE_OPTIONS.map((item) => ({ ...item })),
  };
  return {
    groups,
    all: GROUP_ORDER.flatMap((dimension) => groups[dimension]),
  };
}

export function filterOptionCatalog(
  catalog,
  query = "",
  { initialLocationLimit = 6 } = {},
) {
  const normalizedQuery = normalizeOptionLabel(query);
  return GROUP_ORDER.map((dimension) => {
    let options = catalog?.groups?.[dimension] ?? [];
    if (normalizedQuery) {
      options = options.filter(({ searchableLabel }) =>
        searchableLabel.includes(normalizedQuery),
      );
    } else if (dimension === "where") {
      const fixed = options.filter(({ id }) => id.startsWith("where:"));
      const source = options
        .filter(({ id }) => !id.startsWith("where:"))
        .slice(0, initialLocationLimit);
      options = [...fixed, ...source];
    }
    return { dimension, options };
  }).filter(({ options }) => options.length);
}

const orderedTokens = (tokens) =>
  tokens.map((token, selectionOrder) => ({ ...token, selectionOrder }));

export function selectFilterToken(tokens = [], option, parameters = {}) {
  if (!option?.id || !GROUP_ORDER.includes(option.dimension))
    return orderedTokens(tokens);
  let next = tokens.filter(({ optionId }) => optionId !== option.id);
  const wasActive = next.length !== tokens.length;
  if (option.dimension === "where" && option.kind === "anywhere")
    return orderedTokens(next.filter(({ dimension }) => dimension !== "where"));
  if (option.dimension === "what" && wasActive) return orderedTokens(next);
  if (SINGLE_VALUE_DIMENSIONS.has(option.dimension))
    next = next.filter(({ dimension }) => dimension !== option.dimension);
  next.push({
    optionId: option.id,
    dimension: option.dimension,
    label: option.label,
    value: option.value,
    kind: option.kind,
    parameters: { ...parameters },
    state: "active",
  });
  return orderedTokens(next);
}

export function removeFilterToken(tokens = [], optionId) {
  return orderedTokens(tokens.filter((token) => token.optionId !== optionId));
}

export function reconcileFilterTokens(tokens = [], catalog) {
  const optionsById = new Map(
    (catalog?.all ?? []).map((option) => [option.id, option]),
  );
  const removed = [];
  const reconciled = [];
  for (const token of tokens) {
    const current = optionsById.get(token.optionId);
    if (!current) {
      removed.push(token);
      continue;
    }
    reconciled.push({
      ...token,
      dimension: current.dimension,
      label:
        current.kind === "custom" && token.parameters
          ? token.label
          : current.label,
      value: current.value,
      kind: current.kind,
    });
  }
  return { tokens: orderedTokens(reconciled), removed };
}

export function projectFilterTokens(tokens = []) {
  const categories = tokens
    .filter(({ dimension }) => dimension === "what")
    .map(({ value }) => value);
  const when = tokens.find(({ dimension }) => dimension === "when");
  const price = tokens.find(({ dimension }) => dimension === "price");
  const location = tokens.find(({ dimension }) => dimension === "where");
  let where = null;
  let placementView = "all";
  if (location?.kind === "radius")
    where = {
      kind: "radius",
      center: location.parameters?.center,
      radiusKm: Number(location.parameters?.radiusKm ?? 3),
    };
  else if (location?.kind === "bounds")
    where = {
      kind: "bounds",
      west: Number(location.parameters?.west),
      south: Number(location.parameters?.south),
      east: Number(location.parameters?.east),
      north: Number(location.parameters?.north),
    };
  else if (location?.kind === "area")
    where = { kind: "area", areaId: location.value };
  else if (location?.kind === "landmark")
    where = { kind: "landmark", landmarkId: location.value };
  else if (location?.kind === "venue")
    where = {
      kind: "venue",
      venueKey: normalizeOptionLabel(location.value),
    };
  else if (location?.kind === "placement")
    placementView =
      location.value === "mystery-location" ? "secret_tba" : location.value;
  return {
    categories,
    dateRange: when?.value ?? "any",
    dateStart: when?.kind === "custom" ? (when.parameters?.start ?? "") : "",
    dateEnd: when?.kind === "custom" ? (when.parameters?.end ?? "") : "",
    placementView,
    priceRange: price?.value ?? "any",
    query: "",
    where,
  };
}

export function recoverySuggestions(tokens = [], evaluate) {
  if (typeof evaluate !== "function") return [];
  const suggestions = [];
  for (const token of tokens) {
    const result = evaluate(removeFilterToken(tokens, token.optionId));
    const restoredCount = Number(result?.matchedEvents ?? 0);
    if (Number.isInteger(restoredCount) && restoredCount > 0)
      suggestions.push({
        tokenId: token.optionId,
        label: `Remove ${token.label}`,
        restoredCount,
      });
  }
  return suggestions.sort(
    (left, right) =>
      right.restoredCount - left.restoredCount ||
      left.label.localeCompare(right.label),
  );
}

const coordinatesOf = (event) => {
  const source = event?.anchor ?? event?.candidateCoordinates;
  const longitude = Number(Array.isArray(source) ? source[0] : source?.lng);
  const latitude = Number(Array.isArray(source) ? source[1] : source?.lat);
  return Number.isFinite(longitude) && Number.isFinite(latitude)
    ? [longitude, latitude]
    : null;
};

export function distanceKm(left, right) {
  if (
    !Array.isArray(left) ||
    !Array.isArray(right) ||
    left.length < 2 ||
    right.length < 2
  )
    return Number.POSITIVE_INFINITY;
  const [leftLongitude, leftLatitude] = left.map(Number);
  const [rightLongitude, rightLatitude] = right.map(Number);
  if (
    ![leftLongitude, leftLatitude, rightLongitude, rightLatitude].every(
      Number.isFinite,
    )
  )
    return Number.POSITIVE_INFINITY;
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(rightLatitude - leftLatitude);
  const longitudeDelta = radians(rightLongitude - leftLongitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(leftLatitude)) *
      Math.cos(radians(rightLatitude)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function matchesWhere(event, where) {
  if (!where) return true;
  if (where.kind === "landmark") return event?.landmarkId === where.landmarkId;
  if (where.kind === "venue")
    return normalizeOptionLabel(event?.venue) === where.venueKey;
  if (where.kind === "area") return event?.candidateAreaId === where.areaId;
  const coordinates = coordinatesOf(event);
  if (!coordinates) return false;
  if (where.kind === "radius")
    return distanceKm(coordinates, where.center) <= Number(where.radiusKm);
  if (where.kind === "bounds") {
    const [longitude, latitude] = coordinates;
    const west = Number(where.west);
    const south = Number(where.south);
    const east = Number(where.east);
    const north = Number(where.north);
    if (![west, south, east, north].every(Number.isFinite)) return false;
    const longitudeMatches =
      west <= east
        ? longitude >= west && longitude <= east
        : longitude >= west || longitude <= east;
    return longitudeMatches && latitude >= south && latitude <= north;
  }
  return true;
}
