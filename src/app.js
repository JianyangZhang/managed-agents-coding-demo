const TITLE_MAX = 200
const TAG_MAX_LEN = 32
const TAGS_MAX = 10
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

/** Validates the tags input: an optional array of strings, each 1-32 chars after
 * trimming, duplicates (case-sensitive) removed keeping first-seen order. */
function parseTags(raw) {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) throw new HttpError(400, 'invalid_tags', 'tags must be an array of strings')
  const seen = new Set()
  const tags = []
  for (const item of raw) {
    if (typeof item !== 'string') throw new HttpError(400, 'invalid_tags', 'tags must be an array of strings')
    const tag = item.trim()
    if (tag.length === 0 || tag.length > TAG_MAX_LEN) {
      throw new HttpError(400, 'invalid_tags', `each tag must be between 1 and ${TAG_MAX_LEN} characters after trimming`)
    }
    if (seen.has(tag)) continue
    seen.add(tag)
    tags.push(tag)
  }
  if (tags.length > TAGS_MAX) throw new HttpError(400, 'invalid_tags', `a note can have at most ${TAGS_MAX} tags`)
  return tags
}

/** Returns the tag filter for the list endpoint, or null when absent. */
function parseTagParam(raw) {
  if (raw === null) return null
  const tag = raw.trim()
  if (tag.length === 0) throw new HttpError(400, 'invalid_query', 'tag must be a non-empty string')
  return tag
}

function toNote(row) {
  return { id: row.id, title: row.title, body: row.body, created_at: row.created_at, tags: JSON.parse(row.tags) }
}

export function createApp(db) {
  const insertNote = db.prepare('INSERT INTO notes (title, body, tags, created_at) VALUES (?, ?, ?, ?)')
  const selectNote = db.prepare('SELECT id, title, body, created_at, tags FROM notes WHERE id = ?')
  const listNotes = db.prepare('SELECT id, title, body, created_at, tags FROM notes ORDER BY id DESC LIMIT ?')
  const listNotesByTag = db.prepare(
    'SELECT id, title, body, created_at, tags FROM notes WHERE EXISTS (SELECT 1 FROM json_each(notes.tags) AS t WHERE t.value = ?) ORDER BY id DESC LIMIT ?'
  )
  const deleteNote = db.prepare('DELETE FROM notes WHERE id = ?')

  async function route(req, res) {
    const url = new URL(req.url, 'http://localhost')
    const parts = url.pathname.split('/').filter(Boolean)

    if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true })

    if (parts[0] !== 'notes' || parts.length > 2) throw new HttpError(404, 'not_found', 'route not found')

    if (parts.length === 1) {
      if (req.method === 'GET') {
        const limit = parseLimit(url.searchParams.get('limit'))
        const tag = parseTagParam(url.searchParams.get('tag'))
        const rows = tag === null ? listNotes.all(limit) : listNotesByTag.all(tag, limit)
        return send(res, 200, { data: rows.map(toNote) })
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
        const tags = parseTags(input.tags)
        const result = insertNote.run(title, input.body ?? '', JSON.stringify(tags), new Date().toISOString())
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
