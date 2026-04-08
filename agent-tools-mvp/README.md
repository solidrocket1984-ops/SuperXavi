# agent-tools-mvp

Minimal TypeScript tool server for agent-facing backend tools.

## Implemented tools

- `supabase_run_sql` (working, sandbox-only)
- `github_upsert_file` (placeholder)

## Safety behavior for `supabase_run_sql`

- Requires `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_SANDBOX_PROJECT_REF`.
- Rejects requests when `SUPABASE_URL` project ref does not match `SUPABASE_SANDBOX_PROJECT_REF`.
- Rejects destructive SQL patterns:
  - `DROP`
  - `TRUNCATE`
  - `DELETE` without a `WHERE` clause

## Setup

```bash
cd agent-tools-mvp
cp .env.example .env
npm install
npm run dev
```

Set the following values in `.env`:

- `SUPABASE_URL=https://<project-ref>.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY=<service-role-key>`
- `SUPABASE_SANDBOX_PROJECT_REF=<project-ref>`

## Endpoints

### Tool execution contract (new)

- `POST /execute`

Request body:

```json
{
  "tool": "supabase_run_sql",
  "input": {
    "sql": "select now() as server_time"
  }
}
```

`tool` must be one of:

- `supabase_run_sql`
- `github_upsert_file`

All tool responses are normalized to:

```json
{
  "success": true,
  "message": "Tool-specific message",
  "data": {},
  "error": null
}
```

### Existing endpoints (kept)

- `POST /tools/run` (legacy multi-tool endpoint, same body as `/execute`)
- `POST /tools/supabase/run-sql` (direct endpoint, body is tool `input` object)
- `POST /tools/github/upsert-file` (direct endpoint, body is tool `input` object)

## Validation and errors

- Invalid JSON returns `400` with `{"success": false, ...}`.
- Schema validation failures return `400` with a clear field-level message.
- Unsupported routes return `404`.
- Non-`POST` requests return `405`.
- Unhandled server errors return `500` with normalized error shape.

## Example curl

```bash
curl -X POST http://localhost:3000/execute \
  -H 'content-type: application/json' \
  -d '{
    "tool": "supabase_run_sql",
    "input": { "sql": "select now() as server_time" }
  }'
```
