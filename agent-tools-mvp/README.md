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

## Demo orchestration endpoint: `POST /orchestrate/demo`

`/orchestrate/demo` is a demo-only endpoint that performs a deterministic 2-step orchestration:
1. Run `supabase_run_sql` with the existing `health_check` RPC behavior.
2. If step 1 succeeds, run `github_upsert_file` to create/update a file in an allowlisted repo.

This endpoint is intentionally minimal and explicit for demonstration. It is **not** the final orchestration architecture.

Request example:

```json
{
  "repo": "SuperXavi",
  "path": "agent-tools-mvp/docs/orchestrator-demo.txt"
}
```

Response example:

```json
{
  "success": true,
  "message": "Demo orchestration completed successfully",
  "data": {
    "steps": [
      {
        "tool": "supabase_run_sql",
        "success": true,
        "message": "Health check RPC executed successfully",
        "data": [{ "ok": true }],
        "error": null
      },
      {
        "tool": "github_upsert_file",
        "success": true,
        "message": "File updated successfully",
        "data": {
          "commitSha": "abc123...",
          "contentSha": "def456..."
        },
        "error": null
      }
    ],
    "summary": "Step 1 succeeded; Step 2 succeeded."
  },
  "error": null
}
```

Future full orchestration is intended to live in SuperXavi. This repo remains the execution layer with `/execute` as the main low-level interface.

## Business orchestration endpoint: `POST /orchestrate/provision-respondeya-web`

`/orchestrate/provision-respondeya-web` is the first business-oriented orchestration for the RespondeYA / Enllaç ecosystem. It performs a deterministic 3-step flow:
1. Run `supabase_run_sql` with the existing `health_check` RPC behavior.
2. If step 1 succeeds, fetch the real workspace by `workspaceId` from Supabase (`public.client_workspaces` via `/rest/v1/client_workspaces?...`).
3. If the workspace exists, run `github_upsert_file` to create/update a JSON provision run artifact.

Intended use:
- Record a provisioning run tied to a concrete `workspaceId`.
- Validate and read a real workspace before writing any artifact.
- Persist a lightweight JSON run artifact in a controlled GitHub path, including workspace summary + Supabase health result.
- Keep orchestration execution deterministic and dependency-safe (`github_upsert_file` only runs after successful Supabase health check and successful workspace lookup).

Request example:

```json
{
  "workspaceId": "3f9eb145-3e63-4f1f-aad8-1b7f0f7523aa",
  "repo": "SuperXavi",
  "path": "agent-tools-mvp/docs/provision-runs/3f9eb145-3e63-4f1f-aad8-1b7f0f7523aa.json"
}
```

Response example:

```json
{
  "success": true,
  "message": "Provision orchestration completed successfully",
  "data": {
    "workspaceId": "3f9eb145-3e63-4f1f-aad8-1b7f0f7523aa",
    "workspaceFound": true,
    "steps": [
      {
        "tool": "supabase_run_sql",
        "success": true,
        "message": "Health check RPC executed successfully",
        "data": [{ "ok": true }],
        "error": null
      },
      {
        "tool": "supabase_fetch_workspace",
        "success": true,
        "message": "Workspace fetched successfully",
        "data": {
          "id": "3f9eb145-3e63-4f1f-aad8-1b7f0f7523aa"
        },
        "error": null
      },
      {
        "tool": "github_upsert_file",
        "success": true,
        "message": "File updated successfully",
        "data": {
          "commitSha": "abc123...",
          "contentSha": "def456..."
        },
        "error": null
      }
    ],
    "summary": "Step 1 succeeded; Step 2 succeeded; Step 3 succeeded."
  },
  "error": null
}
```

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
