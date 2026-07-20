import {
  actionContracts,
  objectSchema,
  optional,
  parityCases,
  registerContracts,
  types,
} from "./action-definition.js";

export const APPLICATION_ACTION_DEFINITIONS = Object.freeze([
  {
    actionId: "tour.start",
    description: "Start the feature tour",
    contextProvider: "applicationContext",
  },
  {
    actionId: "tour.previous",
    description: "Show the previous tour step",
    contextProvider: "overlayContext",
  },
  {
    actionId: "tour.next",
    description: "Show the next tour step",
    contextProvider: "overlayContext",
  },
  {
    actionId: "tour.finish",
    description: "Finish the feature tour",
    contextProvider: "overlayContext",
  },
  {
    actionId: "saved.open",
    description: "Open saved content",
    contextProvider: "savedContext",
  },
  {
    actionId: "saved.openitem",
    description: "Open a saved item",
    contextProvider: "savedContext",
    argumentSchema: objectSchema({ itemId: types.id }),
    sampleArguments: { itemId: "saved:fixture" },
  },
  {
    actionId: "saved.deleteitem",
    description: "Delete a saved item",
    contextProvider: "savedContext",
    confirmationClass: "consequential",
    argumentSchema: objectSchema({ itemId: types.id }),
    sampleArguments: { itemId: "saved:fixture" },
  },
  {
    actionId: "game.open",
    description: "Open an available game",
    contextProvider: "gameContext",
    argumentSchema: optional({ gameId: types.id }),
    sampleArguments: { gameId: "game:fixture" },
  },
  {
    actionId: "game.start",
    description: "Start a game from a plan",
    contextProvider: "planContext",
    confirmationClass: "consequential",
    argumentSchema: objectSchema({ planId: types.id }),
    sampleArguments: { planId: "plan:fixture" },
  },
  {
    actionId: "game.pause",
    description: "Pause a running game",
    contextProvider: "gameContext",
    argumentSchema: objectSchema({ gameId: types.id }),
    sampleArguments: { gameId: "game:fixture" },
  },
  {
    actionId: "game.resume",
    description: "Resume a paused game",
    contextProvider: "gameContext",
    argumentSchema: objectSchema({ gameId: types.id }),
    sampleArguments: { gameId: "game:fixture" },
  },
  {
    actionId: "game.status",
    description: "Show current game progress",
    contextProvider: "gameContext",
    argumentSchema: objectSchema({ gameId: types.id }),
    sampleArguments: { gameId: "game:fixture" },
  },
  {
    actionId: "game.skip",
    description: "Skip the current game mission",
    contextProvider: "gameContext",
    confirmationClass: "consequential",
    argumentSchema: objectSchema({ gameId: types.id, missionId: types.id }),
    sampleArguments: { gameId: "game:fixture", missionId: "mission:fixture" },
  },
  {
    actionId: "game.quit",
    description: "Quit an active game",
    contextProvider: "gameContext",
    confirmationClass: "consequential",
    argumentSchema: objectSchema({ gameId: types.id }),
    sampleArguments: { gameId: "game:fixture" },
  },
  {
    actionId: "game.openroute",
    description: "Open an approved game route",
    contextProvider: "gameContext",
    confirmationClass: "consequential",
    argumentSchema: optional({ gameId: types.id, missionId: types.id }),
    sampleArguments: { gameId: "game:fixture", missionId: "mission:fixture" },
  },
  {
    actionId: "navigation.enterexperience",
    description: "Enter the interactive experience",
    contextProvider: "applicationContext",
  },
  {
    actionId: "navigation.openassistant",
    description: "Open the assistant",
    contextProvider: "applicationContext",
  },
  {
    actionId: "navigation.closeassistant",
    description: "Close the assistant",
    contextProvider: "overlayContext",
  },
  {
    actionId: "navigation.closeoverlay",
    description: "Close a named or active overlay",
    contextProvider: "overlayContext",
    argumentSchema: optional({ overlayId: types.id }),
    sampleArguments: { overlayId: "assistant" },
  },
  {
    actionId: "navigation.openexternal",
    description: "Open an allowlisted external destination",
    contextProvider: "selectionContext",
    confirmationClass: "consequential",
    argumentSchema: objectSchema({
      targetId: types.id,
      linkKind: { enum: ["reference", "directions", "deal", "route"] },
    }),
    sampleArguments: { targetId: "event:fixture", linkKind: "reference" },
  },
]);

export const createApplicationActionContracts = (options = {}) =>
  actionContracts(APPLICATION_ACTION_DEFINITIONS, options);
export const registerApplicationActions = (registry, options = {}) =>
  registerContracts(registry, createApplicationActionContracts(options));
export const APPLICATION_ACTION_PARITY_CASES = parityCases(
  APPLICATION_ACTION_DEFINITIONS,
);

const makePanel = (testId, title) => {
  const panel = document.createElement("section");
  panel.className = "application-action-panel";
  panel.hidden = true;
  panel.dataset.testid = testId;
  panel.setAttribute("aria-label", title);
  const heading = document.createElement("h2");
  heading.textContent = title;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "application-action-panel__close";
  close.textContent = "Close";
  close.setAttribute("aria-label", `Close ${title.toLowerCase()}`);
  const content = document.createElement("div");
  content.className = "application-action-panel__content";
  panel.append(heading, close, content);
  document.body.append(panel);
  return { panel, content, close };
};

