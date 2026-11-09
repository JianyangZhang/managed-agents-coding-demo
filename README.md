# notes-api

A small notes HTTP API on Node.js 22 and `node:sqlite`, with no third-party dependencies.

This repository is a public demo: its feature changes are delivered by agents running on Z Managed Agents, following the rules in [AGENTS.md](AGENTS.md). Every change arrives as a pull request that a human reviews and merges.

## API

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness check |
| POST | `/notes` | Create a note: `{ "title": string, "body"?: string, "tags"?: string[] }` — at most 10 tags, each 1–32 characters after trimming, duplicates (case-sensitive) removed |
| GET | `/notes?limit=N` | List notes, newest first (default 50, at most 200) |
| GET | `/notes?tag=T&limit=N` | List only notes carrying tag `T` (exact, case-sensitive); `limit` optional and combinable |
| GET | `/notes/:id` | Read a note |
| DELETE | `/notes/:id` | Delete a note |

## Development

```bash
npm test
PORT=3000 DB_PATH=data/notes.db npm start
```
