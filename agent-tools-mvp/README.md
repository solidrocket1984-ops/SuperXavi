# agent-tools-mvp

Initial TypeScript scaffold for an AI-agent tool server.

## Tools (placeholders)

- `supabase_run_sql`
- `github_upsert_file`

Both tools intentionally return "not implemented" responses right now.

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
npm run dev
```

Then call the local endpoint:

```bash
curl -X POST http://localhost:3000/tools/run \
  -H 'content-type: application/json' \
  -d '{"tool":"supabase_run_sql","input":{"sql":"select 1"}}'
```

## Safety notes

- This is an MVP scaffold only.
- No production-safe execution logic is implemented yet.
- Add strict validation, authZ/authN, allow-lists, and auditing before real use.
