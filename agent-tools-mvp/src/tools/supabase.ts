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

const DESTRUCTIVE_SQL_PATTERNS: ReadonlyArray<RegExp> = [
  /\bdrop\b/i,
  /\btruncate\b/i,
  /\bdelete\b(?!\s+from\s+.+\s+where\b)/i,
];

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

function isBlockedSql(sql: string): boolean {
  const normalizedSql = sql.replace(/--.*$/gm, " ").replace(/\s+/g, " ").trim();
  return DESTRUCTIVE_SQL_PATTERNS.some((pattern) => pattern.test(normalizedSql));
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

  if (isBlockedSql(input.sql)) {
    return {
      success: false,
      message: "Blocked potentially destructive SQL",
      data: null,
      error: "DROP, TRUNCATE, and DELETE without WHERE are not allowed",
    };
  }

  try {
    const supabaseUrl = getRequiredEnv("SUPABASE_URL");
    const serviceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    assertSandboxProject(supabaseUrl);

    const response = await undiciFetch(`${supabaseUrl}/pg/v1/query`, {
      dispatcher: proxyAgent,
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({ query: input.sql }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        message: "Supabase query failed",
        data: null,
        error: errorText || `HTTP ${response.status}`,
      };
    }

    const payload = (await response.json()) as PgQueryResponseRow[];
    return {
      success: true,
      message: "Query executed successfully",
      data: payload,
      error: null,
    };
  } catch (error) {
    return {
      success: false,
      message: "Supabase query failed",
      data: null,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
