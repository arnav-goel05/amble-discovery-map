import "@phosphor-icons/web/bold";
import {
  announceOverlayOpen,
  closeWhenAnotherOverlayOpens,
  watchOverlayState,
} from "./overlay-coordinator";
import { eventLocationLabel } from "./events/event-location-label.js";
import {
  createFilterOptionCatalog,
  filterOptionCatalog,
  projectFilterTokens,
  reconcileFilterTokens,
  recoverySuggestions,
  removeFilterToken,
  selectFilterToken,
} from "./events/event-filter-options.js";
import { classifyEventQuery } from "./events/event-query-classifier.js";
import { createEventQueryController } from "./events/event-query-controller.js";

const CATEGORY_ICONS = {
  Exhibitions: "ph-images-square",
  Performances: "ph-microphone-stage",
  "Workshops & Classes": "ph-paint-brush",
  "Tours & Experiences": "ph-map-trifold",
};
const CATEGORY_THUMBNAILS = {
  Exhibitions: "/event-filter-thumbnails/exhibitions.png",
  Performances: "/event-filter-thumbnails/performances.png",
  "Workshops & Classes": "/event-filter-thumbnails/workshops-classes.png",
  "Tours & Experiences": "/event-filter-thumbnails/tours-experiences.png",
};
const GROUP_LABELS = {
  what: "What",
  when: "When",
  where: "Where",
  price: "Price",
};
const OPTION_ICONS = {
  what: "ph-shapes",
  when: "ph-calendar-blank",
  where: "ph-map-pin",
  price: "ph-ticket",
};
const OPTION_THUMBNAILS = {
  what: "/event-filter-thumbnails/what.png",
  when: "/event-filter-thumbnails/when.png",
  where: "/event-filter-thumbnails/where.png",
  price: "/event-filter-thumbnails/price.png",
};
const RESULT_BATCH_SIZE = 8;
const DIMENSION_ORDER = ["what", "when", "where", "price"];
const PHRASE_CONNECTORS = {
  what: "",
  when: "on",
  where: "near",
  price: "for",
};
const phraseConnector = (token) =>
  token.dimension === "price" && /^(under|over)\b/i.test(token.label)
    ? ""
    : PHRASE_CONNECTORS[token.dimension];
const catalogFingerprint = (optionCatalog) =>
  optionCatalog.all
    .map(
      ({ availableCount, id, label }) =>
        `${id}\u0000${label}\u0000${availableCount ?? ""}`,
    )
    .join("\u0001");
const catalogRevisionFor = (optionCatalog) => {
  let hash = 0x811c9dc5;
  for (const character of catalogFingerprint(optionCatalog)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return `event-catalog:${(hash >>> 0).toString(16).padStart(8, "0")}`;
};

function createFilterThumbnail({ fallbackIcon, src }) {
  const thumbnail = document.createElement("span");
  thumbnail.className = "landmark-event-search__thumbnail";
  thumbnail.setAttribute("aria-hidden", "true");
  const image = Object.assign(document.createElement("img"), {
    alt: "",
    decoding: "async",
    src,
  });
  const fallback = Object.assign(document.createElement("i"), {
    className: `ph-bold ${fallbackIcon}`,
  });
  image.addEventListener(
    "error",
    () => thumbnail.classList.add("is-fallback"),
    { once: true },
  );
  thumbnail.append(image, fallback);
  return thumbnail;
}

function dateLabel(start, end) {
  if (!start && !end) return "Choose dates";
  const format = (value) =>
    new Intl.DateTimeFormat("en-SG", {
      day: "numeric",
      month: "short",
    }).format(new Date(`${value}T00:00:00`));
  if (start && !end) return `From ${format(start)}`;
  if (!start && end) return `Until ${format(end)}`;
  if (start === end) return format(start);
  return `${format(start)} – ${format(end)}`;
}

function createDateRangePanel() {
  const button = Object.assign(document.createElement("button"), {
    type: "button",
    textContent: "Choose dates",
  });
  button.hidden = true;
  const panel = document.createElement("div");
  panel.className = "landmark-event-search__date-panel";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Choose date range");
  const field = (name, labelText) => {
    const label = document.createElement("label");
    label.className = "landmark-event-search__date-field";
    label.append(
      Object.assign(document.createElement("span"), {
        textContent: labelText,
      }),
    );
    const input = Object.assign(document.createElement("input"), {
      type: "date",
      name,
      autocomplete: "off",
    });
    input.setAttribute("aria-label", labelText);
    label.append(input);
    return { input, label };
  };
  const start = field("dateStart", "Start date");
  const end = field("dateEnd", "End date");
  const actions = document.createElement("div");
  actions.className = "landmark-event-search__date-actions";
  const clear = Object.assign(document.createElement("button"), {
    type: "button",
    textContent: "Clear",
  });
  const apply = Object.assign(document.createElement("button"), {
    type: "button",
    textContent: "Apply",
  });
  apply.className = "landmark-event-search__date-apply";
  actions.append(clear, apply);
  panel.append(start.label, end.label, actions);
  return {
    apply,
    button,
    clear,
    end: end.input,
    panel,
    start: start.input,
  };
}

const defaultLocationRequest = () =>
  new Promise((resolve, reject) => {
    if (!globalThis.navigator?.geolocation?.getCurrentPosition) {
      reject(new Error("Location is unavailable on this device."));
      return;
    }
    globalThis.navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve([coords.longitude, coords.latitude]),
      () => reject(new Error("Location access was not granted.")),
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 10_000 },
    );
  });

