-- Preserve damaged save payloads for manual recovery before the player resets.
CREATE TABLE IF NOT EXISTS save_recovery_archive (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_user_id TEXT NOT NULL,
  source_revision INTEGER NOT NULL,
  raw_payload TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_save_recovery_account ON save_recovery_archive (telegram_user_id, created_at);
