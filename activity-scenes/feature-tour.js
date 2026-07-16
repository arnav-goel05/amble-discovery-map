import "@phosphor-icons/web/bold";

const STORAGE_KEY = "amble-feature-tour-complete-v1";

export const FEATURE_TOUR_STEPS = [
  {
    selector: ".landmark-event-pill:not(.is-hidden) .landmark-event-pill__card",
    fallbackSelector: ".maplibregl-canvas",
    title: "Events live on the map",
    copy: "Select an event label to see what’s happening at that place.",
  },
  {
    selector: "#landmark-event-search-input",
    title: "Search what’s nearby",
    copy: "Search by event, venue, or activity to move quickly around Singapore.",
  },
  {
    selector: ".landmark-event-search__categories",
    title: "Explore by category",
    copy: "Narrow the map to exhibitions, performances, workshops, or experiences.",
  },
  {
    selector: ".landmark-event-search__filter--dateRange",
    title: "Choose when to go",
    copy: "Set a date range to find events that fit your schedule.",
  },
  {
    selector: "#restaurant-search-button",
    title: "Find food nearby",
    copy: "Explore restaurants around the part of the map you’re viewing.",
  },
  {
    selector: "#plan-builder-button",
    title: "Build your day out",
    copy: "Add events and restaurants, reorder stops, and open your route in Maps.",
  },
  {
    selector: "#map-guidance",
    title: "Make the map yours",
    copy: "Zoom, rotate, and drag the map. You can replay this tour from the help button here.",
  },
];

function storageComplete(storage) {
  try { return storage?.getItem(STORAGE_KEY) === "true"; } catch { return false; }
}

function saveComplete(storage) {
  try { storage?.setItem(STORAGE_KEY, "true"); } catch {}
}

function makeButton(className, label, iconName) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  const labelNode = document.createElement("span");
  labelNode.textContent = label;
  button.appendChild(labelNode);
  if (iconName) {
    const icon = document.createElement("i");
    icon.className = `ph-bold ph-${iconName}`;
    icon.setAttribute("aria-hidden", "true");
    button.appendChild(icon);
  }
  return button;
}

function findTarget(step, viewport) {
  const centerX = viewport.innerWidth / 2;
  const centerY = viewport.innerHeight / 2;
  const candidates = [...document.querySelectorAll(step.selector)]
    .map((element) => ({ element, rect: element.getBoundingClientRect() }))
    .filter(({ rect }) => rect.width > 0 && rect.height > 0
      && rect.right > 0 && rect.bottom > 0
      && rect.left < viewport.innerWidth && rect.top < viewport.innerHeight)
    .sort((a, b) => {
      const distance = (rect) => Math.hypot(rect.left + rect.width / 2 - centerX, rect.top + rect.height / 2 - centerY);
      return distance(a.rect) - distance(b.rect);
    });
  return candidates[0]?.element || (step.fallbackSelector ? document.querySelector(step.fallbackSelector) : null);
}

