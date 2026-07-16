import assert from "node:assert/strict";
import test from "node:test";

import { resetSavedMapView } from "../activity-scenes/map-initial-state.js";

test("a normal refresh discards the saved map camera while preserving the query", () => {
  let replacement = null;
  const history = {
    state: { marker: "kept" },
    replaceState(state, title, url) { replacement = { state, title, url }; },
  };
  const reset = resetSavedMapView({
    location: { hash: "#12.8/1.28/103.86/-30/60", pathname: "/", search: "?date=today" },
    history,
  });

  assert.equal(reset, true);
  assert.deepEqual(replacement, { state: history.state, title: "", url: "/?date=today" });
});

test("explicit auto-start fixtures can preserve a requested camera", () => {
  let replaced = false;
  const reset = resetSavedMapView({
    location: { hash: "#17/1.28/103.86/0/60", pathname: "/", search: "?autoStart" },
    history: { replaceState() { replaced = true; } },
    preserve: true,
  });

  assert.equal(reset, false);
  assert.equal(replaced, false);
});
