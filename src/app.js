const TITLE_MAX = 200
const LIST_LIMIT_DEFAULT = 50
const LIST_LIMIT_MAX = 200

class HttpError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

function send(res, status, payload) {
  if (payload === undefined) {
    res.writeHead(status)
    res.end()
    return
  }
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

async function readJson(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.length === 0) throw new HttpError(400, 'invalid_body', 'request body must be a JSON object')
  let value
  try {
    value = JSON.parse(text)
  } catch {
    throw new HttpError(400, 'invalid_body', 'request body is not valid JSON')
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'invalid_body', 'request body must be a JSON object')
  }
  return value
}

function parseId(raw) {
  if (!/^[1-9]\d*$/.test(raw)) throw new HttpError(404, 'not_found', 'note not found')
  return Number(raw)
}

function parseLimit(raw) {
  if (raw === null) return LIST_LIMIT_DEFAULT
  if (!/^[1-9]\d*$/.test(raw) || Number(raw) > LIST_LIMIT_MAX) {
    throw new HttpError(400, 'invalid_query', `limit must be an integer between 1 and ${LIST_LIMIT_MAX}`)
  }
  return Number(raw)
}

function toNote(row) {
  return { id: row.id, title: row.title, body: row.body, created_at: row.created_at }
}

export function createApp(db) {
  const insertNote = db.prepare('INSERT INTO notes (title, body, created_at) VALUES (?, ?, ?)')
  const selectNote = db.prepare('SELECT id, title, body, created_at FROM notes WHERE id = ?')
  const listNotes = db.prepare('SELECT id, title, body, created_at FROM notes ORDER BY id DESC LIMIT ?')
  const deleteNote = db.prepare('DELETE FROM notes WHERE id = ?')

  async function route(req, res) {
    const url = new URL(req.url, 'http://localhost')
    const parts = url.pathname.split('/').filter(Boolean)

    if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true })

    if (parts[0] !== 'notes' || parts.length > 2) throw new HttpError(404, 'not_found', 'route not found')

    if (parts.length === 1) {
      if (req.method === 'GET') {
        const limit = parseLimit(url.searchParams.get('limit'))
        return send(res, 200, { data: listNotes.all(limit).map(toNote) })
      }
      if (req.method === 'POST') {
        const input = await readJson(req)
        const title = typeof input.title === 'string' ? input.title.trim() : ''
        if (title.length === 0 || title.length > TITLE_MAX) {
          throw new HttpError(400, 'invalid_title', `title must be a non-empty string of at most ${TITLE_MAX} characters`)
        }
        if (input.body !== undefined && typeof input.body !== 'string') {
          throw new HttpError(400, 'invalid_body', 'body must be a string')
        }
        const result = insertNote.run(title, input.body ?? '', new Date().toISOString())
        return send(res, 201, toNote(selectNote.get(result.lastInsertRowid)))
      }
      throw new HttpError(405, 'method_not_allowed', 'method not allowed')
    }

    const id = parseId(parts[1])
    if (req.method === 'GET') {
      const row = selectNote.get(id)
      if (!row) throw new HttpError(404, 'not_found', 'note not found')
      return send(res, 200, toNote(row))
    }
    if (req.method === 'DELETE') {
      const result = deleteNote.run(id)
      if (result.changes === 0) throw new HttpError(404, 'not_found', 'note not found')
      return send(res, 204)
    }
    throw new HttpError(405, 'method_not_allowed', 'method not allowed')
  }

  return async function handler(req, res) {
    try {
      await route(req, res)
    } catch (error) {
      if (error instanceof HttpError) return send(res, error.status, { error: { code: error.code, message: error.message } })
      console.error(error)
      return send(res, 500, { error: { code: 'internal_error', message: 'internal server error' } })
    }
  }
}
