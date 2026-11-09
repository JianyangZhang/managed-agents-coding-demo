import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { migrate, openDb } from '../src/db.js'
import { startTestServer } from './helpers.js'

describe('tags API', () => {
  let api
  before(async () => { api = await startTestServer() })
  after(async () => { await api.close() })

  test('a note without tags carries an empty array everywhere', async () => {
    const created = await api.request('POST', '/notes', { title: 'No tags' })
    assert.equal(created.status, 201)
    assert.deepEqual(created.body.tags, [])

    const fetched = await api.request('GET', `/notes/${created.body.id}`)
    assert.deepEqual(fetched.body.tags, [])

    const listed = await api.request('GET', '/notes')
    const mine = listed.body.data.find((note) => note.id === created.body.id)
    assert.deepEqual(mine.tags, [])
  })

  test('tags are trimmed, deduplicated case-sensitively, first-seen order kept', async () => {
    const res = await api.request('POST', '/notes', {
      title: 'Tagged',
      tags: ['  work  ', 'Urgent', 'work', 'urgent', 'Urgent'],
    })
    assert.equal(res.status, 201)
    assert.deepEqual(res.body.tags, ['work', 'Urgent', 'urgent'])
  })

  test('each tag is 1 to 32 characters after trimming', async () => {
    const tag32 = 'x'.repeat(32)
    const padded32 = `  ${'y'.repeat(32)}  `
    const ok = await api.request('POST', '/notes', { title: 'Bounds', tags: [tag32, padded32] })
    assert.equal(ok.status, 201)
    assert.deepEqual(ok.body.tags, [tag32, 'y'.repeat(32)])

    for (const bad of ['', '   ', 'x'.repeat(33), ` ${'x'.repeat(33)}`]) {
      const res = await api.request('POST', '/notes', { title: 'Bad tag', tags: [bad] })
      assert.equal(res.status, 400)
      assert.equal(res.body.error.code, 'invalid_tags')
    }
  })

  test('tags must be an array of strings when present', async () => {
    for (const bad of [null, 'work', 7, {}, [1], ['ok', null], ['ok', true]]) {
      const res = await api.request('POST', '/notes', { title: 'Bad tags field', tags: bad })
      assert.equal(res.status, 400)
      assert.equal(res.body.error.code, 'invalid_tags')
    }
    const empty = await api.request('POST', '/notes', { title: 'Empty tags', tags: [] })
    assert.equal(empty.status, 201)
    assert.deepEqual(empty.body.tags, [])
  })

  test('at most 10 tags after deduplication', async () => {
    const ten = Array.from({ length: 10 }, (_, i) => `t-${i}`)
    const ok = await api.request('POST', '/notes', { title: 'Ten tags', tags: ten })
    assert.equal(ok.status, 201)
    assert.deepEqual(ok.body.tags, ten)

    const eleven = Array.from({ length: 11 }, (_, i) => `u-${i}`)
    const res = await api.request('POST', '/notes', { title: 'Eleven tags', tags: eleven })
    assert.equal(res.status, 400)
    assert.equal(res.body.error.code, 'invalid_tags')

    const dupes = [...Array.from({ length: 9 }, (_, i) => `v-${i}`), 'v-0', 'v-1', 'v-2']
    const deduped = await api.request('POST', '/notes', { title: 'Dupes', tags: dupes })
    assert.equal(deduped.status, 201)
    assert.deepEqual(deduped.body.tags, Array.from({ length: 9 }, (_, i) => `v-${i}`))
  })

  test('list filters by tag, case-sensitively, and combines with limit', async () => {
    const a = await api.request('POST', '/notes', { title: 'A', tags: ['filter-work'] })
    const b = await api.request('POST', '/notes', { title: 'B', tags: ['filter-work', 'filter-home'] })
    const c = await api.request('POST', '/notes', { title: 'C', tags: ['filter-home'] })
    assert.equal(a.status, 201)
    assert.equal(b.status, 201)
    assert.equal(c.status, 201)

    const work = await api.request('GET', '/notes?tag=filter-work')
    assert.equal(work.status, 200)
    assert.deepEqual(work.body.data.map((note) => note.id), [b.body.id, a.body.id])
    assert.deepEqual(work.body.data[0].tags, ['filter-work', 'filter-home'])

    const home = await api.request('GET', '/notes?tag=filter-home')
    assert.deepEqual(home.body.data.map((note) => note.id), [c.body.id, b.body.id])

    const upper = await api.request('GET', '/notes?tag=FILTER-WORK')
    assert.deepEqual(upper.body.data, [])

    const padded = await api.request('GET', '/notes?tag=%20filter-work%20')
    assert.deepEqual(padded.body.data.map((note) => note.id), [b.body.id, a.body.id])

    const limited = await api.request('GET', '/notes?tag=filter-home&limit=1')
    assert.equal(limited.status, 200)
    assert.deepEqual(limited.body.data.map((note) => note.id), [c.body.id])

    const none = await api.request('GET', '/notes?tag=no-such-tag')
    assert.equal(none.status, 200)
    assert.deepEqual(none.body.data, [])

    // No stored tag can exceed 32 characters, so an over-long filter simply matches nothing.
    const overLong = await api.request('GET', `/notes?tag=${'x'.repeat(33)}`)
    assert.equal(overLong.status, 200)
    assert.deepEqual(overLong.body.data, [])
  })

  test('an empty or whitespace-only tag filter is rejected', async () => {
    for (const query of ['?tag=', '?tag=%20%20']) {
      const res = await api.request('GET', `/notes${query}`)
      assert.equal(res.status, 400)
      assert.equal(res.body.error.code, 'invalid_query')
    }
  })

  test('with several tag params the first value wins', async () => {
    const created = await api.request('POST', '/notes', { title: 'Multi', tags: ['multi-first'] })
    assert.equal(created.status, 201)

    const first = await api.request('GET', '/notes?tag=multi-first&tag=no-such-tag')
    assert.equal(first.status, 200)
    assert.deepEqual(first.body.data.map((note) => note.id), [created.body.id])

    const reversed = await api.request('GET', '/notes?tag=no-such-tag&tag=multi-first')
    assert.equal(reversed.status, 200)
    assert.deepEqual(reversed.body.data, [])
  })

  test('deleting a note drops its tags', async () => {
    const created = await api.request('POST', '/notes', { title: 'Temp', tags: ['vanishing'] })
    const before = await api.request('GET', '/notes?tag=vanishing')
    assert.equal(before.body.data.length, 1)

    assert.equal((await api.request('DELETE', `/notes/${created.body.id}`)).status, 204)
    const after = await api.request('GET', '/notes?tag=vanishing')
    assert.equal(after.status, 200)
    assert.deepEqual(after.body.data, [])
  })
})

