import type { ToolResult } from "./supabase.js";

export interface GithubUpsertFileInput {
  repo: string;
  path: string;
  content: string;
  message: string;
  branch?: string;
  sha?: string;
}

export interface GithubUpsertFileData {
  owner: string;
  repo: string;
  branch: string;
  path: string;
  action: "created" | "updated";
  commitSha: string;
  contentSha?: string;
  previousContentSha?: string;
}

interface GitHubContentResponse {
  sha: string;
}

interface GitHubPutResponse {
  content?: { sha?: string };
  commit?: { sha?: string };
}

function readAllowedReposFromEnv(): readonly string[] {
  const fromAllowlist = process.env.GITHUB_ALLOWED_REPOS
    ?.split(",")
    .map((repo) => repo.trim())
    .filter(Boolean);

  if (fromAllowlist && fromAllowlist.length > 0) {
    return fromAllowlist;
  }

  const singleRepo = process.env.GITHUB_REPO?.trim();
  return singleRepo ? [singleRepo] : [];
}

function isSafePath(path: string): boolean {
  if (path.length < 1 || path.length > 500) {
    return false;
  }

  if (path.startsWith("/") || path.includes("\\") || path.includes("..")) {
    return false;
  }

  return /^[A-Za-z0-9._\-/]+$/.test(path);
}

function validateInput(
  input: GithubUpsertFileInput,
  allowedRepos: readonly string[],
): string | null {
  if (!input || typeof input !== "object") {
    return "Input payload is required";
  }

  if (typeof input.repo !== "string" || input.repo.trim().length === 0) {
    return "repo is required and must be a non-empty string";
  }

  if (!allowedRepos.includes(input.repo.trim())) {
    return `repo '${input.repo}' is not in the allowlist`;
  }

  if (typeof input.path !== "string" || !isSafePath(input.path.trim())) {
    return "path must be a safe relative file path";
  }

  if (typeof input.content !== "string" || input.content.length === 0) {
    return "content is required and must be a non-empty string";
  }

  if (input.content.length > 1_000_000) {
    return "content is too large (max 1,000,000 characters)";
  }

  if (typeof input.message !== "string" || input.message.trim().length < 3) {
    return "message is required and must be at least 3 characters";
  }

  if (input.message.length > 200) {
    return "message is too long (max 200 characters)";
  }

  if (input.branch && (typeof input.branch !== "string" || input.branch.trim().length === 0)) {
    return "branch must be a non-empty string when provided";
  }

  if (input.sha && (typeof input.sha !== "string" || input.sha.trim().length === 0)) {
    return "sha must be a non-empty string when provided";
  }

  return null;
}

export async function githubUpsertFile(
  input: GithubUpsertFileInput,
): Promise<ToolResult<GithubUpsertFileData>> {
  const token = process.env.GITHUB_TOKEN?.trim();
  const owner = process.env.GITHUB_OWNER?.trim();
  const allowedRepos = readAllowedReposFromEnv();

  if (!token || !owner) {
    return {
      ok: false,
      error: "Missing required env vars: GITHUB_TOKEN and GITHUB_OWNER",
      meta: { tool: "github_upsert_file" },
    };
  }

  if (allowedRepos.length === 0) {
    return {
      ok: false,
      error: "Missing allowed repositories env var: GITHUB_ALLOWED_REPOS (or GITHUB_REPO)",
      meta: { tool: "github_upsert_file" },
    };
  }

  const validationError = validateInput(input, allowedRepos);
  if (validationError) {
    return {
      ok: false,
      error: validationError,
      meta: { tool: "github_upsert_file", allowedRepos },
    };
  }

  const repo = input.repo.trim();
  const path = input.path.trim();
  const branch = input.branch?.trim() || process.env.GITHUB_DEFAULT_BRANCH?.trim() || "main";
  const githubApiPath = encodeURIComponent(path).replace(/%2F/g, "/");
  const contentsUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${githubApiPath}?ref=${encodeURIComponent(branch)}`;

  const commonHeaders = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "agent-tools-mvp",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  let existingSha: string | undefined;
  let action: "created" | "updated" = "created";

  const existingResponse = await fetch(contentsUrl, { headers: commonHeaders });
  if (existingResponse.status === 200) {
    const existingJson = (await existingResponse.json()) as GitHubContentResponse;
    existingSha = existingJson.sha;
    action = "updated";
  } else if (existingResponse.status !== 404) {
    const errorText = await existingResponse.text();
    return {
      ok: false,
      error: `Failed to check existing file: ${existingResponse.status} ${errorText}`,
      meta: { tool: "github_upsert_file", owner, repo, path, branch },
    };
  }

  if (existingSha && input.sha && existingSha !== input.sha) {
    return {
      ok: false,
      error: `SHA mismatch. Current SHA is ${existingSha} but received ${input.sha}`,
      meta: { tool: "github_upsert_file", owner, repo, path, branch },
    };
  }

  const putBody = {
    message: input.message.trim(),
    content: Buffer.from(input.content, "utf8").toString("base64"),
    branch,
    sha: input.sha ?? existingSha,
  };

  const upsertResponse = await fetch(contentsUrl.replace(/\?ref=.*/, ""), {
    method: "PUT",
    headers: {
      ...commonHeaders,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(putBody),
  });

  if (!upsertResponse.ok) {
    const errorText = await upsertResponse.text();
    return {
      ok: false,
      error: `GitHub upsert failed: ${upsertResponse.status} ${errorText}`,
      meta: { tool: "github_upsert_file", owner, repo, path, branch, action },
    };
  }

  const upsertJson = (await upsertResponse.json()) as GitHubPutResponse;

  return {
    ok: true,
    data: {
      owner,
      repo,
      branch,
      path,
      action,
      previousContentSha: existingSha,
      contentSha: upsertJson.content?.sha,
      commitSha: upsertJson.commit?.sha ?? "",
    },
    meta: {
      tool: "github_upsert_file",
      allowedRepos,
    },
  };
}
