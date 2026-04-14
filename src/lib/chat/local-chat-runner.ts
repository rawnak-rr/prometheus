import { spawn } from "node:child_process";

import type { ChatProviderId, ChatRuntimeMode } from "./types";
import { startCodexAppServerTurn } from "./codex-app-server-runner";
import type { ChatApprovalDecision, ChatApprovalRequest } from "./types";

const maxPromptLength = 12_000;
const processTimeoutMs = 120_000;
const escapeCharacter = String.fromCharCode(27);
const ansiEscapePattern = new RegExp(`${escapeCharacter}\\[[0-?]*[ -/]*[@-~]`, "g");

type LocalChatRun = {
  sessionId?: string | null;
  providerId: ChatProviderId;
  prompt: string;
  model?: string | null;
  runtimeMode?: ChatRuntimeMode;
  workspaceRoot?: string | null;
  activeFilePath?: string | null;
};

export type LocalChatTurnCallbacks = {
  onStdout: (chunk: string) => void;
  onStderr: (chunk: string) => void;
  onComplete: () => void;
  onError: (error: LocalChatError) => void;
  onApprovalRequest?: (approval: ChatApprovalRequest) => void;
  onApprovalResolved?: (approvalId: string, decision: ChatApprovalDecision) => void;
};

export type LocalChatTurnHandle = {
  stop: () => void;
};

type ProviderCommand = {
  command: string;
  args: string[];
  stdin: string | null;
  cwd: string | null;
};

export class LocalChatError extends Error {
  constructor(
    message: string,
    public readonly status = 500,
  ) {
    super(message);
  }
}

function getContextPrefix(input: LocalChatRun) {
  const contextLines = [
    input.workspaceRoot ? `Workspace root: ${input.workspaceRoot}` : null,
    input.activeFilePath ? `Selected file: ${input.activeFilePath}` : null,
  ].filter(Boolean);

  return contextLines.length > 0 ? [...contextLines, ""].join("\n") : "";
}

function getChatOnlyPrompt(input: LocalChatRun) {
  return [
    "You are being used as a local chatbot inside Prometheus.",
    "Answer the user's message directly. Do not edit files, run shell commands, or request tool permissions.",
    "",
    getContextPrefix(input),
    "User message:",
    input.prompt,
  ].join("\n");
}

function getCodexSandbox(runtimeMode: ChatRuntimeMode) {
  switch (runtimeMode) {
    case "workspace-write":
      return "workspace-write";
    case "chat":
    case "read-only":
      return "read-only";
  }
}

