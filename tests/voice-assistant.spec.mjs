import { expect, test } from "playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    globalThis.__EVENT_PIPELINE_SNAPSHOT__ = {
      pois: [],
      landmarks: [],
      backgroundTilesetUrl: "tests/fixtures/empty-tileset.json",
      poiTilesetUrl: "poi-tiles/event-venues/tileset.json",
    };
  });
});

const selectors = {
  shell: ".assistant-shell",
  open: '[data-testid="assistant-open"]',
  panel: '[data-testid="assistant-panel"]',
  disclosure: '[data-testid="assistant-voice-disclosure"]',
  acceptDisclosure: '[data-testid="assistant-disclosure-accept"]',
  stopVoice: '[data-testid="assistant-stop-voice"]',
  orb: '[data-testid="assistant-voice-orb"]',
  microphone: '[data-testid="assistant-microphone-icon"]',
  livePreview: '[data-testid="assistant-live-preview"]',
  pushToTalk: '[data-testid="assistant-push-to-talk"]',
  interrupt: '[data-testid="assistant-interrupt"]',
  mute: '[data-testid="assistant-mute"]',
  voiceState: '[data-testid="assistant-voice-state"]',
  transcriptUser: '[data-testid="assistant-transcript-user"]',
  transcriptAssistant: ".assistant-transcript__assistant",
  textInput: '[data-testid="assistant-text-input"]',
  textSubmit: '[data-testid="assistant-text-submit"]',
  confirmation: '[data-testid="assistant-confirmation"]',
  confirmationAccept: '[data-testid="assistant-confirmation-accept"]',
  confirmationReject: '[data-testid="assistant-confirmation-reject"]',
  error: '[data-testid="assistant-error"]',
};

const noisySinglishRequest =
  "Can find somewhere shiok near Dhoby Ghaut, not too noisy lah?";

async function installMicrophoneMock(page, { denied = false } = {}) {
  await page.addInitScript(
    ({ shouldDeny }) => {
      const endedListeners = new Set();
      const track = {
        kind: "audio",
        readyState: "live",
        stop() {
          if (this.readyState === "ended") return;
          this.readyState = "ended";
          globalThis.__voiceTest.mediaTrackStops += 1;
          for (const listener of endedListeners)
            listener.call(this, new Event("ended"));
        },
        addEventListener(type, listener) {
          if (type === "ended") endedListeners.add(listener);
        },
        removeEventListener(type, listener) {
          if (type === "ended") endedListeners.delete(listener);
        },
      };
      const stream = {
        active: true,
        getTracks: () => [track],
        getAudioTracks: () => [track],
      };
      globalThis.__voiceTest = {
        mediaRequests: 0,
        mediaTrackStops: 0,
        permissionRevocations: 0,
      };
      globalThis.__revokeVoicePermission = () => {
        globalThis.__voiceTest.permissionRevocations += 1;
        track.stop();
      };
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getUserMedia: async (constraints) => {
            globalThis.__voiceTest.mediaRequests += 1;
            globalThis.__voiceTest.constraints = constraints;
            if (shouldDeny) {
              throw new DOMException(
                "Microphone permission denied",
                "NotAllowedError",
              );
            }
            return stream;
          },
        },
      });
    },
    { shouldDeny: denied },
  );
}

async function mockRelay(
  page,
  { transcript, assistantText, admissionError = null } = {},
) {
  const admissionBodies = [];
  const browserMessages = [];
  const providerUrls = [];
  let browserSocket = null;
  page.on("request", (request) => {
    if (/api\.openai\.com|openai\.com\/v1\/realtime/i.test(request.url())) {
      providerUrls.push(request.url());
    }
  });
  await page.route("**/api/voice/sessions", async (route) => {
    admissionBodies.push(await route.request().postDataJSON());
    if (admissionError) {
      await route.fulfill({
        status: admissionError.status,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          error: {
            code: admissionError.code,
            message: admissionError.message,
          },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          sessionId: "session-browser-lifecycle-001",
          protocolVersion: "1.1",
          streamPath:
            "/api/voice/sessions/session-browser-lifecycle-001/stream",
          expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
          limits: {
            maxSessionSeconds: 300,
            idleSeconds: 60,
            maxResponses: 6,
          },
        },
      }),
    });
  });
  await page.routeWebSocket(
    "**/api/voice/sessions/session-browser-lifecycle-001/stream",
    (socket) => {
      browserSocket = socket;
      socket.send(
        JSON.stringify({ type: "session.state", state: "listening" }),
      );
      if (transcript) {
        socket.send(
          JSON.stringify({
            type: "transcript.delta",
            itemId: "noisy-mrt-item-001",
            role: "user",
            modality: "audio",
            text: "Can find somewhere shiok near Dhoby",
          }),
        );
        socket.send(
          JSON.stringify({
            type: "transcript.final",
            itemId: "noisy-mrt-item-001",
            role: "user",
            modality: "audio",
            text: transcript,
          }),
        );
      }
      if (assistantText) {
        socket.send(
          JSON.stringify({
            type: "assistant.text.delta",
            itemId: "assistant-text-item-001",
            role: "assistant",
            text: assistantText.slice(0, Math.ceil(assistantText.length / 2)),
          }),
        );
        socket.send(
          JSON.stringify({
            type: "assistant.text.done",
            itemId: "assistant-text-item-001",
            role: "assistant",
            text: assistantText,
          }),
        );
      }
      socket.onMessage((raw) => browserMessages.push(JSON.parse(String(raw))));
    },
  );
  return {
    admissionBodies,
    browserMessages,
    providerUrls,
    send(message) {
      browserSocket?.send(JSON.stringify(message));
    },
  };
}

