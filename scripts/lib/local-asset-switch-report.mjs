import { readFile } from "node:fs/promises";
import path from "node:path";

import { canonicalJson } from "./background-lite-run.mjs";
import {
  atomicWriteJson,
  readJson,
  sha256,
} from "./local-asset-migration-shared.mjs";

const activeSelectionProjection = (manifest) => ({
  schemaVersion: manifest.schemaVersion,
  policyId: manifest.policyId,
  snapshotId: manifest.snapshotId,
  catalogueId: manifest.catalogueId,
  background: {
    path: manifest.background?.path,
    sha256: manifest.background?.sha256,
    opacity: manifest.background?.opacity,
  },
  overlays: {
    path: manifest.overlays?.path,
    sha256: manifest.overlays?.sha256,
    opacity: manifest.overlays?.opacity,
  },
  rollbackReference: {
    path: manifest.rollbackReference?.path,
    sha256: manifest.rollbackReference?.sha256,
  },
});

export const activeLocalSelectionId = (manifest) =>
  `sha256:${sha256(canonicalJson(activeSelectionProjection(manifest)))}`;

export const terminalizeSwitchReport = async ({
  active,
  activeManifestPath,
}) => {
  const reportPath = active.validation.path;
  const report = await readJson(reportPath);
  if (
    report?.schemaVersion !== "local-background-lite-validation-v2" ||
    report.complete !== true
  )
    return { active, switchReport: null };

  const outputRoot = path.dirname(path.dirname(reportPath));
  const switchReportPath = path.join(outputRoot, "reports", "switch.json");
  const switchReport = {
    schemaVersion: "local-building-asset-migration-v1",
    operation: "switch-local",
    state: "active-local",
    outcome: "active-local",
    complete: true,
    activatedAt: active.activatedAt,
    activeManifestPath,
    activeSelectionId: activeLocalSelectionId(active),
    policyId: active.policyId,
    snapshotId: active.snapshotId,
    catalogueId: active.catalogueId,
    background: {
      path: active.background.path,
      sha256: active.background.sha256,
    },
    overlays: {
      path: active.overlays.path,
      sha256: active.overlays.sha256,
    },
    rollbackReference: active.rollbackReference,
    localOnly: true,
    publicationActions: [],
  };
  await atomicWriteJson(switchReportPath, switchReport);

  const { reportId: ignoredReportId, ...previousContent } = report;
  const content = {
    ...previousContent,
    state: "active-local",
    migration: {
      ...report.migration,
      switch: { ...switchReport, verified: true },
    },
    artifacts: {
      ...report.artifacts,
      activeManifest: activeManifestPath,
      switchReport: switchReportPath,
    },
  };
  const terminalReport = {
    ...content,
    reportId: sha256(canonicalJson(content)),
  };
  await atomicWriteJson(reportPath, terminalReport);
  const terminalReportBytes = await readFile(reportPath);
  const rebound = {
    ...active,
    validation: {
      ...active.validation,
      path: reportPath,
      sha256: `sha256:${sha256(terminalReportBytes)}`,
    },
  };
  await atomicWriteJson(activeManifestPath, rebound);
  return { active: rebound, switchReport };
};
