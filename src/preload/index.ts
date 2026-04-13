import { contextBridge, ipcRenderer } from "electron";

import type { LocalChatRequest, LocalChatResponse } from "@/lib/chat/types";
import type { LocalProvidersResponse } from "@/lib/providers/types";

const api = {
  providers: {
    list: () => ipcRenderer.invoke("providers:list") as Promise<LocalProvidersResponse>,
  },
  chat: {
    send: (request: LocalChatRequest) =>
      ipcRenderer.invoke("chat:send", request) as Promise<LocalChatResponse>,
  },
};

contextBridge.exposeInMainWorld("prometheus", api);