export function createApplicationActionControls({
  savedItems = globalThis.__ASSISTANT_SAVED_ITEMS__ || [],
  games = globalThis.__ASSISTANT_PUBLIC_GAMES__ || [],
  dispatch = null,
} = {}) {
  const saved = makePanel("saved-content-panel", "Saved content");
  const game = makePanel("game-panel", "Games");
  let items = structuredClone(savedItems);
  let publicGames = structuredClone(games);
  let selectedSavedItemId = null;
  let activeGameId = null;

  const itemButton = (item, dataKey, selected, onSelect) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = item.title || item.id;
    button.dataset[dataKey] = item.id;
    button.setAttribute("aria-current", String(item.id === selected));
    button.addEventListener("click", onSelect);
    return button;
  };
  const render = () => {
    saved.content.replaceChildren(
      ...items.map((item) =>
        itemButton(item, "savedItemId", selectedSavedItemId, () =>
          invoke("saved.openitem", { itemId: item.id }),
        ),
      ),
    );
    game.content.replaceChildren(
      ...publicGames.map((item) =>
        itemButton(item, "gameId", activeGameId, () =>
          invoke("game.open", { gameId: item.id }),
        ),
      ),
    );
  };
  const execute = (actionId, args = {}) => {
    if (actionId === "saved.open") saved.panel.hidden = false;
    else if (actionId === "saved.openitem") {
      if (!items.some(({ id }) => id === args.itemId))
        return { changed: false };
      selectedSavedItemId = args.itemId;
      saved.panel.hidden = false;
    } else if (actionId === "saved.deleteitem") {
      if (!items.some(({ id }) => id === args.itemId))
        return { changed: false };
      items = items.filter(({ id }) => id !== args.itemId);
      if (selectedSavedItemId === args.itemId) selectedSavedItemId = null;
    } else if (actionId === "game.open") {
      if (args.gameId && !publicGames.some(({ id }) => id === args.gameId))
        return { changed: false };
      game.panel.hidden = false;
      activeGameId = args.gameId || activeGameId || publicGames[0]?.id || null;
    } else if (actionId === "game.start") {
      const id = `game:${String(args.planId).replace(/^plan:/, "")}`;
      const existing = publicGames.find((item) => item.id === id);
      if (!existing)
        publicGames.push({
          id,
          title: "Plan game",
          status: "running",
          progress: 0,
        });
      else existing.status = "running";
      activeGameId = id;
      game.panel.hidden = false;
    } else if (
      ["game.pause", "game.resume", "game.status"].includes(actionId)
    ) {
      const current = publicGames.find(
        (item) => item.id === (args.gameId || activeGameId),
      );
      if (!current) return { changed: false };
      if (actionId === "game.pause") current.status = "paused";
      if (actionId === "game.resume") current.status = "running";
      activeGameId = current.id;
      game.panel.hidden = false;
    } else if (actionId === "game.skip") {
      const current = publicGames.find((item) => item.id === args.gameId);
      if (!current) return { changed: false };
      current.progress = Math.min(100, Number(current.progress || 0) + 1);
    } else if (actionId === "game.quit") {
      const current = publicGames.find((item) => item.id === args.gameId);
      if (!current) return { changed: false };
      current.status = "ended";
      game.panel.hidden = true;
    } else if (actionId === "game.openroute") {
      const current = publicGames.find(
        (item) => item.id === (args.gameId || activeGameId),
      );
      const url = current?.routeUrl;
      if (!url || !/^https:\/\/(?:www\.)?google\.com\/maps\//.test(url))
        return { changed: false };
      window.open(url, "_blank", "noopener,noreferrer");
    } else if (actionId === "navigation.enterexperience") {
      const control = document.querySelector(
        '[data-testid="enter-experience"], #enter-experience, .intro-enter',
      );
      control?.click();
      return { changed: Boolean(control) };
    } else if (actionId === "navigation.closeoverlay") {
      if (!args.overlayId || args.overlayId === "saved")
        saved.panel.hidden = true;
      if (!args.overlayId || args.overlayId === "game")
        game.panel.hidden = true;
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    } else return { changed: false };
    render();
    return { changed: true };
  };
  const invoke = (actionId, args = {}) =>
    typeof dispatch === "function"
      ? dispatch(actionId, args)
      : execute(actionId, args);
  saved.close.addEventListener("click", () => {
    saved.panel.hidden = true;
  });
  game.close.addEventListener("click", () => {
    game.panel.hidden = true;
  });
  const onKeyDown = (event) => {
    if (event.key !== "Escape") return;
    saved.panel.hidden = true;
    game.panel.hidden = true;
  };
  document.addEventListener("keydown", onKeyDown);
  render();
  return Object.freeze({
    dispatch: execute,
    finalize() {
      document.removeEventListener("keydown", onKeyDown);
      saved.panel.remove();
      game.panel.remove();
    },
  });
}