async function openAssistant(page, { beforeOpen } = {}) {
  await page.goto("/?autoStart&emptyApprovedSnapshot");
  await beforeOpen?.();
  await page.locator(selectors.open).click();
  await expect
    .poll(async () => {
      const expanded =
        (await page.locator(selectors.open).getAttribute("aria-expanded")) ===
        "true";
      const state = await page
        .locator(selectors.shell)
        .getAttribute("data-state");
      return (
        expanded ||
        ["connecting", "listening", "processing", "speaking", "muted"].includes(
          state,
        )
      );
    })
    .toBe(true);
}

async function acceptAndStartVoice(page) {
  const disclosure = page.locator(selectors.disclosure);
  if (await disclosure.isVisible())
    await page.locator(selectors.acceptDisclosure).click();
}

test("discloses OpenAI processing and retention before acquiring the microphone", async ({
  page,
}) => {
  await installMicrophoneMock(page);
  const relay = await mockRelay(page);
  await openAssistant(page);

  await expect(page.locator(selectors.disclosure)).toContainText(/OpenAI/i);
  await expect(page.locator(selectors.disclosure)).toContainText(
    /process|provider/i,
  );
  await expect(page.locator(selectors.disclosure)).toContainText(
    /retention|abuse monitoring/i,
  );
  await expect(page.locator(selectors.disclosure)).toContainText(
    /not (?:store|retain)|no application retention/i,
  );
  await expect(page.locator(selectors.acceptDisclosure)).toHaveAttribute(
    "data-control-owner",
    "browser",
  );
  expect(await page.evaluate(() => globalThis.__voiceTest.mediaRequests)).toBe(
    0,
  );
  expect(relay.admissionBodies).toHaveLength(0);

  await page.locator(selectors.acceptDisclosure).click();
  await expect.poll(() => relay.admissionBodies.length).toBe(1);
  expect(relay.admissionBodies[0].disclosureAccepted).toBe(true);
  expect(relay.admissionBodies[0].protocolVersion).toBe("1.1");
  await expect
    .poll(() => page.evaluate(() => globalThis.__voiceTest.mediaRequests))
    .toBe(1);
  expect(relay.providerUrls).toEqual([]);
});

