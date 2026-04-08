/**
 * Placeholder tool for future GitHub file upsert.
 *
 * IMPORTANT:
 * - Do NOT write directly to protected branches without policy checks.
 * - Add path restrictions, content scanning, and commit attribution rules.
 */

import type { ToolResult } from "./supabase.js";

export interface GithubUpsertFileInput {
  owner: string;
  repo: string;
  branch: string;
  path: string;
  content: string;
  message: string;
  sha?: string;
}

export interface GithubUpsertFileData {
  commitSha?: string;
  contentSha?: string;
}

export async function githubUpsertFile(
  input: GithubUpsertFileInput,
): Promise<ToolResult<GithubUpsertFileData>> {
  // TODO: Validate repository and path against explicit allow-lists.
  // TODO: Integrate GitHub API client and handle create-vs-update semantics.
  // TODO: Add dry-run mode, conflict handling, and audit logging.

  return {
    ok: false,
    error: "Not implemented: github_upsert_file placeholder",
    meta: {
      tool: "github_upsert_file",
      target: `${input.owner}/${input.repo}`,
      branch: input.branch,
      path: input.path,
    },
  };
}
