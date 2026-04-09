import { EnvHttpProxyAgent, fetch as undiciFetch } from "undici";

export interface SupabaseRunSqlInput {
  sql: string;
}

export interface SupabaseFetchWorkspaceInput {
  workspaceId: string;
}

export interface SupabaseUpdateWorkspaceOrchestrationTraceInput {
  workspaceId: string;
  trace: {
    orchestrator_last_run_at: string;
    orchestrator_status: string;
    orchestrator_artifact_path: string;
    orchestrator_artifact_commit_sha: string;
    orchestrator_artifact_content_sha: string;
    orchestrator_name: string;
  };
}

export interface SupabaseRecordProvisioningTraceInput {
  accountId: string;
  workspaceId: string;
  provisioningJobId: string;
  artifact: {
    path: string;
    commitSha: string;
    contentSha: string;
  };
  orchestratorName: string;
  assistantId: string | null;
  assistantVersionId: string | null;
  seededKnowledgeItems: number | null;
}

export interface ToolResponse<TData = unknown> {
  success: boolean;
  message: string;
  data: TData | null;
  error: string | null;
}

interface PgQueryResponseRow {
  [key: string]: unknown;
}

type WorkspaceRecord = Record<string, unknown>;
type ProvisioningTraceRecord = { inserted_log: Record<string, unknown> | null; updated_job: Record<string, unknown> | null };

const proxyAgent = new EnvHttpProxyAgent();

function getRequiredEnv(name: "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function assertSandboxProject(supabaseUrl: string): void {
  const configuredRef = process.env.SUPABASE_SANDBOX_PROJECT_REF?.trim();
  if (!configuredRef) {
    throw new Error("SUPABASE_SANDBOX_PROJECT_REF is required");
  }

  const hostname = new URL(supabaseUrl).hostname;
  const projectRef = hostname.split(".")[0] ?? "";

  if (projectRef !== configuredRef) {
    throw new Error("Supabase project is not allowed. Only sandbox project is permitted");
  }
}

function parseJsonSafely(rawBody: string): unknown {
  if (!rawBody.trim()) {
    return null;
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    return rawBody;
  }
}

function getSupabaseConfig(): { supabaseUrl: string; serviceRoleKey: string } {
  const supabaseUrl = getRequiredEnv("SUPABASE_URL");
  const serviceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  assertSandboxProject(supabaseUrl);
  return { supabaseUrl, serviceRoleKey };
}

async function updateClientWorkspaceTrace(
  supabaseUrl: string,
  serviceRoleKey: string,
  request: SupabaseUpdateWorkspaceOrchestrationTraceInput,
): Promise<ToolResponse<WorkspaceRecord>> {
  const headers = {
    "content-type": "application/json",
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    accept: "application/json",
  };
  const basePath = `${supabaseUrl}/rest/v1/client_workspaces`;
  const selectFields = "id,status,metadata,updated_at";
  const rowFilter = `id=eq.${encodeURIComponent(request.workspaceId)}`;
  const fetchResponse = await undiciFetch(`${basePath}?${rowFilter}&select=${selectFields}`, {
    dispatcher: proxyAgent,
    method: "GET",
    headers,
  });
  const fetchRawBody = await fetchResponse.text();
  const fetchParsedBody = parseJsonSafely(fetchRawBody);
  if (!fetchResponse.ok) {
    const errorText =
      typeof fetchParsedBody === "string"
        ? fetchParsedBody
        : JSON.stringify(fetchParsedBody) || `HTTP ${fetchResponse.status}`;
    return {
      success: false,
      message: "Supabase RPC failed",
      data: null,
      error: errorText,
    };
  }
  if (!Array.isArray(fetchParsedBody) || fetchParsedBody.length === 0) {
    return {
      success: false,
      message: "Workspace trace update failed",
      data: null,
      error: "Workspace not found for metadata write-back",
    };
  }
  const row = fetchParsedBody[0] as Record<string, unknown>;
  const existingMetadata =
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {};
  const mergedMetadata = { ...existingMetadata, ...request.trace };

  const updateResponse = await undiciFetch(`${basePath}?${rowFilter}&select=${selectFields}`, {
    dispatcher: proxyAgent,
    method: "PATCH",
    headers: {
      ...headers,
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      metadata: mergedMetadata,
      updated_at: new Date().toISOString(),
    }),
  });
  const updateRawBody = await updateResponse.text();
  const updateParsedBody = parseJsonSafely(updateRawBody);
  if (!updateResponse.ok) {
    const errorText =
      typeof updateParsedBody === "string"
        ? updateParsedBody
        : JSON.stringify(updateParsedBody) || `HTTP ${updateResponse.status}`;
    return {
      success: false,
      message: "Workspace trace update failed",
      data: null,
      error: errorText,
    };
  }
  const payload =
    Array.isArray(updateParsedBody) && updateParsedBody.length > 0
      ? (updateParsedBody[0] as WorkspaceRecord)
      : (updateParsedBody as WorkspaceRecord);
  return {
    success: true,
    message: "Workspace orchestration trace updated successfully",
    data: payload,
    error: null,
  };
}

