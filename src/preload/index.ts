import { contextBridge, ipcRenderer } from "electron";

import type {
  ChatBridge,
  ChatRuntimeEvent,
  ChatStopTurnRequest,
  ChatTurnStartRequest,
  ChatTurnStartResult,
  ChatSession,
} from "@/lib/chat/types";
import type { LocalProvidersResponse } from "@/lib/providers/types";

const api = {
  providers: {
    list: () => ipcRenderer.invoke("providers:list") as Promise<LocalProvidersResponse>,
  },
  chat: {
    listSessions: () =>
      ipcRenderer.invoke("chat:list-sessions") as Promise<ChatSession[]>,
    startTurn: (request: ChatTurnStartRequest) =>
      ipcRenderer.invoke("chat:start-turn", request) as Promise<ChatTurnStartResult>,
    stopTurn: (request: ChatStopTurnRequest) =>
      ipcRenderer.invoke("chat:stop-turn", request) as Promise<void>,
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
