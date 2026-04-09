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
  "tool": "supabase_run_sql" | "github_upsert_file" | "supabase_update_workspace_orchestration_trace" | "supabase_record_provisioning_trace",
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
        "message": "SQL RPC executed successfully",
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

`/orchestrate/provision-respondeya-web` is the first business-oriented orchestration for the RespondeYA / Enllaç ecosystem. It performs a deterministic 4-step flow:
1. Validate `workspaceId` and fetch the real workspace by `workspaceId` from Supabase (`public.client_workspaces` via `/rest/v1/client_workspaces?...`) including `account_id`, `project_id`, `metadata`, and `updated_at` (plus the existing workspace fields).
2. If the workspace exists, run `github_upsert_file` to create/update a JSON provision run artifact.
3. If the artifact write succeeds, run `supabase_update_workspace_orchestration_trace` to update `public.client_workspaces` and merge orchestration trace fields into `metadata` (`orchestrator_last_run_at`, `orchestrator_status`, `orchestrator_artifact_path`, `orchestrator_artifact_commit_sha`, `orchestrator_artifact_content_sha`, `orchestrator_name`) and set `updated_at = now()`, returning `id`, `status`, `metadata`, and `updated_at`.
4. Read `provisioning_job_id` from `workspace.metadata`:
   - If missing, return a normalized successful skipped/no-op step result.
   - If present, use `supabase_record_provisioning_trace` to insert an operational trace row into `public.provisioning_job_logs` and update `public.provisioning_jobs` (`current_step`, `updated_at`, and merged `result` JSONB trace fields).

Intended use:
- Record a provisioning run tied to a concrete `workspaceId`.
- Validate and read a real workspace before writing any artifact.
- Persist a lightweight JSON run artifact in a controlled GitHub path, including workspace summary and orchestration metadata.
- Record a real write-back trace in `public.client_workspaces.metadata` after artifact creation.
- When `provisioning_job_id` is present in workspace metadata, record a real operational trace in `public.provisioning_job_logs` and update `public.provisioning_jobs`.
- Keep orchestration execution deterministic and dependency-safe (`github_upsert_file` only runs after successful workspace lookup, and metadata write-back only runs after artifact success).

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
      },
      {
        "tool": "supabase_update_workspace_orchestration_trace",
        "success": true,
        "message": "Workspace orchestration trace updated successfully",
        "data": {
          "id": "3f9eb145-3e63-4f1f-aad8-1b7f0f7523aa",
          "status": "active",
          "metadata": {
            "orchestrator_status": "artifact_written"
          },
          "updated_at": "2026-01-01T00:00:00.000Z"
        },
        "error": null
      },
      {
        "tool": "supabase_record_provisioning_trace",
        "success": true,
        "message": "Provisioning trace recorded successfully",
        "data": {
          "inserted_log": { "id": "..." },
          "updated_job": { "id": "..." }
        },
        "error": null
      }
    ],
    "summary": "Step 1 succeeded; Step 2 succeeded; Step 3 succeeded; Step 4 completed."
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

- `supabase_run_sql`: validates input, attempts a controlled Supabase SQL RPC call with the provided `sql`, and preserves sandbox guardrails.
  - Required env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SANDBOX_PROJECT_REF`
- `supabase_update_workspace_orchestration_trace`: explicit domain write tool for provisioning orchestration workspace trace write-back (`public.client_workspaces` metadata merge + `updated_at`).
  - Required env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SANDBOX_PROJECT_REF`
- `supabase_record_provisioning_trace`: explicit domain write tool for provisioning job trace write-back (`public.provisioning_job_logs` insert + `public.provisioning_jobs` update).
  - Required env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SANDBOX_PROJECT_REF`
- `github_upsert_file`: creates or updates a file in an allowlisted GitHub repository via the GitHub Contents API.
  - Required env: `GITHUB_OWNER`, `GITHUB_TOKEN`, `GITHUB_ALLOWED_REPOS` (comma-separated)

Provisioning orchestration no longer uses business-specific SQL fallback parsing/emulation inside `supabase_run_sql`; it now calls explicit domain tools (`supabase_update_workspace_orchestration_trace` and `supabase_record_provisioning_trace`).

### Example: `supabase_update_workspace_orchestration_trace`

```bash
curl -X POST http://localhost:3000/execute \
  -H 'content-type: application/json' \
  -d '{
    "tool": "supabase_update_workspace_orchestration_trace",
    "input": {
      "workspaceId": "3cbd0059-5347-4e9c-acbc-3b3752dfd517",
      "trace": {
        "orchestrator_last_run_at": "2026-04-09T12:00:00.000Z",
        "orchestrator_status": "artifact_written",
        "orchestrator_artifact_path": "agent-tools-mvp/docs/provision-runs/3cbd0059-5347-4e9c-acbc-3b3752dfd517.json",
        "orchestrator_artifact_commit_sha": "abc123...",
        "orchestrator_artifact_content_sha": "def456...",
        "orchestrator_name": "provision-respondeya-web"
      }
    }
  }'
```

Example response:

```json
{
  "success": true,
  "message": "Workspace orchestration trace updated successfully",
  "data": {
    "id": "3cbd0059-5347-4e9c-acbc-3b3752dfd517",
    "status": "active",
    "metadata": {
      "orchestrator_status": "artifact_written"
    },
    "updated_at": "2026-04-09T12:00:00.000Z"
  },
  "error": null
}
```

### Example: `supabase_record_provisioning_trace`

```bash
curl -X POST http://localhost:3000/execute \
  -H 'content-type: application/json' \
  -d '{
    "tool": "supabase_record_provisioning_trace",
    "input": {
      "accountId": "11111111-1111-4111-8111-111111111111",
      "workspaceId": "3cbd0059-5347-4e9c-acbc-3b3752dfd517",
      "provisioningJobId": "22222222-2222-4222-8222-222222222222",
      "artifact": {
        "path": "agent-tools-mvp/docs/provision-runs/3cbd0059-5347-4e9c-acbc-3b3752dfd517.json",
        "commitSha": "abc123...",
        "contentSha": "def456..."
      },
      "orchestratorName": "provision-respondeya-web",
      "assistantId": null,
      "assistantVersionId": null,
      "seededKnowledgeItems": null
    }
  }'
```

Example response:

```json
{
  "success": true,
  "message": "Provisioning trace recorded successfully",
  "data": {
    "inserted_log": {
      "id": "..."
    },
    "updated_job": {
      "id": "..."
    }
  },
  "error": null
}
```

## Safety rules

- Supabase sandbox restriction: requests are rejected unless `SUPABASE_URL` project ref matches `SUPABASE_SANDBOX_PROJECT_REF`.
- GitHub repository allowlist: requests are rejected unless `input.repo` is present in `GITHUB_ALLOWED_REPOS`.
- No destructive production behavior: this MVP is intentionally constrained to sandbox/allowlisted operations only.

## Intended orchestrator flow

A future OpenAI agent (orchestrator) decides which tool to call (`supabase_run_sql`, `supabase_update_workspace_orchestration_trace`, `supabase_record_provisioning_trace`, or `github_upsert_file`) and sends a request to `POST /execute` using the request contract above; this server validates, runs the tool, and returns the standard response contract.
