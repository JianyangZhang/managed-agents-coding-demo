# Editing notes: PATCH /notes/:id

## 1. What changes and why

Notes can be edited after creation. A new `PATCH /notes/:id` updates any subset of
`title`, `body` and `tags`; fields the request does not carry keep their current
value. There is no PUT — partial patch is the only editing verb. No schema change:
notes keep the same columns, `created_at` included (it never changes on edit).

## 2. Request and response shapes

### PATCH /notes/:id

```json
{ "title": "New title", "body": "New body", "tags": ["work"] }
```

- Every field is optional, but at least one of `title`, `body`, `tags` must be
  present. A request that carries none of them (including `{}` or only unknown
  fields) is rejected with `400 empty_patch`. Unknown fields are otherwise ignored,
  same as on create.
- A field set to `null` counts as present and is rejected by that field's rule
  (same treatment as on create, where `null` is never "absent").
- Each carried field is validated exactly like on `POST /notes`:
  - `title` — string, trimmed, 1–200 characters after trimming, else `400 invalid_title`;
  - `body` — string (may be empty), else `400 invalid_body`;
  - `tags` — array of strings, each trimmed to 1–32 characters, duplicates removed
    case-sensitively keeping the first occurrence, at most 10 after deduplication,
    else `400 invalid_tags`.
- `tags` replaces the whole list when present: `[]` clears the tags; omitting the
  field keeps the old ones.

Success: `200` with the full updated note (the usual shape, `created_at`
unchanged):

```json
{ "id": 1, "title": "New title", "body": "New body", "created_at": "…", "tags": ["work"] }
```

Error precedence, pinned because it is a contract: resolving the resource beats
validating the payload. A malformed id, or a note that does not exist (or was
deleted), answers `404 not_found` — even if the body is also invalid (not JSON,
`{}`, a bad title…). Only when the note exists do the body rules apply: `400
invalid_body` for a non-object or non-JSON body, then `400 empty_patch` / field
errors as above.

Errors keep the single shape `{ "error": { "code", "message" } }`; the one new
code is `empty_patch`.

## 3. Implementation and existing rows

No migration. `src/app.js` reads the current row (the same `SELECT` as `GET`),
merges the carried fields over it in memory, and issues one `UPDATE notes SET
title = ?, body = ?, tags = ? WHERE id = ?`. All three columns are rewritten even
when only one changed: the read-modify-write sits in one synchronous block after
the body has been read, and the server is single-threaded, so nothing can
interleave between the `SELECT` and the `UPDATE`. Building a column-specific
`SET` list would add code for no benefit at this scale. The response re-reads the
row, so it is exactly what is stored.

## 4. Out of scope

- Renaming the resource or changing `created_at` (no `updated_at` column; if edit
  history is ever needed it is a schema change of its own).
- JSON Patch / JSON Merge Patch media types (`application/merge-patch+json`);
  the plain-object semantics above are enough here.
- PUT (full replace) — if needed later it can reuse the same validators.
- Editing tags by add/remove operation instead of whole-list replacement.
