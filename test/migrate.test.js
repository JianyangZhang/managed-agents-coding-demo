import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { migrate, openDb } from '../src/db.js'

test('migrations apply once and are recorded by file name', () => {
  const db = openDb(':memory:')
  const first = migrate(db)
  assert.ok(first.includes('001_create_notes.sql'))
  assert.deepEqual(migrate(db), [])
  const recorded = db.prepare('SELECT name FROM schema_migrations ORDER BY name').all().map((row) => row.name)
  assert.deepEqual(recorded, first)
})

test('upgrading a pre-tags database gives existing notes an empty tags array', () => {
  const db = openDb(':memory:')
  // Recreate a database as the previous version left it: 001 applied, one row, no tags column.
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)')
  db.exec(readFileSync(new URL('../migrations/001_create_notes.sql', import.meta.url), 'utf8'))
  db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run('001_create_notes.sql', '2026-01-01T00:00:00.000Z')
  db.prepare('INSERT INTO notes (title, body, created_at) VALUES (?, ?, ?)').run('Legacy note', 'old body', '2026-01-01T00:00:00.000Z')

  const ran = migrate(db)
  assert.deepEqual(ran, ['002_add_tags.sql'])

  const row = db.prepare('SELECT title, tags FROM notes WHERE title = ?').get('Legacy note')
  assert.equal(row.tags, '[]')
})
