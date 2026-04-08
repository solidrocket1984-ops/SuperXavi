import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { githubUpsertFile, type GithubUpsertFileInput } from "./tools/github.js";
import { supabaseRunSql, type SupabaseRunSqlInput, type ToolResponse } from "./tools/supabase.js";

type SupportedToolName = "supabase_run_sql" | "github_upsert_file";

interface ToolRequestBody {
  tool: SupportedToolName;
  input: unknown;
}

type ResponseWriter = ServerResponse<IncomingMessage>;

interface ValidationResult<T> {
  ok: boolean;
  value?: T;
  error?: string;
}

const TOOL_ROUTES: Record<SupportedToolName, string> = {
  supabase_run_sql: "/tools/supabase/run-sql",
  github_upsert_file: "/tools/github/upsert-file",
};

function parsePort(raw?: string): number {
  const port = Number(raw ?? 3000);
  return Number.isInteger(port) && port > 0 ? port : 3000;
}

function jsonResponse<T>(res: ResponseWriter, statusCode: number, body: ToolResponse<T>): void {
  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function normalizedErrorResponse(message: string, error: string): ToolResponse<null> {
  return {
    success: false,
    message,
    data: null,
    error,
  };
}

async function readJsonBody(req: IncomingMessage): Promise<ValidationResult<unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  if (chunks.length === 0) {
    return { ok: false, error: "Request body is required" };
  }

  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { ok: false, error: "Invalid JSON body" };
  }
}

function validateExecuteBody(input: unknown): ValidationResult<ToolRequestBody> {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Body must be an object" };
  }

  const candidate = input as Partial<ToolRequestBody>;
  if (candidate.tool !== "supabase_run_sql" && candidate.tool !== "github_upsert_file") {
    return { ok: false, error: "tool must be one of: supabase_run_sql, github_upsert_file" };
  }

  if (candidate.input === undefined || candidate.input === null || typeof candidate.input !== "object") {
    return { ok: false, error: "input must be an object" };
  }

  return {
    ok: true,
    value: {
      tool: candidate.tool,
      input: candidate.input,
    },
  };
}

function validateSupabaseInput(input: unknown): ValidationResult<SupabaseRunSqlInput> {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "input must be an object" };
  }

  const { sql } = input as Partial<SupabaseRunSqlInput>;
  if (typeof sql !== "string" || sql.trim().length === 0) {
    return { ok: false, error: "input.sql must be a non-empty string" };
  }

  return { ok: true, value: { sql } };
}

function validateGithubInput(input: unknown): ValidationResult<GithubUpsertFileInput> {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "input must be an object" };
  }

  const candidate = input as Partial<GithubUpsertFileInput>;
  const requiredFields: Array<keyof GithubUpsertFileInput> = [
    "owner",
    "repo",
    "branch",
    "path",
    "content",
    "message",
  ];

  for (const field of requiredFields) {
    const value = candidate[field];
    if (typeof value !== "string" || value.trim().length === 0) {
      return { ok: false, error: `input.${field} must be a non-empty string` };
    }
  }

  if (candidate.sha !== undefined && typeof candidate.sha !== "string") {
    return { ok: false, error: "input.sha must be a string when provided" };
  }

  return {
    ok: true,
    value: {
      owner: candidate.owner!,
      repo: candidate.repo!,
      branch: candidate.branch!,
      path: candidate.path!,
      content: candidate.content!,
      message: candidate.message!,
      sha: candidate.sha,
    },
  };
}

async function runTool(tool: SupportedToolName, rawInput: unknown): Promise<ToolResponse> {
  if (tool === "supabase_run_sql") {
    const validated = validateSupabaseInput(rawInput);
    if (!validated.ok) {
      return normalizedErrorResponse("Validation failed", validated.error ?? "Invalid supabase input");
    }
    return supabaseRunSql(validated.value!);
  }

  const validated = validateGithubInput(rawInput);
  if (!validated.ok) {
    return normalizedErrorResponse("Validation failed", validated.error ?? "Invalid github input");
  }
  return githubUpsertFile(validated.value!);
}

function mapLegacyRouteToTool(pathname: string): SupportedToolName | null {
  const entry = (Object.entries(TOOL_ROUTES) as Array<[SupportedToolName, string]>).find(([, route]) => route === pathname);
  return entry?.[0] ?? null;
}

const server = createServer(async (req, res) => {
  try {
    if (req.method !== "POST") {
      jsonResponse(res, 405, normalizedErrorResponse("Method not allowed", "Use POST"));
      return;
    }

    const pathname = req.url ?? "";

    if (pathname === "/execute" || pathname === "/tools/run") {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) {
        jsonResponse(res, 400, normalizedErrorResponse("Invalid request body", parsed.error ?? "Unknown error"));
        return;
      }

      const validated = validateExecuteBody(parsed.value);
      if (!validated.ok) {
        jsonResponse(res, 400, normalizedErrorResponse("Validation failed", validated.error ?? "Invalid execute request"));
        return;
      }

      const result = await runTool(validated.value!.tool, validated.value!.input);
      jsonResponse(res, result.success ? 200 : 400, result);
      return;
    }

    const legacyTool = mapLegacyRouteToTool(pathname);
    if (legacyTool) {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) {
        jsonResponse(res, 400, normalizedErrorResponse("Invalid request body", parsed.error ?? "Unknown error"));
        return;
      }

      const result = await runTool(legacyTool, parsed.value);
      jsonResponse(res, result.success ? 200 : 400, result);
      return;
    }

    jsonResponse(res, 404, normalizedErrorResponse("Not found", "Route does not exist"));
  } catch (error) {
    jsonResponse(
      res,
      500,
      normalizedErrorResponse("Internal server error", error instanceof Error ? error.message : "Unknown error"),
    );
  }
});

const port = parsePort(process.env.PORT);
server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`agent-tools-mvp listening on http://localhost:${port}`);
});
