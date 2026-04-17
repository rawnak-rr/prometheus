/// <reference types="vite/client" />

import type { ChatBridge } from "@/lib/chat/types";
import type { GitBridge } from "@/lib/git/types";
import type { LocalProvidersResponse } from "@/lib/providers/types";
import type { WorkspaceBridge } from "@/lib/workspace/types";

declare global {
  interface Window {
    prometheus: {
      shell: {
        onShortcut: (
          listener: (shortcut: "toggle-sidebar" | "toggle-graph") => void,
        ) => () => void;
      };
      providers: {
        list: () => Promise<LocalProvidersResponse>;
      };
      workspace: WorkspaceBridge;
      git: GitBridge;
      chat: ChatBridge;
    };
  }
}
