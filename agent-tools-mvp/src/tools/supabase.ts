/**
 * Placeholder tool for future Supabase SQL execution.
 *
 * IMPORTANT:
 * - Do NOT execute arbitrary SQL in production without strict guardrails.
 * - Add query allow-lists, statement classification, and auditing first.
 */

export interface SupabaseRunSqlInput {
  sql: string;
  params?: readonly unknown[];
}

export interface ToolResult<TData = unknown> {
  ok: boolean;
  data?: TData;
  error?: string;
  meta?: Record<string, unknown>;
}

export async function supabaseRunSql(
  input: SupabaseRunSqlInput,
): Promise<ToolResult<{ rows: unknown[] }>> {
  // TODO: Validate SQL shape and enforce safe statement classes.
  // TODO: Add role-based access controls for table/column-level access.
  // TODO: Integrate official Supabase client with secure credential handling.

  return {
    ok: false,
    error: "Not implemented: supabase_run_sql placeholder",
    meta: {
      tool: "supabase_run_sql",
      receivedSqlLength: input.sql.length,
      paramCount: input.params?.length ?? 0,
    },
  };
}
