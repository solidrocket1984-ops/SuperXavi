import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { githubUpsertFile, type GithubUpsertFileInput } from "./tools/github.js";
import {
  supabaseFetchWorkspace,
  supabaseRunSql,
  type SupabaseRunSqlInput,
  type ToolResponse,
} from "./tools/supabase.js";

type SupportedToolName = "supabase_run_sql" | "github_upsert_file";

interface ToolRequestBody {
  tool: SupportedToolName;
  input: unknown;
}

interface OrchestrateDemoRequestBody {
  repo: string;
  path: string;
}

interface ProvisionRespondeyaWebRequestBody {
  workspaceId: string;
  repo: string;
  path: string;
}

interface OrchestrateDemoData {
  steps: OrchestrationStep[];
  summary: string;
}

interface OrchestrationStep {
  tool: string;
  success: boolean;
  message: string;
  data: unknown;
  error: string | null;
}

interface ProvisionRespondeyaWebData {
  workspaceId: string;
  workspaceFound: boolean;
  steps: OrchestrationStep[];
  summary: string;
}

const PRIMARY_EXECUTE_PATH = "/execute";
const LEGACY_EXECUTE_PATH = "/tools/run";
const ORCHESTRATE_DEMO_PATH = "/orchestrate/demo";
const ORCHESTRATE_PROVISION_RESPONDEYA_WEB_PATH = "/orchestrate/provision-respondeya-web";
const UUID_V4_OR_ANY_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function isProvisionRespondeyaWebRoute(method?: string, url?: string): boolean {
  if (method !== "POST" || !url) {
    return false;
  }

  return new URL(url, "http://localhost").pathname === ORCHESTRATE_PROVISION_RESPONDEYA_WEB_PATH;
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
  tool: string,
  response: ToolResponse,
): OrchestrationStep {
  return {
    tool,
    success: response.success,
    message: response.message,
    data: response.data,
    error: response.error,
  };
}

