export type LocalProviderId = "codex" | "claude" | "gemini";

export type LocalProviderStatus = "available" | "missing";

export type LocalProvider = {
  id: LocalProviderId;
  name: string;
  command: string;
  description: string;
  status: LocalProviderStatus;
};

export type LocalProvidersResponse = {
  runtime: "desktop";
  providers: LocalProvider[];
};