export function createFeatureTour({
  steps = FEATURE_TOUR_STEPS,
  storage = globalThis.localStorage,
  viewport = globalThis.window,
} = {}) {
  let index = 0;
  let active = false;
  let lastFocused = null;
  let target = null;

  const root = document.createElement("section");
  root.id = "feature-tour";
  root.className = "feature-tour";
  root.hidden = true;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "feature-tour-title");

  const spotlight = document.createElement("div");
  spotlight.className = "feature-tour__spotlight";
  spotlight.setAttribute("aria-hidden", "true");
  const card = document.createElement("div");
  card.className = "feature-tour__card";
  const progress = document.createElement("div");
  progress.className = "feature-tour__progress";
  const title = document.createElement("h2");
  title.id = "feature-tour-title";
  title.className = "feature-tour__title";
  const copy = document.createElement("p");
  copy.className = "feature-tour__copy";
  const actions = document.createElement("div");
  actions.className = "feature-tour__actions";
  const skip = makeButton("feature-tour__skip", "", "x");
  skip.querySelector("span")?.remove();
  skip.setAttribute("aria-label", "Skip tour");
  skip.title = "Skip tour";
  const back = makeButton("feature-tour__back", "Back", "arrow-left");
  const next = makeButton("feature-tour__next", "Next", "arrow-right");
  actions.append(back, next);
  card.append(skip, progress, title, copy, actions);
  root.append(spotlight, card);
  document.body.appendChild(root);

  const position = () => {
    if (!active || !target?.isConnected) return;
    const rect = target.getBoundingClientRect();
    const padding = target.matches(".maplibregl-canvas") ? 18 : 10;
    const left = Math.max(12, rect.left - padding);
    const top = Math.max(12, rect.top - padding);
    const right = Math.min(viewport.innerWidth - 12, rect.right + padding);
    const bottom = Math.min(viewport.innerHeight - 12, rect.bottom + padding);
    Object.assign(spotlight.style, {
      left: `${left}px`, top: `${top}px`, width: `${Math.max(44, right - left)}px`, height: `${Math.max(44, bottom - top)}px`,
    });

    const cardRect = card.getBoundingClientRect();
    const gap = 18;
    let cardLeft = right + gap;
    if (cardLeft + cardRect.width > viewport.innerWidth - 18) cardLeft = left - cardRect.width - gap;
    if (cardLeft < 18) cardLeft = Math.min(Math.max(18, left), viewport.innerWidth - cardRect.width - 18);
    let cardTop = top + (bottom - top - cardRect.height) / 2;
    cardTop = Math.min(Math.max(18, cardTop), viewport.innerHeight - cardRect.height - 18);
    card.style.left = `${Math.round(cardLeft)}px`;
    card.style.top = `${Math.round(cardTop)}px`;
  };

  const render = () => {
    const step = steps[index];
    target = findTarget(step, viewport);
    if (!target) {
      if (index < steps.length - 1) { index += 1; render(); }
      else finish();
      return;
    }
    progress.textContent = `${index + 1} of ${steps.length}`;
    title.textContent = step.title;
    copy.textContent = step.copy;
    back.hidden = index === 0;
    next.querySelector("span").textContent = index === steps.length - 1 ? "Start exploring" : "Next";
    requestAnimationFrame(position);
  };

  const close = ({ remember = true } = {}) => {
    if (!active) return;
    active = false;
    if (remember) saveComplete(storage);
    root.hidden = true;
    root.classList.remove("is-visible");
    document.body.dataset.featureTour = remember ? "complete" : "closed";
    viewport.removeEventListener("resize", position);
    viewport.removeEventListener("scroll", position, true);
    viewport.removeEventListener("keydown", handleKeydown);
    lastFocused?.focus?.({ preventScroll: true });
  };

  function finish() { close({ remember: true }); }

  const start = ({ force = false } = {}) => {
    if (active || (!force && storageComplete(storage))) {
      if (!active) document.body.dataset.featureTour = "previously-completed";
      return false;
    }
    lastFocused = document.activeElement;
    index = 0;
    active = true;
    root.hidden = false;
    document.body.dataset.featureTour = "active";
    viewport.addEventListener("resize", position);
    viewport.addEventListener("scroll", position, true);
    viewport.addEventListener("keydown", handleKeydown);
    requestAnimationFrame(() => {
      root.classList.add("is-visible");
      render();
      next.focus({ preventScroll: true });
    });
    return true;
  };

  const move = (change) => {
    index = Math.min(steps.length - 1, Math.max(0, index + change));
    render();
  };
  skip.addEventListener("click", finish);
  back.addEventListener("click", () => move(-1));
  next.addEventListener("click", () => index === steps.length - 1 ? finish() : move(1));
  function handleKeydown(event) {
    if (event.key === "Escape") { event.preventDefault(); finish(); return; }
    if (event.key === "ArrowRight") { event.preventDefault(); move(1); }
    if (event.key === "ArrowLeft") { event.preventDefault(); move(-1); }
    if (event.key === "Tab") {
      const focusable = [...card.querySelectorAll("button:not([hidden])")];
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }

  return {
    destroy() { close({ remember: false }); root.remove(); },
    isActive: () => active,
    start,
  };
}
