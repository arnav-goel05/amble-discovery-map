import "@phosphor-icons/web/bold";
import { ApiClientError, requestJson } from "../shared/api-client.js";
import { renderVenueReview } from "./venue-review.js";
import { renderPhotoReview } from "./photo-review.js";

const root = document.querySelector("#admin-app");
let csrfToken = null;
let selectedReviewId = null;
let selectedPhotoReviewId = null;

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};
const icon = (name) => element("i", `ph-bold ph-${name}`);
const request = (url, options = {}) => requestJson(url, { ...options, headers: { ...(csrfToken && options.method && options.method !== "GET" ? { "X-CSRF-Token": csrfToken } : {}), ...options.headers } });

function renderLogin(message = "") {
  csrfToken = null;
  selectedReviewId = null;
  const card = element("section", "admin-login");
  card.append(element("p", "admin-eyebrow", "Private administration"), element("h1", null, "What's Here"), element("p", "admin-muted", "Sign in to review unresolved venue evidence."));
  const form = element("form", "admin-login__form");
  const label = element("label", "admin-field");
  label.append(element("span", null, "Administrator password"));
  const password = element("input");
  password.type = "password";
  password.name = "password";
  password.required = true;
  password.autocomplete = "current-password";
  label.append(password);
  const feedback = element("p", "admin-feedback", message);
  feedback.hidden = !message;
  const submit = element("button", "admin-button admin-button--primary", "Sign in");
  submit.type = "submit";
  form.append(label, feedback, submit);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    feedback.hidden = true;
    try {
      const response = await requestJson("/api/admin/session", { method: "POST", body: JSON.stringify({ password: password.value }) });
      csrfToken = response.data.csrfToken;
      password.value = "";
      await renderWorkspace();
    } catch (error) {
      feedback.textContent = error.message || "Unable to sign in";
      feedback.hidden = false;
    } finally { submit.disabled = false; }
  });
  card.append(form);
  root.replaceChildren(card);
  password.focus();
}

async function loadReview(reviewId, detail, queue) {
  selectedReviewId = reviewId;
  detail.replaceChildren(element("p", "admin-loading", "Loading venue evidence…"));
  for (const item of queue.querySelectorAll("button")) item.setAttribute("aria-current", String(item.dataset.reviewId === reviewId));
  try {
    const response = await request(`/api/admin/venue-reviews/${encodeURIComponent(reviewId)}`);
    renderVenueReview(detail, response.data, { onDecision: async (decision) => {
      try {
        await request(`/api/admin/venue-reviews/${encodeURIComponent(reviewId)}/decision`, {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({ ...decision, evidenceHash: response.data.evidenceHash }),
        });
        await renderWorkspace("Decision saved. The pipeline will revalidate it before publication.");
      } catch (error) {
        if (error instanceof ApiClientError && error.status === 409) {
          await renderWorkspace("Evidence changed or the case was already decided. The queue has been refreshed.");
          return;
        }
        const feedback = detail.querySelector(".admin-feedback");
        feedback.textContent = error.message;
        feedback.hidden = false;
      }
    } });
  } catch (error) { detail.replaceChildren(element("div", "admin-error", error.message)); }
}