async function recordProvisioningTrace(
  supabaseUrl: string,
  serviceRoleKey: string,
  request: SupabaseRecordProvisioningTraceInput,
): Promise<ToolResponse<ProvisioningTraceRecord>> {
  const headers = {
    "content-type": "application/json",
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    accept: "application/json",
  };

  const insertedLogResponse = await undiciFetch(`${supabaseUrl}/rest/v1/provisioning_job_logs?select=*`, {
    dispatcher: proxyAgent,
    method: "POST",
    headers: {
      ...headers,
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      account_id: request.accountId,
      job_id: request.provisioningJobId,
      step_code: "orchestrate_provision_respondeya_web",
      step_status: "completed",
      message: "Workspace-aware orchestration completed",
      data: {
        workspaceId: request.workspaceId,
        orchestrator_name: request.orchestratorName,
        artifact_path: request.artifact.path,
        artifact_commit_sha: request.artifact.commitSha,
        artifact_content_sha: request.artifact.contentSha,
        assistant_id: request.assistantId,
        assistant_version_id: request.assistantVersionId,
        seeded_knowledge_items: request.seededKnowledgeItems,
        completed_at: new Date().toISOString(),
      },
    }),
  });
  const insertedLogRawBody = await insertedLogResponse.text();
  const insertedLogParsedBody = parseJsonSafely(insertedLogRawBody);
  if (!insertedLogResponse.ok) {
    const errorText =
      typeof insertedLogParsedBody === "string"
        ? insertedLogParsedBody
        : JSON.stringify(insertedLogParsedBody) || `HTTP ${insertedLogResponse.status}`;
    return {
      success: false,
      message: "Supabase RPC failed",
      data: null,
      error: errorText,
    };
  }
  const insertedLog =
    Array.isArray(insertedLogParsedBody) && insertedLogParsedBody.length > 0
      ? (insertedLogParsedBody[0] as Record<string, unknown>)
      : null;

  const fetchJobResponse = await undiciFetch(
    `${supabaseUrl}/rest/v1/provisioning_jobs?id=eq.${encodeURIComponent(request.provisioningJobId)}&select=*`,
    {
      dispatcher: proxyAgent,
      method: "GET",
      headers,
    },
  );
  const fetchJobRawBody = await fetchJobResponse.text();
  const fetchJobParsedBody = parseJsonSafely(fetchJobRawBody);
  if (!fetchJobResponse.ok) {
    const errorText =
      typeof fetchJobParsedBody === "string"
        ? fetchJobParsedBody
        : JSON.stringify(fetchJobParsedBody) || `HTTP ${fetchJobResponse.status}`;
    return {
      success: false,
      message: "Provisioning trace write failed",
      data: null,
      error: errorText,
    };
  }
  if (!Array.isArray(fetchJobParsedBody) || fetchJobParsedBody.length === 0) {
    return {
      success: false,
      message: "Provisioning trace write failed",
      data: null,
      error: "Provisioning job not found for update",
    };
  }
  const jobRow = fetchJobParsedBody[0] as Record<string, unknown>;
  const existingResult =
    jobRow.result && typeof jobRow.result === "object" && !Array.isArray(jobRow.result)
      ? (jobRow.result as Record<string, unknown>)
      : {};
  const mergedResult = {
    ...existingResult,
    workspaceId: request.workspaceId,
    orchestrator_name: request.orchestratorName,
    artifact_path: request.artifact.path,
    artifact_commit_sha: request.artifact.commitSha,
    artifact_content_sha: request.artifact.contentSha,
    assistant_id: request.assistantId,
    assistant_version_id: request.assistantVersionId,
    seeded_knowledge_items: request.seededKnowledgeItems,
    last_orchestrated_at: new Date().toISOString(),
  };

  const updatedJobResponse = await undiciFetch(
    `${supabaseUrl}/rest/v1/provisioning_jobs?id=eq.${encodeURIComponent(request.provisioningJobId)}&select=*`,
    {
      dispatcher: proxyAgent,
      method: "PATCH",
      headers: {
        ...headers,
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        current_step: "orchestrator_trace_written",
        updated_at: new Date().toISOString(),
        result: mergedResult,
      }),
    },
  );
  const updatedJobRawBody = await updatedJobResponse.text();
  const updatedJobParsedBody = parseJsonSafely(updatedJobRawBody);
  if (!updatedJobResponse.ok) {
    const errorText =
      typeof updatedJobParsedBody === "string"
        ? updatedJobParsedBody
        : JSON.stringify(updatedJobParsedBody) || `HTTP ${updatedJobResponse.status}`;
    return {
      success: false,
      message: "Provisioning trace write failed",
      data: null,
      error: errorText,
    };
  }
  const updatedJob =
    Array.isArray(updatedJobParsedBody) && updatedJobParsedBody.length > 0
      ? (updatedJobParsedBody[0] as Record<string, unknown>)
      : null;

  return {
    success: true,
    message: "Provisioning trace recorded successfully",
    data: { inserted_log: insertedLog, updated_job: updatedJob },
    error: null,
  };
}

