export type ChatProviderId = "claude" | "codex";

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  providerId?: ChatProviderId;
};

export type LocalChatRequest = {
  providerId: ChatProviderId;
  prompt: string;
};

export type LocalChatResponse = {
  providerId: ChatProviderId;
  content: string;
  durationMs: number;
};
