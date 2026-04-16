import { contextBridge, ipcRenderer } from "electron";

import type {
  ChatBridge,
  ChatApprovalResponseRequest,
  ChatRuntimeEvent,
  ChatStopTurnRequest,
  ChatTurnStartRequest,
  ChatTurnStartResult,
  ChatSession,
} from "@/lib/chat/types";
import type { LocalProvidersResponse } from "@/lib/providers/types";
import type { GitBridge, GitActionResponse, GitStatusResponse } from "@/lib/git/types";
import type { WorkspaceBridge, WorkspaceListFilesResponse } from "@/lib/workspace/types";

const api = {
  providers: {
    list: () => ipcRenderer.invoke("providers:list") as Promise<LocalProvidersResponse>,
  },
  workspace: {
    listFiles: (request) =>
      ipcRenderer.invoke("workspace:list-files", request) as Promise<WorkspaceListFilesResponse>,
    openFolder: () =>
      ipcRenderer.invoke("workspace:open-folder") as Promise<WorkspaceListFilesResponse | null>,
  } satisfies WorkspaceBridge,
  git: {
    getStatus: (request) =>
      ipcRenderer.invoke("git:status", request) as Promise<GitStatusResponse>,
    commit: (request) =>
      ipcRenderer.invoke("git:commit", request) as Promise<GitActionResponse>,
    push: (request) =>
      ipcRenderer.invoke("git:push", request) as Promise<GitActionResponse>,
  } satisfies GitBridge,
  chat: {
    listSessions: () =>
      ipcRenderer.invoke("chat:list-sessions") as Promise<ChatSession[]>,
    startTurn: (request: ChatTurnStartRequest) =>
      ipcRenderer.invoke("chat:start-turn", request) as Promise<ChatTurnStartResult>,
    stopTurn: (request: ChatStopTurnRequest) =>
      ipcRenderer.invoke("chat:stop-turn", request) as Promise<void>,
    respondToApproval: (request: ChatApprovalResponseRequest) =>
      ipcRenderer.invoke("chat:respond-to-approval", request) as Promise<void>,
    onEvent: (listener: (event: ChatRuntimeEvent) => void) => {
      const wrappedListener = (_event: Electron.IpcRendererEvent, event: ChatRuntimeEvent) => {
        listener(event);
      };

      ipcRenderer.on("chat:event", wrappedListener);

      return () => {
        ipcRenderer.removeListener("chat:event", wrappedListener);
      };
    },
  } satisfies ChatBridge,
};

contextBridge.exposeInMainWorld("prometheus", api);
