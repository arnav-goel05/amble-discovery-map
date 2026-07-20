import { expect, test } from "playwright/test";

test("the empty planner explains unavailable actions without duplicate warnings", async ({ page }) => {
  await page.goto("/test-harness.html");
  await page.evaluate(async () => {
    const { addPlanBuilder } = await import("/activity-scenes/plan-builder.js");
    addPlanBuilder({ geolocation: { getCurrentPosition: (_resolve, reject) => reject(new Error("denied")) } });
  });
  await page.locator("#plan-builder-button").click();
  await expect(page.locator(".plan-builder__stop--origin")).toContainText("Select to try again");
  await expect(page.locator(".plan-builder__preview-summary")).toHaveCount(0);
  await expect(page.getByText("Add stops for a route estimate")).toHaveCount(0);
  await expect(page.locator(".plan-builder__preview-warnings")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open route in Google Maps" })).toBeDisabled();
  await expect(page.locator(".plan-builder__telegram, .plan-builder__game-settings")).toHaveCount(0);
  await expect(page.getByText(/Telegram/i)).toHaveCount(0);
});

test("the MVP planner stays frontend-only and exposes only Google Maps routing", async ({ page }) => {
  const frontendRequests = [];
  await page.route(/\/api\/(?:game-readiness|plans|games)/, (route) => {
    frontendRequests.push(route.request().url());
    return route.abort();
  });
  await page.goto("/test-harness.html");
  await page.evaluate(async () => {
    const { addPlanBuilder } = await import("/activity-scenes/plan-builder.js");
    addPlanBuilder({ geolocation: { getCurrentPosition: (resolve) => resolve({ coords: { latitude: 1.283, longitude: 103.851 } }) } });
    window.dispatchEvent(new CustomEvent("whats-here:add-to-plan", { detail: {
      id: "event-ready", type: "event", title: "Ready event", place: "Esplanade", latitude: 1.2897, longitude: 103.8559,
    } }));
  });
  await expect(page.getByRole("link", { name: "Open route in Google Maps" })).toBeEnabled();
  await expect(page.locator(".plan-builder__preview-summary")).toContainText("1 stop");
  await expect(page.getByText(/Telegram|Theme|Timer/i)).toHaveCount(0);
  expect(frontendRequests).toEqual([]);
});

test("users build, reorder, and route a mixed plan without generating a share link", async ({ page }, testInfo) => {
  let planRequests = 0;
  await page.route("**/api/plans", async (route) => {
    planRequests += 1;
    await route.abort();
  });
  await page.goto("/test-harness.html");
  await page.evaluate(async () => {
    window.__mapMoves = [];
    const { addPlanBuilder } = await import("/activity-scenes/plan-builder.js");
    window.__planner = addPlanBuilder({
      map: { getZoom: () => 14, easeTo: (options) => window.__mapMoves.push(options) },
      geolocation: { getCurrentPosition: (resolve) => resolve({ coords: { latitude: 1.283, longitude: 103.851 } }) },
    });
    const add = (detail) => window.dispatchEvent(new CustomEvent("whats-here:add-to-plan", { detail }));
    add({ id: "event-1", type: "event", title: "Jazz by the Bay", place: "Esplanade", latitude: 1.2897, longitude: 103.8559 });
    add({ id: "food-1", type: "restaurant", title: "Example Kitchen", place: "3 Example Road", latitude: 1.285, longitude: 103.858 });
  });
  await expect(page.locator("#plan-builder")).toBeVisible();
  await expect(page.locator(".plan-builder__stop--origin .plan-builder__stop-title")).toHaveText("My location");
  await expect(page.locator(".plan-builder__stop:not(.plan-builder__stop--origin)")).toHaveCount(2);
  await expect(page.locator(".plan-builder__preview-summary")).toContainText("2 stops");
  await expect(page.locator(".plan-builder__preview-summary")).toContainText("km");
  await expect(page.locator(".plan-builder__preview-warnings")).not.toContainText("Accessibility details");
  await expect(page.locator("#plan-builder-button")).toHaveAttribute("aria-label", "Plan, 2 stops");
  await expect(page.getByLabel(/^Move .+ (up|down)$/)).toHaveCount(0);
  await expect(page.getByLabel("Remove Example Kitchen").locator(".ph-x")).toHaveCount(1);
  const dragHandle = page.getByLabel("Drag Example Kitchen to reorder");
  const firstStop = page.locator(".plan-builder__stop:not(.plan-builder__stop--origin)").first();
  const handleBox = await dragHandle.boundingBox();
  const firstBox = await firstStop.boundingBox();
  if (testInfo.project.name.endsWith("-mobile")) {
    await page.evaluate(({ source, target }) => {
      const handle = document.querySelector('[aria-label="Drag Example Kitchen to reorder"]');
      const pointer = { bubbles: true, cancelable: true, isPrimary: true, pointerId: 41, pointerType: "touch" };
      handle.dispatchEvent(new PointerEvent("pointerdown", { ...pointer, button: 0, buttons: 1, clientX: source.x, clientY: source.y }));
      document.dispatchEvent(new PointerEvent("pointermove", { ...pointer, button: -1, buttons: 1, clientX: target.x, clientY: target.y }));
      document.dispatchEvent(new PointerEvent("pointerup", { ...pointer, button: 0, buttons: 0, clientX: target.x, clientY: target.y }));
    }, {
      source: { x: handleBox.x + handleBox.width / 2, y: handleBox.y + handleBox.height / 2 },
      target: { x: firstBox.x + firstBox.width / 2, y: firstBox.y + firstBox.height / 2 },
    });
  } else {
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2, { steps: 6 });
    await page.mouse.up();
  }
  await expect(page.locator(".plan-builder__stop:not(.plan-builder__stop--origin) .plan-builder__stop-title").first()).toHaveText("Example Kitchen");
  const maps = new URL(await page.locator(".plan-builder__maps-link").getAttribute("href"));
  expect(maps.origin + maps.pathname).toBe("https://www.google.com/maps/dir/");
  expect(maps.searchParams.get("origin")).toBe("1.283,103.851");
  expect(maps.searchParams.get("waypoints")).toBe("1.285,103.858");
  const statusBox = await page.locator(".plan-builder__status").boundingBox();
  expect(statusBox.width).toBeLessThanOrEqual(1);
  expect(statusBox.height).toBeLessThanOrEqual(1);
  expect((await page.locator(".plan-builder__maps-link").boundingBox()).height).toBeLessThanOrEqual(50);
  await expect(page.locator(".plan-builder__share-actions, .plan-builder__share--whatsapp")).toHaveCount(0);
  expect(planRequests).toBe(0);
  await page.locator(".plan-builder__stop:not(.plan-builder__stop--origin) .plan-builder__stop-focus").first().click();
  await expect(page.locator("#plan-builder")).toBeVisible();
  expect(await page.evaluate(() => window.__mapMoves)).toEqual([{ center: [103.858, 1.285], zoom: 17, duration: 700 }]);
});

