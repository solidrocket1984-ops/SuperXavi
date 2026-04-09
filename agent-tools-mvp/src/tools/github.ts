/**
 * Placeholder tool for future GitHub file upsert.
 *
 * IMPORTANT:
 * - Do NOT write directly to protected branches without policy checks.
 * - Add path restrictions, content scanning, and commit attribution rules.
 */

import type { ToolResponse } from "./supabase.js";

export interface GithubUpsertFileInput {
  repo: string;
  path: string;
  content: string;
  message: string;
  branch?: string;
  sha?: string;
}

export interface GithubUpsertFileData {
  commitSha?: string;
  contentSha?: string;
}

function validateInput(input: GithubUpsertFileInput): string | null {
  if (!input || typeof input !== "object") {
    return "Input is required";
  }

  const requiredFields: Array<keyof GithubUpsertFileInput> = ["repo", "path", "content", "message"];

  for (const field of requiredFields) {
    const value = input[field];
    if (typeof value !== "string" || value.trim() === "") {
      return `Field '${field}' must be a non-empty string`;
    }
  }

  if (input.branch !== undefined && (typeof input.branch !== "string" || input.branch.trim() === "")) {
    return "Field 'branch' must be a non-empty string when provided";
  }

  return null;
}

export async function githubUpsertFile(
  input: GithubUpsertFileInput,
): Promise<ToolResponse<GithubUpsertFileData>> {
  // TODO: Validate repository and path against explicit allow-lists.
  // TODO: Integrate GitHub API client and handle create-vs-update semantics.
  // TODO: Add dry-run mode, conflict handling, and audit logging.

  const validationError = validateInput(input);
  if (validationError) {
    return {
      success: false,
      message: "Validation failed",
      data: null,
      error: validationError,
    };
  }

  const owner = process.env.GITHUB_OWNER?.trim();
  if (!owner) {
    return {
      success: false,
      message: "Validation failed",
      data: null,
      error: "Environment variable GITHUB_OWNER is required",
    };
  }

  const allowedReposRaw = process.env.GITHUB_ALLOWED_REPOS?.trim();
  if (allowedReposRaw) {
    const allowedRepos = allowedReposRaw
      .split(",")
      .map((repo) => repo.trim())
      .filter(Boolean);

    if (!allowedRepos.includes(input.repo)) {
      return {
        success: false,
        message: "Validation failed",
        data: null,
        error: `Repository '${input.repo}' is not in GITHUB_ALLOWED_REPOS`,
      };
    }
  }

  return {
    success: false,
    message: "Not implemented",
    data: null,
    error: `Not implemented: github_upsert_file placeholder for ${owner}/${input.repo}`,
  };
}
