import assert from "node:assert/strict";
import test from "node:test";

import {
  DiscoveryAreaConnectorError,
  createDiscoveryAreaConnector,
} from "../activity-scenes/assistant/connectors/discovery-area-connector.js";

const areas = [
  {
    areaId: "ura-subzone:marina-south",
    rank: 1,
    confidence: 0.91,
    reasons: [
      {
        text: "A calm waterfront option.",
        candidateIds: ["venue:gardens"],
        attributeKeys: ["pace", "setting"],
      },
    ],
    tradeoffs: ["Crowd levels are not supplied."],
    candidateIds: ["venue:gardens"],
  },
  {
    areaId: "ura-subzone:city-hall",
    rank: 2,
    confidence: 0.72,
    reasons: [
      {
        text: "Arts and waterfront options.",
        candidateIds: ["venue:gallery"],
        attributeKeys: ["setting"],
      },
    ],
    tradeoffs: ["This option is livelier."],
    candidateIds: ["venue:gallery"],
  },
];

function ownerFixture(initialAreas = areas) {
  let revision = 4;
  let selectedAreaId = null;
  let comparedAreaIds = [];
  let currentAreas = structuredClone(initialAreas);
  const listeners = new Set();
  const calls = [];
  const publish = (change = {}) => {
    const snapshot = {
      revision,
      selectedAreaId,
      comparedAreaIds,
      areas: structuredClone(currentAreas),
    };
    for (const listener of listeners) listener(snapshot, change);
  };

  return {
    calls,
    snapshot: () => ({
      revision,
      selectedAreaId,
      comparedAreaIds,
      areas: structuredClone(currentAreas),
    }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    handleAction(actionId, argumentsValue) {
      calls.push([actionId, structuredClone(argumentsValue)]);
      if (actionId === "map.openarea" || actionId === "map.selectarea") {
        const area = currentAreas.find(
          ({ areaId }) => areaId === argumentsValue.areaId,
        );
        if (!area) return null;
        selectedAreaId = area.areaId;
        revision += 1;
        publish();
        return { area: structuredClone(area), candidates: [], revision };
      }
      if (actionId === "map.compareareas") {
        const comparison = argumentsValue.areaIds
          .map((areaId) => currentAreas.find((area) => area.areaId === areaId))
          .filter(Boolean);
        if (comparison.length !== argumentsValue.areaIds.length)
          return comparison;
        comparedAreaIds = [...argumentsValue.areaIds];
        revision += 1;
        publish();
        return structuredClone(comparison);
      }
      if (actionId === "map.dismissarea") {
        if (
          !currentAreas.some(({ areaId }) => areaId === argumentsValue.areaId)
        )
          return false;
        currentAreas = currentAreas.filter(
          ({ areaId }) => areaId !== argumentsValue.areaId,
        );
        selectedAreaId =
          selectedAreaId === argumentsValue.areaId ? null : selectedAreaId;
        comparedAreaIds = comparedAreaIds.filter(
          (areaId) => areaId !== argumentsValue.areaId,
        );
        revision += 1;
        publish({ removedAreaIds: [argumentsValue.areaId] });
        return true;
      }
      return null;
    },
    reconcile(nextAreas) {
      const nextIds = new Set(nextAreas.map(({ areaId }) => areaId));
      const removedAreaIds = currentAreas
        .map(({ areaId }) => areaId)
        .filter((areaId) => !nextIds.has(areaId));
      currentAreas = structuredClone(nextAreas);
      if (!nextIds.has(selectedAreaId)) selectedAreaId = null;
      comparedAreaIds = comparedAreaIds.filter((areaId) => nextIds.has(areaId));
      revision += 1;
      publish({ removedAreaIds });
    },
  };
}

test("connector exposes a bounded approved-area snapshot and contextual eligibility", () => {
  const owner = ownerFixture([
    ...areas,
    ...Array.from({ length: 8 }, (_, index) => ({
      ...areas[0],
      areaId: `ura-subzone:extra-${index}`,
      rank: index + 3,
    })),
  ]);
  const connector = createDiscoveryAreaConnector({
    areaController: owner,
  });

  const snapshot = connector.snapshot();
  assert.equal(connector.connectorId, "discovery-areas");
  assert.deepEqual(connector.capabilityIds, [
    "map.openarea",
    "map.selectarea",
    "map.compareareas",
    "map.dismissarea",
  ]);
  assert.equal(connector.availability(), "available");
  assert.equal(snapshot.areas.length, 5);
  assert.equal(snapshot.visibleTargets.length, 5);
  assert.deepEqual(snapshot.availableCapabilityIds, connector.capabilityIds);
  assert.equal(
    connector.isEligible("map.openarea", {
      areaId: "ura-subzone:marina-south",
    }),
    true,
  );
  assert.equal(
    connector.isEligible("map.openarea", {
      areaId: "ura-subzone:not-visible",
    }),
    false,
  );
  assert.equal(
    connector.isEligible("map.compareareas", {
      areaIds: ["ura-subzone:marina-south", "ura-subzone:city-hall"],
    }),
    true,
  );
  assert.equal(
    connector.isEligible("map.compareareas", {
      areaIds: ["ura-subzone:marina-south", "ura-subzone:not-visible"],
    }),
    false,
  );
});

test("area commands delegate once to the owner and return observable outcomes", async () => {
  const owner = ownerFixture();
  const connector = createDiscoveryAreaConnector({
    areaController: owner,
  });

  const opened = await connector.execute("map.openarea", {
    areaId: "ura-subzone:marina-south",
  });
  assert.deepEqual(owner.calls[0], [
    "map.openarea",
    { areaId: "ura-subzone:marina-south" },
  ]);
  assert.equal(opened.changed, true);
  assert.deepEqual(opened.affectedTargetIds, ["ura-subzone:marina-south"]);
  assert.equal(
    opened.data.contextPatch.focusedTargetId,
    "ura-subzone:marina-south",
  );
  assert.deepEqual(opened.data.contextPatch.selectedTargetIds, [
    "ura-subzone:marina-south",
  ]);

  const compared = await connector.execute("map.compareareas", {
    areaIds: ["ura-subzone:marina-south", "ura-subzone:city-hall"],
  });
  assert.equal(compared.changed, true);
  assert.deepEqual(compared.affectedTargetIds, [
    "ura-subzone:marina-south",
    "ura-subzone:city-hall",
  ]);
  assert.deepEqual(compared.data.comparedAreaIds, [
    "ura-subzone:marina-south",
    "ura-subzone:city-hall",
  ]);

  const dismissed = await connector.execute("map.dismissarea", {
    areaId: "ura-subzone:marina-south",
  });
  assert.equal(dismissed.changed, true);
  assert.deepEqual(dismissed.data.removedAreaIds, ["ura-subzone:marina-south"]);
  assert.equal(
    dismissed.data.contextPatch.visibleTargets.some(
      ({ targetId }) => targetId === "ura-subzone:marina-south",
    ),
    false,
  );
});

test("unknown and stale area identities fail before owner invocation", async () => {
  const owner = ownerFixture();
  const connector = createDiscoveryAreaConnector({
    areaController: owner,
  });

  for (const [capabilityId, argumentsValue] of [
    ["map.selectarea", { areaId: "ura-subzone:missing" }],
    [
      "map.compareareas",
      {
        areaIds: ["ura-subzone:marina-south", "ura-subzone:missing"],
      },
    ],
    ["map.dismissarea", { areaId: "not a stable area id" }],
  ]) {
    await assert.rejects(
      connector.execute(capabilityId, argumentsValue),
      (error) =>
        error instanceof DiscoveryAreaConnectorError &&
        error.code === "area_target_unavailable",
    );
  }
  assert.deepEqual(owner.calls, []);
});

test("subscriptions publish owner reconciliations with stale selections removed", () => {
  const owner = ownerFixture();
  const connector = createDiscoveryAreaConnector({
    areaController: owner,
  });
  const snapshots = [];
  const unsubscribe = connector.subscribe((snapshot) =>
    snapshots.push(snapshot),
  );

  owner.handleAction("map.openarea", {
    areaId: "ura-subzone:marina-south",
  });
  owner.reconcile([areas[1]]);

  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[0].selectedAreaId, "ura-subzone:marina-south");
  assert.equal(snapshots[1].selectedAreaId, null);
  assert.deepEqual(snapshots[1].selectedTargetIds, []);
  assert.deepEqual(
    snapshots[1].visibleTargets.map(({ targetId }) => targetId),
    ["ura-subzone:city-hall"],
  );
  assert.equal(unsubscribe(), true);
});

test("direct and assistant calls share the same executor and observable state", async () => {
  const owner = ownerFixture();
  const connector = createDiscoveryAreaConnector({
    areaController: owner,
  });

  const direct = await connector.execute(
    "map.selectarea",
    { areaId: "ura-subzone:city-hall" },
    {},
    { source: "direct" },
  );
  owner.handleAction("map.dismissarea", {
    areaId: "ura-subzone:city-hall",
  });
  owner.reconcile(areas);
  const assistant = await connector.execute(
    "map.selectarea",
    { areaId: "ura-subzone:city-hall" },
    {},
    { source: "assistant" },
  );

  assert.deepEqual(direct, assistant);
});

test("an empty owner is not advertised", () => {
  const connector = createDiscoveryAreaConnector({
    areaController: ownerFixture([]),
  });

  assert.equal(connector.availability(), "empty");
  assert.deepEqual(connector.snapshot().availableCapabilityIds, []);
  assert.equal(
    connector.isEligible("map.openarea", {
      areaId: "ura-subzone:marina-south",
    }),
    false,
  );
});
