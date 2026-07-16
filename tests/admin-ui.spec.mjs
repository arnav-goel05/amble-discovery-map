import { expect, test } from "playwright/test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { AdminRepository } = require("../scripts/lib/admin-repository.cjs");
const { AdminService } = require("../scripts/lib/admin-service.cjs");
const { PlanGameService } = require("../scripts/lib/plan-game-service.cjs");
const databasePath = "/tmp/onemap-admin-playwright.sqlite";
const planRoot = "/tmp/onemap-plan-playwright";

function seedReview({ venueId, hashCharacter = "a" }) {
  const repository = new AdminRepository({ databasePath });
  const service = new AdminService({ repository });
  const review = service.createVenueReview({
    venueId,
    evidenceHash: hashCharacter.repeat(64),
    evidenceSnapshot: {
      venue: "National Library Building",
      rawNames: ["National Library Building"],
      addressCandidates: ["100 Victoria Street, Singapore 188064"],
      recoveryAttempts: [{ label: "Official event page", outcome: "Address verified" }],
      finalReason: "Two nearby candidates required an explicit building decision",
    },
    candidates: [{
      name: "NATIONAL LIBRARY BUILDING", gmlId: `SLA_BLDG2_${venueId}`, gmlIds: [`SLA_BLDG2_${venueId}`],
      latitude: 1.2976, longitude: 103.8545, distanceMeters: 8,
      sourceTiles: [{ tilePath: "tiles/0/0/0.b3dm", batchIds: [1] }],
    }],
  });
  repository.close();
  return review;
}

async function signIn(page) {
  await page.goto("/admin.html");
  await expect(page.getByRole("heading", { name: "What's Here" })).toBeVisible();
  await page.getByLabel("Administrator password").fill("admin-test-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Review queue" })).toBeVisible();
}

test.describe.serial("private admin venue review", () => {
  test.beforeAll(() => {
    const repository = new AdminRepository({ databasePath });
    repository.db.exec("DELETE FROM admin_idempotency; DELETE FROM venue_reviews; DELETE FROM admin_sessions; DELETE FROM admin_login_attempts;");
    repository.close();
    const gameService = new PlanGameService({ root: planRoot });
    gameService.repository.db.exec("DELETE FROM photo_submissions; DELETE FROM photo_fingerprints; DELETE FROM deleted_photo_reviews; DELETE FROM active_sessions; DELETE FROM sessions;");
    gameService.close();
  });

  test("desktop login, evidence comparison, approval, empty state, and logout", async ({ page }) => {
    const review = seedReview({ venueId: "desktop" });
    await signIn(page);
    await expect(page.getByRole("heading", { name: "National Library Building" })).toBeVisible();
    await expect(page.getByText("100 Victoria Street, Singapore 188064")).toBeVisible();
    await expect(page.getByText(`SLA_BLDG2_desktop`)).toBeVisible();
    await page.getByLabel("Decision reason").fill("Official address and current OneMap geometry agree");
    await page.getByRole("button", { name: "Approve candidate" }).click();
    await expect(page.getByText("The venue review queue is clear.")).toBeVisible();

    const repository = new AdminRepository({ databasePath });
    expect(repository.getVenueReview(review.reviewId).status).toBe("approved");
    repository.close();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });

  test("mobile stale decision refreshes safely without applying old evidence", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const review = seedReview({ venueId: "mobile", hashCharacter: "b" });
    await signIn(page);
    await page.getByLabel("Decision reason").fill("This decision will become stale");
    const repository = new AdminRepository({ databasePath });
    new AdminService({ repository }).createVenueReview({
      venueId: "mobile", evidenceHash: "c".repeat(64),
      evidenceSnapshot: { venue: "National Library Building", addressCandidates: ["Updated evidence address"] },
      candidates: [{ name: "Updated candidate", gmlId: "SLA_BLDG2_mobile_updated", gmlIds: ["SLA_BLDG2_mobile_updated"], latitude: 1.2976, longitude: 103.8545, sourceTiles: [{ tilePath: "tiles/updated.b3dm", batchIds: [2] }] }],
    });
    repository.close();
    await page.getByRole("button", { name: "Approve candidate" }).click();
    await expect(page.getByText(/Evidence changed or the case was already decided/)).toBeVisible();
    await expect(page.getByText("Updated evidence address")).toBeVisible();
  });

  test("uncertain photo queue exposes minimal evidence and records a private decision", async ({ page }) => {
    const gameService = new PlanGameService({ root: planRoot });
    const plan = gameService.createPlan({ stops: [{ id: "photo-event", type: "event", title: "Photo event", place: "Esplanade", latitude: 1.29, longitude: 103.85 }] });
    const game = gameService.createGame({ planId: plan.id });
    gameService.handleTelegramUpdate({ update_id: Date.now(), message: { chat: { id: 7722 }, text: `/start ${game.id}` } });
    gameService.repository.savePhotoSubmission({ gameId: game.id, chatId: 7722, missionId: "mission-1", fileUniqueId: "never-in-dom", status: "needs_review", verifier: "fixture", result: { reason: "low_confidence", raw: "never-in-dom" }, deleteAfter: "2026-07-21T00:00:00Z" });
    gameService.close();
    await signIn(page);
    await page.getByRole("button", { name: "Photo reviews" }).click();
    await expect(page.getByRole("heading", { name: /Mission photo/ })).toBeVisible();
    await expect(page.getByText("low_confidence").first()).toBeVisible();
    await expect(page.locator("body")).not.toContainText("never-in-dom");
    await page.getByLabel("Decision reason").fill("The submitted subject matches the mission evidence");
    await page.getByRole("button", { name: "Accept photo" }).click();
    await expect(page.getByText("The photo review queue is clear.")).toBeVisible();
  });

  test("queue service errors remain actionable and reveal no private data", async ({ page }) => {
    await page.route("**/api/admin/venue-reviews?**", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ schemaVersion: "1.0", error: { code: "service_unavailable", message: "Review service is temporarily unavailable." } }) }));
    await signIn(page);
    await expect(page.getByText("Review service is temporarily unavailable.")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("/tmp/");
  });
});