const normalizeBounds = (bounds) => {
  if (!bounds) return null;
  const normalized = {
    west: Number(bounds.getWest?.() ?? bounds.west),
    south: Number(bounds.getSouth?.() ?? bounds.south),
    east: Number(bounds.getEast?.() ?? bounds.east),
    north: Number(bounds.getNorth?.() ?? bounds.north),
  };
  return Object.values(normalized).every(Number.isFinite) ? normalized : null;
};

const normalizePosition = (position) => {
  const source = Array.isArray(position)
    ? position
    : [position?.coords?.longitude, position?.coords?.latitude];
  const coordinates = source.map(Number);
  return coordinates.length >= 2 && coordinates.every(Number.isFinite)
    ? coordinates.slice(0, 2)
    : null;
};

export function createLandmarkEventSearch({
  categories = [],
  discoveryModel,
  getMapBounds = () => null,
  onFilter,
  onFilterResult,
  onResultSelect,
  onSearch,
  requestLocation = defaultLocationRequest,
}) {
  const existing = document.getElementById("landmark-event-search");
  if (existing)
    return {
      destroy: () => {},
      input: existing.querySelector("#landmark-event-search-input"),
      root: existing,
    };

  let activeDiscoveryModel = discoveryModel;
  let catalog = createFilterOptionCatalog(
    activeDiscoveryModel?.filterOptions?.() ?? { categories, locations: [] },
  );
  let tokens = [];
  let activeDimension = null;
  let wantsOpen = false;
  let legacyQuery = "";
  let editingQuery = false;
  let cachedDiscoveryResult = null;
  let reconciliationNotice = "";
  let resultItems = [];
  let renderedResultCount = 0;
  let selectedEventId = null;
  let revision = 0;
  let destroyed = false;
  const subscribers = new Set();

  const root = document.createElement("search");
  root.id = "landmark-event-search";
  root.className = "landmark-event-search";
  root.setAttribute("aria-label", "Filter upcoming events");

  const label = document.createElement("label");
  label.className = "landmark-event-search__label";
  label.htmlFor = "landmark-event-search-input";
  label.textContent = "Filter events";

  const controls = document.createElement("div");
  controls.id = "landmark-event-search-controls";
  controls.className = "landmark-event-search__controls";

  const builder = document.createElement("div");
  builder.className = "landmark-event-search__builder";
  const prompt = Object.assign(document.createElement("span"), {
    className: "landmark-event-search__prompt",
    textContent: "Find",
  });
  const tokenHost = document.createElement("span");
  tokenHost.className = "landmark-event-search__tokens";
  const input = document.createElement("input");
  input.id = "landmark-event-search-input";
  input.className = "landmark-event-search__input";
  input.type = "search";
  input.placeholder = "Add filter";
  input.autocomplete = "off";
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", "landmark-event-filter-options");
  input.setAttribute("aria-expanded", "false");
  builder.append(prompt, tokenHost, input);

  const popover = document.createElement("div");
  popover.className = "landmark-event-search__popover";
  popover.hidden = true;
  const options = document.createElement("div");
  options.id = "landmark-event-filter-options";
  options.className = "landmark-event-search__options";
  options.setAttribute("role", "listbox");
  options.setAttribute("aria-label", "Event filter options");
  const dateFilter = createDateRangePanel();
  const results = document.createElement("div");
  results.id = "landmark-event-search-results";
  results.className = "landmark-event-search__results";
  results.hidden = true;
  results.setAttribute("role", "listbox");
  results.setAttribute("aria-label", "Matching events");
  const recovery = document.createElement("div");
  recovery.className = "landmark-event-search__recovery";
  recovery.hidden = true;
  popover.append(options, dateFilter.panel, recovery, results);

  const status = document.createElement("div");
  status.className = "landmark-event-search__status";
  status.setAttribute("aria-live", "polite");
  const collapsedIndicator = document.createElement("div");
  collapsedIndicator.className = "landmark-event-search__collapsed-indicator";
  collapsedIndicator.setAttribute("aria-hidden", "true");
  collapsedIndicator.append(
    Object.assign(document.createElement("i"), {
      className: "ph-bold ph-dots-three",
    }),
  );

  const placementViews = new Map();
  const optionById = (id) =>
    catalog.all.find((candidate) => candidate.id === id);
  const activeOptionIds = () => new Set(tokens.map(({ optionId }) => optionId));
  const nextUnfilledDimension = (after = null) => {
    const start = Math.max(0, DIMENSION_ORDER.indexOf(after) + 1);
    const ordered = [
      ...DIMENSION_ORDER.slice(start),
      ...DIMENSION_ORDER.slice(0, start),
    ];
    return (
      ordered.find(
        (dimension) =>
          dimension === "what" ||
          !tokens.some((token) => token.dimension === dimension),
      ) ?? "what"
    );
  };
  const resultEventId = (item) =>
    item?.candidateId ?? item?.targetId ?? item?.eventId ?? item?.id ?? null;
  const eventComposerState = () => {
    const phrases = [...tokens]
      .sort(
        (left, right) =>
          DIMENSION_ORDER.indexOf(left.dimension) -
            DIMENSION_ORDER.indexOf(right.dimension) ||
          left.selectionOrder - right.selectionOrder ||
          left.optionId.localeCompare(right.optionId),
      )
      .map((token) => ({
        phraseId: `phrase:${token.optionId}`.slice(0, 120),
        facet: token.dimension,
        valueId: token.optionId,
        label: String(token.label).slice(0, 160),
      }));
    return {
      canonicalSentence: [
        ...phrases.map(({ label: phraseLabel }) => phraseLabel),
        legacyQuery,
      ]
        .filter(Boolean)
        .join(" ")
        .slice(0, 500),
      residualQuery: legacyQuery.slice(0, 500),
      phrases,
      catalogRevision: catalogRevisionFor(catalog),
      contextRevision: revision,
      resultCount:
        cachedDiscoveryResult?.matchedEvents ??
        renderedResultCount ??
        resultItems.length,
    };
  };
  const snapshot = () => ({
    revision,
    query: legacyQuery.slice(0, 500),
    resultsOpen: wantsOpen && !results.hidden,
    filterOptions: catalog.all.slice(0, 100).map((option) => ({
      id: option.id,
      dimension: option.dimension,
      value: option.value,
      label: option.label,
      kind: option.kind,
    })),
    filterTokens: tokens.slice(0, 20).map((token) => ({
      optionId: token.optionId,
      dimension: token.dimension,
      value: token.value,
      label: token.label,
      kind: token.kind,
      parameters: { ...token.parameters },
    })),
    eventComposerState: eventComposerState(),
    events: resultItems.slice(0, 50).map((item) => ({
      eventId: resultEventId(item),
      title: String(item?.title ?? "").slice(0, 200),
      occurrenceIds: (item?.occurrences ?? item?.sessions ?? [])
        .map(
          (occurrence) =>
            occurrence?.occurrenceId ?? occurrence?.sessionId ?? occurrence?.id,
        )
        .filter(Boolean)
        .slice(0, 20),
      sourceOffers: (item?.sourceOffers ?? [])
        .slice(0, 10)
        .map((offer, index) => ({
          referenceId:
            offer?.referenceId ?? offer?.id ?? `reference:${index + 1}`,
        })),
      landmarkId: item?.landmarkId ?? null,
      anchor: item?.anchor ?? null,
      publicPlacement: item?.publicPlacement ?? null,
    })),
    selectedEventId,
  });
  const publish = () => {
    if (destroyed) return;
    revision += 1;
    const current = snapshot();
    for (const subscriber of subscribers) subscriber(current);
  };

  const openPopover = () => {
    const wasOpen = wantsOpen;
    wantsOpen = true;
    root.classList.add("is-open");
    popover.hidden = false;
    input.setAttribute("aria-expanded", "true");
    if (!wasOpen) announceOverlayOpen("event-search");
    if (!wasOpen) publish();
  };
  const closePopover = () => {
    const wasOpen = wantsOpen;
    wantsOpen = false;
    activeDimension = null;
    editingQuery = false;
    input.value = "";
    input.placeholder = "Add filter";
    root.classList.remove("is-open");
    popover.hidden = true;
    input.setAttribute("aria-expanded", "false");
    dateFilter.panel.hidden = true;
    renderOptionGroups();
    if (wasOpen) publish();
  };

  const renderTokens = () => {
    tokenHost.replaceChildren();
    const appendQuery = () => {
      if (!legacyQuery || editingQuery) return;
      const queryButton = Object.assign(document.createElement("button"), {
        type: "button",
        className:
          "landmark-event-search__token landmark-event-search__query-phrase",
      });
      queryButton.dataset.filterQuery = legacyQuery;
      queryButton.dataset.phraseDimension = "what";
      queryButton.setAttribute("aria-label", `Edit ${legacyQuery}`);
      queryButton.append(
        Object.assign(document.createElement("strong"), {
          textContent: legacyQuery,
        }),
      );
      queryButton.addEventListener("click", () => {
        editingQuery = true;
        activeDimension = "what";
        input.value = legacyQuery;
        input.placeholder = "Describe the event";
        renderTokens();
        openPopover();
        renderOptionGroups();
        input.focus();
      });
      tokenHost.append(queryButton);
    };
    for (const dimension of DIMENSION_ORDER) {
      const dimensionTokens = tokens.filter(
        (token) => token.dimension === dimension,
      );
      for (const [index, token] of dimensionTokens.entries()) {
        const connector = index === 0 ? phraseConnector(token) : "";
        if (connector)
          tokenHost.append(
            Object.assign(document.createElement("span"), {
              className: "landmark-event-search__connector",
              textContent: connector,
            }),
          );
        const button = Object.assign(document.createElement("button"), {
          type: "button",
          className: "landmark-event-search__token",
        });
        button.dataset.filterTokenId = token.optionId;
        button.dataset.phraseDimension = token.dimension;
        button.setAttribute("aria-label", `Edit ${token.label}`);
        button.append(
          Object.assign(document.createElement("strong"), {
            textContent: token.label,
          }),
        );
        button.addEventListener("click", () => {
          activeDimension = token.dimension;
          input.value = "";
          input.placeholder = `Change ${GROUP_LABELS[token.dimension]}`;
          openPopover();
          renderOptionGroups();
          input.focus();
        });
        tokenHost.append(button);
      }
    }
    appendQuery();
  };

  const parametersForOption = async (selected) => {
    let parameters = {};
    if (selected.kind === "bounds") {
      const bounds = normalizeBounds(getMapBounds());
      if (!bounds) {
        root.dataset.state = "error";
        status.textContent = "The current map area is unavailable.";
        return null;
      }
      parameters = bounds;
    }
    if (selected.kind === "radius") {
      root.dataset.state = "pending-permission";
      root.setAttribute("aria-busy", "true");
      status.textContent = "Getting your location…";
      try {
        const center = normalizePosition(await requestLocation());
        if (!center) throw new Error("Location is unavailable.");
        parameters = { center, radiusKm: 3 };
      } catch (error) {
        root.dataset.state = "permission-denied";
        status.textContent =
          error?.message || "Location access was not granted.";
        root.setAttribute("aria-busy", "false");
        openPopover();
        return null;
      }
      root.setAttribute("aria-busy", "false");
    }
    return parameters;
  };

  const selectOption = async (selected) => {
    if (!selected) return;
    if (selected.kind === "custom") {
      dateFilter.panel.hidden = false;
      dateFilter.start.focus();
      return;
    }
    const parameters = await parametersForOption(selected);
    if (!parameters) return;
    const nextTokens = selectFilterToken(tokens, selected, parameters);
    if (
      !["bounds", "radius", "custom"].includes(selected.kind) &&
      Object.keys(parameters).length === 0
    ) {
      executeAction("event.applyquery", {
        text: nextTokens
          .filter(({ dimension }) => dimension === selected.dimension)
          .map(({ label: tokenLabel }) => tokenLabel)
          .join(" "),
        mode: "refine",
        baseContextRevision: revision,
        catalogRevision: catalogRevisionFor(catalog),
      });
      return;
    }
    executeAction(
      "event.setfilter",
      {
        facet: selected.dimension,
        values: nextTokens
          .filter(({ dimension }) => dimension === selected.dimension)
          .map((token) => ({
            filterId: token.optionId,
            parameters: token.parameters,
          })),
      },
      { advanceFrom: selected.dimension },
    );
  };

  const commitDraftQuery = async () => {
    const draft = input.value.trim();
    if (!draft) {
      closePopover();
      return;
    }
    executeAction("event.applyquery", {
      text: draft,
      mode: editingQuery ? "refine" : "replace",
      baseContextRevision: revision,
      catalogRevision: catalogRevisionFor(catalog),
    });
  };

  function renderOptionGroups() {
    options.replaceChildren();
    options.hidden = false;
    placementViews.clear();
    const query = input.value.trim();
    const selected = activeOptionIds();

    if (!activeDimension && !query) activeDimension = nextUnfilledDimension();
    options.dataset.view = activeDimension ? "values" : "matches";
    const flow = document.createElement("nav");
    flow.className = "landmark-event-search__flow";
    flow.setAttribute("aria-label", "Event search steps");
    for (const dimension of DIMENSION_ORDER) {
      const isFilled =
        dimension !== "what" &&
        tokens.some((token) => token.dimension === dimension);
      if (isFilled && activeDimension !== dimension) continue;
      if (
        dimension === "what" &&
        tokens.some((token) => token.dimension === "what") &&
        activeDimension !== "what"
      )
        continue;
      const button = Object.assign(document.createElement("button"), {
        type: "button",
        className: "landmark-event-search__flow-step",
        textContent: GROUP_LABELS[dimension],
      });
      button.dataset.filterDimension = dimension;
      button.setAttribute(
        "aria-current",
        activeDimension === dimension ? "step" : "false",
      );
      button.addEventListener("click", () => {
        activeDimension = dimension;
        input.value = "";
        input.placeholder = `Search ${GROUP_LABELS[dimension]}`;
        renderOptionGroups();
        input.focus();
      });
      flow.append(button);
    }
    options.append(flow);

    const groups = filterOptionCatalog(catalog, query)
      .map((group) =>
        group.dimension === "where"
          ? {
              ...group,
              options: group.options.filter(({ id }) =>
                id.startsWith("where:"),
              ),
            }
          : group,
      )
      .filter(
        (group) =>
          group.options.length &&
          (!activeDimension || group.dimension === activeDimension),
      );
    if (activeDimension) {
      const activeTokens = tokens.filter(
        (token) => token.dimension === activeDimension,
      );
      const hasEditablePhrase =
        activeTokens.length || (activeDimension === "what" && legacyQuery);
      if (hasEditablePhrase) {
        const header = document.createElement("header");
        header.className = "landmark-event-search__option-header";
        header.append(
          Object.assign(document.createElement("h2"), {
            className: "landmark-event-search__option-view-title",
            textContent: GROUP_LABELS[activeDimension],
          }),
        );
        const remove = Object.assign(document.createElement("button"), {
          type: "button",
          className: "landmark-event-search__remove-phrase",
          textContent:
            activeTokens.length > 1 ? "Clear selected" : "Remove selection",
        });
        remove.addEventListener("click", () => {
          if (activeTokens.length)
            executeAction("event.applyquery", {
              text: activeTokens
                .map(({ label: tokenLabel }) => tokenLabel)
                .join(" "),
              mode: "remove",
              baseContextRevision: revision,
              catalogRevision: catalogRevisionFor(catalog),
            });
          if (activeDimension === "what" && legacyQuery)
            executeAction("event.search", { query: "" });
          activeDimension = nextUnfilledDimension();
          input.value = "";
          renderOptionGroups();
        });
        header.append(remove);
        options.append(header);
      }
    }
    if (!groups.length) {
      options.append(
        Object.assign(document.createElement("p"), {
          className: "landmark-event-search__no-options",
          textContent: query
            ? `Press Enter to search for “${query}”.`
            : "No options are available.",
        }),
      );
      return;
    }
    for (const group of groups) {
      const section = document.createElement("section");
      section.className = "landmark-event-search__option-group";
      section.setAttribute("role", "group");
      const heading = Object.assign(document.createElement("h2"), {
        className: "landmark-event-search__option-group-heading",
        textContent: GROUP_LABELS[group.dimension],
      });
      if (activeDimension) heading.classList.add("is-visually-hidden");
      const list = document.createElement("div");
      list.className = "landmark-event-search__option-list";
      for (const item of group.options) {
        const button = Object.assign(document.createElement("button"), {
          type: "button",
          className: "landmark-event-search__option",
        });
        button.dataset.filterOptionId = item.id;
        button.setAttribute("role", "option");
        button.setAttribute("aria-selected", String(selected.has(item.id)));
        const fallbackIcon =
          item.dimension === "what"
            ? CATEGORY_ICONS[item.label] || OPTION_ICONS.what
            : OPTION_ICONS[item.dimension];
        const thumbnail = createFilterThumbnail({
          fallbackIcon,
          src:
            item.dimension === "what"
              ? CATEGORY_THUMBNAILS[item.label] || OPTION_THUMBNAILS.what
              : OPTION_THUMBNAILS[item.dimension],
        });
        const copy = document.createElement("span");
        copy.append(
          Object.assign(document.createElement("strong"), {
            textContent: item.label,
          }),
        );
        if (Number.isInteger(item.availableCount))
          copy.append(
            Object.assign(document.createElement("small"), {
              textContent: `${item.availableCount} ${
                item.availableCount === 1 ? "event" : "events"
              }`,
            }),
          );
        const check = Object.assign(document.createElement("i"), {
          className: "ph-bold ph-check",
          ariaHidden: "true",
        });
        button.append(thumbnail, copy, check);
        button.addEventListener("click", () => void selectOption(item));
        list.append(button);
        if (item.id === "where:mystery-location")
          placementViews.set("secret_tba", button);
      }
      section.append(heading, list);
      options.append(section);
    }
  }

  const createResultOption = (item) => {
    const option = Object.assign(document.createElement("button"), {
      type: "button",
      className: "landmark-event-search__result",
    });
    option.setAttribute("role", "option");
    const thumbnail = createFilterThumbnail({
      fallbackIcon: CATEGORY_ICONS[item.category] || "ph-calendar-blank",
      src: CATEGORY_THUMBNAILS[item.category] || OPTION_THUMBNAILS.what,
    });
    const copy = document.createElement("span");
    copy.className = "landmark-event-search__result-copy";
    copy.append(
      Object.assign(document.createElement("strong"), {
        textContent: item.title,
      }),
      Object.assign(document.createElement("span"), {
        textContent: [
          item.venueGroups?.length > 1
            ? `${item.venueGroups.length} venues`
            : item.venue,
          item.scheduleSummary || item.date,
        ]
          .filter(Boolean)
          .join(" · "),
      }),
    );
    const locationLabel = eventLocationLabel(item);
    if (
      locationLabel ||
      item.freshness === "stale" ||
      item.scheduleKind === "anytime"
    ) {
      const states = document.createElement("span");
      states.className = "landmark-event-search__result-states";
      for (const stateLabel of [
        locationLabel,
        item.scheduleKind === "anytime" ? "Anytime" : "",
        item.freshness === "stale" ? "May be outdated" : "",
      ].filter(Boolean))
        states.append(
          Object.assign(document.createElement("em"), {
            textContent: stateLabel,
          }),
        );
      copy.append(states);
    }
    option.append(thumbnail, copy);
    option.addEventListener("click", () => {
      executeAction("event.selectresult", {
        eventId: resultEventId(item),
        trigger: option,
      });
    });
    return option;
  };

  const appendResultBatch = () => {
    const batch = resultItems.slice(
      renderedResultCount,
      renderedResultCount + RESULT_BATCH_SIZE,
    );
    for (const item of batch) results.append(createResultOption(item));
    renderedResultCount += batch.length;
  };

  const renderResults = (result) => {
    results.replaceChildren();
    resultItems = result.results ?? result.events ?? [];
    renderedResultCount = 0;
    if (!wantsOpen || !resultItems.length) {
      results.hidden = true;
      return;
    }
    const heading = document.createElement("div");
    heading.className = "landmark-event-search__results-heading";
    const copy = document.createElement("div");
    copy.append(
      Object.assign(document.createElement("span"), {
        className: "landmark-event-search__results-eyebrow",
        textContent: tokens.length || legacyQuery ? "Filtered for you" : "",
      }),
      Object.assign(document.createElement("strong"), {
        className: "landmark-event-search__results-title",
        textContent: tokens.length
          ? tokens.map(({ label: tokenLabel }) => tokenLabel).join(" · ")
          : legacyQuery
            ? `Events matching “${legacyQuery}”`
            : "Closest to this view",
      }),
    );
    heading.append(
      copy,
      Object.assign(document.createElement("span"), {
        className: "landmark-event-search__results-count",
        textContent: `${result.matchedEvents} found`,
      }),
    );
    results.append(heading);
    appendResultBatch();
    results.hidden = false;
  };

  const filtersFor = (candidateTokens = tokens) => ({
    ...projectFilterTokens(candidateTokens),
    query: legacyQuery,
  });

  const renderRecovery = (result) => {
    recovery.replaceChildren();
    recovery.hidden = true;
    if (result.matchedEvents !== 0 || !tokens.length) return;
    const suggestions = activeDiscoveryModel
      ? recoverySuggestions(tokens, (candidateTokens) =>
          activeDiscoveryModel.filter(filtersFor(candidateTokens)),
        )
      : [];
    const heading = Object.assign(document.createElement("strong"), {
      textContent: "Try removing a filter",
    });
    recovery.append(heading);
    for (const suggestion of suggestions) {
      const button = Object.assign(document.createElement("button"), {
        type: "button",
        textContent: `${suggestion.label} · ${suggestion.restoredCount}`,
      });
      button.addEventListener("click", () => {
        executeAction("event.removefilter", {
          filterId: suggestion.tokenId,
        });
      });
      recovery.append(button);
    }
    if (!suggestions.length) {
      const clear = Object.assign(document.createElement("button"), {
        type: "button",
        textContent: "Clear all filters",
      });
      clear.addEventListener("click", () => {
        executeAction("event.clearfilters");
      });
      recovery.append(clear);
    }
    recovery.hidden = false;
  };

  const failedResult = () => ({
    matchedEvents: 0,
    query: legacyQuery,
    results: [],
  });
  const renderResult = (result) => {
    root.dataset.state = result.matchedEvents === 0 ? "empty" : "ready";
    status.textContent =
      reconciliationNotice ||
      (result.matchedEvents === 0
        ? tokens.length
          ? "No events match these filters."
          : legacyQuery
            ? "No matching events"
            : "No events available"
        : "");
    reconciliationNotice = "";
    root.classList.toggle("has-no-results", Boolean(status.textContent));
    renderRecovery(result);
    renderResults(result);
    return result;
  };
  const withLoadingState = (operation) => {
    root.dataset.state = "loading";
    root.setAttribute("aria-busy", "true");
    try {
      return renderResult(operation() || failedResult());
    } catch (error) {
      const result = failedResult();
      root.dataset.state = "error";
      status.textContent = "Events are temporarily unavailable. Try again.";
      root.classList.add("has-no-results");
      renderResults(result);
      root.dispatchEvent(
        new CustomEvent("event-search:error", { detail: { error } }),
      );
      return result;
    } finally {
      root.setAttribute("aria-busy", "false");
    }
  };

  const refreshMapAreaToken = () => {
    const bounds = normalizeBounds(getMapBounds());
    if (!bounds) return;
    tokens = tokens.map((token) =>
      token.optionId === "where:map-area"
        ? { ...token, parameters: bounds }
        : token,
    );
  };
  const update = () =>
    withLoadingState(() => {
      refreshMapAreaToken();
      const filters = filtersFor();
      const modelResult = activeDiscoveryModel?.filter(filters);
      if (modelResult) cachedDiscoveryResult = modelResult;
      return modelResult
        ? (onFilterResult?.(modelResult) ?? modelResult)
        : onFilter
          ? onFilter(filters)
          : onSearch?.(legacyQuery);
    });
  const refreshViewport = () => {
    if (tokens.some(({ optionId }) => optionId === "where:map-area"))
      return update();
    if (!cachedDiscoveryResult) return null;
    return withLoadingState(
      () => onFilterResult?.(cachedDiscoveryResult) ?? cachedDiscoveryResult,
    );
  };
  const executeAction = (
    actionId,
    args = {},
    { advanceFrom = null, clearQuery = false } = {},
  ) => {
    if (actionId === "event.applyquery") {
      const controller = createEventQueryController({
        catalog,
        catalogRevision: catalogRevisionFor(catalog),
        contextRevision: revision,
        initialState: {
          filterTokens: tokens,
          residualQuery: legacyQuery,
          resultCount:
            cachedDiscoveryResult?.matchedEvents ?? resultItems.length,
        },
        countResults: ({ query, filterTokens }) =>
          activeDiscoveryModel?.filter({
            ...projectFilterTokens(filterTokens),
            query,
          })?.matchedEvents ?? resultItems.length,
      });
      const result = controller.applyQuery(args);
      if (result.data.outcome === "clarification_required") {
        status.textContent = `Choose ${result.data.clarificationChoices
          .map(({ label: choiceLabel }) => choiceLabel)
          .join(" or ")}.`;
        renderOptionGroups();
        return result;
      }
      if (result.data.outcome !== "applied" || !result.changed) return result;
      const state = controller.snapshot();
      tokens = state.filterTokens;
      legacyQuery = state.residualQuery;
      editingQuery = false;
      input.value = "";
      input.placeholder = "Add details";
      activeDimension = nextUnfilledDimension(state.phrases.at(-1)?.facet);
      renderTokens();
      renderOptionGroups();
      update();
      publish();
      return result;
    }
    if (actionId === "event.setcategory")
      return executeAction("event.setfilter", {
        facet: "what",
        values: args.categoryId
          ? [
              catalog.groups.what.find(({ value }) => value === args.categoryId)
                ?.id,
            ].filter(Boolean)
          : [],
      });
    if (actionId === "event.setdaterange")
      return executeAction("event.setfilter", {
        facet: "when",
        values:
          args.startDate || args.endDate
            ? [
                {
                  filterId: "when:custom",
                  parameters: {
                    start: args.startDate || "",
                    end: args.endDate || "",
                  },
                  label: dateLabel(args.startDate, args.endDate),
                },
              ]
            : [],
      });
    if (actionId === "event.setpricerange")
      return executeAction("event.setfilter", {
        facet: "price",
        values: args.priceBand ? [`price:${args.priceBand}`] : [],
      });
    if (actionId === "event.search") {
      legacyQuery = String(args.query ?? "").trim();
      editingQuery = false;
      input.value = "";
    } else if (actionId === "event.setfilter") {
      if (
        !Object.hasOwn(catalog.groups, args.facet) ||
        !Array.isArray(args.values)
      )
        return false;
      const singleValue = ["when", "where", "price"].includes(args.facet);
      if (singleValue && args.values.length > 1) return false;
      const selected = [];
      const seen = new Set();
      for (const value of args.values) {
        const id =
          typeof value === "string"
            ? value
            : (value?.filterId ?? value?.optionId ?? value?.id);
        const option = optionById(id);
        if (!option || option.dimension !== args.facet || seen.has(option.id))
          return false;
        seen.add(option.id);
        selected.push({
          option,
          parameters:
            value && typeof value === "object" ? (value.parameters ?? {}) : {},
          label: value && typeof value === "object" ? value.label : undefined,
        });
      }
      let nextTokens = tokens.filter(
        ({ dimension }) => dimension !== args.facet,
      );
      for (const value of selected)
        nextTokens = selectFilterToken(
          nextTokens,
          value.label ? { ...value.option, label: value.label } : value.option,
          value.parameters,
        );
      tokens = nextTokens;
      if (clearQuery) legacyQuery = "";
    } else if (actionId === "event.removefilter") {
      if (!tokens.some(({ optionId }) => optionId === args.filterId))
        return false;
      tokens = removeFilterToken(tokens, args.filterId);
      if (clearQuery) legacyQuery = "";
    } else if (actionId === "event.clearfilters") {
      tokens = [];
      legacyQuery = "";
      editingQuery = false;
      input.value = "";
      dateFilter.start.value = "";
      dateFilter.end.value = "";
      dateFilter.button.textContent = "Choose dates";
    } else if (
      actionId === "event.selectresult" ||
      actionId === "event.opendetail"
    ) {
      const item = resultItems.find(
        (candidate) => resultEventId(candidate) === args.eventId,
      );
      if (!item) return false;
      selectedEventId = args.eventId;
      onResultSelect?.(item, args.trigger);
      closePopover();
      publish();
      return true;
    } else return false;
    activeDimension = nextUnfilledDimension(advanceFrom);
    input.placeholder = "Add details";
    renderTokens();
    renderOptionGroups();
    openPopover();
    update();
    publish();
    return true;
  };

  dateFilter.button.addEventListener("click", () => {
    openPopover();
    dateFilter.panel.hidden = false;
  });
  for (const field of [dateFilter.start, dateFilter.end])
    field.addEventListener("input", () => {
      dateFilter.end.setCustomValidity("");
      dateFilter.button.textContent = dateLabel(
        dateFilter.start.value,
        dateFilter.end.value,
      );
    });
  dateFilter.apply.addEventListener("click", () => {
    if (
      dateFilter.start.value &&
      dateFilter.end.value &&
      dateFilter.end.value < dateFilter.start.value
    ) {
      dateFilter.end.setCustomValidity(
        "End date must be on or after the start date.",
      );
      dateFilter.end.reportValidity();
      return;
    }
    if (!dateFilter.start.value && !dateFilter.end.value) return;
    executeAction(
      "event.setfilter",
      {
        facet: "when",
        values: [
          {
            filterId: "when:custom",
            label: dateLabel(dateFilter.start.value, dateFilter.end.value),
            parameters: {
              start: dateFilter.start.value,
              end: dateFilter.end.value,
            },
          },
        ],
      },
      { advanceFrom: "when" },
    );
    dateFilter.panel.hidden = true;
    input.value = "";
  });
  dateFilter.clear.addEventListener("click", () => {
    dateFilter.start.value = "";
    dateFilter.end.value = "";
    dateFilter.button.textContent = "Choose dates";
    executeAction("event.setfilter", { facet: "when", values: [] });
    dateFilter.panel.hidden = true;
  });

  input.addEventListener("focus", () => {
    openPopover();
    renderOptionGroups();
    update();
  });
  input.addEventListener("input", () => {
    openPopover();
    const draft = input.value.trim();
    if (draft) {
      const matchingGroups = filterOptionCatalog(catalog, draft);
      if (matchingGroups.length === 1)
        activeDimension = matchingGroups[0].dimension;
      else if (!matchingGroups.length) {
        const classification = classifyEventQuery(draft, catalog);
        const dimensions = new Set(
          classification.matches.map(({ dimension }) => dimension),
        );
        if (dimensions.size === 1) activeDimension = [...dimensions][0];
      }
    }
    renderOptionGroups();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      const first = options.querySelector('[role="option"]');
      if (first) {
        event.preventDefault();
        first.focus();
      }
    } else if (event.key === "Enter") {
      if (input.value.trim()) {
        event.preventDefault();
        void commitDraftQuery();
      }
    } else if (event.key === "Backspace" && !input.value) {
      if (legacyQuery) executeAction("event.search", { query: "" });
      else if (tokens.length)
        executeAction("event.removefilter", {
          filterId: tokens.at(-1).optionId,
        });
    } else if (event.key === "Escape") {
      event.preventDefault();
      closePopover();
    }
  });
  options.addEventListener("keydown", (event) => {
    const buttons = [...options.querySelectorAll("button")];
    const index = buttons.indexOf(document.activeElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      buttons[(index + step + buttons.length) % buttons.length]?.focus();
    } else if (event.key === "Escape") {
      input.focus();
      closePopover();
    }
  });
  results.addEventListener("scroll", () => {
    if (
      results.scrollTop + results.clientHeight >= results.scrollHeight - 80 &&
      renderedResultCount < resultItems.length
    )
      appendResultBatch();
  });

  const closeWhenClickingAway = (event) => {
    if (!root.contains(event.target)) closePopover();
  };
  document.addEventListener("pointerdown", closeWhenClickingAway);
  const stopWatchingOverlays = closeWhenAnotherOverlayOpens(
    "event-search",
    closePopover,
  );
  const setCollapsed = (collapsed) => {
    root.classList.toggle("is-collapsed", collapsed);
    if (collapsed) {
      closePopover();
      input.blur();
    }
  };
  const stopWatchingOverlayState = watchOverlayState(({ id, open }) => {
    if (id === "event-search") {
      if (open) setCollapsed(false);
      return;
    }
    setCollapsed(open);
  });

  popover.prepend(status, recovery);
  controls.append(builder, popover);
  root.append(label, controls, collapsedIndicator);
  document.body.append(root);
  renderTokens();
  renderOptionGroups();

  return {
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      subscribers.clear();
      document.removeEventListener("pointerdown", closeWhenClickingAway);
      stopWatchingOverlays();
      stopWatchingOverlayState();
      root.remove();
    },
    input,
    dispatch: executeAction,
    filters: {
      dateApply: dateFilter.apply,
      dateButton: dateFilter.button,
      dateClear: dateFilter.clear,
      dateEnd: dateFilter.end,
      dateStart: dateFilter.start,
      placementViews,
    },
    refresh: () => {
      const result = update();
      publish();
      return result;
    },
    refreshViewport: () => {
      const result = refreshViewport();
      if (result) publish();
      return result;
    },
    snapshot,
    subscribe(listener, { emitCurrent = false } = {}) {
      if (typeof listener !== "function")
        throw new TypeError("Event-search subscriber must be callable");
      subscribers.add(listener);
      if (emitCurrent) listener(snapshot());
      return () => subscribers.delete(listener);
    },
    setDiscoveryModel: (nextModel) => {
      activeDiscoveryModel = nextModel;
      cachedDiscoveryResult = null;
      const nextCatalog = createFilterOptionCatalog(
        activeDiscoveryModel?.filterOptions?.() ?? {
          categories,
          locations: [],
        },
      );
      const catalogChanged =
        catalogFingerprint(nextCatalog) !== catalogFingerprint(catalog);
      catalog = nextCatalog;
      const reconciled = reconcileFilterTokens(tokens, catalog);
      tokens = reconciled.tokens;
      if (reconciled.removed.length)
        reconciliationNotice = `${reconciled.removed
          .map(({ label: removedLabel }) => removedLabel)
          .join(", ")} is no longer available.`;
      if (catalogChanged || reconciled.removed.length) {
        renderTokens();
        renderOptionGroups();
      }
      update();
      publish();
    },
    root,
  };
}