export async function supabaseUpdateWorkspaceOrchestrationTrace(
  input: SupabaseUpdateWorkspaceOrchestrationTraceInput,
): Promise<ToolResponse<WorkspaceRecord>> {
  if (!input?.workspaceId || typeof input.workspaceId !== "string" || input.workspaceId.trim() === "") {
    return {
      success: false,
      message: "Validation failed",
      data: null,
      error: "Input must include a non-empty workspaceId string",
    };
  }
  if (!input.trace || typeof input.trace !== "object") {
    return {
      success: false,
      message: "Validation failed",
      data: null,
      error: "Input must include a trace object",
    };
  }

  try {
    const { supabaseUrl, serviceRoleKey } = getSupabaseConfig();
    return await updateClientWorkspaceTrace(supabaseUrl, serviceRoleKey, {
      workspaceId: input.workspaceId.trim(),
      trace: input.trace,
    });
  } catch (error) {
    return {
      success: false,
      message: "Workspace trace update failed",
      data: null,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function supabaseRecordProvisioningTrace(
  input: SupabaseRecordProvisioningTraceInput,
): Promise<ToolResponse<ProvisioningTraceRecord>> {
  if (
    !input?.accountId ||
    !input.workspaceId ||
    !input.provisioningJobId ||
    !input.artifact?.path ||
    !input.artifact?.commitSha ||
    !input.artifact?.contentSha ||
    !input.orchestratorName
  ) {
    return {
      success: false,
      message: "Validation failed",
      data: null,
      error:
        "Input must include accountId, workspaceId, provisioningJobId, artifact.path, artifact.commitSha, artifact.contentSha, and orchestratorName",
    };
  }

  try {
    const { supabaseUrl, serviceRoleKey } = getSupabaseConfig();
    return await recordProvisioningTrace(supabaseUrl, serviceRoleKey, input);
  } catch (error) {
    return {
      success: false,
      message: "Provisioning trace write failed",
      data: null,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function supabaseRunSql(
  input: SupabaseRunSqlInput,
): Promise<ToolResponse<PgQueryResponseRow[]>> {
  if (!input?.sql || typeof input.sql !== "string") {
    return {
      success: false,
      message: "Validation failed",
      data: null,
      error: "Input must include a non-empty SQL string",
    };
  }

  try {
    const { supabaseUrl, serviceRoleKey } = getSupabaseConfig();
    const headers = {
      "content-type": "application/json",
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
    };
    const runSqlResponse = await undiciFetch(`${supabaseUrl}/rest/v1/rpc/run_sql`, {
      dispatcher: proxyAgent,
      method: "POST",
      headers,
      body: JSON.stringify({ sql: input.sql }),
    });
    const runSqlRawBody = await runSqlResponse.text();
    const runSqlParsedBody = parseJsonSafely(runSqlRawBody);
    if (runSqlResponse.ok) {
      const payload = Array.isArray(runSqlParsedBody)
        ? (runSqlParsedBody as PgQueryResponseRow[])
        : ([runSqlParsedBody] as PgQueryResponseRow[]);
      return {
        success: true,
        message: "SQL RPC executed successfully",
        data: payload,
        error: null,
      };
    }

    const runSqlErrorText =
      typeof runSqlParsedBody === "string"
        ? runSqlParsedBody
        : JSON.stringify(runSqlParsedBody) || `HTTP ${runSqlResponse.status}`;
    const shouldFallbackToHealthCheck =
      runSqlResponse.status === 404 ||
      (typeof runSqlParsedBody === "object" &&
        runSqlParsedBody !== null &&
        "code" in runSqlParsedBody &&
        runSqlParsedBody.code === "PGRST202");
    if (!shouldFallbackToHealthCheck) {
      return {
        success: false,
        message: "Supabase RPC failed",
        data: null,
        error: runSqlErrorText || `HTTP ${runSqlResponse.status}`,
      };
    }

    const healthCheckResponse = await undiciFetch(`${supabaseUrl}/rest/v1/rpc/health_check`, {
      dispatcher: proxyAgent,
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });
    const healthCheckRawBody = await healthCheckResponse.text();
    const healthCheckParsedBody = parseJsonSafely(healthCheckRawBody);
    if (!healthCheckResponse.ok) {
      const errorText =
        typeof healthCheckParsedBody === "string"
          ? healthCheckParsedBody
          : JSON.stringify(healthCheckParsedBody) || `HTTP ${healthCheckResponse.status}`;
      return {
        success: false,
        message: "Supabase RPC failed",
        data: null,
        error: errorText || runSqlErrorText || `HTTP ${healthCheckResponse.status}`,
      };
    }
    const healthPayload = Array.isArray(healthCheckParsedBody)
      ? (healthCheckParsedBody as PgQueryResponseRow[])
      : ([healthCheckParsedBody] as PgQueryResponseRow[]);
    return {
      success: true,
      message: "Health check RPC executed successfully",
      data: healthPayload,
      error: null,
    };
  } catch (error) {
    return {
      success: false,
      message: "Supabase RPC failed",
      data: null,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function supabaseFetchWorkspace(
  input: SupabaseFetchWorkspaceInput,
): Promise<ToolResponse<WorkspaceRecord | null>> {
  if (!input?.workspaceId || typeof input.workspaceId !== "string" || input.workspaceId.trim() === "") {
    return {
      success: false,
      message: "Validation failed",
      data: null,
      error: "Input must include a non-empty workspaceId string",
    };
  }

  const workspaceId = input.workspaceId.trim();

  try {
    const { supabaseUrl, serviceRoleKey } = getSupabaseConfig();
    const response = await undiciFetch(
      `${supabaseUrl}/rest/v1/client_workspaces?id=eq.${encodeURIComponent(workspaceId)}&select=id,account_id,project_id,status,company_name,lead_id,product_id,selected_plan,selected_modules,assistant_id,active_assistant_version_id,metadata,updated_at`,
      {
        dispatcher: proxyAgent,
        method: "GET",
        headers: {
          apikey: serviceRoleKey,
          authorization: `Bearer ${serviceRoleKey}`,
          accept: "application/json",
        },
      },
    );

    const rawBody = await response.text();
    const parsedBody = parseJsonSafely(rawBody);

    if (!response.ok) {
      const errorText =
        typeof parsedBody === "string"
          ? parsedBody
          : JSON.stringify(parsedBody) || `HTTP ${response.status}`;
      return {
        success: false,
        message: "Workspace lookup failed",
        data: null,
        error: errorText || `HTTP ${response.status}`,
      };
    }

    if (!Array.isArray(parsedBody)) {
      return {
        success: false,
        message: "Workspace lookup failed",
        data: null,
        error: "Unexpected Supabase response shape",
      };
    }

    const workspace = (parsedBody[0] as WorkspaceRecord | undefined) ?? null;
    if (!workspace) {
      return {
        success: false,
        message: "Workspace not found",
        data: null,
        error: "Workspace does not exist",
      };
    }

    return {
      success: true,
      message: "Workspace fetched successfully",
      data: workspace,
      error: null,
    };
  } catch (error) {
    return {
      success: false,
      message: "Workspace lookup failed",
      data: null,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
