import { EnvHttpProxyAgent, fetch as undiciFetch } from "undici";

export interface SupabaseRunSqlInput {
  sql: string;
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
    const supabaseUrl = getRequiredEnv("SUPABASE_URL");
    const serviceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    assertSandboxProject(supabaseUrl);

    const response = await undiciFetch(`${supabaseUrl}/rest/v1/rpc/health_check`, {
      dispatcher: proxyAgent,
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({}),
    });

    const rawBody = await response.text();
    const parsedBody = parseJsonSafely(rawBody);

    if (!response.ok) {
      const errorText =
        typeof parsedBody === "string"
          ? parsedBody
          : JSON.stringify(parsedBody) || `HTTP ${response.status}`;
      return {
        success: false,
        message: "Supabase RPC failed",
        data: null,
        error: errorText || `HTTP ${response.status}`,
      };
    }

    const payload = Array.isArray(parsedBody)
      ? (parsedBody as PgQueryResponseRow[])
      : ([parsedBody] as PgQueryResponseRow[]);

    return {
      success: true,
      message: "Health check RPC executed successfully",
      data: payload,
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