function toWorkspaceSummary(workspace: Record<string, unknown>): Record<string, unknown> {
  const summaryKeys = [
    "id",
    "account_id",
    "project_id",
    "status",
    "company_name",
    "lead_id",
    "product_id",
    "selected_plan",
    "selected_modules",
    "assistant_id",
    "active_assistant_version_id",
    "metadata",
    "updated_at",
  ] as const;
  const summary = summaryKeys.reduce<Record<string, unknown>>((acc, key) => {
    if (workspace[key] !== undefined) {
      acc[key] = workspace[key];
    }
    return acc;
  }, {});

  if (Object.keys(summary).length > 0) {
    return summary;
  }

  return { id: workspace.id ?? null };
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

function validateProvisionRespondeyaWebBody(body: unknown): string | null {
  if (!body || typeof body !== "object") {
    return "Request body is required";
  }

  const candidate = body as Partial<ProvisionRespondeyaWebRequestBody>;
  if (typeof candidate.workspaceId !== "string" || candidate.workspaceId.trim() === "") {
    return "Field 'workspaceId' must be a non-empty string";
  }

  if (!UUID_V4_OR_ANY_UUID_REGEX.test(candidate.workspaceId.trim())) {
    return "Field 'workspaceId' must be a valid UUID";
  }

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
    const step2: OrchestrationStep = {
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

async function orchestrateProvisionRespondeyaWeb(
  input: ProvisionRespondeyaWebRequestBody,
): Promise<ToolResponse<ProvisionRespondeyaWebData>> {
  const orchestrationName = "provision-respondeya-web";
  const startedAt = new Date().toISOString();
  const workspaceResult = await supabaseFetchWorkspace({ workspaceId: input.workspaceId });
  const step1 = normalizeStep("supabase_fetch_workspace", workspaceResult);

  if (!workspaceResult.success) {
    const notFound = workspaceResult.message === "Workspace not found";
    return {
      success: false,
      message: "Provision orchestration failed",
      data: {
        workspaceId: input.workspaceId,
        workspaceFound: false,
        steps: [step1],
        summary: notFound
          ? "Step 1 failed (workspace not found); Step 2 not executed; Step 3 not executed; Step 4 not executed."
          : "Step 1 failed; Step 2 not executed; Step 3 not executed; Step 4 not executed.",
      },
      error: notFound ? "workspace not found" : "supabase_fetch_workspace failed",
    };
  }

  const workspaceSummary = toWorkspaceSummary(workspaceResult.data as Record<string, unknown>);
  const githubPayload = {
    workspaceId: input.workspaceId,
    orchestrationName,
    timestamp: startedAt,
    workspaceSummary,
    status: "completed",
    note: "Real workspace-aware provisioning orchestration using public.client_workspaces as the first execution step.",
  };

  const githubResult = await githubUpsertFile({
    repo: input.repo,
    path: input.path,
    content: JSON.stringify(githubPayload, null, 2) + "\n",
    message: `chore: record ${orchestrationName} run for ${input.workspaceId}`,
  });
  const step2 = normalizeStep("github_upsert_file", githubResult);

  if (!githubResult.success) {
    return {
      success: false,
      message: "Provision orchestration failed",
      data: {
        workspaceId: input.workspaceId,
        workspaceFound: true,
        steps: [step1, step2],
        summary: "Step 1 succeeded; Step 2 failed; Step 3 not executed; Step 4 not executed.",
      },
      error: "github_upsert_file failed",
    };
  }

  const githubData = (githubResult.data ?? {}) as Record<string, unknown>;
  const metadataPatch = {
    orchestrator_last_run_at: startedAt,
    orchestrator_status: "artifact_written",
    orchestrator_artifact_path: input.path,
    orchestrator_artifact_commit_sha:
      typeof githubData.commitSha === "string" ? githubData.commitSha : null,
    orchestrator_artifact_content_sha:
      typeof githubData.contentSha === "string" ? githubData.contentSha : null,
    orchestrator_name: orchestrationName,
  };
  const writeBackSql = `
update public.client_workspaces
set
  metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify(metadataPatch)}::jsonb,
  updated_at = now()
where id = '${input.workspaceId}'::uuid
returning id, status, metadata, updated_at;
`.trim();
  const writeBackResult = await supabaseRunSql({ sql: writeBackSql });
  const step3 = normalizeStep("supabase_run_sql", writeBackResult);

  if (!writeBackResult.success) {
    return {
      success: false,
      message: "Provision orchestration failed",
      data: {
        workspaceId: input.workspaceId,
        workspaceFound: true,
        steps: [step1, step2, step3],
        summary: "Step 1 succeeded; Step 2 succeeded; Step 3 failed; Step 4 not executed.",
      },
      error: "supabase_run_sql failed",
    };
  }

  const workspace = (workspaceResult.data ?? {}) as Record<string, unknown>;
  const workspaceMetadata =
    workspace.metadata && typeof workspace.metadata === "object" && !Array.isArray(workspace.metadata)
      ? (workspace.metadata as Record<string, unknown>)
      : {};
  const provisioningJobId =
    typeof workspaceMetadata.provisioning_job_id === "string"
      ? workspaceMetadata.provisioning_job_id.trim()
      : "";

  let step4: OrchestrationStep;
  if (!provisioningJobId) {
    step4 = {
      tool: "supabase_run_sql",
      success: true,
      message: "Skipped Step 4: provisioning_job_id was not found in workspace metadata (no-op)",
      data: {
        skipped: true,
        reason: "Missing provisioning_job_id in workspace.metadata",
      },
      error: null,
    };
  } else {
    const completedAt = new Date().toISOString();
    const accountId = typeof workspace.account_id === "string" ? workspace.account_id : null;
    const githubCommitSha = typeof githubData.commitSha === "string" ? githubData.commitSha : null;
    const githubContentSha = typeof githubData.contentSha === "string" ? githubData.contentSha : null;
    const step4Data = {
      workspaceId: input.workspaceId,
      orchestrator_name: orchestrationName,
      artifact_path: input.path,
      artifact_commit_sha: githubCommitSha,
      artifact_content_sha: githubContentSha,
      completed_at: completedAt,
    };
    const step4ResultPatch = {
      workspaceId: input.workspaceId,
      orchestrator_name: orchestrationName,
      artifact_path: input.path,
      artifact_commit_sha: githubCommitSha,
      artifact_content_sha: githubContentSha,
      last_orchestrated_at: completedAt,
    };
    const step4Sql = `
/* provisioning_trace_write_back */
-- account_id: ${accountId ?? "null"}
-- job_id: ${provisioningJobId}
-- log_data: ${JSON.stringify(step4Data)}
-- job_result_patch: ${JSON.stringify(step4ResultPatch)}
with inserted_log as (
  insert into public.provisioning_job_logs (
    account_id,
    job_id,
    step_code,
    step_status,
    message,
    data
  )
  values (
    ${accountId ? `'${accountId}'::uuid` : "null"},
    '${provisioningJobId}'::uuid,
    'orchestrate_provision_respondeya_web',
    'completed',
    'Workspace-aware orchestration completed',
    '${JSON.stringify(step4Data)}'::jsonb
  )
  returning *
),
updated_job as (
  update public.provisioning_jobs
  set
    current_step = 'orchestrator_trace_written',
    updated_at = now(),
    result = coalesce(result, '{}'::jsonb) || '${JSON.stringify(step4ResultPatch)}'::jsonb
  where id = '${provisioningJobId}'::uuid
  returning *
)
select
  (select row_to_json(inserted_log) from inserted_log) as inserted_log,
  (select row_to_json(updated_job) from updated_job) as updated_job;
`.trim();
    const step4Result = await supabaseRunSql({ sql: step4Sql });
    step4 = normalizeStep("supabase_run_sql", step4Result);

    if (!step4Result.success) {
      return {
        success: false,
        message: "Provision orchestration failed",
        data: {
          workspaceId: input.workspaceId,
          workspaceFound: true,
          steps: [step1, step2, step3, step4],
          summary: "Step 1 succeeded; Step 2 succeeded; Step 3 succeeded; Step 4 failed.",
        },
        error: "supabase_run_sql failed",
      };
    }
  }

  return {
    success: true,
    message: "Provision orchestration completed successfully",
    data: {
      workspaceId: input.workspaceId,
      workspaceFound: true,
      steps: [step1, step2, step3, step4],
      summary: "Step 1 succeeded; Step 2 succeeded; Step 3 succeeded; Step 4 completed.",
    },
    error: null,
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

  if (isProvisionRespondeyaWebRoute(req.method, req.url)) {
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      invalidRequestBodyResponse(res, "Invalid JSON body");
      return;
    }

    const validationError = validateProvisionRespondeyaWebBody(body);
    if (validationError) {
      invalidRequestBodyResponse(res, validationError);
      return;
    }

    const result = await orchestrateProvisionRespondeyaWeb(body as ProvisionRespondeyaWebRequestBody);
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
    `agent-tools-mvp listening on http://localhost:${port} (POST ${PRIMARY_EXECUTE_PATH}, POST ${ORCHESTRATE_DEMO_PATH}, POST ${ORCHESTRATE_PROVISION_RESPONDEYA_WEB_PATH}, legacy: ${LEGACY_EXECUTE_PATH})`,
  );
});
