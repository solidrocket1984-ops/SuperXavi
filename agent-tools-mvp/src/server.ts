import { createServer } from "node:http";
import { githubUpsertFile, type GithubUpsertFileInput } from "./tools/github.js";
import { supabaseRunSql, type SupabaseRunSqlInput, type ToolResponse } from "./tools/supabase.js";

type SupportedToolName = "supabase_run_sql" | "github_upsert_file";

interface ToolRequestBody {
  tool: SupportedToolName;
  input: unknown;
}

function parsePort(raw?: string): number {
  const port = Number(raw ?? 3000);
  return Number.isInteger(port) && port > 0 ? port : 3000;
}

function jsonResponse<T>(
  res: Parameters<Parameters<typeof createServer>[0]>[1],
  statusCode: number,
  body: ToolResponse<T>,
): void {
  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/tools/run") {
    jsonResponse(res, 404, {
      success: false,
      message: "Not found",
      data: null,
      error: "Route does not exist",
    });
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
    jsonResponse(res, 400, {
      success: false,
      message: "Invalid request body",
      data: null,
      error: "Invalid JSON body",
    });
    return;
  }

  if (!body || typeof body.tool !== "string") {
    jsonResponse(res, 400, {
      success: false,
      message: "Invalid request body",
      data: null,
      error: "Missing tool name",
    });
    return;
  }

  let result: ToolResponse;
  if (body.tool === "supabase_run_sql") {
    result = await supabaseRunSql(body.input as SupabaseRunSqlInput);
  } else if (body.tool === "github_upsert_file") {
    result = await githubUpsertFile(body.input as GithubUpsertFileInput);
  } else {
    jsonResponse(res, 400, {
      success: false,
      message: "Unsupported tool",
      data: null,
      error: "Unsupported tool",
    });
    return;
  }

  jsonResponse(res, result.success ? 200 : 400, result);
});

const port = parsePort(process.env.PORT);
server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`agent-tools-mvp listening on http://localhost:${port}`);
});
