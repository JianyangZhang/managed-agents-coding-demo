# notes-api — agent guide

This file is a map for anyone (human or agent) changing this repository. Read it before editing.

## What this is

A small HTTP API for notes, built on Node.js 22 and its built-in `node:sqlite`. No third-party dependencies.

- `src/app.js` — routes and request validation
- `src/db.js` — database connection and the migration runner
- `src/server.js` — process entry: opens the database, applies migrations, listens on `PORT`
- `migrations/` — numbered SQL files, applied in order and recorded in `schema_migrations`
- `test/` — `node:test` suites; `test/helpers.js` starts the API over an in-memory database
- `docs/design/` — short design notes for API or schema changes

## Commands

- Run the tests: `npm test`
- Start the server: `PORT=3000 DB_PATH=data/notes.db npm start`
- Apply migrations only: `DB_PATH=data/notes.db npm run migrate`

## Hard rules

- **Migrations are append-only.** Never edit or delete a file in `migrations/` once it is on `main`. The runner records migrations by file name, so an edited file is never run again on an existing database. Every schema change is a new file with the next number.
- **API or schema changes start with a design note.** Before writing code, add `docs/design/YYYY-MM-DD-<slug>.md`: what changes, why, the request and response shapes, and how existing data is handled.
- **Errors keep one shape**: `{ "error": { "code": "...", "message": "..." } }`.
- **Never push to `main`.** Work on `feat/<slug>` or `fix/<slug>`, push the branch, and open a pull request against `main`. Humans review and merge.
- **Run `npm test` before every push**, and make sure CI is green on the pull request.
