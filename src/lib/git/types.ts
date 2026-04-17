export type GitStatusFile = {
  path: string;
  index: string;
  workingTree: string;
};

export type GitStatusSummary = {
  changed: number;
  staged: number;
  unstaged: number;
  untracked: number;
};

export type GitStatusResponse = {
  workspaceRoot: string;
  repositoryRoot: string | null;
  isRepository: boolean;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: GitStatusFile[];
  summary: GitStatusSummary;
  lastError: string | null;
};

export type GitCommitRequest = {
  workspaceRoot: string | null;
  message: string;
  files: string[];
};

export type GitPushRequest = {
  workspaceRoot: string | null;
};

export type GitActionResponse = {
  status: GitStatusResponse;
  output: string;
};

export type GitBridge = {
  getStatus: (request: { workspaceRoot: string | null }) => Promise<GitStatusResponse>;
  commit: (request: GitCommitRequest) => Promise<GitActionResponse>;
  push: (request: GitPushRequest) => Promise<GitActionResponse>;
};
