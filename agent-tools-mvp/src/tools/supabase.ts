import { EnvHttpProxyAgent, fetch as undiciFetch } from "undici";

export interface SupabaseRunSqlInput {
  sql: string;
}

export interface SupabaseFetchWorkspaceInput {
  workspaceId: string;
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

interface ClientWorkspaceTraceUpdateRequest {
  workspaceId: string;
  metadataPatch: Record<string, unknown>;
}

function tryParseClientWorkspaceTraceUpdateSql(sql: string): ClientWorkspaceTraceUpdateRequest | null {
  const normalized = sql.trim().replace(/\s+/g, " ").toLowerCase();
  if (!normalized.startsWith("update public.client_workspaces")) {
    return null;
  }

  const workspaceIdMatch = sql.match(/where\s+id\s*=\s*'([0-9a-f-]{36})'::uuid/i);
  const metadataPatchMatch = sql.match(
    /metadata\s*=\s*coalesce\(\s*metadata\s*,\s*'\{\}'::jsonb\s*\)\s*\|\|\s*(\{[\s\S]*?\})::jsonb/i,
  );
  if (!workspaceIdMatch || !metadataPatchMatch) {
    return null;
  }

  try {
    const metadataPatch = JSON.parse(metadataPatchMatch[1]) as Record<string, unknown>;
    return {
      workspaceId: workspaceIdMatch[1],
      metadataPatch,
    };
  } catch {
    return null;
  }
}

async function executeClientWorkspaceTraceUpdate(
  supabaseUrl: string,
  serviceRoleKey: string,
  request: ClientWorkspaceTraceUpdateRequest,
): Promise<ToolResponse<PgQueryResponseRow[]>> {
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
      message: "Supabase RPC failed",
      data: null,
      error: "Workspace not found for metadata write-back",
    };
  }
  const row = fetchParsedBody[0] as Record<string, unknown>;
  const existingMetadata =
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {};
  const mergedMetadata = { ...existingMetadata, ...request.metadataPatch };

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
      message: "Supabase RPC failed",
      data: null,
      error: errorText,
    };
  }
  const payload = Array.isArray(updateParsedBody)
    ? (updateParsedBody as PgQueryResponseRow[])
    : ([updateParsedBody] as PgQueryResponseRow[]);
  return {
    success: true,
    message: "SQL emulation executed successfully",
    data: payload,
    error: null,
  };
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

    const traceUpdateRequest = tryParseClientWorkspaceTraceUpdateSql(input.sql);
    if (traceUpdateRequest) {
      return executeClientWorkspaceTraceUpdate(supabaseUrl, serviceRoleKey, traceUpdateRequest);
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
      `${supabaseUrl}/rest/v1/client_workspaces?id=eq.${encodeURIComponent(workspaceId)}&select=id,status,company_name,lead_id,product_id,selected_plan,selected_modules,assistant_id,active_assistant_version_id,metadata,updated_at`,
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
