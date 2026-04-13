/// <reference types="vite/client" />

import type { ChatBridge } from "@/lib/chat/types";
import type { LocalProvidersResponse } from "@/lib/providers/types";

declare global {
  interface Window {
    prometheus: {
      providers: {
        list: () => Promise<LocalProvidersResponse>;
      };
      chat: ChatBridge;
    };
  }
}
