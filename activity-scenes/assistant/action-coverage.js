import { createActionGateway } from "./action-gateway.js";

const clean = (value) => value.trim().replace(/^`|`$/g, "");
const duplicates = (values) =>
  [
    ...new Set(
      values.filter((value, index) => values.indexOf(value) !== index),
    ),
  ].sort();

export function parsePublicActionInventory(markdown) {
  const entries = [];
  for (const line of String(markdown).split(/\r?\n/)) {
    if (!/^\|\s*`[a-z]/.test(line)) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length !== 7) continue;
    const contextMatch = cells[3].match(/^(.*?)\s*\/\s*`([^`]+)`$/);
    if (!contextMatch) continue;
    entries.push({
      actionId: clean(cells[0]),
      release: cells[1],
      arguments: clean(cells[2]),
      eligibleState: contextMatch[1].trim(),
      contextProvider: contextMatch[2],
      confirmationClass: cells[4],
      result: cells[5],
      directControlOwner: cells[6],
    });
  }
  return entries;
}

export function verifyRegistryInventoryCoverage({
  inventory = [],
  registry,
  parityCases = [],
} = {}) {
  const inventoryIds = inventory.map(({ actionId }) => actionId);
  const registryIds = registry?.ids?.() || [];
  const parityIds = parityCases.map(({ actionId }) => actionId);
  const inventorySet = new Set(inventoryIds);
  const registrySet = new Set(registryIds);
  const paritySet = new Set(parityIds);
  const report = {
    inventoryCount: inventoryIds.length,
    registryCount: registryIds.length,
    parityCaseCount: parityIds.length,
    missingRegistryIds: [...inventorySet]
      .filter((id) => !registrySet.has(id))
      .sort(),
    unlistedRegistryIds: [...registrySet]
      .filter((id) => !inventorySet.has(id))
      .sort(),
    missingParityIds: [...new Set([...inventorySet, ...registrySet])]
      .filter((id) => !paritySet.has(id))
      .sort(),
    unlistedParityIds: [...paritySet]
      .filter((id) => !inventorySet.has(id))
      .sort(),
    duplicateInventoryIds: duplicates(inventoryIds),
    duplicateParityIds: duplicates(parityIds),
  };
  report.complete = Object.entries(report)
    .filter(([key]) => key.endsWith("Ids"))
    .every(([, value]) => value.length === 0);
  return report;
}

export async function verifyDirectVoiceParity({
  registry,
  parityCases = [],
} = {}) {
  const gateway = createActionGateway({ registry });
  const checkedActionIds = [];
  const failedActionIds = [];
  const missingActionIds = [];
  const failures = [];
  for (const parityCase of parityCases) {
    let direct;
    let voice;
    try {
      registry.get(parityCase.actionId);
      direct = await gateway.execute(
        parityCase.actionId,
        structuredClone(parityCase.argumentsValue),
        structuredClone(parityCase.context),
        { source: "direct" },
      );
      voice = await gateway.execute(
        parityCase.actionId,
        structuredClone(parityCase.argumentsValue),
        structuredClone(parityCase.context),
        { source: "voice" },
      );
      checkedActionIds.push(parityCase.actionId);
      if (JSON.stringify(direct) !== JSON.stringify(voice)) {
        failedActionIds.push(parityCase.actionId);
        failures.push({ actionId: parityCase.actionId, direct, voice });
      }
    } catch (error) {
      if (error?.code === "unknown_action")
        missingActionIds.push(parityCase.actionId);
      else {
        failedActionIds.push(parityCase.actionId);
        failures.push({
          actionId: parityCase.actionId,
          direct: direct ?? { error: error?.code || error?.message },
          voice: voice ?? null,
        });
      }
    }
  }
  checkedActionIds.sort();
  failedActionIds.sort();
  missingActionIds.sort();
  return {
    complete: failedActionIds.length === 0 && missingActionIds.length === 0,
    checkedCount: parityCases.length,
    checkedActionIds,
    failedActionIds,
    missingActionIds,
    failures,
  };
}
