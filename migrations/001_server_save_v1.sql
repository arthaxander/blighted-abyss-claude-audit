CREATE TABLE IF NOT EXISTS game_accounts (
  telegram_user_id TEXT PRIMARY KEY,
  game_name TEXT,
  telegram_metadata TEXT NOT NULL DEFAULT '{}',
  save_payload TEXT,
  save_schema_version INTEGER NOT NULL DEFAULT 1,
  save_revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
