const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
class StaleRevisionError extends Error { constructor(account) { super('stale-revision'); this.statusCode = 409; this.account = account; } }
class SqliteAccountRepository {
  constructor(filename = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'ashen-abyss.sqlite')) {
    console.log('[account-db] opening sqlite', { filename });
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations', '001_server_save_v1.sql'), 'utf8'));
    this.db.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations', '002_save_recovery.sql'), 'utf8'));
  }
  map(row) {
    if (!row) return null;
    let save = null;
    let saveCorrupt = false;
    if (row.save_payload != null) {
      try {
        save = JSON.parse(row.save_payload);
        if (!save || typeof save !== 'object' || Array.isArray(save)) {
          save = null;
          saveCorrupt = true;
        }
      } catch {
        // A damaged JSON payload must not disable authentication for the account.
        // Keep the original bytes in SQLite until the player explicitly resets.
        saveCorrupt = true;
      }
    }
    let telegramMetadata = {};
    try { telegramMetadata = JSON.parse(row.telegram_metadata || '{}'); }
    catch { /* Display metadata is not account identity. */ }
    return {
      telegramUserId: row.telegram_user_id,
      gameName: row.game_name,
      telegramMetadata,
      save,
      saveCorrupt,
      saveSchemaVersion: row.save_schema_version,
      revision: row.save_revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
  get(id) { return this.map(this.db.prepare('SELECT * FROM game_accounts WHERE telegram_user_id = ?').get(String(id))); }
  getOrCreate(identity) {
    const id = String(identity.telegramUserId); const now = new Date().toISOString();
    this.db.prepare('INSERT OR IGNORE INTO game_accounts (telegram_user_id, telegram_metadata, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, JSON.stringify(identity.telegramMetadata || {}), now, now);
    this.db.prepare('UPDATE game_accounts SET telegram_metadata = ?, updated_at = ? WHERE telegram_user_id = ?').run(JSON.stringify(identity.telegramMetadata || {}), now, id);
    return this.get(id);
  }
  setName(id, name) { this.db.prepare('UPDATE game_accounts SET game_name = ?, updated_at = ? WHERE telegram_user_id = ? AND game_name IS NULL').run(name, new Date().toISOString(), String(id)); return this.get(id); }
  save(id, payload, expectedRevision, schemaVersion = 1) {
    const current = this.get(id); if (!current) throw Object.assign(new Error('account-not-found'), { statusCode: 404 });
    if (current.revision !== expectedRevision) throw new StaleRevisionError(current);
    if (current.saveCorrupt) throw Object.assign(new Error('save-corrupt'), { statusCode: 409, account: current });
    this.db.prepare('UPDATE game_accounts SET save_payload = ?, save_schema_version = ?, save_revision = save_revision + 1, updated_at = ? WHERE telegram_user_id = ? AND save_revision = ?').run(JSON.stringify(payload), schemaVersion, new Date().toISOString(), String(id), expectedRevision);
    return this.get(id);
  }
  resetSave(id, expectedRevision) {
    const account = this.get(id);
    if (!account) throw Object.assign(new Error('account-not-found'), { statusCode: 404 });
    if (account.revision !== expectedRevision) throw new StaleRevisionError(account);
    if (account.save == null && !account.saveCorrupt) throw Object.assign(new Error('save-empty'), { statusCode: 409, account });
    // Back up raw bytes *inside the same SQLite transaction* before clearing them.
    // The user cannot access or overwrite another Telegram account's data.
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const stored = this.db.prepare('SELECT save_payload FROM game_accounts WHERE telegram_user_id = ?').get(String(id));
      this.db.prepare('INSERT INTO save_recovery_archive (telegram_user_id, source_revision, raw_payload, created_at) VALUES (?, ?, ?, ?)')
        .run(String(id), expectedRevision, stored.save_payload, new Date().toISOString());
      const update = this.db.prepare('UPDATE game_accounts SET save_payload = NULL, save_schema_version = 1, save_revision = save_revision + 1, updated_at = ? WHERE telegram_user_id = ? AND save_revision = ?')
        .run(new Date().toISOString(), String(id), expectedRevision);
      if (update.changes !== 1) throw new StaleRevisionError(this.get(id));
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.get(id);
  }
  close() { this.db.close(); }
}
module.exports = { SqliteAccountRepository, StaleRevisionError };
