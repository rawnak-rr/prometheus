export type ChatProviderId = "claude" | "codex";

export type ChatRole = "user" | "assistant";

export type ChatSessionStatus = "idle" | "running" | "error";

export type ChatRuntimeMode = "chat" | "read-only" | "workspace-write";

export type ChatSessionScope = "repo" | "file" | "directory";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  providerId?: ChatProviderId;
  createdAt: string;
  status?: "streaming" | "completed" | "failed";
};

export type ChatSession = {
  id: string;
  title: string;
  workspaceRoot: string;
  scope: ChatSessionScope;
  activeFilePath: string | null;
  providerId: ChatProviderId;
  model: string | null;
  runtimeMode: ChatRuntimeMode;
  status: ChatSessionStatus;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
  activeTurnId: string | null;
  lastError: string | null;
};

export type ChatTurnStartRequest = {
  sessionId?: string | null;
  providerId: ChatProviderId;
  prompt: string;
  model?: string | null;
  runtimeMode: ChatRuntimeMode;
  activeFilePath?: string | null;
  workspaceRoot?: string | null;
};

export type ChatTurnStartResult = {
  session: ChatSession;
  turnId: string;
};

export type ChatStopTurnRequest = {
  sessionId: string;
};

export type ChatRuntimeEvent =
  | {
      type: "sessions.changed";
      sessions: ChatSession[];
    }
  | {
      type: "turn.started";
      sessionId: string;
      turnId: string;
      session: ChatSession;
    }
  | {
      type: "message.delta";
      sessionId: string;
      messageId: string;
      delta: string;
      session: ChatSession;
    }
  | {
      type: "turn.completed";
      sessionId: string;
      turnId: string;
      session: ChatSession;
    }
  | {
      type: "turn.failed";
      sessionId: string;
      turnId: string;
      error: string;
      session: ChatSession;
    }
  | {
      type: "turn.stderr";
      sessionId: string;
      turnId: string;
      text: string;
      session: ChatSession;
    };

export type LocalChatRequest = ChatTurnStartRequest;

export type LocalChatResponse = ChatTurnStartResult;

export type ChatBridge = {
  listSessions: () => Promise<ChatSession[]>;
  startTurn: (request: ChatTurnStartRequest) => Promise<ChatTurnStartResult>;
  stopTurn: (request: ChatStopTurnRequest) => Promise<void>;
  onEvent: (listener: (event: ChatRuntimeEvent) => void) => () => void;
};
