import { expect, test } from "playwright/test";

test("diagnostic variants are opt-in, allowlisted, and lifecycle bounded", async ({
  page,
}) => {
  await page.goto("/?autoStart&emptyApprovedSnapshot");
  await expect
    .poll(() =>
      page.evaluate(
        () => typeof globalThis.__applyPerformanceDiagnosticVariant,
      ),
    )
    .toBe("undefined");

  await page.goto(
    "/?autoStart&emptyApprovedSnapshot&performanceDiagnostics=1&performanceVariant=no-background-3d",
  );
  await expect
    .poll(() =>
      page.evaluate(
        () => typeof globalThis.__applyPerformanceDiagnosticVariant,
      ),
    )
    .toBe("function");
  await expect
    .poll(() =>
      page.evaluate(
        () => document.body.dataset.performanceVariantApplied,
      ),
    )
    .toBe("false");
  const result = await page.evaluate(() =>
    globalThis.__applyPerformanceDiagnosticVariant(),
  );
  expect(result.before.backgroundLayerPresent).toBe(true);
  expect(result.after.backgroundLayerPresent).toBe(false);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.body.dataset.performanceVariantApplied,
      ),
    )
    .toBe("true");
});

test("unknown variants never expose a diagnostic mutation control", async ({
  page,
}) => {
  await page.goto(
    "/?autoStart&emptyApprovedSnapshot&performanceDiagnostics=1&performanceVariant=unknown",
  );
  await expect
    .poll(() =>
      page.evaluate(
        () => typeof globalThis.__applyPerformanceDiagnosticVariant,
      ),
    )
    .toBe("undefined");
});
