import "@phosphor-icons/web/bold";
import {
  announceOverlayOpen,
  closeWhenAnotherOverlayOpens,
  watchOverlayState,
} from "./overlay-coordinator";
import { eventLocationLabel } from "./events/event-location-label.js";

const CATEGORY_ICONS = {
  Exhibitions: "ph-images-square",
  Performances: "ph-microphone-stage",
  "Workshops & Classes": "ph-paint-brush",
  "Tours & Experiences": "ph-map-trifold",
};

const RESULT_BATCH_SIZE = 8;

function dateLabel(start, end) {
  if (!start && !end) return "Any date";
  const format = (value) =>
    new Intl.DateTimeFormat("en-SG", { day: "numeric", month: "short" }).format(
      new Date(`${value}T00:00:00`),
    );
  if (start && !end) return `From ${format(start)}`;
  if (!start && end) return `Until ${format(end)}`;
  if (start === end) return format(start);
  return `${format(start)} – ${format(end)}`;
}

function createDateRangeFilter() {
  const wrapper = document.createElement("div");
  wrapper.className =
    "landmark-event-search__filter landmark-event-search__filter--dateRange";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "landmark-event-search__filter-button";
  button.setAttribute("aria-label", "Date range");
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-expanded", "false");
  const buttonText = document.createElement("span");
  buttonText.textContent = "Any date";
  const icon = document.createElement("i");
  icon.className = "ph-bold ph-caret-down";
  icon.setAttribute("aria-hidden", "true");
  button.append(buttonText, icon);

  const panel = document.createElement("div");
  panel.className = "landmark-event-search__date-panel";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Choose date range");
  const createDateInput = (name, labelText) => {
    const label = document.createElement("label");
    label.className = "landmark-event-search__date-field";
    const text = document.createElement("span");
    text.textContent = labelText;
    const input = document.createElement("input");
    input.type = "date";
    input.name = name;
    input.autocomplete = "off";
    input.setAttribute("aria-label", labelText);
    label.append(text, input);
    return { input, label };
  };
  const start = createDateInput("dateStart", "Start date");
  const end = createDateInput("dateEnd", "End date");
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
  wrapper.append(button, panel);
  return {
    apply,
    button,
    buttonText,
    clear,
    end: end.input,
    panel,
    start: start.input,
    wrapper,
  };
}

