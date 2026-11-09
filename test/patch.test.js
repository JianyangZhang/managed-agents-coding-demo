import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { migrate, openDb } from '../src/db.js'
import { startTestServer } from './helpers.js'

describe('patch notes API', () => {
  let api
  before(async () => { api = await startTestServer() })
  after(async () => { await api.close() })

  async function createNote(fields = {}) {
    const res = await api.request('POST', '/notes', { title: 'Original', body: 'first body', tags: ['keep', 'old'], ...fields })
    assert.equal(res.status, 201)
    return res.body
  }

  test('changes only the fields carried, keeps the rest and created_at', async () => {
    const note = await createNote()

    const res = await api.request('PATCH', `/notes/${note.id}`, { title: '  Renamed  ' })
    assert.equal(res.status, 200)
    assert.deepEqual(res.body, {
      id: note.id,
      title: 'Renamed',
      body: 'first body',
      created_at: note.created_at,
      tags: ['keep', 'old'],
    })

    const fetched = await api.request('GET', `/notes/${note.id}`)
    assert.deepEqual(fetched, { status: 200, body: res.body })
  })

  test('body alone can be changed, including to an empty string', async () => {
    const note = await createNote()
    const res = await api.request('PATCH', `/notes/${note.id}`, { body: 'second body' })
    assert.equal(res.status, 200)
    assert.equal(res.body.title, 'Original')
    assert.equal(res.body.body, 'second body')
    assert.deepEqual(res.body.tags, ['keep', 'old'])

    const cleared = await api.request('PATCH', `/notes/${note.id}`, { body: '' })
    assert.equal(cleared.status, 200)
    assert.equal(cleared.body.body, '')
  })

  test('tags replace the whole list, with the create-time rules', async () => {
    const note = await createNote()

    const replaced = await api.request('PATCH', `/notes/${note.id}`, { tags: ['  fresh  ', 'fresh', 'Fresh'] })
    assert.equal(replaced.status, 200)
    assert.deepEqual(replaced.body.tags, ['fresh', 'Fresh'])

    const cleared = await api.request('PATCH', `/notes/${note.id}`, { tags: [] })
    assert.equal(cleared.status, 200)
    assert.deepEqual(cleared.body.tags, [])

    const restored = await api.request('PATCH', `/notes/${note.id}`, { tags: ['again'] })
    assert.deepEqual(restored.body.tags, ['again'])
  })

  test('all three fields at once', async () => {
    const note = await createNote({ title: 'Third', body: 'c', tags: ['x'] })
    const res = await api.request('PATCH', `/notes/${note.id}`, { title: 'All new', body: 'd', tags: ['y', 'z'] })
    assert.equal(res.status, 200)
    assert.deepEqual(res.body, {
      id: note.id,
      title: 'All new',
      body: 'd',
      created_at: note.created_at,
      tags: ['y', 'z'],
    })
  })

  test('successive patches compose', async () => {
    const note = await createNote({ tags: [] })
    assert.equal((await api.request('PATCH', `/notes/${note.id}`, { title: 'After one' })).status, 200)
    const second = await api.request('PATCH', `/notes/${note.id}`, { tags: ['kept-later'] })
    assert.equal(second.status, 200)
    assert.equal(second.body.title, 'After one')
    assert.deepEqual(second.body.tags, ['kept-later'])
  })

  test('unknown fields are ignored, but do not count as an update', async () => {
    const note = await createNote()
    const res = await api.request('PATCH', `/notes/${note.id}`, { priority: 'high', title: 'Known field' })
    assert.equal(res.status, 200)
    assert.equal(res.body.title, 'Known field')
    assert.deepEqual(Object.keys(res.body).sort(), ['body', 'created_at', 'id', 'tags', 'title'])

    const onlyUnknown = await api.request('PATCH', `/notes/${note.id}`, { priority: 'high' })
    assert.equal(onlyUnknown.status, 400)
    assert.equal(onlyUnknown.body.error.code, 'empty_patch')
  })

  test('a request without any updatable field is rejected', async () => {
    const note = await createNote()
    for (const input of [{}, { foo: 1 }]) {
      const res = await api.request('PATCH', `/notes/${note.id}`, input)
      assert.equal(res.status, 400)
      assert.equal(res.body.error.code, 'empty_patch')
    }
    // The note is untouched after the rejections.
    const fetched = await api.request('GET', `/notes/${note.id}`)
    assert.equal(fetched.body.title, 'Original')
    assert.deepEqual(fetched.body.tags, ['keep', 'old'])
  })

  test('title follows the create-time rules', async () => {
    const note = await createNote()
    const maxTitle = 'x'.repeat(200)
    const ok = await api.request('PATCH', `/notes/${note.id}`, { title: `  ${maxTitle}  ` })
    assert.equal(ok.status, 200)
    assert.equal(ok.body.title, maxTitle)

    for (const bad of ['', '   ', null, 7, 'x'.repeat(201)]) {
      const res = await api.request('PATCH', `/notes/${note.id}`, { title: bad })
      assert.equal(res.status, 400)
      assert.equal(res.body.error.code, 'invalid_title')
    }
  })

  test('body follows the create-time rules', async () => {
    const note = await createNote()
    for (const bad of [null, 7, []]) {
      const res = await api.request('PATCH', `/notes/${note.id}`, { body: bad })
      assert.equal(res.status, 400)
      assert.equal(res.body.error.code, 'invalid_body')
    }
  })

  test('tags follow the create-time rules', async () => {
    const note = await createNote()
    const ten = Array.from({ length: 10 }, (_, i) => `t-${i}`)
    const ok = await api.request('PATCH', `/notes/${note.id}`, { tags: ten })
    assert.equal(ok.status, 200)
    assert.deepEqual(ok.body.tags, ten)

    for (const bad of [null, 'work', 7, {}, [1], ['ok', null], [''], ['x'.repeat(33)], Array.from({ length: 11 }, (_, i) => `u-${i}`)]) {
      const res = await api.request('PATCH', `/notes/${note.id}`, { tags: bad })
      assert.equal(res.status, 400)
      assert.equal(res.body.error.code, 'invalid_tags')
    }
    // Dedup happens before the 10-tag cap, like on create.
    const dedup = [...Array.from({ length: 9 }, (_, i) => `v-${i}`), 'v-0', 'v-1', 'v-2']
    const res = await api.request('PATCH', `/notes/${note.id}`, { tags: dedup })
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.tags, Array.from({ length: 9 }, (_, i) => `v-${i}`))
  })

  test('a rejected patch leaves the note unchanged', async () => {
    const note = await createNote()
    const before = await api.request('GET', `/notes/${note.id}`)
    const res = await api.request('PATCH', `/notes/${note.id}`, { title: 'ok so far', tags: ['oops', 42] })
    assert.equal(res.status, 400)
    assert.equal(res.body.error.code, 'invalid_tags')
    assert.deepEqual((await api.request('GET', `/notes/${note.id}`)).body, before.body)
  })

  test('a body that is not a JSON object is rejected', async () => {
    const note = await createNote()
    for (const raw of ['not json', '[]', '"a string"', 'null', '5']) {
      const res = await api.requestRaw('PATCH', `/notes/${note.id}`, raw)
      assert.equal(res.status, 400)
      assert.equal(res.body.error.code, 'invalid_body')
    }
    // An empty body is not an empty patch either.
    const empty = await api.requestRaw('PATCH', `/notes/${note.id}`, '')
    assert.equal(empty.status, 400)
    assert.equal(empty.body.error.code, 'invalid_body')
  })

  test('unknown notes are 404, whatever the body says', async () => {
    for (const [input, raw] of [[{ title: 'New' }, null], [{}, null], [{ title: '' }, null], [null, 'not json']]) {
      const res = raw === null ? await api.request('PATCH', '/notes/999999', input) : await api.requestRaw('PATCH', '/notes/999999', raw)
      assert.equal(res.status, 404)
      assert.equal(res.body.error.code, 'not_found')
    }
    for (const badId of ['abc', '0', '-1', '1.5']) {
      const res = await api.request('PATCH', `/notes/${badId}`, { title: 'New' })
      assert.equal(res.status, 404)
      assert.equal(res.body.error.code, 'not_found')
    }
  })

  test('a deleted note can no longer be patched', async () => {
    const note = await createNote()
    assert.equal((await api.request('DELETE', `/notes/${note.id}`)).status, 204)
    const res = await api.request('PATCH', `/notes/${note.id}`, { title: 'Zombie' })
    assert.equal(res.status, 404)
    assert.equal(res.body.error.code, 'not_found')
  })

  test('lists and tag filters see the updates', async () => {
    const note = await createNote({ tags: ['before-edit'] })
    assert.equal((await api.request('GET', '/notes?tag=before-edit')).body.data[0].id, note.id)

    const res = await api.request('PATCH', `/notes/${note.id}`, { title: 'Listed as new', tags: ['after-edit'] })
    assert.equal(res.status, 200)

    const listed = await api.request('GET', '/notes')
    const mine = listed.body.data.find((item) => item.id === note.id)
    assert.equal(mine.title, 'Listed as new')
    assert.deepEqual(mine.tags, ['after-edit'])

    assert.deepEqual((await api.request('GET', '/notes?tag=before-edit')).body.data, [])
    assert.deepEqual((await api.request('GET', '/notes?tag=after-edit')).body.data.map((item) => item.id), [note.id])
  })

  test('other methods on the note resource are still 405', async () => {
    const note = await createNote()
    for (const method of ['PUT', 'POST']) {
      const res = await api.request(method, `/notes/${note.id}`, { title: 'X' })
      assert.equal(res.status, 405)
      assert.equal(res.body.error.code, 'method_not_allowed')
    }
    assert.equal((await api.request('PATCH', '/notes', { title: 'X' })).status, 405)
  })

  test('error responses keep the single { code, message } shape', async () => {
    const note = await createNote()
    const cases = [
      [{}, 'empty_patch'],
      [{ title: '' }, 'invalid_title'],
      [{ body: 7 }, 'invalid_body'],
      [{ tags: 'work' }, 'invalid_tags'],
    ]
    for (const [input, code] of cases) {
      const res = await api.request('PATCH', `/notes/${note.id}`, input)
      assert.equal(res.status, 400)
      assert.deepEqual(Object.keys(res.body).sort(), ['error'])
      assert.deepEqual(Object.keys(res.body.error).sort(), ['code', 'message'])
      assert.equal(res.body.error.code, code)
      assert.equal(typeof res.body.error.message, 'string')
      assert.ok(res.body.error.message.length > 0)
    }
    const missing = await api.request('PATCH', '/notes/999999', { title: 'X' })
    assert.equal(missing.status, 404)
    assert.deepEqual(Object.keys(missing.body.error).sort(), ['code', 'message'])
  })

  // The design note (§3) makes the read-modify-write safe by keeping the
  // SELECT and the UPDATE in one synchronous block. These tests pin that:
  // if an await ever slips between them, concurrent patches interleave and
  // either a partial update gets lost or a response stops reflecting the row
  // its own request wrote.
  test('concurrent full-field patches never tear a row', async () => {
    const note = await createNote({ tags: [] })
    const markers = Array.from({ length: 20 }, (_, i) => `m${i}`)
    const responses = await Promise.all(
      markers.map((marker) => api.request('PATCH', `/notes/${note.id}`, { title: marker, body: marker, tags: [marker] }))
    )
    for (const [i, res] of responses.entries()) {
      assert.equal(res.status, 200)
      // Each response shows the row its own request wrote, all three fields together.
      assert.equal(res.body.title, markers[i])
      assert.equal(res.body.body, markers[i])
      assert.deepEqual(res.body.tags, [markers[i]])
      assert.equal(res.body.created_at, note.created_at)
    }
    const final = await api.request('GET', `/notes/${note.id}`)
    assert.ok(markers.includes(final.body.title))
    assert.equal(final.body.body, final.body.title)
    assert.deepEqual(final.body.tags, [final.body.title])
  })

  test('concurrent partial patches compose without losing a field', async () => {
    const note = await createNote()
    for (let round = 1; round <= 15; round++) {
      const results = await Promise.all([
        api.request('PATCH', `/notes/${note.id}`, { title: `t${round}` }),
        api.request('PATCH', `/notes/${note.id}`, { body: `b${round}` }),
        api.request('PATCH', `/notes/${note.id}`, { tags: [`g${round}`] }),
      ])
      for (const res of results) assert.equal(res.status, 200)
      const after = await api.request('GET', `/notes/${note.id}`)
      // Whichever order the three requests ran in, all three changes must stick.
      assert.deepEqual(after.body, {
        id: note.id,
        title: `t${round}`,
        body: `b${round}`,
        created_at: note.created_at,
        tags: [`g${round}`],
      })
    }
  })
})

