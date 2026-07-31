import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const PROGRAM = `
import { createEventDiscoveryModel } from "./activity-scenes/events/event-discovery-model.js";
const session = (sessionId, start) => ({
  sessionId,
  schedule: { kind: "exact", start, end: start },
  venueGroupIds: ["venue-group:museum"],
});
const activity = {
  id: "activity:memory-palace",
  activityId: "activity:memory-palace",
  title: "Memory Palace",
  projectedVenueGroupId: "venue-group:museum",
  projectedSessionIds: ["session:26", "session:02"],
  sessions: [
    session("session:26", "2026-07-26T09:00:00+08:00"),
    session("session:02", "2026-08-02T09:00:00+08:00"),
  ],
  venueGroups: [{
    venueGroupId: "venue-group:museum",
    approvedLocationId: "museum",
    label: "National Museum of Singapore",
    sessionIds: ["session:26", "session:02"],
    publicPlacement: "mapped",
    mappingStatus: "approved",
  }],
  sourceOffers: [],
};
const model = createEventDiscoveryModel([{
  id: "museum",
  label: "National Museum of Singapore",
  events: [activity],
}]);
const on27 = model.filter({ dateStart: "2026-07-27", dateEnd: "2026-07-27" });
const on02 = model.filter({ dateStart: "2026-08-02", dateEnd: "2026-08-02" });
process.stdout.write(JSON.stringify({
  on27: on27.events.length,
  on02: on02.events[0]?.matchingSessions.map((item) => item.sessionId),
}));
`;

test("Singapore calendar filtering is invariant across host timezones", () => {
  for (const timezone of ["Asia/Singapore", "UTC", "America/Los_Angeles"]) {
    const child = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", PROGRAM],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, TZ: timezone },
      },
    );
    assert.equal(child.status, 0, `${timezone}: ${child.stderr}`);
    assert.deepEqual(JSON.parse(child.stdout), {
      on27: 0,
      on02: ["session:02"],
    });
  }
});
