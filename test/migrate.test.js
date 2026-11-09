import assert from 'node:assert/strict'
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
