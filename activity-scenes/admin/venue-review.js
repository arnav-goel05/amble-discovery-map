const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

function evidenceList(title, values) {
  const section = element("section", "admin-review__evidence");
  section.append(element("h3", null, title));
  const list = element("ul");
  const available = (values ?? []).filter(Boolean);
  if (!available.length) list.append(element("li", "admin-muted", "Not available"));
  else for (const value of available) {
    const item = element("li");
    item.textContent = typeof value === "string" ? value : value.label || value.outcome || value.url || JSON.stringify(value);
    list.append(item);
  }
  section.append(list);
  return section;
}

export function renderVenueReview(container, review, { onDecision }) {
  container.replaceChildren();
  const heading = element("div", "admin-review__heading");
  heading.append(element("p", "admin-eyebrow", "Venue evidence"), element("h2", null, review.evidenceSnapshot?.venue || "Unresolved venue"));
  container.append(heading);

  const evidence = element("div", "admin-review__evidence-grid");
  evidence.append(
    evidenceList("Official address evidence", review.evidenceSnapshot?.addressCandidates),
    evidenceList("Names supplied by sources", review.evidenceSnapshot?.rawNames),
    evidenceList("Recovery attempts", review.evidenceSnapshot?.recoveryAttempts),
    evidenceList("Uncertainty", [review.evidenceSnapshot?.finalReason]),
  );
  container.append(evidence);

  const form = element("form", "admin-review__form");
  form.dataset.reviewId = review.reviewId;
  form.append(element("h3", null, "Current OneMap candidates"));
  const candidates = element("fieldset", "admin-review__candidates");
  candidates.append(element("legend", "sr-only", "Select a OneMap candidate"));
  for (const [index, candidate] of (review.candidates ?? []).entries()) {
    const label = element("label", "admin-candidate");
    const input = element("input");
    input.type = "radio";
    input.name = "candidate";
    input.value = candidate.gmlId || "";
    input.disabled = !candidate.gmlId;
    if (index === 0 && candidate.gmlId) input.checked = true;
    const copy = element("span", "admin-candidate__copy");
    copy.append(element("strong", null, candidate.name || "Unnamed OneMap building"));
    copy.append(element("span", null, candidate.gmlId || "GML identity unavailable"));
    copy.append(element("span", null, candidate.distanceMeters == null ? "Distance not available" : `${Math.round(candidate.distanceMeters)} m from evidence`));
    if (candidate.rejectionReason) copy.append(element("span", "admin-warning", candidate.rejectionReason));
    label.append(input, copy);
    candidates.append(label);
  }
  if (!(review.candidates ?? []).length) candidates.append(element("p", "admin-empty", "No candidates are currently available."));
  form.append(candidates);

  const reasonLabel = element("label", "admin-field");
  reasonLabel.append(element("span", null, "Decision reason"));
  const reason = element("textarea");
  reason.name = "reason";
  reason.rows = 3;
  reason.maxLength = 1000;
  reason.placeholder = "State which evidence supports this decision";
  reasonLabel.append(reason);
  form.append(reasonLabel);

  const actions = element("div", "admin-review__actions");
  for (const [decision, label, className] of [["approve", "Approve candidate", "admin-button admin-button--primary"], ["reject", "Reject mapping", "admin-button admin-button--danger"], ["defer", "Review later", "admin-button"]]) {
    const button = element("button", className, label);
    button.type = "submit";
    button.value = decision;
    button.name = "decision";
    actions.append(button);
  }
  form.append(actions);
  const feedback = element("p", "admin-feedback");
  feedback.hidden = true;
  form.append(feedback);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const decision = event.submitter?.value;
    const candidateGmlId = new FormData(form).get("candidate");
    const decisionReason = reason.value.trim();
    if (decision === "approve" && (!candidateGmlId || !decisionReason)) {
      feedback.textContent = "Choose a candidate and enter the supporting reason.";
      feedback.hidden = false;
      return;
    }
    if (decision === "reject" && !decisionReason) {
      feedback.textContent = "Enter a reason for rejecting this mapping.";
      feedback.hidden = false;
      return;
    }
    for (const button of actions.querySelectorAll("button")) button.disabled = true;
    feedback.textContent = "Saving decision…";
    feedback.hidden = false;
    try { await onDecision({ decision, candidateGmlId: decision === "approve" ? candidateGmlId : null, reason: decisionReason }); }
    finally { for (const button of actions.querySelectorAll("button")) button.disabled = false; }
  });
  container.append(form);
}