test("returning consent starts voice directly from the expanding pill", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("amble.voice-disclosure.v1", "accepted"),
  );
  await installMicrophoneMock(page);
  const relay = await mockRelay(page);

  await openAssistant(page, {
    beforeOpen: async () => {
      await expect(page.locator(selectors.microphone)).toBeVisible();
      await expect(page.locator(selectors.orb)).toBeHidden();
    },
  });

  await expect(page.locator(selectors.disclosure)).toBeHidden();
  await expect(page.locator(selectors.voiceState)).toContainText(/listening/i);
  await expect(page.locator(selectors.open)).toContainText(/listening/i);
  await expect(page.locator(selectors.microphone)).toBeHidden();
  await expect(page.locator(".landmark-event-search__builder")).toHaveClass(
    /is-assistant-active/,
  );
  await expect(page.locator(selectors.panel)).toBeHidden();
  await expect(page.locator(selectors.stopVoice)).toBeVisible();
  await expect(page.locator(selectors.livePreview)).toBeHidden();
  await expect(page.locator(selectors.shell)).toHaveClass(
    /frosted-control-bar/,
  );
  await expect(page.locator("#map-guidance")).toHaveClass(
    /frosted-control-bar/,
  );
  const shellBounds = await page.locator(selectors.shell).boundingBox();
  const builderBounds = await page
    .locator(".landmark-event-search__builder")
    .boundingBox();
  await expect(page.locator(selectors.shell)).toHaveClass(
    /assistant-shell--in-search/,
  );
  expect(shellBounds?.x || 0).toBeGreaterThanOrEqual(builderBounds?.x || 0);
  expect((shellBounds?.x || 0) + (shellBounds?.width || 0)).toBeLessThanOrEqual(
    (builderBounds?.x || 0) + (builderBounds?.width || 0) + 1,
  );
  expect(shellBounds?.height || 0).toBeLessThanOrEqual(
    builderBounds?.height || 0,
  );
  await expect(page.locator(selectors.orb)).toBeVisible();
  await expect(page.locator(selectors.orb)).toHaveAttribute(
    "src",
    /amble-voice-orb\.png$/,
  );
  await expect(page.locator(selectors.livePreview)).toContainText(
    /mood|say|listening/i,
  );
  await expect
    .poll(() =>
      page.locator(selectors.orb).evaluate((node) => {
        const animation = getComputedStyle(node).animationName;
        return animation && animation !== "none";
      }),
    )
    .toBe(true);
  await expect.poll(() => relay.admissionBodies.length).toBe(1);
});

test("speech during playback interrupts Amble and becomes the next voice turn", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("amble.voice-disclosure.v1", "accepted"),
  );
  await installMicrophoneMock(page);
  const relay = await mockRelay(page);
  await openAssistant(page);
  await expect(page.locator(selectors.voiceState)).toContainText(/listening/i);

  relay.send({ type: "session.state", state: "speaking" });
  await expect(page.locator(selectors.voiceState)).toContainText(/speaking/i);

  await page.locator(selectors.pushToTalk).dispatchEvent("pointerdown");
  await expect
    .poll(() =>
      relay.browserMessages.some(
        (message) => message.type === "response.cancel",
      ),
    )
    .toBe(true);

  relay.send({ type: "session.state", state: "listening" });
  await expect
    .poll(() =>
      relay.browserMessages.find((message) => message.type === "turn.request"),
    )
    .toBeTruthy();
  const requestedTurn = relay.browserMessages.find(
    (message) => message.type === "turn.request",
  );
  relay.send({ type: "turn.ready", turnId: requestedTurn.turnId });
  await page.locator(selectors.pushToTalk).dispatchEvent("pointerup");
  await expect
    .poll(() =>
      relay.browserMessages.some(
        (message) =>
          message.type === "audio.commit" &&
          message.turnId === requestedTurn.turnId,
      ),
    )
    .toBe(true);
});

test("permission denial explains the limitation while preserving the same text conversation", async ({
  page,
}) => {
  await installMicrophoneMock(page, { denied: true });
  await mockRelay(page);
  await openAssistant(page);

  await acceptAndStartVoice(page);

  await expect(page.locator(selectors.error)).toContainText(
    /microphone|permission/i,
  );
  await expect(page.locator(selectors.textInput)).toBeVisible();
  await expect(page.locator(selectors.textInput)).toHaveAttribute(
    "aria-label",
    "Message Amble",
  );
});

test("permission revocation stops capture and keeps the voice pill retryable", async ({
  page,
}) => {
  await installMicrophoneMock(page);
  const relay = await mockRelay(page);
  await openAssistant(page);
  await acceptAndStartVoice(page);
  await expect(page.locator(selectors.voiceState)).toContainText(/listening/i);

  await page.evaluate(() => globalThis.__revokeVoicePermission());

  await expect(page.locator(selectors.error)).toContainText(
    /microphone|permission/i,
  );
  await expect(page.locator(selectors.textInput)).toBeVisible();
  await expect
    .poll(() =>
      relay.browserMessages.some(
        (message) =>
          message.type === "session.stop" &&
          (!message.reason || message.reason === "permission"),
      ),
    )
    .toBe(true);
  expect(
    await page.evaluate(() => globalThis.__voiceTest.mediaTrackStops),
  ).toBe(1);
});

test("reconciles a noisy MRT Singlish place-name voice transcript", async ({
  page,
}) => {
  await installMicrophoneMock(page);
  const relay = await mockRelay(page, { transcript: noisySinglishRequest });
  await openAssistant(page);
  await acceptAndStartVoice(page);

  const userTranscript = page.locator(selectors.transcriptUser);
  await expect(userTranscript).toContainText(noisySinglishRequest);
  await expect(
    userTranscript.getByText(noisySinglishRequest, { exact: true }),
  ).toHaveCount(1);
  await expect(page.locator(selectors.livePreview)).toHaveText(
    noisySinglishRequest,
  );

  expect(relay.providerUrls).toEqual([]);
});