describe('tags on an upgraded database', () => {
  test('notes created before the migration list no tags, new ones work', async () => {
    const db = openDb(':memory:')
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)')
    db.exec(readFileSync(new URL('../migrations/001_create_notes.sql', import.meta.url), 'utf8'))
    db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run('001_create_notes.sql', '2026-01-01T00:00:00.000Z')
    db.prepare('INSERT INTO notes (title, body, created_at) VALUES (?, ?, ?)').run('Legacy note', 'old body', '2026-01-01T00:00:00.000Z')

    assert.deepEqual(migrate(db), ['002_add_tags.sql'])

    const api = await startTestServer(db)
    try {
      const listed = await api.request('GET', '/notes')
      assert.equal(listed.status, 200)
      assert.equal(listed.body.data.length, 1)
      assert.deepEqual(listed.body.data[0].tags, [])

      const fetched = await api.request('GET', `/notes/${listed.body.data[0].id}`)
      assert.deepEqual(fetched.body.tags, [])

      const created = await api.request('POST', '/notes', { title: 'New', tags: ['fresh'] })
      assert.equal(created.status, 201)
      assert.deepEqual(created.body.tags, ['fresh'])
      assert.deepEqual((await api.request('GET', '/notes?tag=fresh')).body.data.map((note) => note.id), [created.body.id])
    } finally {
      await api.close()
    }
  })
})
