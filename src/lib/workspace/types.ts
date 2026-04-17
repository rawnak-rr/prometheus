export type WorkspaceEntryKind = "file" | "directory";

export type WorkspaceEntry = {
  path: string;
  kind: WorkspaceEntryKind;
  parentPath: string | null;
};

export type WorkspaceListFilesResponse = {
  workspaceRoot: string;
  entries: WorkspaceEntry[];
  truncated: boolean;
  source: "git" | "filesystem";
};

export type WorkspaceListFilesRequest = {
  workspaceRoot?: string | null;
};

export type WorkspaceReadFileRequest = {
  workspaceRoot?: string | null;
  path: string;
};

export type WorkspaceReadFileResponse = {
  workspaceRoot: string;
  path: string;
  content: string;
};

export type WorkspaceBridge = {
  listFiles: (request?: WorkspaceListFilesRequest) => Promise<WorkspaceListFilesResponse>;
  openFolder: () => Promise<WorkspaceListFilesResponse | null>;
  readFile: (request: WorkspaceReadFileRequest) => Promise<WorkspaceReadFileResponse>;
};
