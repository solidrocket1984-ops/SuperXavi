import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { githubUpsertFile, type GithubUpsertFileInput } from "./tools/github.js";
import { supabaseRunSql, type SupabaseRunSqlInput, type ToolResponse } from "./tools/supabase.js";

type SupportedToolName = "supabase_run_sql" | "github_upsert_file";

interface ToolRequestBody {
  tool: SupportedToolName;
  input: unknown;
}

const PRIMARY_EXECUTE_PATH = "/execute";
const LEGACY_EXECUTE_PATH = "/tools/run";

function parsePort(raw?: string): number {
  const port = Number(raw ?? 3000);
  return Number.isInteger(port) && port > 0 ? port : 3000;
}

function jsonResponse<T>(res: ServerResponse, statusCode: number, body: ToolResponse<T>): void {
  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function isExecuteRoute(method?: string, url?: string): boolean {
  if (method !== "POST" || !url) {
    return false;
  }

  const pathname = new URL(url, "http://localhost").pathname;
  return pathname === PRIMARY_EXECUTE_PATH || pathname === LEGACY_EXECUTE_PATH;
}

function invalidRequestBodyResponse(res: ServerResponse, error: string): void {
  jsonResponse(res, 400, {
    success: false,
    message: "Invalid request body",
    data: null,
    error,
  });
}

async function readJsonBody(req: IncomingMessage): Promise<ToolRequestBody | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(rawBody) as ToolRequestBody;
}

async function runTool(body: ToolRequestBody): Promise<ToolResponse> {
  if (body.tool === "supabase_run_sql") {
    return supabaseRunSql(body.input as SupabaseRunSqlInput);
  }

  return githubUpsertFile(body.input as GithubUpsertFileInput);
}

const server = createServer(async (req, res) => {
  if (!isExecuteRoute(req.method, req.url)) {
    jsonResponse(res, 404, {
      success: false,
      message: "Not found",
      data: null,
      error: "Route does not exist",
    });
    return;
  }

  let body: ToolRequestBody | null = null;
  try {
    body = await readJsonBody(req);
  } catch {
    invalidRequestBodyResponse(res, "Invalid JSON body");
    return;
  }

  if (!body || typeof body.tool !== "string") {
    invalidRequestBodyResponse(res, "Missing tool name");
    return;
  }

  if (body.tool !== "supabase_run_sql" && body.tool !== "github_upsert_file") {
    jsonResponse(res, 400, {
      success: false,
      message: "Unsupported tool",
      data: null,
      error: "Unsupported tool",
    });
    return;
  }

  const result = await runTool(body);
  jsonResponse(res, result.success ? 200 : 400, result);
});

const port = parsePort(process.env.PORT);
server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(
    `agent-tools-mvp listening on http://localhost:${port} (POST ${PRIMARY_EXECUTE_PATH}, legacy: ${LEGACY_EXECUTE_PATH})`,
  );
});
