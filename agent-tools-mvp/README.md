# agent-tools-mvp

Initial TypeScript scaffold for an AI-agent tool server.

## Tools

- `supabase_run_sql` (placeholder)
- `github_upsert_file` (working: create/update one file in an allowlisted repository)

## Project structure

```text
agent-tools-mvp/
├── .env.example
├── package.json
├── README.md
├── tsconfig.json
└── src/
    ├── server.ts
    └── tools/
        ├── github.ts
        └── supabase.ts
```

## Quick start

```bash
cd agent-tools-mvp
npm install
cp .env.example .env
npm run dev
```

## Environment variables

```bash
# GitHub
GITHUB_TOKEN=ghp_xxx
GITHUB_OWNER=your-org-or-user
GITHUB_ALLOWED_REPOS=repo-a,repo-b
GITHUB_DEFAULT_BRANCH=main
```

Notes:
- `GITHUB_ALLOWED_REPOS` is the repository allowlist.
- `GITHUB_REPO` is still supported as a backward-compatible single-repo fallback.

## Endpoints

### 1) Generic tool runner

```bash
POST /tools/run
```

Example:

```bash
curl -X POST http://localhost:3000/tools/run \
  -H 'content-type: application/json' \
  -d '{"tool":"supabase_run_sql","input":{"sql":"select 1"}}'
```

### 2) GitHub file upsert endpoint

```bash
POST /github/upsert-file
```

Sample request body for testing:

```json
{
  "repo": "repo-a",
  "path": "docs/agent-note.md",
  "content": "# Hello\n\nCreated by github_upsert_file.",
  "message": "docs: add agent note",
  "branch": "main"
}
```

Curl example:

```bash
curl -X POST http://localhost:3000/github/upsert-file \
  -H 'content-type: application/json' \
  -d '{
    "repo": "repo-a",
    "path": "docs/agent-note.md",
    "content": "# Hello\\n\\nCreated by github_upsert_file.",
    "message": "docs: add agent note",
    "branch": "main"
  }'
```

## Behavior and validation for `github_upsert_file`

- Uses `GITHUB_OWNER` + token from env (owner is not accepted from request body).
- Allows only repositories listed in `GITHUB_ALLOWED_REPOS` (or fallback `GITHUB_REPO`).
- Validates:
  - `repo` is non-empty and allowlisted
  - `path` is a safe relative path (no leading slash, no `..`, no backslashes)
  - `content` is non-empty (with a size cap)
  - `message` is non-empty and bounded
- If file exists, fetches current file SHA first, then sends SHA in `PUT /contents` request.
- Returns structured JSON with `ok`, `data`/`error`, and `meta`.

## Safety notes

- This is still an MVP server.
- Add authN/authZ, richer auditing, and policy checks before production use.
