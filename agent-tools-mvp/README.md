# agent-tools-mvp

Minimal TypeScript tool server for agent-facing backend tools.

## Setup

```bash
cd agent-tools-mvp
cp .env.example .env
npm install
npm run dev
```

## Main interface: `POST /execute`

`/execute` is the primary and recommended interface for all tool invocations.

### Request contract (exact)

```json
{
  "tool": "supabase_run_sql" | "github_upsert_file",
  "input": { ... }
}
```

### Response contract (exact)

```json
{
  "success": boolean,
  "message": string,
  "data": unknown,
  "error": string | null
}
```

## Legacy alias: `POST /tools/run`

`/tools/run` is a legacy alias for `/execute` and has the same behavior and response contract. Prefer `/execute` for all new integrations.

## Complete examples

### Example: `supabase_run_sql`

```bash
curl -X POST http://localhost:3000/execute \
  -H 'content-type: application/json' \
  -d '{
    "tool": "supabase_run_sql",
    "input": {
      "sql": "select now() as server_time"
    }
  }'
```

Example response:

```json
{
  "success": true,
  "message": "Health check RPC executed successfully",
  "data": [{ "ok": true }],
  "error": null
}
```

### Example: `github_upsert_file`

```bash
curl -X POST http://localhost:3000/execute \
  -H 'content-type: application/json' \
  -d '{
    "tool": "github_upsert_file",
    "input": {
      "repo": "my-repo",
      "path": "docs/agent-output.md",
      "content": "# Agent output\n\nHello from agent-tools-mvp.\n",
      "message": "docs: update agent output",
      "branch": "main"
    }
  }'
```

Example response:

```json
{
  "success": true,
  "message": "File updated successfully",
  "data": {
    "commitSha": "abc123...",
    "contentSha": "def456..."
  },
  "error": null
}
```

## Tool catalog

- `supabase_run_sql`: validates input and executes a controlled Supabase `health_check` RPC call (sandbox-only guardrails).
  - Required env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SANDBOX_PROJECT_REF`
- `github_upsert_file`: creates or updates a file in an allowlisted GitHub repository via the GitHub Contents API.
  - Required env: `GITHUB_OWNER`, `GITHUB_TOKEN`, `GITHUB_ALLOWED_REPOS` (comma-separated)

## Safety rules

- Supabase sandbox restriction: requests are rejected unless `SUPABASE_URL` project ref matches `SUPABASE_SANDBOX_PROJECT_REF`.
- GitHub repository allowlist: requests are rejected unless `input.repo` is present in `GITHUB_ALLOWED_REPOS`.
- No destructive production behavior: this MVP is intentionally constrained to sandbox/allowlisted operations only.

## Intended orchestrator flow

A future OpenAI agent (orchestrator) decides which tool to call (`supabase_run_sql` or `github_upsert_file`) and sends a request to `POST /execute` using the request contract above; this server validates, runs the tool, and returns the standard response contract.
