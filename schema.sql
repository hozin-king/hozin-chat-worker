-- Hozin Notes random chat — skema D1.
-- Jalankan sekali: wrangler d1 execute hozin_chat --file=schema.sql

CREATE TABLE IF NOT EXISTS users (
  user_id    TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS queue (
  user_id     TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  enqueued_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rooms (
  room_id    TEXT PRIMARY KEY,
  a_id       TEXT NOT NULL,
  b_id       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  closed     INTEGER NOT NULL DEFAULT 0,
  seen_a     INTEGER NOT NULL DEFAULT 0,
  seen_b     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS messages (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL,
  from_id TEXT NOT NULL,
  text    TEXT NOT NULL,
  ts      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id, id);

CREATE TABLE IF NOT EXISTS blocks (
  user_id    TEXT NOT NULL,
  peer_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, peer_id)
);

CREATE TABLE IF NOT EXISTS reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id     TEXT NOT NULL,
  reporter_id TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
