import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { githubUpsertFile, type GithubUpsertFileInput } from "./tools/github.js";
import { supabaseRunSql, type SupabaseRunSqlInput, type ToolResponse } from "./tools/supabase.js";

type SupportedToolName = "supabase_run_sql" | "github_upsert_file";

interface ToolRequestBody {
  tool: SupportedToolName;
  input: unknown;
}

interface OrchestrateDemoRequestBody {
  repo: string;
  path: string;
}

interface OrchestrateDemoStep {
  tool: "supabase_run_sql" | "github_upsert_file";
  success: boolean;
  message: string;
  data: unknown;
  error: string | null;
}

interface OrchestrateDemoData {
  steps: [OrchestrateDemoStep, OrchestrateDemoStep];
  summary: string;
}

const PRIMARY_EXECUTE_PATH = "/execute";
const LEGACY_EXECUTE_PATH = "/tools/run";
const ORCHESTRATE_DEMO_PATH = "/orchestrate/demo";

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

function isOrchestrateDemoRoute(method?: string, url?: string): boolean {
  if (method !== "POST" || !url) {
    return false;
  }

  return new URL(url, "http://localhost").pathname === ORCHESTRATE_DEMO_PATH;
}

function invalidRequestBodyResponse(res: ServerResponse, error: string): void {
  jsonResponse(res, 400, {
    success: false,
    message: "Invalid request body",
    data: null,
    error,
  });
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(rawBody);
}

async function runTool(body: ToolRequestBody): Promise<ToolResponse> {
  if (body.tool === "supabase_run_sql") {
    return supabaseRunSql(body.input as SupabaseRunSqlInput);
  }

  return githubUpsertFile(body.input as GithubUpsertFileInput);
}

function normalizeStep(
  tool: OrchestrateDemoStep["tool"],
  response: ToolResponse,
): OrchestrateDemoStep {
  return {
    tool,
    success: response.success,
    message: response.message,
    data: response.data,
    error: response.error,
  };
}

function validateOrchestrateDemoBody(body: unknown): string | null {
  if (!body || typeof body !== "object") {
    return "Request body is required";
  }

  const candidate = body as Partial<OrchestrateDemoRequestBody>;
  if (typeof candidate.repo !== "string" || candidate.repo.trim() === "") {
    return "Field 'repo' must be a non-empty string";
  }

  if (typeof candidate.path !== "string" || candidate.path.trim() === "") {
    return "Field 'path' must be a non-empty string";
  }

  return null;
}

async function orchestrateDemo(input: OrchestrateDemoRequestBody): Promise<ToolResponse<OrchestrateDemoData>> {
  const supabaseResult = await supabaseRunSql({ sql: "select now() as server_time" });
  const step1 = normalizeStep("supabase_run_sql", supabaseResult);

  if (!supabaseResult.success) {
    const step2: OrchestrateDemoStep = {
      tool: "github_upsert_file",
      success: false,
      message: "Skipped because supabase_run_sql failed",
      data: null,
      error: "Dependency step failed",
    };

    return {
      success: false,
      message: "Demo orchestration failed",
      data: {
        steps: [step1, step2],
        summary: "Step 1 failed; Step 2 skipped.",
      },
      error: "supabase_run_sql failed",
    };
  }

  const timestamp = new Date().toISOString();
  const githubContent = [
    "# Orchestrator Demo Run",
    "",
    `Timestamp: ${timestamp}`,
    `Supabase health check result: ${JSON.stringify(supabaseResult.data)}`,
    "",
    "Note: This is a demo orchestration run.",
    "",
  ].join("\n");

  const githubResult = await githubUpsertFile({
    repo: input.repo,
    path: input.path,
    content: githubContent,
    message: "chore: update orchestrator demo output",
  });
  const step2 = normalizeStep("github_upsert_file", githubResult);

  return {
    success: githubResult.success,
    message: githubResult.success ? "Demo orchestration completed successfully" : "Demo orchestration failed",
    data: {
      steps: [step1, step2],
      summary: githubResult.success
        ? "Step 1 succeeded; Step 2 succeeded."
        : "Step 1 succeeded; Step 2 failed.",
    },
    error: githubResult.success ? null : "github_upsert_file failed",
  };
}

const server = createServer(async (req, res) => {
  if (isExecuteRoute(req.method, req.url)) {
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      invalidRequestBodyResponse(res, "Invalid JSON body");
      return;
    }

    if (!body || typeof body !== "object" || !("tool" in body) || typeof body.tool !== "string") {
      invalidRequestBodyResponse(res, "Missing tool name");
      return;
    }

    const toolBody = body as ToolRequestBody;

    if (toolBody.tool !== "supabase_run_sql" && toolBody.tool !== "github_upsert_file") {
      jsonResponse(res, 400, {
        success: false,
        message: "Unsupported tool",
        data: null,
        error: "Unsupported tool",
      });
      return;
    }

    const result = await runTool(toolBody);
    jsonResponse(res, result.success ? 200 : 400, result);
    return;
  }

  if (isOrchestrateDemoRoute(req.method, req.url)) {
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      invalidRequestBodyResponse(res, "Invalid JSON body");
      return;
    }

    const validationError = validateOrchestrateDemoBody(body);
    if (validationError) {
      invalidRequestBodyResponse(res, validationError);
      return;
    }

    const result = await orchestrateDemo(body as OrchestrateDemoRequestBody);
    jsonResponse(res, result.success ? 200 : 400, result);
    return;
  }

  jsonResponse(res, 404, {
    success: false,
    message: "Not found",
    data: null,
    error: "Route does not exist",
  });
});

const port = parsePort(process.env.PORT);
server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(
    `agent-tools-mvp listening on http://localhost:${port} (POST ${PRIMARY_EXECUTE_PATH}, POST ${ORCHESTRATE_DEMO_PATH}, legacy: ${LEGACY_EXECUTE_PATH})`,
  );
});
