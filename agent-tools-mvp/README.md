# agent-tools-mvp

Minimal TypeScript tool server for agent-facing backend tools.

## Implemented tools

- `supabase_run_sql` (working, sandbox-only)
- `github_upsert_file` (placeholder with input validation)

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

- `POST /execute` (current)
- `POST /tools/run` (legacy alias; same behavior and response contract)

### Sample request body

```json
{
  "tool": "supabase_run_sql",
  "input": {
    "sql": "select now() as server_time"
  }
}
```

### Example curl (current endpoint)

```bash
curl -X POST http://localhost:3000/execute \
  -H 'content-type: application/json' \
  -d '{
    "tool": "supabase_run_sql",
    "input": { "sql": "select now() as server_time" }
  }'
```

### Example curl (legacy alias)

```bash
curl -X POST http://localhost:3000/tools/run \
  -H 'content-type: application/json' \
  -d '{
    "tool": "supabase_run_sql",
    "input": { "sql": "select now() as server_time" }
  }'
```

### Response shape

```json
{
  "success": true,
  "message": "Query executed successfully",
  "data": [{ "server_time": "2026-04-08T00:00:00.000Z" }],
  "error": null
}
```