function getProviderCommand(input: LocalChatRun): ProviderCommand {
  const runtimeMode = input.runtimeMode ?? "chat";
  const chatOnlyPrompt =
    runtimeMode === "chat"
      ? getChatOnlyPrompt(input)
      : [
          "You are being used inside Prometheus.",
          "Act like the selected local coding-agent CLI would in a terminal, but keep the response concise unless the user asks for detail.",
          "",
          getContextPrefix(input),
          "User message:",
          input.prompt,
        ].join("\n");

  if (input.providerId === "claude") {
    const args = [
      "-p",
      "--output-format",
      "text",
      "--input-format",
      "text",
      "--no-session-persistence",
    ];

    if (input.model?.trim()) {
      args.push("--model", input.model.trim());
    }

    if (runtimeMode === "chat") {
      args.push("--tools", "");
    } else if (runtimeMode === "workspace-write") {
      args.push("--permission-mode", "acceptEdits");
    }

    return {
      command: "claude",
      args,
      stdin: chatOnlyPrompt,
      cwd: input.workspaceRoot ?? null,
    };
  }

  const args = [
    "exec",
    "--sandbox",
    getCodexSandbox(runtimeMode),
    "--skip-git-repo-check",
    "--color",
    "never",
  ];

  if (input.model?.trim()) {
    args.push("--model", input.model.trim());
  }

  args.push("-");

  return {
    command: "codex",
    args,
    stdin: chatOnlyPrompt,
    cwd: input.workspaceRoot ?? null,
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

export async function runLocalChat({ providerId, prompt, model, runtimeMode }: LocalChatRun) {
  const trimmedPrompt = prompt.trim();

  if (!trimmedPrompt) {
    throw new LocalChatError("Prompt is required.", 400);
  }

  if (trimmedPrompt.length > maxPromptLength) {
    throw new LocalChatError(`Prompt is too long. Limit it to ${maxPromptLength} characters.`, 400);
  }

  const providerCommand = getProviderCommand({ providerId, prompt: trimmedPrompt, model, runtimeMode });

  return new Promise<string>((resolve, reject) => {
    const child = spawn(providerCommand.command, providerCommand.args, {
      cwd: providerCommand.cwd ?? undefined,
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

      reject(createProviderExitError(providerId, code, Buffer.concat(stderr).toString("utf8")));
    });

    if (providerCommand.stdin) {
      child.stdin.end(providerCommand.stdin);
    } else {
      child.stdin.end();
    }
  });
}

export function startLocalChatTurn(input: LocalChatRun, callbacks: LocalChatTurnCallbacks) {
  const trimmedPrompt = input.prompt.trim();

  if (!trimmedPrompt) {
    callbacks.onError(new LocalChatError("Prompt is required.", 400));
    return { stop: () => undefined };
  }

  if (trimmedPrompt.length > maxPromptLength) {
    callbacks.onError(
      new LocalChatError(`Prompt is too long. Limit it to ${maxPromptLength} characters.`, 400),
    );
    return { stop: () => undefined };
  }

  if (input.providerId === "codex" && input.sessionId) {
    return startCodexAppServerTurn(
      {
        ...input,
        sessionId: input.sessionId,
        prompt: trimmedPrompt,
      },
      callbacks,
    );
  }

  const providerCommand = getProviderCommand({
    ...input,
    prompt: trimmedPrompt,
  });

  const child = spawn(providerCommand.command, providerCommand.args, {
    cwd: providerCommand.cwd ?? undefined,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let finished = false;
  let stopped = false;
  const stderr: Buffer[] = [];

  const timeout = setTimeout(() => {
    stopped = true;
    child.kill("SIGTERM");
    callbacks.onError(
      new LocalChatError(
        `${input.providerId} took too long to respond. Try a shorter prompt.`,
        504,
      ),
    );
  }, processTimeoutMs);

  function finish(callback: () => void) {
    if (finished) {
      return;
    }

    finished = true;
    clearTimeout(timeout);
    callback();
  }

  child.stdout.on("data", (chunk: Buffer) => {
    callbacks.onStdout(chunk.toString("utf8"));
  });

  child.stderr.on("data", (chunk: Buffer) => {
    stderr.push(chunk);
    callbacks.onStderr(chunk.toString("utf8"));
  });

  child.on("error", (error: NodeJS.ErrnoException) => {
    finish(() => {
      if (error.code === "ENOENT") {
        callbacks.onError(
          new LocalChatError(`${input.providerId} is not installed or is not on PATH.`, 404),
        );
        return;
      }

      callbacks.onError(new LocalChatError(`${input.providerId} could not be started.`, 500));
    });
  });

  child.on("close", (code) => {
    finish(() => {
      if (stopped) {
        callbacks.onError(new LocalChatError(`${input.providerId} turn was stopped.`, 499));
        return;
      }

      if (code === 0) {
        callbacks.onComplete();
        return;
      }

      const stderrText = Buffer.concat(stderr).toString("utf8");
      callbacks.onError(createProviderExitError(input.providerId, code, stderrText));
    });
  });

  child.stdin.end(providerCommand.stdin ?? "");

  return {
    stop: () => {
      stopped = true;
      child.kill("SIGTERM");
    },
  };
}

function createProviderExitError(
  providerId: ChatProviderId,
  code: number | null,
  stderrText: string,
) {
  const cleanError = sanitizeErrorOutput(stderrText);
  const likelyAuthIssue = /auth|login|api key|apikey|credential|token/i.test(stderrText);
  const likelyNetworkIssue = /network|lookup|websocket|disconnected|request|url/i.test(stderrText);
  const reason = likelyAuthIssue
    ? " Check local CLI authentication."
    : likelyNetworkIssue
      ? " Check network access from the desktop app."
      : " Check the local CLI in your terminal.";

  return new LocalChatError(
    `${providerId} exited with code ${code ?? "unknown"}.${reason}${
      cleanError ? ` ${cleanError}` : ""
    }`,
    502,
  );
}
