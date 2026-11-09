import { createServer } from 'node:http'
import { createApp } from '../src/app.js'
import { migrate, openDb } from '../src/db.js'

/** Starts the API on an ephemeral port over a fresh in-memory database. */
export async function startTestServer() {
  const db = openDb(':memory:')
  migrate(db)
  const server = createServer(createApp(db))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  async function request(method, path, body) {
    const res = await fetch(base + path, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    return { status: res.status, body: text.length === 0 ? null : JSON.parse(text) }
  }
  return { db, request, close: () => new Promise((resolve) => server.close(resolve)) }
}