test("the real plan/game API persists shared plans and authenticates Telegram webhooks", async ({ request }) => {
  const planResponse = await request.post("/api/plans", { data: {
    title: "API day out", travelMode: "walking",
    stops: [{ id: "event-api", type: "event", title: "Waterfront show", place: "Esplanade", latitude: 1.2897, longitude: 103.8559 }],
  } });
  expect(planResponse.status()).toBe(201);
  const plan = await planResponse.json();
  expect(plan.id).toMatch(/^plan_/);
  expect((await (await request.get(`/api/plans/${plan.id}`)).json()).title).toBe("API day out");

  const gameResponse = await request.post("/api/games", { data: { planId: plan.id } });
  expect(gameResponse.status()).toBe(201);
  const game = await gameResponse.json();
  expect(game.telegramUrl).toBe(`https://t.me/WhatsHereTestBot?start=${game.id}`);
  const persistedGame = await (await request.get(`/api/games/${game.id}`)).json();
  expect(persistedGame.missions).toHaveLength(1);
  expect(persistedGame.missions[0]).toMatchObject({ title: "Waterfront show", place: "Esplanade", latitude: 1.2897, longitude: 103.8559 });
  persistedGame.missions[0].title = "client-side mutation";
  expect((await (await request.get(`/api/games/${game.id}`)).json()).missions[0].title).toBe("Waterfront show");

  const update = { update_id: Date.now(), message: { chat: { id: 991122 }, text: `/start ${game.id}` } };
  const rejected = await request.post("/api/telegram/webhook", { data: update, headers: { "X-Telegram-Bot-Api-Secret-Token": "wrong" } });
  expect(rejected.status()).toBe(401);
  const accepted = await request.post("/api/telegram/webhook", { data: update, headers: { "X-Telegram-Bot-Api-Secret-Token": "test-secret" } });
  expect(accepted.status()).toBe(503);
  const diagnostic = await accepted.json();
  expect(diagnostic.error).toContain("TELEGRAM_BOT_TOKEN");
  expect(diagnostic.actions[0].text).toContain("Mission 1/1");
});

