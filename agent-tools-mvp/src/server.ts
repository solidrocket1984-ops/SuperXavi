import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
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

async function parseJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

const server = createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/github/upsert-file") {
    try {
      const input = await parseJsonBody<GithubUpsertFileInput>(req);
      const result = await githubUpsertFile(input);
      sendJson(res, result.ok ? 200 : 400, result);
      return;
    } catch {
      sendJson(res, 400, { ok: false, error: "Invalid JSON body" });
      return;
    }
  }

  if (req.method === "POST" && req.url === "/tools/run") {
    let body: ToolRequestBody;
    try {
      body = await parseJsonBody<ToolRequestBody>(req);
    } catch {
      sendJson(res, 400, { ok: false, error: "Invalid JSON body" });
      return;
    }

    if (!body || typeof body.tool !== "string") {
      sendJson(res, 400, { ok: false, error: "Missing tool name" });
      return;
    }

    let result;
    if (body.tool === "supabase_run_sql") {
      result = await supabaseRunSql(body.input as SupabaseRunSqlInput);
    } else if (body.tool === "github_upsert_file") {
      result = await githubUpsertFile(body.input as GithubUpsertFileInput);
    } else {
      sendJson(res, 400, { ok: false, error: "Unsupported tool" });
      return;
    }

    sendJson(res, result.ok ? 200 : 400, result);
    return;
  }

  sendJson(res, 404, { ok: false, error: "Not found" });
});

const port = parsePort(process.env.PORT);
server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`agent-tools-mvp listening on http://localhost:${port}`);
});
