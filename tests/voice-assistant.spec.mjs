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
  livePreview: '[data-testid="assistant-live-preview"]',
  pushToTalk: '[data-testid="assistant-push-to-talk"]',
  voiceState: '[data-testid="assistant-voice-state"]',
  transcriptUser: '[data-testid="assistant-transcript-user"]',
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

async function mockRelay(page, { transcript } = {}) {
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
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          sessionId: "session-browser-lifecycle-001",
          protocolVersion: "1.0",
          streamPath:
            "/api/voice/sessions/session-browser-lifecycle-001/stream",
          expiresAt: "2026-07-18T12:05:00.000Z",
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

async function openAssistant(page) {
  await page.goto("/?autoStart&emptyApprovedSnapshot");
  await page.locator(selectors.open).click();
  await expect(page.locator(selectors.open)).toHaveAttribute(
    "aria-expanded",
    "true",
  );
}

async function acceptAndStartVoice(page) {
  await expect(page.locator(selectors.disclosure)).toBeVisible();
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
  expect(await page.evaluate(() => globalThis.__voiceTest.mediaRequests)).toBe(
    0,
  );
  expect(relay.admissionBodies).toHaveLength(0);

  await page.locator(selectors.acceptDisclosure).click();
  await expect.poll(() => relay.admissionBodies.length).toBe(1);
  expect(relay.admissionBodies[0].disclosureAccepted).toBe(true);
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

  await openAssistant(page);

  await expect(page.locator(selectors.disclosure)).toBeHidden();
  await expect(page.locator(selectors.voiceState)).toContainText(/listening/i);
  await expect(page.locator(selectors.open)).toContainText(/listening/i);
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
  const guidanceBounds = await page.locator("#map-guidance").boundingBox();
  expect(
    Math.abs((shellBounds?.width || 0) - (guidanceBounds?.width || 0)),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs((shellBounds?.height || 0) - (guidanceBounds?.height || 0)),
  ).toBeLessThanOrEqual(1);
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

test("permission denial explains the limitation without opening a text chatbot", async ({
  page,
}) => {
  await installMicrophoneMock(page, { denied: true });
  await mockRelay(page);
  await openAssistant(page);

  await acceptAndStartVoice(page);

  await expect(page.locator(selectors.error)).toContainText(
    /microphone|permission/i,
  );
  await expect(
    page.locator('[data-testid="assistant-text-input"]'),
  ).toHaveCount(0);
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
  await expect(
    page.locator('[data-testid="assistant-text-input"]'),
  ).toHaveCount(0);
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
