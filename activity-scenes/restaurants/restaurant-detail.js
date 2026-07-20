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

function directionsUrl(restaurant) {
  const latitude = Number(restaurant?.latitude);
  const longitude = Number(restaurant?.longitude);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  )
    return null;
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("destination", `${latitude},${longitude}`);
  return url.href;
}

function validUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value, window.location.href);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

const DAY_LABELS = {
  Mo: "Monday",
  Tu: "Tuesday",
  We: "Wednesday",
  Th: "Thursday",
  Fr: "Friday",
  Sa: "Saturday",
  Su: "Sunday",
  PH: "Public holidays",
};

function openingHourGroups(value) {
  if (!value) return [];
  if (value.trim() === "24/7")
    return [{ days: "Every day", hours: "Open 24 hours" }];
  const groups = new Map();
  for (const rule of value
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)) {
    const match = rule.match(/^([A-Za-z,-]+)\s+(.+)$/);
    const days = (match ? match[1] : "Schedule")
      .split(",")
      .map((part) => {
        const [start, end] = part.trim().split("-");
        return end && DAY_LABELS[start] && DAY_LABELS[end]
          ? `${DAY_LABELS[start]}–${DAY_LABELS[end]}`
          : DAY_LABELS[start] || part.trim();
      })
      .join(", ");
    const hours = (match ? match[2] : rule).replace(
      /(\d{1,2}:\d{2})-(\d{1,2}:\d{2})/g,
      "$1–$2",
    );
    if (!groups.has(days)) groups.set(days, []);
    groups.get(days).push(hours);
  }
  return [...groups].map(([days, hours]) => ({
    days,
    hours: [...new Set(hours)].join(" · "),
  }));
}

function field(list, label, value) {
  if (!value || (Array.isArray(value) && !value.length)) return;
  const row = element("div", "restaurant-detail__field");
  row.append(
    element("dt", "restaurant-detail__label", label),
    element(
      "dd",
      "restaurant-detail__value",
      Array.isArray(value) ? value.join(", ") : value,
    ),
  );
  list.appendChild(row);
}

function referenceField(list, restaurant) {
  const row = element(
    "div",
    "restaurant-detail__field restaurant-detail__field--reference",
  );
  row.appendChild(element("dt", "restaurant-detail__label", "Reference"));
  const value = element("dd", "restaurant-detail__value");
  const referenceUrl = validUrl(restaurant.osm?.url || restaurant.website);
  const referenceLabel =
    restaurant.source ||
    (restaurant.osm?.url
      ? "OpenStreetMap"
      : restaurant.website
        ? "Official website"
        : "Not available");
  if (referenceUrl) {
    const link = element("a", "restaurant-detail__link", referenceLabel);
    link.href = referenceUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    value.appendChild(link);
  } else {
    value.textContent = referenceLabel;
    value.classList.add("is-unavailable");
  }
  row.appendChild(value);
  list.appendChild(row);
}

function openingHoursField(list, value) {
  const groups = openingHourGroups(value);
  if (!groups.length) return;
  const row = element(
    "div",
    "restaurant-detail__field restaurant-detail__field--hours",
  );
  row.appendChild(element("dt", "restaurant-detail__label", "Opening hours"));
  const content = element(
    "dd",
    "restaurant-detail__value restaurant-detail__hours",
  );
  for (const group of groups) {
    const schedule = element("div", "restaurant-detail__hours-group");
    schedule.append(
      element("strong", "restaurant-detail__hours-days", group.days),
      element("span", "restaurant-detail__hours-time", group.hours),
    );
    content.appendChild(schedule);
  }
  row.appendChild(content);
  list.appendChild(row);
}

function checkedLabel(timestamp) {
  if (!timestamp || Number.isNaN(Date.parse(timestamp)))
    return "Last checked time unavailable";
  return `Last checked ${new Intl.DateTimeFormat("en-SG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(timestamp))}`;
}