export function createLandmarkEventSearch({
  categories = [],
  discoveryModel,
  onFilter,
  onFilterResult,
  onResultSelect,
  onSearch,
}) {
  const existing = document.getElementById("landmark-event-search");
  if (existing) return { destroy: () => {}, root: existing };

  const root = document.createElement("search");
  root.id = "landmark-event-search";
  root.className = "landmark-event-search";
  root.setAttribute("aria-label", "Search upcoming events");

  const label = document.createElement("label");
  label.className = "landmark-event-search__label";
  label.setAttribute("for", "landmark-event-search-input");
  label.textContent = "Search events";

  const input = document.createElement("input");
  input.id = "landmark-event-search-input";
  input.className = "landmark-event-search__input";
  input.type = "search";
  input.placeholder = "Search or explore what's nearby";
  input.autocomplete = "off";
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", "landmark-event-search-results");
  input.setAttribute("aria-expanded", "false");

  const inputShell = document.createElement("div");
  inputShell.className = "landmark-event-search__input-shell";

  const controls = document.createElement("div");
  controls.id = "landmark-event-search-controls";
  controls.className = "landmark-event-search__controls";

  const collapsedIndicator = document.createElement("div");
  collapsedIndicator.className = "landmark-event-search__collapsed-indicator";
  collapsedIndicator.setAttribute("aria-hidden", "true");
  const collapsedIndicatorIcon = document.createElement("i");
  collapsedIndicatorIcon.className = "ph-bold ph-dots-three";
  collapsedIndicator.appendChild(collapsedIndicatorIcon);

  const categoryList = document.createElement("div");
  categoryList.className = "landmark-event-search__categories";
  categoryList.setAttribute("aria-label", "Filter events by category");
  const activeCategories = new Set();
  let activeDiscoveryModel = discoveryModel;
  let wantsOpen = false;

  const filterList = document.createElement("div");
  filterList.className = "landmark-event-search__filters";
  filterList.setAttribute("aria-label", "Filter events by date");
  const dateFilter = createDateRangeFilter();
  filterList.append(dateFilter.wrapper);
  let appliedDateStart = "";
  let appliedDateEnd = "";
  let activePriceRange = "any";
  let activePlacementView = "all";

  const viewList = document.createElement("div");
  viewList.className = "landmark-event-search__views";
  viewList.setAttribute("aria-label", "Filter secret-location events");
  const viewButtons = new Map();
  for (const [value, labelText] of [["secret_tba", "Mystery Location"]]) {
    const button = Object.assign(document.createElement("button"), {
      type: "button",
      textContent: labelText,
    });
    button.className = "landmark-event-search__view";
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => {
      activePlacementView = activePlacementView === value ? "all" : value;
      for (const [candidate, element] of viewButtons)
        element.setAttribute(
          "aria-pressed",
          String(candidate === activePlacementView),
        );
      requestOpen();
      update();
    });
    viewButtons.set(value, button);
    viewList.append(button);
  }

  const requestOpen = () => {
    const wasOpen = wantsOpen;
    wantsOpen = true;
    if (!wasOpen) announceOverlayOpen("event-search");
  };

  const syncDateButton = (start = appliedDateStart, end = appliedDateEnd) => {
    const hasValue = Boolean(start || end);
    dateFilter.buttonText.textContent = dateLabel(start, end);
    dateFilter.button.toggleAttribute("data-has-value", hasValue);
  };

  const restoreDateDraft = () => {
    dateFilter.start.value = appliedDateStart;
    dateFilter.end.value = appliedDateEnd;
    if (!appliedDateStart && !appliedDateEnd) dateFilter.end.value = "";
    syncDateButton();
  };

  const closeDatePanel = ({ restore = true } = {}) => {
    if (restore) restoreDateDraft();
    dateFilter.panel.hidden = true;
    dateFilter.button.setAttribute("aria-expanded", "false");
  };

  dateFilter.button.addEventListener("click", () => {
    const willOpen = dateFilter.panel.hidden;
    if (willOpen) restoreDateDraft();
    dateFilter.panel.hidden = !willOpen;
    dateFilter.button.setAttribute("aria-expanded", String(willOpen));
    if (!willOpen) restoreDateDraft();
  });

  for (const category of categories) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "landmark-event-search__category";
    button.ariaLabel = category;
    button.title = category;
    button.setAttribute("aria-pressed", "false");
    const icon = document.createElement("i");
    icon.className = `ph-bold ${CATEGORY_ICONS[category] || "ph-tag"}`;
    icon.setAttribute("aria-hidden", "true");
    button.appendChild(icon);
    button.addEventListener("click", () => {
      const wasActive = activeCategories.has(category);
      activeCategories.clear();
      for (const categoryButton of categoryList.querySelectorAll(
        ".landmark-event-search__category",
      )) {
        categoryButton.setAttribute("aria-pressed", "false");
      }
      if (!wasActive) {
        activeCategories.add(category);
        button.setAttribute("aria-pressed", "true");
      }
      requestOpen();
      update();
    });
    categoryList.appendChild(button);
  }

  const status = document.createElement("div");
  status.className = "landmark-event-search__status";
  status.setAttribute("aria-live", "polite");

  const results = document.createElement("div");
  results.id = "landmark-event-search-results";
  results.className = "landmark-event-search__results";
  results.hidden = true;
  results.setAttribute("role", "listbox");
  results.setAttribute("aria-label", "Matching events");

  const hideResults = () => {
    results.hidden = true;
    input.setAttribute("aria-expanded", "false");
  };

  const closeResults = () => {
    wantsOpen = false;
    hideResults();
  };

  const setCollapsed = (collapsed) => {
    root.classList.toggle("is-collapsed", collapsed);
    if (collapsed) {
      closeDatePanel();
      closeResults();
      input.blur();
    }
  };

  let resultItems = [];
  let renderedResultCount = 0;

  const createResultOption = (item) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "landmark-event-search__result";
    option.setAttribute("role", "option");
    const icon = document.createElement("i");
    icon.className = `ph-bold ${CATEGORY_ICONS[item.category] || "ph-calendar-blank"}`;
    icon.setAttribute("aria-hidden", "true");
    const copy = document.createElement("span");
    copy.className = "landmark-event-search__result-copy";
    copy.append(
      Object.assign(document.createElement("strong"), {
        textContent: item.title,
      }),
      Object.assign(document.createElement("span"), {
        textContent: [item.venue, item.date].filter(Boolean).join(" · "),
      }),
    );
    const locationLabel = eventLocationLabel(item);
    if (
      item.publicPlacement === "off_map" ||
      locationLabel ||
      item.freshness === "stale" ||
      item.scheduleKind === "anytime"
    ) {
      const states = document.createElement("span");
      states.className = "landmark-event-search__result-states";
      if (locationLabel)
        states.append(
          Object.assign(document.createElement("em"), {
            textContent: locationLabel,
          }),
        );
      if (item.scheduleKind === "anytime")
        states.append(
          Object.assign(document.createElement("em"), {
            textContent: "Anytime",
          }),
        );
      if (item.freshness === "stale")
        states.append(
          Object.assign(document.createElement("em"), {
            textContent: "May be outdated",
          }),
        );
      copy.append(states);
    }
    option.append(icon, copy);
    option.addEventListener("click", () => {
      onResultSelect?.(item, option);
      closeResults();
    });
    return option;
  };

  const appendResultBatch = () => {
    const nextItems = resultItems.slice(
      renderedResultCount,
      renderedResultCount + RESULT_BATCH_SIZE,
    );
    for (const item of nextItems) results.appendChild(createResultOption(item));
    renderedResultCount += nextItems.length;
  };

  const renderResults = (
    items,
    query,
    matchedEvents = items.length,
    scope = "nearby",
  ) => {
    results.replaceChildren();
    if (!wantsOpen || items.length === 0) {
      hideResults();
      return;
    }

    const heading = document.createElement("div");
    heading.className = "landmark-event-search__results-heading";
    heading.setAttribute("role", "presentation");
    const headingCopy = document.createElement("div");
    const eyebrow = document.createElement("span");
    eyebrow.className = "landmark-event-search__results-eyebrow";
    const hasDateFilter = Boolean(appliedDateStart || appliedDateEnd);
    eyebrow.textContent = query
      ? "Search results"
      : activeCategories.size || hasDateFilter
        ? "Filtered for you"
        : "";
    const headingTitle = document.createElement("strong");
    headingTitle.className = "landmark-event-search__results-title";
    headingTitle.textContent = query
      ? `Events matching “${query}”`
      : activeCategories.size || hasDateFilter
        ? `${[
            ...activeCategories,
            hasDateFilter ? dateFilter.buttonText.textContent : "",
          ]
            .filter(Boolean)
            .join(" · ")} nearest first`
        : "Closest to this view";
    headingCopy.append(eyebrow, headingTitle);
    const count = document.createElement("span");
    count.className = "landmark-event-search__results-count";
    count.textContent = `${matchedEvents} found`;
    heading.append(headingCopy, count);
    results.appendChild(heading);

    resultItems = items;
    renderedResultCount = 0;
    appendResultBatch();
    results.hidden = false;
    input.setAttribute("aria-expanded", "true");
  };

  results.addEventListener("scroll", () => {
    const nearBottom =
      results.scrollTop + results.clientHeight >= results.scrollHeight - 80;
    if (nearBottom && renderedResultCount < resultItems.length)
      appendResultBatch();
  });

  const update = () => {
    const filters = {
      categories: [...activeCategories],
      query: input.value,
      dateRange: appliedDateStart || appliedDateEnd ? "custom" : "any",
      dateStart: appliedDateStart,
      dateEnd: appliedDateEnd,
      placementView: activePlacementView,
      priceRange: activePriceRange,
    };
    root.dataset.state = "loading";
    root.setAttribute("aria-busy", "true");
    let result;
    try {
      const modelResult = activeDiscoveryModel?.filter(filters);
      result = (modelResult
        ? (onFilterResult?.(modelResult) ?? modelResult)
        : onFilter
          ? onFilter(filters)
          : onSearch?.(input.value)) || {
        matchedEvents: 0,
        query: input.value.trim(),
        results: [],
      };
      root.dataset.state = result.matchedEvents === 0 ? "empty" : "ready";
      status.textContent =
        result.matchedEvents === 0
          ? result.query
            ? "No matching events"
            : "No events available"
          : "";
    } catch (error) {
      result = { matchedEvents: 0, query: input.value.trim(), results: [] };
      root.dataset.state = "error";
      status.textContent = "Events are temporarily unavailable. Try again.";
      root.dispatchEvent(
        new CustomEvent("event-search:error", { detail: { error } }),
      );
    } finally {
      root.setAttribute("aria-busy", "false");
    }
    root.classList.toggle("has-no-results", Boolean(status.textContent));
    const displayedResults = result.results || [];
    renderResults(
      displayedResults,
      result.query,
      result.matchedEvents,
      "nearest",
    );
  };
  input.addEventListener("focus", () => {
    requestOpen();
    update();
  });
  input.addEventListener("input", () => {
    requestOpen();
    update();
  });
  dateFilter.start.addEventListener("input", () => {
    dateFilter.end.setCustomValidity("");
    syncDateButton(dateFilter.start.value, dateFilter.end.value);
  });
  dateFilter.end.addEventListener("input", () => {
    dateFilter.end.setCustomValidity("");
    syncDateButton(dateFilter.start.value, dateFilter.end.value);
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
    dateFilter.end.setCustomValidity("");
    appliedDateStart = dateFilter.start.value;
    appliedDateEnd = dateFilter.end.value;
    syncDateButton();
    closeDatePanel({ restore: false });
    requestOpen();
    update();
  });
  dateFilter.clear.addEventListener("click", () => {
    appliedDateStart = "";
    appliedDateEnd = "";
    dateFilter.start.value = "";
    dateFilter.end.value = "";
    dateFilter.end.setCustomValidity("");
    syncDateButton();
    closeDatePanel({ restore: false });
    requestOpen();
    update();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" && !results.hidden) {
      event.preventDefault();
      results.querySelector("button")?.focus();
    }
    if (event.key === "Escape") closeResults();
  });
  const closeWhenClickingAway = (event) => {
    if (!root.contains(event.target)) {
      closeDatePanel();
      closeResults();
    } else if (!dateFilter.wrapper.contains(event.target)) closeDatePanel();
  };
  document.addEventListener("pointerdown", closeWhenClickingAway);
  const stopWatchingOverlays = closeWhenAnotherOverlayOpens(
    "event-search",
    closeResults,
  );
  const stopWatchingOverlayState = watchOverlayState(({ id, open }) => {
    if (id === "event-search") {
      if (open) setCollapsed(false);
      return;
    }
    setCollapsed(open);
  });
  inputShell.append(input, results);
  controls.append(inputShell, viewList, categoryList, filterList);
  root.append(label, controls, status, collapsedIndicator);
  document.body.appendChild(root);

  return {
    destroy: () => {
      document.removeEventListener("pointerdown", closeWhenClickingAway);
      stopWatchingOverlays();
      stopWatchingOverlayState();
      root.remove();
    },
    input,
    dispatch(actionId, args = {}) {
      if (actionId === "event.search") input.value = String(args.query ?? "");
      else if (actionId === "event.setcategory") {
        activeCategories.clear();
        if (args.categoryId) activeCategories.add(args.categoryId);
        for (const button of categoryList.querySelectorAll("button"))
          button.setAttribute(
            "aria-pressed",
            String(button.ariaLabel === args.categoryId),
          );
      } else if (actionId === "event.setdaterange") {
        appliedDateStart = args.startDate || "";
        appliedDateEnd = args.endDate || "";
        dateFilter.start.value = appliedDateStart;
        dateFilter.end.value = appliedDateEnd;
        syncDateButton();
      } else if (actionId === "event.setpricerange")
        activePriceRange = args.priceBand || "any";
      else if (actionId === "event.clearfilters") {
        input.value = "";
        activeCategories.clear();
        activePriceRange = "any";
        appliedDateStart = appliedDateEnd = "";
        dateFilter.start.value = dateFilter.end.value = "";
        syncDateButton();
        for (const button of categoryList.querySelectorAll("button"))
          button.setAttribute("aria-pressed", "false");
      } else return false;
      requestOpen();
      update();
      return true;
    },
    filters: {
      dateButton: dateFilter.button,
      dateStart: dateFilter.start,
      dateEnd: dateFilter.end,
      dateApply: dateFilter.apply,
      dateClear: dateFilter.clear,
      placementViews: viewButtons,
    },
    refresh: update,
    setDiscoveryModel: (nextModel) => {
      activeDiscoveryModel = nextModel;
      update();
    },
    root,
  };
}
