export {
  activeLocalSelectionId,
  activateLocalSwitchManifest,
  finalizeActiveLocalSwitchReport,
  rebindActiveValidationReport,
  rollbackLocalSwitchManifest,
  validateLocalSwitchManifest,
} from "./local-asset-switch.mjs";
export {
  asRecoveryManifest,
  recoveryContract,
  recoverySelectionId,
  validateRecoveryManifest,
} from "./local-asset-recovery.mjs";
export {
  createMigrationPreflight,
  reclaimOptimizedTiles,
} from "./local-asset-reclaim.mjs";
export {
  cleanupLegacyPoiTiles,
  createLegacyPoiCleanupPreflight,
} from "./local-asset-legacy-cleanup.mjs";
import {
  MIGRATION_SCHEMA,
  SWITCH_SCHEMA,
  TOKEN_SCHEMA,
} from "./local-asset-migration-shared.mjs";

export const migrationSchemas = Object.freeze({
  confirmation: TOKEN_SCHEMA,
  migration: MIGRATION_SCHEMA,
  switchManifest: SWITCH_SCHEMA,
});
