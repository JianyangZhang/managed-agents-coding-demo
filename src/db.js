import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')
const MIGRATION_FILE = /^\d{3}_[a-z0-9_]+\.sql$/

export function openDb(path = ':memory:') {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA foreign_keys = ON')
  return db
}

/**
 * Applies every migration file not yet recorded in schema_migrations, in file-name order.
 * A migration is recorded by file name, so an already-applied file is never run again:
 * editing it changes nothing on an existing database. Schema changes go in a new file.
 */
export function migrate(db, dir = MIGRATIONS_DIR) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)')
  const applied = new Set(db.prepare('SELECT name FROM schema_migrations').all().map((row) => row.name))
  const files = readdirSync(dir).filter((name) => MIGRATION_FILE.test(name)).sort()
  const ran = []
  for (const name of files) {
    if (applied.has(name)) continue
    const sql = readFileSync(join(dir, name), 'utf8')
    db.exec('BEGIN')
    try {
      db.exec(sql)
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(name, new Date().toISOString())
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw new Error(`migration ${name} failed: ${error.message}`, { cause: error })
    }
    ran.push(name)
  }
  return ran
}
