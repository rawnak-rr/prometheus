/// <reference types="vite/client" />

import type { LocalChatRequest, LocalChatResponse } from "@/lib/chat/types";
import type { LocalProvidersResponse } from "@/lib/providers/types";

declare global {
  interface Window {
    prometheus: {
      providers: {
        list: () => Promise<LocalProvidersResponse>;
      };
      chat: {
        send: (request: LocalChatRequest) => Promise<LocalChatResponse>;
      };
    };
  }
}