test("event details add the selected event and expose its Google Maps destination", async ({ page }) => {
  await page.goto("/test-harness.html");
  await page.evaluate(async () => {
    const [{ addPlanBuilder }, { createLandmarkEventPanel }] = await Promise.all([
      import("/activity-scenes/plan-builder.js"), import("/activity-scenes/landmark-event-panel.js"),
    ]);
    addPlanBuilder({ geolocation: { getCurrentPosition: (resolve) => resolve({ coords: { latitude: 1.283, longitude: 103.851 } }) } });
    const trigger = document.createElement("button"); document.body.appendChild(trigger);
    const panel = createLandmarkEventPanel();
    window.__openTestEvent = () => panel.open({
      landmark: { id: "esplanade", label: "Esplanade", anchor: { lat: 1.2897, lng: 103.8559 } },
      sourceEvents: [{ id: "jazz", title: "Jazz by the Bay", dateText: "14 Jul", timeText: "8pm", eventUrl: "https://example.com/jazz" }],
      selectedEventIndex: 0, trigger,
    });
  });
  await page.locator("#plan-builder-button").click();
  await expect(page.locator("#plan-builder")).toBeVisible();
  const planBox = await page.locator("#plan-builder").boundingBox();
  await page.evaluate(() => window.__openTestEvent());
  await expect(page.locator("#plan-builder")).toBeHidden();
  await expect(page.locator("#landmark-event-panel")).toBeVisible();
  expect(await page.locator("#landmark-event-panel").boundingBox()).toEqual(planBox);
  await page.locator(".landmark-event-panel__plan").click();
  await expect(page.locator("#landmark-event-panel")).toBeHidden();
  await expect(page.locator("#plan-builder")).toBeVisible();
  await expect(page.locator("#plan-builder-button")).toHaveAttribute("aria-label", "Plan, 1 stop");
  await expect(page.locator(".plan-builder__stop:not(.plan-builder__stop--origin) .plan-builder__stop-place")).toContainText("Esplanade");
  const maps = new URL(await page.locator(".plan-builder__maps-link").getAttribute("href"));
  expect(maps.origin + maps.pathname).toBe("https://www.google.com/maps/dir/");
  expect(maps.searchParams.get("origin")).toBe("1.283,103.851");
  expect(maps.searchParams.get("destination")).toBe("1.2897,103.8559");
});

test("planner controller publishes stable current plan and game candidates", async ({ page }) => {
  await page.goto("/test-harness.html");
  const snapshots = await page.evaluate(async () => {
    const { addPlanBuilder } = await import("/activity-scenes/plan-builder.js");
    const game = { id: "hunt-1", title: "Garden hunt", status: "available", secret: "omit" };
    const controller = addPlanBuilder({ gameCandidates: [game] });
    const revisions = [];
    const unsubscribe = controller.subscribeCandidateState((state) => revisions.push(state.revision));
    window.dispatchEvent(new CustomEvent("whats-here:add-to-plan", { detail: {
      id: "event-1", type: "event", title: "Jazz", place: "Esplanade", latitude: 1.2897, longitude: 103.8559,
    } }));
    const afterStop = controller.getCandidateState();
    game.title = "Caller mutation";
    controller.setGameCandidates([{ id: "hunt-2", title: "Night hunt", status: "available" }]);
    const afterGames = controller.getCandidateState();
    unsubscribe();
    return { initialRevision: revisions[0], revisions, afterStop, afterGames };
  });

  expect(snapshots.initialRevision).toBe(0);
  expect(snapshots.revisions).toEqual([0, 1, 2]);
  expect(snapshots.afterStop.planStops).toEqual([expect.objectContaining({
    candidateId: "plan-stop:event:event-1",
    candidateType: "plan_stop",
    position: 1,
  })]);
  expect(snapshots.afterStop.games[0].title).toBe("Garden hunt");
  expect(snapshots.afterStop.games[0].secret).toBeUndefined();
  expect(snapshots.afterGames.games.map(({ candidateId }) => candidateId)).toEqual(["game:hunt-2"]);
});

test("the route planner remains usable on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto("/test-harness.html");
  await page.evaluate(async () => {
    const { addPlanBuilder } = await import("/activity-scenes/plan-builder.js");
    addPlanBuilder();
    for (let index = 0; index < 8; index += 1) window.dispatchEvent(new CustomEvent("whats-here:add-to-plan", { detail: {
      id: `stop-${index}`, type: index % 2 ? "restaurant" : "event", title: `Stop ${index + 1}`, place: `Place ${index + 1}`,
      latitude: 1.28 + index / 1000, longitude: 103.85 + index / 1000,
    } }));
  });
  await page.evaluate(() => {
    const handles = [...document.querySelectorAll(".plan-builder__drag-handle")];
    const stops = [...document.querySelectorAll(".plan-builder__stop:not(.plan-builder__stop--origin)")];
    const source = handles[1].getBoundingClientRect();
    const target = stops[0].getBoundingClientRect();
    const pointer = { bubbles: true, cancelable: true, isPrimary: true, pointerId: 42, pointerType: "touch" };
    handles[1].dispatchEvent(new PointerEvent("pointerdown", { ...pointer, button: 0, buttons: 1, clientX: source.x + source.width / 2, clientY: source.y + source.height / 2 }));
    document.dispatchEvent(new PointerEvent("pointermove", { ...pointer, button: -1, buttons: 1, clientX: target.x + target.width / 2, clientY: target.y + target.height / 2 }));
    document.dispatchEvent(new PointerEvent("pointerup", { ...pointer, button: 0, buttons: 0, clientX: target.x + target.width / 2, clientY: target.y + target.height / 2 }));
  });
  await expect(page.locator(".plan-builder__stop:not(.plan-builder__stop--origin) .plan-builder__stop-title").first()).toHaveText("Stop 2");
  const box = await page.locator("#plan-builder").boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(box.y + box.height).toBeLessThanOrEqual(760);
  await expect(page.locator(".plan-builder__maps-link")).toHaveCount(2);
});