export function createRestaurantDetail() {
  const root = element("aside", "restaurant-detail");
  root.id = "restaurant-detail";
  root.hidden = true;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "false");
  root.setAttribute("aria-labelledby", "restaurant-detail-title");
  const header = element("header", "restaurant-detail__header");
  const backButton = iconButton(
    "restaurant-detail__action restaurant-detail__back",
    "arrow-left",
    "Back to restaurant results",
  );
  const headingGroup = element("div", "restaurant-detail__heading-group");
  const title = element("h2", "restaurant-detail__title");
  title.id = "restaurant-detail-title";
  headingGroup.append(title);
  const actions = element("div", "restaurant-detail__actions");
  const addToPlan = iconButton(
    "restaurant-detail__action restaurant-detail__plan",
    "list-plus",
    "Add restaurant to plan",
  );
  const viewRestaurant = element(
    "a",
    "restaurant-detail__action restaurant-detail__header-link",
  );
  viewRestaurant.title = "Open restaurant link";
  viewRestaurant.ariaLabel = "Open restaurant website or map listing";
  viewRestaurant.target = "_blank";
  viewRestaurant.rel = "noopener noreferrer";
  const viewIcon = element("i", "ph-bold ph-arrow-square-out");
  viewIcon.setAttribute("aria-hidden", "true");
  viewRestaurant.appendChild(viewIcon);
  const getDirections = element(
    "a",
    "restaurant-detail__action restaurant-detail__directions",
  );
  getDirections.title = "Get directions";
  getDirections.ariaLabel = "Get directions to restaurant";
  getDirections.target = "_blank";
  getDirections.rel = "noopener noreferrer";
  const directionsIcon = element("i", "ph-bold ph-navigation-arrow");
  directionsIcon.setAttribute("aria-hidden", "true");
  getDirections.appendChild(directionsIcon);
  const closeButton = iconButton(
    "restaurant-detail__action restaurant-detail__close",
    "x",
    "Close restaurant details",
  );
  actions.append(addToPlan, viewRestaurant, getDirections, closeButton);
  header.append(backButton, headingGroup, actions);
  const body = element("div", "restaurant-detail__body");
  root.append(header, body);
  document.body.appendChild(root);

  let trigger = null;
  let onClose = null;
  let activeRestaurant = null;
  const close = ({ restoreFocus = true } = {}) => {
    if (root.hidden) return;
    root.hidden = true;
    document.body.dataset.restaurantDetailOpen = "false";
    if (restoreFocus && trigger?.isConnected) trigger.focus();
    trigger = null;
    activeRestaurant = null;
    const callback = onClose;
    onClose = null;
    callback?.();
  };

  const renderDeals = (container, state) => {
    container.replaceChildren();
    if (
      !state ||
      ["idle", "pending", "queued", "running"].includes(state.status)
    ) {
      container.appendChild(
        element(
          "p",
          "restaurant-detail__deal-status restaurant-detail__deal-status--loading",
          state?.progress?.label || "Preparing restaurant lookup…",
        ),
      );
      return;
    }
    if (state.stale) {
      container.append(
        element("p", "restaurant-detail__stale", "Potentially outdated"),
        element(
          "p",
          "restaurant-detail__deal-checked",
          checkedLabel(state.fetchedAt),
        ),
      );
    }
    const result = state.result;
    if (!result) {
      container.appendChild(
        element(
          "p",
          "restaurant-detail__deal-status",
          state.error ||
            state.warning ||
            "Deal lookup is unavailable right now.",
        ),
      );
      return;
    }
    const currentDeals = (result.deals || []).filter(
      ({ validUntil }) => !validUntil || Date.parse(validUntil) >= Date.now(),
    );
    if (!currentDeals.length) {
      container.append(
        element(
          "p",
          "restaurant-detail__deal-status",
          result.reason ||
            "No current deals were found on the official pages inspected.",
        ),
      );
      if (result.fetchedAt || state.fetchedAt)
        container.appendChild(
          element(
            "p",
            "restaurant-detail__deal-checked",
            checkedLabel(result.fetchedAt || state.fetchedAt),
          ),
        );
      return;
    }
    const list = element("ul", "restaurant-detail__deals");
    for (const deal of currentDeals) {
      const item = element("li", "restaurant-detail__deal");
      item.append(
        element("strong", "restaurant-detail__deal-title", deal.title),
        element("p", "restaurant-detail__deal-evidence", deal.evidence),
      );
      const source = element(
        "a",
        "restaurant-detail__deal-source",
        "View official source",
      );
      source.href = deal.sourceUrl;
      source.target = "_blank";
      source.rel = "noopener noreferrer";
      item.appendChild(source);
      list.appendChild(item);
    }
    container.appendChild(list);
  };

  const open = (restaurant, selectedTrigger, closeCallback) => {
    trigger = selectedTrigger || null;
    onClose = closeCallback || null;
    activeRestaurant = restaurant;
    title.textContent = restaurant.name;
    const externalUrl = validUrl(restaurant.website || restaurant.osm?.url);
    if (externalUrl) {
      viewRestaurant.href = externalUrl;
      viewRestaurant.hidden = false;
    } else {
      viewRestaurant.removeAttribute("href");
      viewRestaurant.hidden = true;
    }
    const routeUrl = directionsUrl(restaurant);
    if (routeUrl) {
      getDirections.href = routeUrl;
      getDirections.hidden = false;
    } else {
      getDirections.removeAttribute("href");
      getDirections.hidden = true;
    }
    body.replaceChildren();
    const fields = element("dl", "restaurant-detail__fields");
    referenceField(fields, restaurant);
    field(fields, "Type", restaurant.category?.replaceAll("_", " "));
    field(fields, "Cuisine", restaurant.cuisine?.replaceAll(";", ", "));
    field(fields, "Address", restaurant.address);
    openingHoursField(fields, restaurant.openingHours);
    field(fields, "Phone", restaurant.phone);
    field(fields, "Email", restaurant.email);
    field(fields, "Dietary", restaurant.dietary);
    field(fields, "Takeaway", restaurant.takeaway);
    field(fields, "Delivery", restaurant.delivery);
    body.appendChild(fields);
    const dealSection = element("section", "restaurant-detail__deal-section");
    dealSection.appendChild(
      element("h3", "restaurant-detail__section-title", "Discounts & deals"),
    );
    const dealContent = element("div", "restaurant-detail__deal-content");
    dealContent.setAttribute("role", "status");
    dealContent.setAttribute("aria-live", "polite");
    dealContent.setAttribute("aria-atomic", "true");
    dealSection.appendChild(dealContent);
    body.appendChild(dealSection);
    renderDeals(dealContent, null);
    root.hidden = false;
    document.body.dataset.restaurantDetailOpen = "true";
    closeButton.focus();
    return { renderDeals: (state) => renderDeals(dealContent, state) };
  };

  addToPlan.addEventListener("click", () => {
    if (!activeRestaurant) return;
    window.dispatchEvent(
      new CustomEvent("whats-here:add-to-plan", {
        detail: {
          id: activeRestaurant.id,
          type: "restaurant",
          title: activeRestaurant.name,
          place: activeRestaurant.address || activeRestaurant.name,
          detail: [
            activeRestaurant.cuisine?.replaceAll(";", ", "),
            activeRestaurant.openingHours,
          ]
            .filter(Boolean)
            .join(" · "),
          cuisine: activeRestaurant.cuisine || null,
          openingHours: activeRestaurant.openingHours || null,
          accessibility:
            activeRestaurant.accessibility ||
            activeRestaurant.wheelchair ||
            null,
          availability: activeRestaurant.availability || null,
          latitude: Number(activeRestaurant.latitude),
          longitude: Number(activeRestaurant.longitude),
          sourceUrl: activeRestaurant.website || activeRestaurant.osm?.url,
        },
      }),
    );
  });
  backButton.addEventListener("click", () => close());
  closeButton.addEventListener("click", () => close());
  const onKeydown = (event) => {
    if (event.key === "Escape") close();
  };
  document.addEventListener("keydown", onKeydown);
  for (const eventName of [
    "pointerdown",
    "mousedown",
    "touchstart",
    "wheel",
    "dblclick",
  ])
    root.addEventListener(eventName, (event) => event.stopPropagation());
  return {
    close,
    open,
    addToPlan: () => addToPlan.click(),
    openReference: () => {
      if (!viewRestaurant.hidden && viewRestaurant.href) viewRestaurant.click();
    },
    openDirections: () => {
      if (!getDirections.hidden && getDirections.href) getDirections.click();
    },
    openDealReference(dealId) {
      const links = [
        ...root.querySelectorAll(".restaurant-detail__deal-source"),
      ];
      const link =
        links.find((item) => item.dataset.dealId === dealId) || links[0];
      link?.click();
      return Boolean(link);
    },
    destroy: () => {
      document.removeEventListener("keydown", onKeydown);
      root.remove();
    },
  };
}
