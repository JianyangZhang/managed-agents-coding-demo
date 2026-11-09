# notes-api

A small notes HTTP API on Node.js 22 and `node:sqlite`, with no third-party dependencies.

This repository is a public demo: its feature changes are delivered by agents running on Z Managed Agents, following the rules in [AGENTS.md](AGENTS.md). Every change arrives as a pull request that a human reviews and merges.

## API

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness check |
| POST | `/notes` | Create a note: `{ "title": string, "body"?: string, "tags"?: string[] }` — at most 10 tags, each 1–32 characters after trimming, duplicates (case-sensitive) removed |
| GET | `/notes?limit=N` | List notes, newest first (default 50, at most 200) |
| GET | `/notes?tag=T&limit=N` | List only notes carrying tag `T` (exact, case-sensitive; the value is trimmed like on create, and an empty or whitespace-only value is a `400 invalid_query`); combinable with `limit` |
| GET | `/notes/:id` | Read a note |
| PATCH | `/notes/:id` | Edit a note: `{ "title"?, "body"?, "tags"? }` — any subset of the fields, each validated like on create; `tags` replaces the whole list; at least one field must be carried (`400 empty_patch`); a missing note is `404` |
| DELETE | `/notes/:id` | Delete a note |

## Development

```bash
npm test
PORT=3000 DB_PATH=data/notes.db npm start
```
