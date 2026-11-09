import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { migrate, openDb } from './db.js'

const path = process.env.DB_PATH ?? 'data/notes.db'
mkdirSync(dirname(path), { recursive: true })
const ran = migrate(openDb(path))
console.log(ran.length === 0 ? 'no pending migrations' : `applied: ${ran.join(', ')}`)
