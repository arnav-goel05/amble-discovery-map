import "@phosphor-icons/web/bold";

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

const VOICE_DISCLOSURE_KEY = "amble.voice-disclosure.v1";

export function createAssistantView({
  voiceUiEnabled = true,
  onStartVoice,
  onStopVoice,
  onInterrupt,
  onConfirmation,
  onSelectArea,
  onCompareAreas,
  onDismissArea,
  onSelectCandidate,
  onClarification,
  executeCapability = null,
} = {}) {
  const subscribers = new Set();
  const open = element("button", "assistant-open");
  open.type = "button";
  open.dataset.testid = "assistant-open";
  open.setAttribute("aria-expanded", "false");
  open.setAttribute("aria-label", "Speak to Amble");
  const voiceDots = element("span", "assistant-voice-dots");
  voiceDots.dataset.testid = "assistant-voice-dots";
  voiceDots.setAttribute("aria-hidden", "true");
  for (let index = 0; index < 3; index += 1)
    voiceDots.append(element("span", "assistant-voice-dot"));
  const openCopy = element("span", "assistant-open__copy");
  const openTitle = element("span", "assistant-open__title", "Speak to Amble");
  const livePreview = element(
    "span",
    "assistant-open__preview",
    "Explore Singapore by voice",
  );
  livePreview.dataset.testid = "assistant-live-preview";
  openCopy.append(openTitle, livePreview);
  const microphone = element("span", "assistant-microphone-icon");
  microphone.dataset.testid = "assistant-microphone-icon";
  microphone.setAttribute("aria-hidden", "true");
  microphone.append(element("i", "ph-bold ph-microphone"));
  open.append(microphone, voiceDots, openCopy);

  const shell = element("div", "assistant-shell frosted-control-bar");
  shell.hidden = !voiceUiEnabled;
  shell.dataset.voiceUiEnabled = String(voiceUiEnabled);
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
  const voiceState = element("span", "assistant-voice-state", "Voice stopped");
  voiceState.dataset.testid = "assistant-voice-state";
  voiceState.setAttribute("aria-live", "polite");
  voiceState.hidden = true;
  const interrupt = element("button", "assistant-interrupt");
  interrupt.type = "button";
  interrupt.dataset.testid = "assistant-interrupt";
  interrupt.dataset.controlOwner = "browser";
  interrupt.title = "Interrupt and speak";
  interrupt.setAttribute("aria-label", "Interrupt Amble and speak");
  const interruptIcon = element("i", "ph-bold ph-hand-palm");
  interruptIcon.setAttribute("aria-hidden", "true");
  interrupt.replaceChildren(interruptIcon);
  const stopVoice = element("button", "assistant-stop-voice", "Stop voice");
  stopVoice.type = "button";
  stopVoice.dataset.testid = "assistant-stop-voice";
  stopVoice.dataset.controlOwner = "browser";
  stopVoice.title = "Stop voice";
  stopVoice.setAttribute("aria-label", "Stop voice");
  const stopIcon = element("i", "ph-bold ph-stop");
  stopIcon.setAttribute("aria-hidden", "true");
  stopVoice.replaceChildren(stopIcon);
  const transcript = element("div", "assistant-transcript");
  transcript.hidden = true;
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
    voiceState,
    transcript,
    status,
    confirmation,
    results,
  );
  shell.append(open, interrupt, stopVoice, panel);
  const searchBuilder = document.querySelector(
    "#landmark-event-search .landmark-event-search__builder",
  );
  if (searchBuilder) {
    shell.classList.add("assistant-shell--in-search");
    shell.dataset.placement = "search";
    searchBuilder.append(shell);
  } else {
    document.body.append(shell);
  }
  const comparisonAreaIds = new Set();
  let voiceMode = "stopped";
  let hasLiveTranscript = false;
  let disclosureTimer = null;
  const activeVoiceModes = new Set([
    "connecting",
    "listening",
    "processing",
    "speaking",
    "muted",
  ]);

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

  const syncOpenControlOwnership = () => {
    if (!activeVoiceModes.has(voiceMode)) {
      delete open.dataset.capabilityId;
      open.dataset.controlOwner = "browser";
      return;
    }
    delete open.dataset.controlOwner;
    open.dataset.capabilityId = panel.hidden
      ? "navigation.openassistant"
      : "navigation.closeassistant";
  };
  const setOpen = (visible) => {
    if (!voiceUiEnabled) return false;
    const nextVisible = visible === true;
    if (panel.hidden === !nextVisible) {
      syncOpenControlOwnership();
      return false;
    }
    panel.hidden = !nextVisible;
    shell.dataset.expanded = String(nextVisible);
    open.setAttribute("aria-expanded", String(!panel.hidden));
    syncOpenControlOwnership();
    const snapshot = Object.freeze({
      assistantOpen: !panel.hidden,
      activeOverlayId: panel.hidden ? null : "assistant",
    });
    for (const subscriber of subscribers) subscriber(snapshot);
    return true;
  };
  const executeAssistantVisibility = (visible) => {
    if (panel.hidden === !visible) return setOpen(visible);
    const capabilityId = visible
      ? "navigation.openassistant"
      : "navigation.closeassistant";
    if (typeof executeCapability === "function")
      return executeCapability(capabilityId, {});
    return setOpen(visible);
  };
  const startFromPill = () => {
    if (!voiceUiEnabled) return false;
    setOpen(true);
    const isFirstUse = !disclosureAccepted();
    if (isFirstUse) {
      rememberDisclosure();
      shell.dataset.mode = "notice";
      disclosure.hidden = false;
      clearTimeout(disclosureTimer);
      disclosureTimer = setTimeout(() => {
        disclosure.hidden = true;
        if (activeVoiceModes.has(voiceMode)) shell.dataset.mode = "voice";
      }, 4_000);
    } else {
      shell.dataset.mode = "voice";
      disclosure.hidden = true;
    }
    onStartVoice?.({ disclosureAccepted: true });
    return true;
  };
  open.addEventListener("click", () => {
    if (!voiceUiEnabled) return;
    if (activeVoiceModes.has(voiceMode)) {
      shell.dataset.mode =
        shell.dataset.mode === "voice" || panel.hidden ? "results" : "voice";
      void executeAssistantVisibility(shell.dataset.mode !== "voice");
    } else if (panel.hidden) startFromPill();
    else if (voiceMode === "degraded") startFromPill();
    else if (voiceMode === "stopped" && disclosure.hidden)
      void executeAssistantVisibility(false);
  });
  stopVoice.addEventListener("click", () => onStopVoice?.("user"));
  interrupt.addEventListener("click", () => onInterrupt?.());
  const clearStatus = () => {
    status.replaceChildren();
  };
  const renderStatus = (testId, message) => {
    clearStatus();
    const node = element("p", `assistant-${testId}`, message);
    node.dataset.testid = `assistant-${testId}`;
    status.append(node);
  };
  const resetSessionContent = () => {
    userTranscript.replaceChildren();
    assistantTranscript.replaceChildren();
    results.replaceChildren();
    clearStatus();
    confirmation.replaceChildren();
    confirmation.hidden = true;
    confirmation.removeAttribute("aria-busy");
    comparisonAreaIds.clear();
    clearTimeout(disclosureTimer);
    disclosureTimer = null;
    hasLiveTranscript = false;
    livePreview.textContent = "Explore Singapore by voice";
  };
  syncOpenControlOwnership();
  const snapshot = () =>
    Object.freeze({
      assistantOpen: voiceUiEnabled && !panel.hidden,
      activeOverlayId: voiceUiEnabled && !panel.hidden ? "assistant" : null,
    });

  return Object.freeze({
    root: panel,
    dispatch(capabilityId, args = {}) {
      if (capabilityId === "navigation.openassistant") return setOpen(true);
      if (capabilityId === "navigation.closeassistant") return setOpen(false);
      if (
        capabilityId === "navigation.closeoverlay" &&
        (!args.overlayId || args.overlayId === "assistant")
      )
        return setOpen(false);
      return false;
    },
    setOpen,
    snapshot,
    subscribe(subscriber, { emitCurrent = false } = {}) {
      if (typeof subscriber !== "function")
        throw new TypeError("Assistant view subscriber must be a function");
      subscribers.add(subscriber);
      if (emitCurrent) subscriber(snapshot());
      return () => subscribers.delete(subscriber);
    },
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
      resetSessionContent();
    },
    showConfirmation(record) {
      const protectedRecord = Object.freeze(structuredClone(record));
      setOpen(true);
      shell.dataset.mode = "confirmation";
      confirmation.replaceChildren();
      confirmation.hidden = false;
      confirmation.append(
        element("h3", "", "Confirm this action"),
        element(
          "p",
          "assistant-confirmation__effect",
          protectedRecord.effectSummary,
        ),
      );
      const accept = element("button", "", "Confirm");
      accept.type = "button";
      accept.dataset.testid = "assistant-confirmation-accept";
      accept.dataset.controlOwner = "browser";
      const reject = element("button", "", "Cancel");
      reject.type = "button";
      reject.dataset.testid = "assistant-confirmation-reject";
      reject.dataset.controlOwner = "browser";
      const resolve = (decision) => {
        if (accept.disabled || reject.disabled) return;
        accept.disabled = true;
        reject.disabled = true;
        confirmation.setAttribute("aria-busy", "true");
        onConfirmation?.(protectedRecord, decision);
      };
      accept.addEventListener("click", () => resolve("accepted"));
      reject.addEventListener("click", () => resolve("rejected"));
      confirmation.append(accept, reject);
      accept.focus();
    },
    clearConfirmation() {
      confirmation.replaceChildren();
      confirmation.hidden = true;
      confirmation.removeAttribute("aria-busy");
      shell.dataset.mode = voiceMode === "stopped" ? "idle" : "voice";
    },
    renderDiscovery(result) {
      setOpen(true);
      shell.dataset.mode = "results";
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
    showVoiceUnavailable() {
      setOpen(true);
      shell.dataset.mode = "error";
      renderStatus(
        "error",
        "Voice service is currently unavailable. Please try again later.",
      );
    },
    setVoiceState(state) {
      voiceMode = state;
      const active = [
        "connecting",
        "listening",
        "processing",
        "speaking",
        "muted",
      ].includes(state);
      shell.classList.toggle("is-voice-active", active);
      searchBuilder?.classList.toggle("is-assistant-active", active);
      interrupt.disabled = !["processing", "speaking"].includes(state);
      stopVoice.disabled = !active;
      if (state === "connecting") clearStatus();
      if (
        ["connecting", "listening", "processing", "speaking", "muted"].includes(
          state,
        ) &&
        shell.dataset.mode !== "results" &&
        disclosure.hidden
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
          stopped: "Speak to Amble",
        }[state] || "Speak to Amble";
      open.setAttribute(
        "aria-label",
        {
          connecting: "Amble voice connecting",
          listening: "Amble voice listening",
          processing: "Amble is thinking",
          speaking: "Amble is speaking",
          muted: "Amble voice paused",
          degraded: "Retry Amble voice",
          stopped: "Speak to Amble",
        }[state] || "Speak to Amble",
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
        resetSessionContent();
        shell.dataset.mode = "idle";
        disclosure.hidden = true;
        setOpen(false);
      } else {
        setOpen(true);
      }
    },
    destroy() {
      clearTimeout(disclosureTimer);
      subscribers.clear();
      searchBuilder?.classList.remove("is-assistant-active");
      shell.remove();
    },
  });
}
