import { execFile } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type {
  WorkspaceEntry,
  WorkspaceReadFileResponse,
  WorkspaceListFilesResponse,
} from "@/lib/workspace/types";

const execFileAsync = promisify(execFile);
const maxFilesystemEntries = 1_500;
const ignoredDirectoryNames = new Set([
  ".git",
  ".next",
  "dist",
  "node_modules",
  "out",
]);

function toPosixPath(value: string) {
  return value.split(path.sep).join("/");
}

function getParentPath(relativePath: string) {
  const parent = path.posix.dirname(relativePath);
  return parent === "." ? null : parent;
}

function directoryAncestorsOf(relativePath: string) {
  const segments = relativePath.split("/").filter(Boolean);

  if (segments.length <= 1) {
    return [];
  }

  return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join("/"));
}

function buildEntriesFromFilePaths(filePaths: string[]) {
  const directoryPaths = new Set<string>();

  for (const filePath of filePaths) {
    for (const directoryPath of directoryAncestorsOf(filePath)) {
      directoryPaths.add(directoryPath);
    }
  }

  const directories: WorkspaceEntry[] = Array.from(directoryPaths)
    .sort((left, right) => left.localeCompare(right))
    .map((directoryPath) => ({
      path: directoryPath,
      kind: "directory",
      parentPath: getParentPath(directoryPath),
    }));

  const files: WorkspaceEntry[] = Array.from(new Set(filePaths))
    .sort((left, right) => left.localeCompare(right))
    .map((filePath) => ({
      path: filePath,
      kind: "file",
      parentPath: getParentPath(filePath),
    }));

  return [...directories, ...files];
}

function resolveWorkspaceFilePath(workspaceRoot: string, relativeFilePath: string) {
  if (!relativeFilePath.trim()) {
    throw new Error("File path is required.");
  }

  if (path.isAbsolute(relativeFilePath)) {
    throw new Error("Workspace file paths must be relative.");
  }

  const resolvedRoot = path.resolve(workspaceRoot);
  const resolvedPath = path.resolve(resolvedRoot, relativeFilePath);
  const relativePath = path.relative(resolvedRoot, resolvedPath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("File path is outside the workspace.");
  }

  return resolvedPath;
}

async function listFilesFromGit(workspaceRoot: string) {
  const result = await execFileAsync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    {
      cwd: workspaceRoot,
      maxBuffer: 1024 * 1024 * 4,
      timeout: 20_000,
    },
  );

  return result.stdout
    .split("\0")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(toPosixPath)
    .filter((entry) => !entry.split("/").some((segment) => ignoredDirectoryNames.has(segment)));
}

async function listFilesFromFilesystem(workspaceRoot: string) {
  const filePaths: string[] = [];
  let truncated = false;

  async function walk(directoryPath: string) {
    if (filePaths.length >= maxFilesystemEntries) {
      truncated = true;
      return;
    }

    const entries = await readdir(directoryPath, { withFileTypes: true });

    for (const entry of entries) {
      if (ignoredDirectoryNames.has(entry.name)) {
        continue;
      }

      const absolutePath = path.join(directoryPath, entry.name);
      const relativePath = toPosixPath(path.relative(workspaceRoot, absolutePath));

      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      filePaths.push(relativePath);

      if (filePaths.length >= maxFilesystemEntries) {
        truncated = true;
        return;
      }
    }
  }

  await walk(workspaceRoot);
  return { filePaths, truncated };
}

export async function listWorkspaceFiles(
  workspaceRoot = process.cwd(),
): Promise<WorkspaceListFilesResponse> {
  const rootStat = await stat(workspaceRoot);

  if (!rootStat.isDirectory()) {
    throw new Error("Workspace root is not a directory.");
  }

  try {
    const filePaths = await listFilesFromGit(workspaceRoot);
    return {
      workspaceRoot,
      entries: buildEntriesFromFilePaths(filePaths),
      truncated: false,
      source: "git",
    };
  } catch {
    const { filePaths, truncated } = await listFilesFromFilesystem(workspaceRoot);
    return {
      workspaceRoot,
      entries: buildEntriesFromFilePaths(filePaths),
      truncated,
      source: "filesystem",
    };
  }
}

export async function readWorkspaceFile(
  workspaceRoot: string,
  filePath: string,
): Promise<WorkspaceReadFileResponse> {
  const absolutePath = resolveWorkspaceFilePath(workspaceRoot, filePath);
  const fileStat = await stat(absolutePath);

  if (!fileStat.isFile()) {
    throw new Error("Workspace path is not a file.");
  }

  if (fileStat.size > 1024 * 1024) {
    throw new Error("Workspace file is too large to open.");
  }

  return {
    workspaceRoot,
    path: toPosixPath(filePath),
    content: await readFile(absolutePath, "utf8"),
  };
}
