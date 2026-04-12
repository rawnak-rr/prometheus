import { access } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { constants } from "node:fs";

import type { LocalProvider, LocalProviderId } from "./types";

type LocalProviderDefinition = {
  id: LocalProviderId;
  name: string;
  command: string;
  description: string;
};

const providerDefinitions: LocalProviderDefinition[] = [
  {
    id: "codex",
    name: "Codex",
    command: "codex",
    description: "OpenAI Codex CLI from the local terminal environment.",
  },
  {
    id: "claude",
    name: "Claude",
    command: "claude",
    description: "Anthropic Claude CLI from the local terminal environment.",
  },
  {
    id: "gemini",
    name: "Gemini",
    command: "gemini",
    description: "Google Gemini CLI from the local terminal environment.",
  },
];

const defaultExecutablePaths = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
];

function getSearchPaths() {
  const pathParts = process.env.PATH?.split(delimiter) ?? [];
  return Array.from(new Set([...pathParts, ...defaultExecutablePaths].filter(Boolean)));
}

async function findExecutable(command: string) {
  for (const directory of getSearchPaths()) {
    const candidate = join(directory, command);

    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Keep scanning PATH entries until an executable is found.
    }
  }

  return null;
}

export async function detectLocalProviders(): Promise<LocalProvider[]> {
  return Promise.all(
    providerDefinitions.map(async (definition) => {
      const executablePath = await findExecutable(definition.command);

      return {
        ...definition,
        status: executablePath ? "available" : "missing",
      };
    }),
  );
}
