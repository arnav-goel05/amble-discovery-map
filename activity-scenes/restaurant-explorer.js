import "@phosphor-icons/web/bold";
import { announceOverlayClosed, announceOverlayOpen, closeWhenAnotherOverlayOpens } from "./overlay-coordinator.js";
import { focusMapLocation } from "./map-location-focus.js";
import { requestDealStatus, requestRestaurants } from "./restaurants/restaurant-api.js";
import { createRestaurantDetail } from "./restaurants/restaurant-detail.js";
import { createRestaurantMap, restaurantSearchArea } from "./restaurants/restaurant-map.js";

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function iconButton(className, icon, label) {
  const button = element("button", className);
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  const glyph = element("i", `ph-bold ph-${icon}`);
  glyph.setAttribute("aria-hidden", "true");
  button.appendChild(glyph);
  return button;
}

const categoryLabel = (value) => String(value || "other").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const categoryOptionLabel = (value) => ({ restaurant: "Restaurants", cafe: "Cafés", food_court: "Food courts", fast_food: "Fast food" })[value] || categoryLabel(value);
const restaurantCuisines = (restaurant) => [...new Set(String(restaurant.cuisine || "").split(/[;,]/).map((value) => value.trim().toLocaleLowerCase()).filter(Boolean))];

function createSelect(filters, id, labelText) {
  const field = element("label", "restaurant-results__filter");
  field.htmlFor = id;
  field.appendChild(element("span", "restaurant-results__filter-label", labelText));
  const wrapper = element("span", "restaurant-results__select-wrap");
  const select = element("select", "restaurant-results__select");
  select.id = id;
  const caret = element("i", "ph-bold ph-caret-down restaurant-results__select-icon");
  caret.setAttribute("aria-hidden", "true");
  wrapper.append(select, caret);
  field.appendChild(wrapper);
  filters.appendChild(field);
  return select;
}

function buildResultsPanel() {
  const root = element("section", "restaurant-results");
  root.id = "restaurant-results";
  root.hidden = true;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "false");
  root.setAttribute("aria-labelledby", "restaurant-results-title");
  const header = element("header", "restaurant-results__header");
  const heading = element("div", "restaurant-results__heading-group");
  heading.appendChild(element("div", "restaurant-results__kicker", "Nearby dining"));
  const title = element("h2", "restaurant-results__title", "Restaurants in this area");
  title.id = "restaurant-results-title";
  heading.appendChild(title);
  const close = iconButton("restaurant-results__close", "x", "Close restaurant results");
  header.append(heading, close);
  const browse = element("div", "restaurant-results__browse");
  const searchLabel = element("label", "restaurant-results__search");
  const searchIcon = element("i", "ph-bold ph-magnifying-glass");
  searchIcon.setAttribute("aria-hidden", "true");
  const search = element("input", "restaurant-results__search-input");
  search.type = "search";
  search.placeholder = "Search restaurants, cuisines, or addresses";
  search.ariaLabel = "Search restaurant results";
  searchLabel.append(searchIcon, search);
  const filters = element("div", "restaurant-results__filters");
  const category = createSelect(filters, "restaurant-category-filter", "Category");
  const cuisine = createSelect(filters, "restaurant-cuisine-filter", "Cuisine");
  const breadcrumbs = element("nav", "restaurant-results__breadcrumbs");
  breadcrumbs.setAttribute("aria-label", "Restaurant result filters");
  browse.append(searchLabel, filters, breadcrumbs);
  const freshness = element("p", "restaurant-results__freshness");
  freshness.hidden = true;
  const status = element("div", "restaurant-results__status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const list = element("div", "restaurant-results__list");
  root.append(header, browse, freshness, status, list);
  document.body.appendChild(root);
  return { root, close, search, category, cuisine, breadcrumbs, freshness, status, list };
}