test("an obvious spoken zoom command executes through the application gateway", async ({
  page,
}) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await installMicrophoneMock(page);
  const relay = await mockRelay(page);
  await openAssistant(page);
  await acceptAndStartVoice(page);
  await expect(page.locator(selectors.voiceState)).toContainText(/listening/i);
  const before = await page.evaluate(() => globalThis._map.getZoom());

  relay.send({
    type: "transcript.final",
    itemId: "deterministic-zoom-item",
    role: "user",
    modality: "audio",
    text: "zoom in",
  });

  await expect(page.locator(selectors.transcriptUser)).toContainText("zoom in");
  await expect
    .poll(() => page.evaluate(() => globalThis._map.getZoom()))
    .toBeGreaterThan(before);
  await expect
    .poll(() =>
      relay.browserMessages.some(
        (message) =>
          message.type === "deterministic.result" &&
          message.capabilityId === "map.zoomin" &&
          message.result.status === "completed",
      ),
    )
    .toBe(true);
  expect(pageErrors).toEqual([]);
});

test("voice transcript, assistant text, and typed text remain one continuous conversation", async ({
  page,
}) => {
  const assistantReply = "I can keep this conversation going by voice or text.";
  await installMicrophoneMock(page);
  const relay = await mockRelay(page, {
    transcript: noisySinglishRequest,
    assistantText: assistantReply,
  });
  await openAssistant(page);
  await acceptAndStartVoice(page);

  await expect(page.locator(selectors.transcriptUser)).toContainText(
    noisySinglishRequest,
  );
  await expect(page.locator(selectors.transcriptAssistant)).toContainText(
    assistantReply,
  );
  await page.locator(selectors.open).click();
  await expect(page.locator(selectors.textInput)).toBeVisible();
  await page.locator(selectors.textInput).fill("Show me the quieter option");
  await page.locator(selectors.textSubmit).click();

  await expect
    .poll(() =>
      relay.browserMessages.find(
        (message) =>
          message.type === "text.submit" &&
          message.text === "Show me the quieter option",
      ),
    )
    .toBeTruthy();
  await expect(page.locator(selectors.transcriptUser)).toContainText(
    noisySinglishRequest,
  );
  await expect(page.locator(selectors.transcriptUser)).toContainText(
    "Show me the quieter option",
  );
  await expect(page.locator(selectors.transcriptAssistant)).toContainText(
    assistantReply,
  );
});

test("push-to-talk, mute, interrupt, and stop stay explicit browser-owned controls", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("amble.voice-disclosure.v1", "accepted"),
  );
  await installMicrophoneMock(page);
  const relay = await mockRelay(page, { transcript: noisySinglishRequest });
  await openAssistant(page);
  await expect(page.locator(selectors.voiceState)).toContainText(/listening/i);
  await page.locator(selectors.open).click();

  for (const selector of [
    selectors.pushToTalk,
    selectors.mute,
    selectors.interrupt,
    selectors.stopVoice,
  ])
    await expect(page.locator(selector)).toHaveAttribute(
      "data-control-owner",
      "browser",
    );

  await page.locator(selectors.mute).click();
  await expect(page.locator(selectors.mute)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(selectors.voiceState)).toContainText(/muted/i);
  await page.locator(selectors.mute).click();
  await expect(page.locator(selectors.mute)).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  relay.send({ type: "session.state", state: "speaking" });
  await expect(page.locator(selectors.voiceState)).toContainText(/speaking/i);
  await page.locator(selectors.interrupt).click();
  await expect
    .poll(() =>
      relay.browserMessages.some(
        (message) => message.type === "response.cancel",
      ),
    )
    .toBe(true);
  expect(
    relay.browserMessages.some((message) =>
      ["capability.proposed", "capability.result"].includes(message.type),
    ),
  ).toBe(false);

  await page.locator(selectors.stopVoice).click();
  await expect
    .poll(() =>
      relay.browserMessages.some((message) => message.type === "session.stop"),
    )
    .toBe(true);
  await expect(page.locator(selectors.transcriptUser)).toBeEmpty();
  await expect(page.locator(selectors.open)).toHaveAttribute(
    "aria-expanded",
    "false",
  );
});

