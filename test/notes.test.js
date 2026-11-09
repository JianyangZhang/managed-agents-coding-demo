import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { startTestServer } from './helpers.js'

describe('notes API', () => {
  let api
  before(async () => { api = await startTestServer() })
  after(async () => { await api.close() })

  test('health', async () => {
    assert.deepEqual(await api.request('GET', '/health'), { status: 200, body: { ok: true } })
  })

  test('create, read, list and delete a note', async () => {
    const created = await api.request('POST', '/notes', { title: '  First  ', body: 'hello' })
    assert.equal(created.status, 201)
    assert.equal(created.body.title, 'First')
    assert.equal(created.body.body, 'hello')

    const fetched = await api.request('GET', `/notes/${created.body.id}`)
    assert.deepEqual(fetched, { status: 200, body: created.body })

    const listed = await api.request('GET', '/notes')
    assert.equal(listed.status, 200)
    assert.equal(listed.body.data[0].id, created.body.id)

    assert.equal((await api.request('DELETE', `/notes/${created.body.id}`)).status, 204)
    assert.equal((await api.request('GET', `/notes/${created.body.id}`)).status, 404)
  })

  test('rejects an empty or missing title', async () => {
    for (const input of [{}, { title: '   ' }, { title: 7 }]) {
      const res = await api.request('POST', '/notes', input)
      assert.equal(res.status, 400)
      assert.equal(res.body.error.code, 'invalid_title')
    }
  })

  test('list limit is bounded', async () => {
    assert.equal((await api.request('GET', '/notes?limit=0')).status, 400)
    assert.equal((await api.request('GET', '/notes?limit=201')).status, 400)
    assert.equal((await api.request('GET', '/notes?limit=2')).status, 200)
  })

  test('unknown ids and routes are 404', async () => {
    assert.equal((await api.request('GET', '/notes/999')).status, 404)
    assert.equal((await api.request('GET', '/notes/abc')).status, 404)
    assert.equal((await api.request('GET', '/nope')).status, 404)
  })
})