export function addRestaurantExplorer(map, { fetchImpl = globalThis.fetch.bind(globalThis) } = {}) {
  if (document.getElementById("restaurant-search-button")) return { finalize() {} };
  const button = element("button", "restaurant-search-button");
  button.id = "restaurant-search-button";
  button.type = "button";
  button.ariaLabel = "Find restaurants in this area";
  button.title = "Find restaurants in this area";
  button.setAttribute("aria-controls", "restaurant-results");
  button.setAttribute("aria-expanded", "false");
  const buttonIcon = element("i", "ph-bold ph-fork-knife");
  buttonIcon.setAttribute("aria-hidden", "true");
  button.appendChild(buttonIcon);
  document.body.appendChild(button);

  const ui = buildResultsPanel();
  const detail = createRestaurantDetail();
  const restaurantMap = createRestaurantMap(map);
  let restaurants = [];
  let visible = [];
  let selectedId = null;
  let activeCategory = "all";
  let activeCuisine = "all";
  let envelope = null;
  let pollTimer = null;
  let abortController = null;

  const setSelected = (id) => { selectedId = id; restaurantMap.select(id); };
  const renderFilters = () => {
    const categories = new Map();
    for (const restaurant of restaurants) categories.set(restaurant.category || "other", (categories.get(restaurant.category || "other") || 0) + 1);
    ui.category.replaceChildren();
    for (const [value, count] of [["all", restaurants.length], ...[...categories].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))]) {
      const option = element("option", "", `${value === "all" ? "All categories" : categoryOptionLabel(value)} · ${count}`);
      option.value = value;
      ui.category.appendChild(option);
    }
    ui.category.value = activeCategory;
    const cuisines = new Map();
    for (const restaurant of restaurants.filter((item) => activeCategory === "all" || item.category === activeCategory)) {
      for (const cuisine of restaurantCuisines(restaurant)) cuisines.set(cuisine, (cuisines.get(cuisine) || 0) + 1);
    }
    if (activeCuisine !== "all" && !cuisines.has(activeCuisine)) activeCuisine = "all";
    ui.cuisine.replaceChildren();
    const all = element("option", "", "All cuisines");
    all.value = "all";
    ui.cuisine.appendChild(all);
    for (const [value, count] of [...cuisines].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
      const option = element("option", "", `${categoryLabel(value)} · ${count}`);
      option.value = value;
      ui.cuisine.appendChild(option);
    }
    ui.cuisine.value = activeCuisine;
    ui.cuisine.disabled = !cuisines.size;
  };

  const renderBreadcrumbs = () => {
    ui.breadcrumbs.replaceChildren();
    const all = element("button", "restaurant-results__breadcrumb", "All restaurants");
    all.type = "button";
    all.disabled = activeCategory === "all" && activeCuisine === "all" && !ui.search.value.trim();
    all.onclick = () => { activeCategory = "all"; activeCuisine = "all"; ui.search.value = ""; render(); };
    ui.breadcrumbs.appendChild(all);
    for (const value of [activeCategory, activeCuisine].filter((item) => item !== "all")) ui.breadcrumbs.append(element("span", "restaurant-results__breadcrumb-separator", "/"), element("span", "restaurant-results__breadcrumb-current", categoryLabel(value)));
    if (ui.search.value.trim()) ui.breadcrumbs.append(element("span", "restaurant-results__breadcrumb-separator", "/"), element("span", "restaurant-results__breadcrumb-current", `Search: ${ui.search.value.trim()}`));
  };

  const pollDeals = async (restaurant, panel) => {
    clearTimeout(pollTimer);
    if (selectedId !== restaurant.id) return;
    try {
      const state = await requestDealStatus(fetchImpl, restaurant.id);
      if (selectedId !== restaurant.id) return;
      panel.renderDeals(state);
      if (["idle", "pending"].includes(state.status)) pollTimer = setTimeout(() => pollDeals(restaurant, panel), 1000);
    } catch (error) { panel.renderDeals({ status: "error", error: error.message }); }
  };

  const selectRestaurant = (restaurant, trigger) => {
    setSelected(restaurant.id);
    focusMapLocation(map, restaurant, { duration: 500 });
    const panel = detail.open(restaurant, trigger, () => setSelected(null));
    pollDeals(restaurant, panel);
  };

  const render = () => {
    renderFilters();
    const query = ui.search.value.trim().toLocaleLowerCase();
    visible = restaurants.filter((restaurant) => {
      if (activeCategory !== "all" && (restaurant.category || "other") !== activeCategory) return false;
      if (activeCuisine !== "all" && !restaurantCuisines(restaurant).includes(activeCuisine)) return false;
      return !query || [restaurant.name, restaurant.cuisine, restaurant.address, restaurant.category].some((value) => String(value || "").toLocaleLowerCase().includes(query));
    });
    ui.list.replaceChildren();
    ui.status.textContent = visible.length ? "" : (restaurants.length ? "No restaurants match these filters." : "No mapped restaurants were found in this area.");
    ui.status.hidden = !ui.status.textContent;
    renderBreadcrumbs();
    for (const restaurant of visible) {
      const item = element("button", "restaurant-results__pill");
      item.type = "button";
      item.dataset.restaurantId = restaurant.id;
      item.append(element("strong", "restaurant-results__name", restaurant.name), element("span", "restaurant-results__meta", [restaurant.cuisine?.replaceAll(";", ", "), restaurant.address, restaurant.category?.replaceAll("_", " ")].filter(Boolean).join(" · ")));
      item.addEventListener("click", () => selectRestaurant(restaurant, item));
      ui.list.appendChild(item);
    }
    restaurantMap.setRestaurants(visible);
  };

  const close = ({ restoreFocus = true } = {}) => {
    const wasOpen = button.getAttribute("aria-expanded") === "true" || button.classList.contains("is-loading") || !ui.root.hidden;
    abortController?.abort();
    clearTimeout(pollTimer);
    restaurants = [];
    visible = [];
    envelope = null;
    activeCategory = "all";
    activeCuisine = "all";
    ui.search.value = "";
    setSelected(null);
    detail.close({ restoreFocus: false });
    ui.list.replaceChildren();
    ui.root.hidden = true;
    ui.freshness.hidden = true;
    button.setAttribute("aria-expanded", "false");
    restaurantMap.clear();
    document.body.dataset.restaurantCount = "0";
    if (wasOpen) announceOverlayClosed("restaurants");
    if (restoreFocus) button.focus();
  };

  const search = async () => {
    announceOverlayOpen("restaurants");
    abortController?.abort();
    const requestController = new AbortController();
    abortController = requestController;
    button.disabled = true;
    button.classList.add("is-loading");
    button.setAttribute("aria-label", "Searching for restaurants in this area");
    if (!restaurants.length) ui.root.hidden = true;
    try {
      const searchArea = restaurantSearchArea(map);
      envelope = await requestRestaurants(fetchImpl, searchArea.bbox, { signal: requestController.signal });
      restaurants = envelope.restaurants.filter((restaurant) => searchArea.contains(restaurant));
      activeCategory = "all";
      activeCuisine = "all";
      ui.search.value = "";
      ui.freshness.textContent = "";
      ui.freshness.hidden = true;
      render();
      ui.root.hidden = false;
      button.setAttribute("aria-expanded", "true");
      document.body.dataset.restaurantCount = String(restaurants.length);
    } catch (error) {
      if (error.name === "AbortError") return;
      restaurants = [];
      restaurantMap.clear();
      ui.status.textContent = error.message;
      ui.status.hidden = false;
      ui.root.hidden = false;
      button.setAttribute("aria-expanded", "true");
    } finally {
      if (abortController === requestController) {
        button.disabled = false;
        button.classList.remove("is-loading");
        button.setAttribute("aria-label", "Find restaurants in this area");
      }
    }
  };

  ui.search.addEventListener("input", render);
  ui.category.addEventListener("change", () => { activeCategory = ui.category.value; activeCuisine = "all"; render(); });
  ui.cuisine.addEventListener("change", () => { activeCuisine = ui.cuisine.value; render(); });
  button.addEventListener("click", search);
  ui.close.addEventListener("click", () => close());
  const stopWatchingOverlays = closeWhenAnotherOverlayOpens("restaurants", () => close({ restoreFocus: false }));
  document.body.dataset.restaurantExplorer = "mounted";
  return {
    id: "restaurant-explorer",
    finalize() {
      stopWatchingOverlays();
      abortController?.abort();
      clearTimeout(pollTimer);
      detail.destroy();
      restaurantMap.destroy();
      button.remove();
      ui.root.remove();
    },
  };
}
