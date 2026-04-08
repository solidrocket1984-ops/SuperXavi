import { createServer } from "node:http";
import { githubUpsertFile, type GithubUpsertFileInput } from "./tools/github.js";
import { supabaseRunSql, type SupabaseRunSqlInput } from "./tools/supabase.js";

type SupportedToolName = "supabase_run_sql" | "github_upsert_file";

interface ToolRequestBody {
  tool: SupportedToolName;
  input: unknown;
}

function parsePort(raw?: string): number {
  const port = Number(raw ?? 3000);
  return Number.isInteger(port) && port > 0 ? port : 3000;
}

const server = createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/tools/run") {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "Not found" }));
    return;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  let body: ToolRequestBody;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as ToolRequestBody;
  } catch {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "Invalid JSON body" }));
    return;
  }

  if (!body || typeof body.tool !== "string") {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "Missing tool name" }));
    return;
  }

  // TODO: Replace with schema validation (e.g. zod) before production use.
  let result;
  if (body.tool === "supabase_run_sql") {
    result = await supabaseRunSql(body.input as SupabaseRunSqlInput);
  } else if (body.tool === "github_upsert_file") {
    result = await githubUpsertFile(body.input as GithubUpsertFileInput);
  } else {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "Unsupported tool" }));
    return;
  }

  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(result));
});

const port = parsePort(process.env.PORT);
server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`agent-tools-mvp listening on http://localhost:${port}`);
});
