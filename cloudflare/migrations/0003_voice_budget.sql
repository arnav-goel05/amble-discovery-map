CREATE TABLE IF NOT EXISTS voice_budget_ledger (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  cap_micro_usd INTEGER NOT NULL DEFAULT 10000000
    CHECK (cap_micro_usd = 10000000),
  spent_micro_usd INTEGER NOT NULL DEFAULT 0
    CHECK (spent_micro_usd >= 0),
  reserved_micro_usd INTEGER NOT NULL DEFAULT 0
    CHECK (reserved_micro_usd >= 0),
  enabled INTEGER NOT NULL DEFAULT 0
    CHECK (enabled IN (0, 1)),
  updated_at TEXT NOT NULL,
  CHECK (spent_micro_usd + reserved_micro_usd <= cap_micro_usd)
);

INSERT OR IGNORE INTO voice_budget_ledger (
  id,
  cap_micro_usd,
  spent_micro_usd,
  reserved_micro_usd,
  enabled,
  updated_at
) VALUES (
  1,
  10000000,
  0,
  0,
  0,
  '1970-01-01T00:00:00.000Z'
);

CREATE TABLE IF NOT EXISTS voice_budget_reservations (
  reservation_id TEXT PRIMARY KEY NOT NULL,
  session_id_hash TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('input_transcription', 'response')),
  reserved_micro_usd INTEGER NOT NULL CHECK (reserved_micro_usd > 0),
  settled_micro_usd INTEGER NOT NULL DEFAULT 0
    CHECK (settled_micro_usd >= 0 AND settled_micro_usd <= reserved_micro_usd),
  status TEXT NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'settled', 'held', 'void')),
  usage_shape_hash TEXT,
  rate_card_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  settled_at TEXT,
  CHECK (
    (status = 'reserved' AND settled_micro_usd = 0 AND usage_shape_hash IS NULL AND settled_at IS NULL)
    OR (status = 'settled' AND usage_shape_hash IS NOT NULL AND settled_at IS NOT NULL)
    OR (status = 'held' AND settled_micro_usd = 0 AND usage_shape_hash IS NULL AND settled_at IS NOT NULL)
    OR (status = 'void' AND settled_micro_usd = 0 AND usage_shape_hash IS NULL AND settled_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS voice_budget_reservations_status_idx
  ON voice_budget_reservations (status, created_at);

CREATE INDEX IF NOT EXISTS voice_budget_reservations_session_idx
  ON voice_budget_reservations (session_id_hash, created_at);

CREATE TRIGGER IF NOT EXISTS voice_budget_ledger_delete_forbidden
BEFORE DELETE ON voice_budget_ledger
BEGIN
  SELECT RAISE(ABORT, 'voice budget ledger singleton cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS voice_budget_reservation_envelope_immutable
BEFORE UPDATE ON voice_budget_reservations
WHEN
  NEW.reservation_id IS NOT OLD.reservation_id
  OR NEW.session_id_hash IS NOT OLD.session_id_hash
  OR NEW.kind IS NOT OLD.kind
  OR NEW.reserved_micro_usd IS NOT OLD.reserved_micro_usd
  OR NEW.rate_card_version IS NOT OLD.rate_card_version
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'voice budget reservation envelope is immutable');
END;

CREATE TRIGGER IF NOT EXISTS voice_budget_reservation_terminal_immutable
BEFORE UPDATE ON voice_budget_reservations
WHEN OLD.status <> 'reserved'
BEGIN
  SELECT RAISE(ABORT, 'terminal voice budget reservation is immutable');
END;

CREATE TRIGGER IF NOT EXISTS voice_budget_reservation_delete_forbidden
BEFORE DELETE ON voice_budget_reservations
BEGIN
  SELECT RAISE(ABORT, 'voice budget reservations are immutable records');
END;
