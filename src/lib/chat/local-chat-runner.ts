import { spawn } from "node:child_process";

import type { ChatProviderId } from "./types";

const maxPromptLength = 12_000;
const processTimeoutMs = 120_000;
const escapeCharacter = String.fromCharCode(27);
const ansiEscapePattern = new RegExp(`${escapeCharacter}\\[[0-?]*[ -/]*[@-~]`, "g");

type LocalChatRun = {
  providerId: ChatProviderId;
  prompt: string;
};

type ProviderCommand = {
  command: string;
  args: string[];
  stdin: string | null;
};

export class LocalChatError extends Error {
  constructor(
    message: string,
    public readonly status = 500,
  ) {
    super(message);
  }
}

function getChatOnlyPrompt(prompt: string) {
  return [
    "You are being used as a local chatbot inside Prometheus.",
    "Answer the user's message directly. Do not edit files, run shell commands, or request tool permissions.",
    "",
    "User message:",
    prompt,
  ].join("\n");
}

function getProviderCommand(providerId: ChatProviderId, prompt: string): ProviderCommand {
  const chatOnlyPrompt = getChatOnlyPrompt(prompt);

  if (providerId === "claude") {
    return {
      command: "claude",
      args: [
        "-p",
        "--output-format",
        "text",
        "--input-format",
        "text",
        "--no-session-persistence",
        "--tools",
        "",
      ],
      stdin: chatOnlyPrompt,
    };
  }

  return {
    command: "codex",
    args: [
      "exec",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "--color",
      "never",
      "-",
    ],
    stdin: chatOnlyPrompt,
  };
}

function normalizeOutput(output: string) {
  return output.trim() || "The provider completed without returning text.";
}

function sanitizeErrorOutput(output: string) {
  return output
    .replace(ansiEscapePattern, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("thread "))
    .filter((line) => !line.includes("/Users/runner/.cargo/registry"))
    .filter((line) => !line.includes("called `Result::unwrap()`"))
    .slice(-4)
    .join(" ");
}

export async function runLocalChat({ providerId, prompt }: LocalChatRun) {
  const trimmedPrompt = prompt.trim();

  if (!trimmedPrompt) {
    throw new LocalChatError("Prompt is required.", 400);
  }

  if (trimmedPrompt.length > maxPromptLength) {
    throw new LocalChatError(`Prompt is too long. Limit it to ${maxPromptLength} characters.`, 400);
  }

  const providerCommand = getProviderCommand(providerId, trimmedPrompt);

  return new Promise<string>((resolve, reject) => {
    const child = spawn(providerCommand.command, providerCommand.args, {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(
        new LocalChatError(
          `${providerId} took too long to respond. Try a shorter prompt.`,
          504,
        ),
      );
    }, processTimeoutMs);

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timeout);

      if (error.code === "ENOENT") {
        reject(new LocalChatError(`${providerId} is not installed or is not on PATH.`, 404));
        return;
      }

      reject(new LocalChatError(`${providerId} could not be started.`, 500));
    });

    child.on("close", (code) => {
      clearTimeout(timeout);

      if (code === 0) {
        resolve(normalizeOutput(Buffer.concat(stdout).toString("utf8")));
        return;
      }

      const stderrText = Buffer.concat(stderr).toString("utf8");
      const cleanError = sanitizeErrorOutput(stderrText);
      const likelyAuthIssue = /auth|login|api key|apikey|credential|token/i.test(stderrText);
      const likelyNetworkIssue = /network|lookup|websocket|disconnected|request|url/i.test(stderrText);
      const reason = likelyAuthIssue
        ? " Check local CLI authentication."
        : likelyNetworkIssue
          ? " Check network access from the local server."
        : " Check the local CLI in your terminal.";

      reject(
        new LocalChatError(
          `${providerId} exited with code ${code}.${reason}${
            cleanError ? ` ${cleanError}` : ""
          }`,
          502,
        ),
      );
    });

    if (providerCommand.stdin) {
      child.stdin.end(providerCommand.stdin);
    } else {
      child.stdin.end();
    }
  });
}
