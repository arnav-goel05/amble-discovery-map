import "@phosphor-icons/web/bold";

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

const VOICE_DISCLOSURE_KEY = "amble.voice-disclosure.v1";

export function createAssistantView({
  onStartVoice,
  onStopVoice,
  onPushToTalkStart,
  onPushToTalkEnd,
  onInterrupt,
  onToggleMute,
  onConfirmation,
  onSelectArea,
  onCompareAreas,
  onDismissArea,
  onSelectCandidate,
  onClarification,
} = {}) {
  const open = element("button", "assistant-open");
  open.type = "button";
  open.dataset.testid = "assistant-open";
  open.setAttribute("aria-expanded", "false");
  open.setAttribute("aria-label", "Talk to Amble");
  const orbFrame = element("span", "assistant-orb-frame");
  orbFrame.setAttribute("aria-hidden", "true");
  const orb = element("img", "assistant-orb");
  orb.dataset.testid = "assistant-voice-orb";
  orb.src = "/brand/amble-voice-orb.png";
  orb.alt = "";
  orb.width = 64;
  orb.height = 64;
  orbFrame.append(orb);
  const openCopy = element("span", "assistant-open__copy");
  const openTitle = element("span", "assistant-open__title", "Talk");
  const livePreview = element(
    "span",
    "assistant-open__preview",
    "Explore Singapore by voice",
  );
  livePreview.dataset.testid = "assistant-live-preview";
  openCopy.append(openTitle, livePreview);
  open.append(orbFrame, openCopy);

  const shell = element("div", "assistant-shell frosted-control-bar");
  shell.dataset.expanded = "false";
  shell.dataset.mode = "idle";
  const panel = element("section", "assistant-panel");
  panel.dataset.testid = "assistant-panel";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Amble assistant");
  const disclosure = element("section", "assistant-disclosure");
  disclosure.hidden = true;
  disclosure.dataset.testid = "assistant-voice-disclosure";
  disclosure.append(
    element(
      "p",
      "",
      "Voice is processed by OpenAI, which may retain data for abuse monitoring. Amble does not store your audio, transcript, context, or precise location.",
    ),
  );
  const acceptDisclosure = element("button", "", "Continue with voice");
  acceptDisclosure.type = "button";
  acceptDisclosure.dataset.testid = "assistant-disclosure-accept";
  const cancelDisclosure = element("button", "", "Cancel");
  cancelDisclosure.type = "button";
  disclosure.append(acceptDisclosure, cancelDisclosure);
  const voiceControls = element("div", "assistant-voice-controls");
  const voiceState = element("span", "assistant-voice-state", "Voice stopped");
  voiceState.dataset.testid = "assistant-voice-state";
  voiceState.setAttribute("aria-live", "polite");
  const pushToTalk = element(
    "button",
    "assistant-push-to-talk",
    "Hold to talk",
  );
  pushToTalk.type = "button";
  pushToTalk.dataset.testid = "assistant-push-to-talk";
  const interrupt = element("button", "assistant-interrupt", "Interrupt");
  interrupt.type = "button";
  interrupt.dataset.testid = "assistant-interrupt";
  const stopVoice = element("button", "assistant-stop-voice", "Stop voice");
  stopVoice.type = "button";
  stopVoice.dataset.testid = "assistant-stop-voice";
  stopVoice.title = "Stop voice";
  stopVoice.setAttribute("aria-label", "Stop voice");
  const stopIcon = element("i", "ph-bold ph-stop");
  stopIcon.setAttribute("aria-hidden", "true");
  stopVoice.replaceChildren(stopIcon);
  const mute = element("button", "assistant-mute", "Mute");
  mute.type = "button";
  mute.dataset.testid = "assistant-mute";
  mute.setAttribute("aria-pressed", "false");
  voiceControls.append(voiceState, pushToTalk, interrupt, mute);
  voiceControls.hidden = true;
  const transcript = element("div", "assistant-transcript");
  transcript.setAttribute("aria-live", "polite");
  const userTranscript = element("div", "assistant-transcript__user");
  userTranscript.dataset.testid = "assistant-transcript-user";
  const assistantTranscript = element("div", "assistant-transcript__assistant");
  transcript.append(userTranscript, assistantTranscript);
  const status = element("div", "assistant-status");
  const confirmation = element("section", "assistant-confirmation");
  confirmation.hidden = true;
  confirmation.dataset.testid = "assistant-confirmation";
  const results = element("div", "assistant-results");
  panel.append(
    disclosure,
    voiceControls,
    transcript,
    status,
    confirmation,
    results,
  );
  shell.append(open, stopVoice, panel);
  document.body.append(shell);
  const comparisonAreaIds = new Set();
  let voiceMode = "stopped";
  let hasLiveTranscript = false;

  const disclosureAccepted = () => {
    try {
      return localStorage.getItem(VOICE_DISCLOSURE_KEY) === "accepted";
    } catch {
      return false;
    }
  };
  const rememberDisclosure = () => {
    try {
      localStorage.setItem(VOICE_DISCLOSURE_KEY, "accepted");
    } catch {
      // Consent remains valid for this page even when storage is unavailable.
    }
  };

  const setOpen = (visible) => {
    panel.hidden = !visible;
    shell.dataset.expanded = String(visible);
    open.setAttribute("aria-expanded", String(!panel.hidden));
  };
  const startFromPill = () => {
    setOpen(true);
    if (!disclosureAccepted()) {
      shell.dataset.mode = "consent";
      disclosure.hidden = false;
      acceptDisclosure.focus();
      return;
    }
    shell.dataset.mode = "voice";
    disclosure.hidden = true;
    voiceControls.hidden = false;
    onStartVoice?.({ disclosureAccepted: true });
  };
  open.addEventListener("click", () => {
    if (panel.hidden) startFromPill();
    else if (voiceMode === "degraded") startFromPill();
    else if (voiceMode === "stopped" && disclosure.hidden) setOpen(false);
  });
  acceptDisclosure.addEventListener("click", () => {
    rememberDisclosure();
    shell.dataset.mode = "voice";
    disclosure.hidden = true;
    voiceControls.hidden = false;
    onStartVoice?.({ disclosureAccepted: true });
  });
  cancelDisclosure.addEventListener("click", () => {
    shell.dataset.mode = "idle";
    disclosure.hidden = true;
    setOpen(false);
    open.focus();
  });
  stopVoice.addEventListener("click", () => onStopVoice?.("user"));
  pushToTalk.addEventListener("pointerdown", () => onPushToTalkStart?.());
  for (const eventName of ["pointerup", "pointercancel", "pointerleave"])
    pushToTalk.addEventListener(eventName, () => onPushToTalkEnd?.());
  interrupt.addEventListener("click", () => onInterrupt?.());
  mute.addEventListener("click", () => {
    const muted = mute.getAttribute("aria-pressed") !== "true";
    mute.setAttribute("aria-pressed", String(muted));
    mute.textContent = muted ? "Resume voice" : "Mute";
    onToggleMute?.(muted);
  });
  const clearStatus = () => {
    status.replaceChildren();
  };
  const renderStatus = (testId, message) => {
    clearStatus();
    const node = element("p", `assistant-${testId}`, message);
    node.dataset.testid = `assistant-${testId}`;
    status.append(node);
  };

  return Object.freeze({
    root: panel,
    setOpen,
    appendTranscript(role, text) {
      setOpen(true);
      const target = role === "user" ? userTranscript : assistantTranscript;
      if ([...target.children].some((node) => node.textContent === text))
        return;
      target.append(element("p", "", text));
      livePreview.textContent = text;
      hasLiveTranscript = true;
    },
    appendAssistantText(text) {
      setOpen(true);
      const node = element("p", "assistant-response", text);
      assistantTranscript.append(node);
      livePreview.textContent = text;
      hasLiveTranscript = true;
    },
    reconcileTranscript(event) {
      setOpen(true);
      const role =
        event.role === "assistant" || event.type?.startsWith("assistant.")
          ? "assistant"
          : "user";
      const target = role === "user" ? userTranscript : assistantTranscript;
      let node = [...target.children].find(
        (item) => item.dataset.itemId === event.itemId,
      );
      if (!node) {
        node = element("p");
        node.dataset.itemId = event.itemId;
        target.append(node);
      }
      node.textContent = event.text;
      livePreview.textContent = event.text;
      hasLiveTranscript = Boolean(event.text);
      node.dataset.status =
        event.type?.endsWith("final") || event.type?.endsWith("done")
          ? "final"
          : "partial";
    },
    clearSession() {
      userTranscript.replaceChildren();
      assistantTranscript.replaceChildren();
      clearStatus();
      confirmation.replaceChildren();
      confirmation.hidden = true;
      hasLiveTranscript = false;
      livePreview.textContent = "Explore Singapore by voice";
    },
    showConfirmation(record) {
      shell.dataset.mode = "confirmation";
      confirmation.replaceChildren();
      confirmation.hidden = false;
      confirmation.append(
        element("h3", "", "Confirm this action"),
        element("p", "assistant-confirmation__effect", record.effectSummary),
      );
      const accept = element("button", "", "Confirm");
      accept.type = "button";
      accept.dataset.testid = "assistant-confirmation-accept";
      const reject = element("button", "", "Cancel");
      reject.type = "button";
      reject.dataset.testid = "assistant-confirmation-reject";
      accept.addEventListener("click", () =>
        onConfirmation?.(record, "accepted"),
      );
      reject.addEventListener("click", () =>
        onConfirmation?.(record, "rejected"),
      );
      confirmation.append(accept, reject);
      accept.focus();
    },
    clearConfirmation() {
      confirmation.replaceChildren();
      confirmation.hidden = true;
      shell.dataset.mode = voiceMode === "stopped" ? "idle" : "voice";
    },
    renderDiscovery(result) {
      setOpen(true);
      clearStatus();
      results.replaceChildren();
      if (!result.areas.length && result.clarification) {
        const box = element("div", "assistant-clarification");
        box.dataset.testid = "assistant-clarification";
        box.append(element("p", "", result.clarification.question));
        for (const choice of result.clarification.choices || []) {
          const button = element("button", "", choice);
          button.type = "button";
          button.addEventListener("click", () => onClarification?.(choice));
          box.append(button);
        }
        results.append(box);
        return;
      }
      if (!result.areas.length) {
        const empty = element(
          "p",
          "assistant-empty",
          "No reliable match yet. Try refining what matters most.",
        );
        empty.dataset.testid = "assistant-empty";
        results.append(empty);
        return;
      }
      for (const area of result.areas) {
        const card = element("article", "assistant-area-card");
        card.dataset.testid = "assistant-area-card";
        card.dataset.areaId = area.areaId;
        card.append(
          element(
            "h3",
            "",
            area.areaId.replace(/^ura-subzone:/, "").replaceAll("-", " "),
          ),
        );
        for (const reason of area.reasons)
          card.append(element("p", "assistant-area-card__reason", reason.text));
        for (const tradeoff of area.tradeoffs)
          card.append(element("p", "assistant-area-card__tradeoff", tradeoff));
        const select = element("button", "", "Show options");
        select.type = "button";
        select.addEventListener("click", () => onSelectArea?.(area.areaId));
        const compare = element("button", "", "Add to comparison");
        compare.type = "button";
        compare.setAttribute("aria-pressed", "false");
        compare.addEventListener("click", () => {
          const selected = compare.getAttribute("aria-pressed") !== "true";
          compare.setAttribute("aria-pressed", String(selected));
          compare.textContent = selected
            ? "Remove from comparison"
            : "Add to comparison";
          if (selected) comparisonAreaIds.add(area.areaId);
          else comparisonAreaIds.delete(area.areaId);
          if (comparisonAreaIds.size >= 2)
            onCompareAreas?.([...comparisonAreaIds].slice(0, 3));
        });
        const dismiss = element("button", "", "Dismiss area");
        dismiss.type = "button";
        dismiss.addEventListener("click", () => onDismissArea?.(area.areaId));
        card.append(select, compare, dismiss);
        results.append(card);
      }
    },
    showAreaComparison(areas) {
      results
        .querySelector('[data-testid="assistant-area-comparison"]')
        ?.remove();
      const comparison = element("section", "assistant-area-comparison");
      comparison.dataset.testid = "assistant-area-comparison";
      comparison.append(element("h3", "", "Area comparison"));
      for (const area of areas)
        comparison.append(
          element(
            "p",
            "",
            `${area.areaId.replace(/^ura-subzone:/, "").replaceAll("-", " ")}: ${area.reasons?.[0]?.text || "Recommended for this request"}`,
          ),
        );
      results.prepend(comparison);
    },
    removeArea(areaId) {
      results.querySelector(`[data-area-id="${CSS.escape(areaId)}"]`)?.remove();
      comparisonAreaIds.delete(areaId);
    },
    selectArea(areaId, candidates) {
      for (const card of results.querySelectorAll(
        '[data-testid="assistant-area-card"]',
      )) {
        if (card.dataset.areaId === areaId)
          card.setAttribute("aria-current", "true");
        else card.removeAttribute("aria-current");
      }
      results.querySelector('[data-testid="assistant-area-detail"]')?.remove();
      const detail = element("section", "assistant-area-detail");
      detail.dataset.testid = "assistant-area-detail";
      detail.dataset.areaId = areaId;
      detail.append(element("h3", "", "Options in this area"));
      for (const candidate of candidates) {
        const item = element(
          "button",
          "assistant-area-candidate",
          candidate.attributes?.name || candidate.candidateId,
        );
        item.type = "button";
        item.dataset.testid = "assistant-area-candidate";
        item.dataset.candidateId = candidate.candidateId;
        item.addEventListener("click", () =>
          onSelectCandidate?.(candidate.candidateId, areaId),
        );
        detail.append(item);
      }
      results.append(detail);
    },
    showError(message) {
      setOpen(true);
      shell.dataset.mode = "error";
      renderStatus("error", message);
    },
    showLocalFallback() {
      setOpen(true);
      shell.dataset.mode = "error";
      renderStatus(
        "local-fallback",
        "Voice is unavailable right now. Please try again.",
      );
    },
    setVoiceState(state) {
      voiceMode = state;
      if (state === "connecting") clearStatus();
      if (
        ["connecting", "listening", "processing", "speaking", "muted"].includes(
          state,
        )
      )
        shell.dataset.mode = "voice";
      open.dataset.state = state;
      shell.dataset.state = state;
      openTitle.textContent =
        {
          connecting: "Connecting",
          listening: "Listening",
          processing: "Thinking",
          speaking: "Speaking",
          muted: "Paused",
          degraded: "Retry",
          stopped: "Talk",
        }[state] || "Talk";
      open.setAttribute(
        "aria-label",
        {
          connecting: "Amble voice connecting",
          listening: "Amble voice listening",
          processing: "Amble is thinking",
          speaking: "Amble is speaking",
          muted: "Amble voice paused",
          degraded: "Retry Amble voice",
          stopped: "Talk to Amble",
        }[state] || "Talk to Amble",
      );
      if (!hasLiveTranscript)
        livePreview.textContent =
          {
            connecting: "Opening your microphone…",
            listening: "Say what you're in the mood for",
            processing: "Matching places and areas…",
            speaking: "Here's what I found",
            muted: "Tap resume when you're ready",
            degraded: "Voice is unavailable; tap to retry",
            stopped: "Explore Singapore by voice",
          }[state] || "Explore Singapore by voice";
      voiceState.textContent =
        {
          connecting: "Voice connecting",
          listening: "Voice listening",
          processing: "Voice processing",
          speaking: "Voice speaking",
          muted: "Voice muted",
          stopped: "Voice stopped",
          degraded: "Voice unavailable; try again",
        }[state] || `Voice ${state}`;
      if (state === "stopped") {
        shell.dataset.mode = "idle";
        voiceControls.hidden = true;
        disclosure.hidden = true;
        setOpen(false);
      } else {
        setOpen(true);
      }
    },
    destroy() {
      shell.remove();
    },
  });
}
