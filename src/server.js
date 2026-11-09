import { mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname } from 'node:path'
import { createApp } from './app.js'
import { migrate, openDb } from './db.js'

const path = process.env.DB_PATH ?? 'data/notes.db'
const port = Number(process.env.PORT ?? 3000)

mkdirSync(dirname(path), { recursive: true })
const db = openDb(path)
migrate(db)
createServer(createApp(db)).listen(port, () => {
  console.log(`notes-api listening on :${port} (db: ${path})`)
})
