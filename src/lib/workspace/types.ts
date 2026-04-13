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

export type WorkspaceBridge = {
  listFiles: () => Promise<WorkspaceListFilesResponse>;
};
