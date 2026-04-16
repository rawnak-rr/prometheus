import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type {
  GitActionResponse,
  GitStatusFile,
  GitStatusResponse,
  GitStatusSummary,
} from "@/lib/git/types";

const execFileAsync = promisify(execFile);

async function runGit(workspaceRoot: string, args: string[]) {
  return execFileAsync("git", args, {
    cwd: workspaceRoot,
    maxBuffer: 1024 * 1024 * 4,
    timeout: 30_000,
  });
}

function emptySummary(): GitStatusSummary {
  return {
    changed: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
  };
}

function parseBranchLine(line: string) {
  const content = line.replace(/^##\s*/, "");
  const [branchPart, trackingPart] = content.split("...");
  const branch = branchPart === "HEAD (no branch)" ? "detached" : branchPart || null;
  const upstreamMatch = trackingPart?.match(/^([^\s[]+)/);
  const aheadMatch = line.match(/ahead (\d+)/);
  const behindMatch = line.match(/behind (\d+)/);

  return {
    branch,
    upstream: upstreamMatch?.[1] ?? null,
    ahead: aheadMatch ? Number(aheadMatch[1]) : 0,
    behind: behindMatch ? Number(behindMatch[1]) : 0,
  };
}

function summarizeFiles(files: GitStatusFile[]) {
  const summary = emptySummary();

  for (const file of files) {
    summary.changed += 1;

    if (file.index === "?" && file.workingTree === "?") {
      summary.untracked += 1;
      continue;
    }

    if (file.index !== " ") {
      summary.staged += 1;
    }

    if (file.workingTree !== " ") {
      summary.unstaged += 1;
    }
  }

  return summary;
}

async function repositoryRoot(workspaceRoot: string) {
  const result = await runGit(workspaceRoot, ["rev-parse", "--show-toplevel"]);
  return result.stdout.trim();
}

export async function getGitStatus(workspaceRoot: string): Promise<GitStatusResponse> {
  try {
    const [rootResult, statusResult] = await Promise.all([
      repositoryRoot(workspaceRoot),
      runGit(workspaceRoot, ["status", "--porcelain=v1", "-b"]),
    ]);
    const lines = statusResult.stdout.split("\n").filter(Boolean);
    const branchInfo = lines[0]?.startsWith("## ")
      ? parseBranchLine(lines[0])
      : { branch: null, upstream: null, ahead: 0, behind: 0 };
    const files = lines
      .filter((line) => !line.startsWith("## "))
      .map((line) => ({
        index: line[0] ?? " ",
        workingTree: line[1] ?? " ",
        path: line.slice(3),
      }));

    return {
      workspaceRoot,
      repositoryRoot: rootResult,
      isRepository: true,
      ...branchInfo,
      files,
      summary: summarizeFiles(files),
      lastError: null,
    };
  } catch (error) {
    return {
      workspaceRoot,
      repositoryRoot: null,
      isRepository: false,
      branch: null,
      upstream: null,
      ahead: 0,
      behind: 0,
      files: [],
      summary: emptySummary(),
      lastError: error instanceof Error ? error.message : "Git status failed.",
    };
  }
}

export async function commitGitChanges(
  workspaceRoot: string,
  message: string,
): Promise<GitActionResponse> {
  const trimmedMessage = message.trim();

  if (!trimmedMessage) {
    throw new Error("Commit message is required.");
  }

  await runGit(workspaceRoot, ["add", "-A"]);
  const commitResult = await runGit(workspaceRoot, ["commit", "-m", trimmedMessage]);
  const status = await getGitStatus(workspaceRoot);

  return {
    status,
    output: `${commitResult.stdout}${commitResult.stderr}`.trim(),
  };
}

export async function pushGitChanges(workspaceRoot: string): Promise<GitActionResponse> {
  const pushResult = await runGit(workspaceRoot, ["push"]);
  const status = await getGitStatus(workspaceRoot);

  return {
    status,
    output: `${pushResult.stdout}${pushResult.stderr}`.trim(),
  };
}
