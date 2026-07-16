CREATE TABLE IF NOT EXISTS restaurants (
  id TEXT PRIMARY KEY,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  payload TEXT NOT NULL,
  source_updated_at TEXT,
  seeded_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS restaurants_latitude_idx ON restaurants(latitude);
CREATE INDEX IF NOT EXISTS restaurants_longitude_idx ON restaurants(longitude);