describe('patch on an upgraded database', () => {
  test('notes created before this code existed can be patched', async () => {
    const db = openDb(':memory:')
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)')
    db.exec(readFileSync(new URL('../migrations/001_create_notes.sql', import.meta.url), 'utf8'))
    db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run('001_create_notes.sql', '2026-01-01T00:00:00.000Z')
    db.prepare('INSERT INTO notes (title, body, created_at) VALUES (?, ?, ?)').run('Legacy note', 'old body', '2026-01-01T00:00:00.000Z')

    assert.deepEqual(migrate(db), ['002_add_tags.sql'])

    const api = await startTestServer(db)
    try {
      const legacy = await api.request('GET', '/notes')
      const id = legacy.body.data[0].id

      const retitled = await api.request('PATCH', `/notes/${id}`, { title: 'Edited title' })
      assert.equal(retitled.status, 200)
      assert.deepEqual(retitled.body, {
        id,
        title: 'Edited title',
        body: 'old body',
        created_at: '2026-01-01T00:00:00.000Z',
        tags: [],
      })

      const retagged = await api.request('PATCH', `/notes/${id}`, { tags: ['late-tag'] })
      assert.equal(retagged.status, 200)
      assert.deepEqual(retagged.body.tags, ['late-tag'])
      assert.equal(retagged.body.title, 'Edited title')

      assert.deepEqual((await api.request('GET', `/notes/${id}`)).body, retagged.body)
      assert.equal((await api.request('GET', '/notes?tag=late-tag')).body.data.length, 1)
    } finally {
      await api.close()
    }
  })
})
