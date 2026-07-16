const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

export function renderPhotoReview(container, review, { onDecision }) {
  container.replaceChildren();
  const heading = element("div", "admin-review__heading");
  heading.append(element("p", "admin-eyebrow", "Uncertain verification"), element("h2", null, `Mission photo #${review.id}`));
  container.append(heading);
  const facts = element("dl", "admin-photo-facts");
  for (const [label, value] of [
    ["Mission", review.missionId], ["Verifier", review.verifier], ["Reason", review.reason || "Not available"],
    ["Confidence", review.confidence == null ? "Not available" : `${Math.round(review.confidence * 100)}%`], ["Submitted", review.createdAt],
  ]) {
    facts.append(element("dt", null, label), element("dd", null, value));
  }
  container.append(facts, element("p", "admin-muted", "No image bytes, Telegram file identifiers, chat identifiers, or raw updates are retained in this view."));
  const form = element("form", "admin-review__form");
  const label = element("label", "admin-field");
  label.append(element("span", null, "Decision reason"));
  const reason = element("textarea"); reason.name = "reason"; reason.rows = 3; reason.maxLength = 1000; reason.required = true;
  label.append(reason);
  const actions = element("div", "admin-review__actions");
  for (const [decision, text, className] of [["accepted", "Accept photo", "admin-button admin-button--primary"], ["rejected", "Reject photo", "admin-button admin-button--danger"]]) {
    const button = element("button", className, text); button.type = "submit"; button.name = "decision"; button.value = decision; actions.append(button);
  }
  const feedback = element("p", "admin-feedback"); feedback.hidden = true;
  form.append(label, actions, feedback);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!reason.value.trim()) { feedback.textContent = "Enter the evidence for this decision."; feedback.hidden = false; return; }
    for (const button of actions.querySelectorAll("button")) button.disabled = true;
    try { await onDecision({ decision: event.submitter.value, reason: reason.value.trim() }); }
    catch (error) { feedback.textContent = error.message; feedback.hidden = false; }
    finally { for (const button of actions.querySelectorAll("button")) button.disabled = false; }
  });
  container.append(form);
}