async function renderPhotoQueue(queue, detail) {
  const response = await request("/api/admin/photo-reviews?status=needs_review&limit=50");
  const records = response.data.records ?? [];
  queue.replaceChildren();
  if (!records.length) {
    queue.append(element("p", "admin-empty", "No uncertain photos."));
    detail.replaceChildren(element("div", "admin-empty-state", "The photo review queue is clear."));
    return;
  }
  const select = async (review) => {
    selectedPhotoReviewId = review.id;
    for (const item of queue.querySelectorAll("button")) item.setAttribute("aria-current", String(item.dataset.photoReviewId === String(review.id)));
    renderPhotoReview(detail, review, { onDecision: async (decision) => {
      try {
        await request(`/api/admin/photo-reviews/${review.id}`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(decision) });
        await renderWorkspace("Photo decision saved and player notification queued.", "photo");
      } catch (error) {
        if (error instanceof ApiClientError && error.status === 409) return renderWorkspace("That photo task is terminal or no longer retained. The queue has been refreshed.", "photo");
        throw error;
      }
    } });
  };
  for (const review of records) {
    const button = element("button", "admin-queue__item"); button.type = "button"; button.dataset.photoReviewId = review.id;
    button.append(element("strong", null, `Mission photo #${review.id}`), element("span", null, review.reason || "Uncertain result"));
    button.addEventListener("click", () => select(review)); queue.append(button);
  }
  await select(records.find((item) => item.id === selectedPhotoReviewId) ?? records[0]);
}

async function renderWorkspace(notice = "", mode = "venue") {
  const shell = element("div", "admin-workspace");
  const header = element("header", "admin-header");
  const title = element("div");
  title.append(element("p", "admin-eyebrow", "Private administration"), element("h1", null, "Review queue"));
  const logout = element("button", "admin-icon-button");
  logout.type = "button";
  logout.setAttribute("aria-label", "Sign out");
  logout.append(icon("sign-out"));
  logout.addEventListener("click", async () => {
    try { await request("/api/admin/session", { method: "DELETE" }); } catch { /* local state still clears */ }
    renderLogin();
  });
  header.append(title, logout);
  const tabs = element("nav", "admin-tabs"); tabs.setAttribute("aria-label", "Review queues");
  const venueTab = element("button", "admin-tab", "Venue reviews"); venueTab.type = "button"; venueTab.setAttribute("aria-current", String(mode === "venue"));
  const photoTab = element("button", "admin-tab", "Photo reviews"); photoTab.type = "button"; photoTab.setAttribute("aria-current", String(mode === "photo"));
  venueTab.addEventListener("click", () => renderWorkspace("", "venue"));
  photoTab.addEventListener("click", () => renderWorkspace("", "photo"));
  tabs.append(venueTab, photoTab);
  const banner = element("p", "admin-notice", notice);
  banner.hidden = !notice;
  const layout = element("div", "admin-layout");
  const queue = element("nav", "admin-queue");
  queue.setAttribute("aria-label", "Pending venue reviews");
  const detail = element("article", "admin-review");
  detail.append(element("p", "admin-empty", "Select a venue to compare its evidence."));
  layout.append(queue, detail);
  shell.append(header, tabs, banner, layout);
  root.replaceChildren(shell);
  try {
    if (mode === "photo") { await renderPhotoQueue(queue, detail); return; }
    const response = await request("/api/admin/venue-reviews?status=pending&limit=50");
    const records = response.data.records ?? [];
    queue.replaceChildren();
    if (!records.length) {
      queue.append(element("p", "admin-empty", "No pending venue reviews."));
      detail.replaceChildren(element("div", "admin-empty-state", "The venue review queue is clear."));
      return;
    }
    for (const review of records) {
      const button = element("button", "admin-queue__item");
      button.type = "button";
      button.dataset.reviewId = review.reviewId;
      button.append(element("strong", null, review.evidenceSnapshot?.venue || review.venueId), element("span", null, `${review.candidates?.length ?? 0} candidates`));
      button.addEventListener("click", () => loadReview(review.reviewId, detail, queue));
      queue.append(button);
    }
    await loadReview(selectedReviewId && records.some((item) => item.reviewId === selectedReviewId) ? selectedReviewId : records[0].reviewId, detail, queue);
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 401) return renderLogin();
    queue.replaceChildren(element("div", "admin-error", error.message));
  }
}

async function bootstrap() {
  root.replaceChildren(element("p", "admin-loading", "Checking administrator session…"));
  try {
    const response = await requestJson("/api/admin/session");
    csrfToken = response.data.csrfToken;
    await renderWorkspace();
  } catch { renderLogin(); }
}

bootstrap();
