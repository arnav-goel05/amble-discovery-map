# Browser support evidence

Checked on 2026-07-14 from macOS 26.5.1 (Apple Silicon).

## Repeatable engine coverage

`playwright.config.mjs` defines the required release-gate desktop and mobile projects for
Chromium, WebKit, and Firefox. These engine checks are not claims that a branded browser was
exercised.

## Actual installed browsers

| Platform | Browser | Version | Result |
| --- | --- | --- | --- |
| macOS 26.5.1 | Safari | 26.5 (WebDriver 21624.2.5.11.4) | Not exercised: Safari remote automation is disabled; no result is claimed. |
| macOS 26.5.1 | Google Chrome | — | Not exercised: no local installation. |
| macOS 26.5.1 | Mozilla Firefox | — | Not exercised: no local installation. |
| macOS 26.5.1 | Microsoft Edge | — | Not exercised: no local installation. |
| iOS Simulator 26.5/27.0 | Mobile Safari | iPad mini (26.5) and iPhone 17 Pro (27.0) booted | Not exercised: the captured simulator remained locked/black; no result is claimed. |
| Android Emulator | Chrome, Firefox, Edge | — | Not exercised: no Android emulator or `adb` installation. |

The local production application was additionally inspected through the Codex in-app browser: the `initial` approved snapshot loaded, the combined highlight manager mounted 64 pills, internal warning copy was absent, a complete event panel opened, and an event entered the anonymous plan. This is useful product evidence but is not substituted for any actual branded-browser row above.

These rows are optional supporting evidence and do not block release. Playwright WebKit is
not reported as actual Safari, and Chromium is not reported as Chrome or Edge; the required
compatibility claim is limited to the passing automated engine matrix.

The 2026-07-14 recheck used a real WebDriver session request rather than inferring Safari
availability from installation. Safari returned `session not created` with the explicit
remote-automation setting requirement. Temporary local servers and screenshots used for
the check were stopped or kept outside the repository.
