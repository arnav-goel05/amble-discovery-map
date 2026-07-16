CREATE TABLE IF NOT EXISTS restaurant_viewports (
  cache_key TEXT PRIMARY KEY,
  south REAL NOT NULL,
  west REAL NOT NULL,
  north REAL NOT NULL,
  east REAL NOT NULL,
  payload TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS restaurant_viewports_expiry_idx
  ON restaurant_viewports(expires_at);

CREATE TABLE IF NOT EXISTS restaurant_deals (
  restaurant_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  payload TEXT,
  fetched_at TEXT,
  expires_at TEXT
);

CREATE INDEX IF NOT EXISTS restaurant_deals_expiry_idx
  ON restaurant_deals(expires_at);