test("confirmation identity can be resolved once only by its browser-owned buttons", async ({
  page,
}) => {
  await page.goto("/?autoStart&emptyApprovedSnapshot");
  await page.evaluate(async () => {
    const { createAssistantView } =
      await import("/activity-scenes/assistant/assistant-view.js");
    globalThis.__confirmationChoices = [];
    const view = createAssistantView({
      onConfirmation(record, decision) {
        globalThis.__confirmationChoices.push({
          callId: record.callId,
          confirmationId: record.confirmationId,
          fingerprint: record.fingerprint,
          decision,
        });
      },
    });
    view.root.closest(".assistant-shell").dataset.confirmationHarness = "true";
    view.showConfirmation({
      callId: "call-browser-confirmation",
      confirmationId: "confirmation-browser-1",
      fingerprint: "sha256:browser-confirmation-1",
      effectSummary: "Open the approved official event page.",
    });
  });
  const harness = page.locator('[data-confirmation-harness="true"]');
  const accept = harness.locator(selectors.confirmationAccept);
  const reject = harness.locator(selectors.confirmationReject);
  await expect(harness.locator(selectors.confirmation)).toBeVisible();
  await expect(accept).toHaveAttribute("data-control-owner", "browser");
  await expect(reject).toHaveAttribute("data-control-owner", "browser");

  await accept.click();
  await expect(accept).toBeDisabled();
  await expect(reject).toBeDisabled();
  expect(await page.evaluate(() => globalThis.__confirmationChoices)).toEqual([
    {
      callId: "call-browser-confirmation",
      confirmationId: "confirmation-browser-1",
      fingerprint: "sha256:browser-confirmation-1",
      decision: "accepted",
    },
  ]);
});

for (const admissionFailure of [
  {
    name: "cumulative cap",
    code: "usage_limit",
    status: 429,
    message: "Voice service is currently unavailable. Please try again later.",
  },
  {
    name: "kill switch",
    code: "voice_disabled",
    status: 503,
    message: "Voice service is currently unavailable. Please try again later.",
  },
]) {
  test(`${admissionFailure.name} fails closed before microphone capture and preserves text access`, async ({
    page,
  }) => {
    await installMicrophoneMock(page);
    const relay = await mockRelay(page, {
      admissionError: admissionFailure,
    });
    await openAssistant(page);
    await acceptAndStartVoice(page);

    await expect(page.locator(selectors.error)).toContainText(
      admissionFailure.message,
    );
    await expect(page.locator(selectors.textInput)).toBeVisible();
    expect(
      await page.evaluate(() => globalThis.__voiceTest.mediaRequests),
    ).toBe(0);
    expect(relay.admissionBodies).toHaveLength(1);
    expect(relay.browserMessages).toHaveLength(0);
  });
}

for (const terminalReason of ["usage_limit", "disabled"]) {
  test(`${terminalReason} terminal event clears capture and session content`, async ({
    page,
  }) => {
    await installMicrophoneMock(page);
    const relay = await mockRelay(page);
    await openAssistant(page);
    await acceptAndStartVoice(page);
    await expect(page.locator(selectors.voiceState)).toContainText(
      /listening/i,
    );
    relay.send({
      type: "transcript.final",
      itemId: `terminal-${terminalReason}-item`,
      role: "user",
      modality: "audio",
      text: noisySinglishRequest,
    });
    await expect(page.locator(selectors.transcriptUser)).toContainText(
      noisySinglishRequest,
    );

    relay.send({ type: "session.stopped", reason: terminalReason });

    await expect(page.locator(selectors.transcriptUser)).toBeEmpty();
    await expect(page.locator(selectors.open)).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(
      await page.evaluate(() => globalThis.__voiceTest.mediaTrackStops),
    ).toBe(1);
    expect(await page.locator(selectors.textInput).inputValue()).toBe("");
  });
}

test("pagehide stops media and removes session-scoped transcript state", async ({
  page,
}) => {
  await installMicrophoneMock(page);
  const relay = await mockRelay(page, { transcript: noisySinglishRequest });
  await openAssistant(page);
  await acceptAndStartVoice(page);
  await expect(page.locator(selectors.transcriptUser)).toContainText(
    noisySinglishRequest,
  );

  await page.evaluate(() =>
    window.dispatchEvent(
      new PageTransitionEvent("pagehide", { persisted: false }),
    ),
  );

  await expect
    .poll(() =>
      relay.browserMessages.some(
        (message) =>
          message.type === "session.stop" &&
          (!message.reason || message.reason === "pagehide"),
      ),
    )
    .toBe(true);
  expect(
    await page.evaluate(() => globalThis.__voiceTest.mediaTrackStops),
  ).toBe(1);
  await expect(page.locator(selectors.transcriptUser)).toBeEmpty();
});
