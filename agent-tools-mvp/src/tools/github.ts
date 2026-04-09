import { EnvHttpProxyAgent, fetch as undiciFetch } from "undici";
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

interface GithubContentResponse {
  sha: string;
  path?: string;
}

interface GithubUpsertApiResponse {
  content?: {
    sha?: string;
  };
  commit?: {
    sha?: string;
  };
  message?: string;
}

const proxyAgent = new EnvHttpProxyAgent();

function safeEncodePath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function isSafeRelativePath(path: string): boolean {
  if (!path || path.startsWith("/") || path.includes("\\") || path.includes("\0")) {
    return false;
  }

  const segments = path.split("/");
  if (segments.length === 0) {
    return false;
  }

  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function getRequiredEnv(name: "GITHUB_OWNER" | "GITHUB_TOKEN" | "GITHUB_ALLOWED_REPOS"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Environment variable ${name} is required`);
  }
  return value;
}

function normalizeAllowedRepos(raw: string): string[] {
  return raw
    .split(",")
    .map((repo) => repo.trim())
    .filter(Boolean);
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

  if (input.sha !== undefined && (typeof input.sha !== "string" || input.sha.trim() === "")) {
    return "Field 'sha' must be a non-empty string when provided";
  }

  if (!isSafeRelativePath(input.path)) {
    return "Field 'path' must be a safe relative path";
  }

  return null;
}

export async function githubUpsertFile(
  input: GithubUpsertFileInput,
): Promise<ToolResponse<GithubUpsertFileData>> {
  const validationError = validateInput(input);
  if (validationError) {
    return {
      success: false,
      message: "Validation failed",
      data: null,
      error: validationError,
    };
  }

  try {
    const owner = getRequiredEnv("GITHUB_OWNER");
    const token = getRequiredEnv("GITHUB_TOKEN");
    const allowedRepos = normalizeAllowedRepos(getRequiredEnv("GITHUB_ALLOWED_REPOS"));
    if (!allowedRepos.includes(input.repo)) {
      return {
        success: false,
        message: "Validation failed",
        data: null,
        error: `Repository '${input.repo}' is not in GITHUB_ALLOWED_REPOS`,
      };
    }

    const branch = input.branch?.trim();
    const encodedPath = safeEncodePath(input.path);
    const query = branch ? `?ref=${encodeURIComponent(branch)}` : "";
    const contentsUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(input.repo)}/contents/${encodedPath}${query}`;

    const baseHeaders = {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "user-agent": "agent-tools-mvp",
      "x-github-api-version": "2022-11-28",
    };

    const existingResponse = await undiciFetch(contentsUrl, {
      dispatcher: proxyAgent,
      method: "GET",
      headers: baseHeaders,
    });

    let existingSha: string | undefined;
    let fileExists = false;

    if (existingResponse.status === 200) {
      const existingBody = (await existingResponse.json()) as GithubContentResponse;
      existingSha = existingBody.sha;
      fileExists = true;
    } else if (existingResponse.status !== 404) {
      const errorText = await existingResponse.text();
      return {
        success: false,
        message: "GitHub upsert failed",
        data: null,
        error: errorText || `GitHub contents lookup failed with HTTP ${existingResponse.status}`,
      };
    }

    const providedSha = input.sha?.trim();
    if (fileExists && providedSha && providedSha !== existingSha) {
      return {
        success: false,
        message: "Validation failed",
        data: null,
        error: "Provided sha does not match the latest file sha",
      };
    }

    if (!fileExists && providedSha) {
      return {
        success: false,
        message: "Validation failed",
        data: null,
        error: "Field 'sha' cannot be set when creating a new file",
      };
    }

    const upsertPayload: Record<string, string> = {
      message: input.message,
      content: Buffer.from(input.content, "utf8").toString("base64"),
    };

    if (branch) {
      upsertPayload.branch = branch;
    }

    if (existingSha) {
      upsertPayload.sha = existingSha;
    }

    const upsertResponse = await undiciFetch(contentsUrl, {
      dispatcher: proxyAgent,
      method: "PUT",
      headers: {
        ...baseHeaders,
        "content-type": "application/json",
      },
      body: JSON.stringify(upsertPayload),
    });

    const upsertBody = (await upsertResponse.json()) as GithubUpsertApiResponse;
    if (!upsertResponse.ok) {
      return {
        success: false,
        message: "GitHub upsert failed",
        data: null,
        error: upsertBody.message || `GitHub upsert failed with HTTP ${upsertResponse.status}`,
      };
    }

    return {
      success: true,
      message: fileExists ? "File updated successfully" : "File created successfully",
      data: {
        commitSha: upsertBody.commit?.sha,
        contentSha: upsertBody.content?.sha,
      },
      error: null,
    };
  } catch (error) {
    return {
      success: false,
      message: "GitHub upsert failed",
      data: null,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
