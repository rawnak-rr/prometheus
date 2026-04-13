/// <reference types="vite/client" />

import type { ChatBridge } from "@/lib/chat/types";
import type { LocalProvidersResponse } from "@/lib/providers/types";
import type { WorkspaceBridge } from "@/lib/workspace/types";

declare global {
  interface Window {
    prometheus: {
      providers: {
        list: () => Promise<LocalProvidersResponse>;
      };
      workspace: WorkspaceBridge;
      chat: ChatBridge;
    };
  }
}
