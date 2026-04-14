import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";

import type { ChatRuntimeMode } from "./types";
import type { LocalChatTurnCallbacks, LocalChatTurnHandle } from "./local-chat-runner";

type JsonRpcId = string | number;

type PendingRequest = {
  method: string;
  timeout: ReturnType<typeof setTimeout>;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type JsonRpcResponse = {
  id: JsonRpcId;
  result?: unknown;
  error?: {
    message?: string;
  };
};

type JsonRpcRequest = {
  id: JsonRpcId;
  method: string;
  params?: unknown;
};

type JsonRpcNotification = {
  method: string;
  params?: unknown;
};

type CodexTurnInput = {
  sessionId: string;
  prompt: string;
  model?: string | null;
  runtimeMode?: ChatRuntimeMode;
  workspaceRoot?: string | null;
  activeFilePath?: string | null;
};

type CodexSession = {
  id: string;
  child: ChildProcessWithoutNullStreams;
  output: readline.Interface;
  pending: Map<string, PendingRequest>;
  nextRequestId: number;
  cwd: string;
  model: string | null;
  runtimeMode: ChatRuntimeMode;
  providerThreadId: string | null;
  activeTurnId: string | null;
  activeCallbacks: LocalChatTurnCallbacks | null;
  ready: Promise<void>;
  closed: boolean;
};

const sessions = new Map<string, CodexSession>();
const requestTimeoutMs = 20_000;

class CodexAppServerError extends Error {
  constructor(
    message: string,
    public readonly status = 500,
  ) {
    super(message);
  }
}

function readObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function readString(value: unknown, key: string) {
  const object = readObject(value);
  const candidate = object?.[key];
  return typeof candidate === "string" ? candidate : undefined;
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

function getCodexApprovalPolicy(runtimeMode: ChatRuntimeMode) {
  return runtimeMode === "workspace-write" ? "on-request" : "never";
}

function buildPrompt(input: CodexTurnInput) {
  const contextLines = [
    input.workspaceRoot ? `Workspace root: ${input.workspaceRoot}` : null,
    input.activeFilePath ? `Selected file: ${input.activeFilePath}` : null,
  ].filter(Boolean);

  const modeLines =
    input.runtimeMode === "chat"
      ? [
          "You are being used as a local chatbot inside Prometheus.",
          "Answer the user's message directly. Do not edit files, run shell commands, or request tool permissions.",
        ]
      : [
          "You are being used inside Prometheus.",
          "Act like the selected local coding-agent CLI would in a terminal, but keep the response concise unless the user asks for detail.",
        ];

  return [
    ...modeLines,
    "",
    ...contextLines,
    contextLines.length > 0 ? "" : null,
    "User message:",
    input.prompt,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function killChildProcess(child: ChildProcessWithoutNullStreams) {
  if (process.platform === "win32" && child.pid !== undefined) {
    try {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      return;
    } catch {
      // Fall through to direct kill.
    }
  }

  child.kill();
}

function isResponse(message: unknown): message is JsonRpcResponse {
  return Boolean(readObject(message) && "id" in readObject(message)! && ("result" in readObject(message)! || "error" in readObject(message)!));
}

function isRequest(message: unknown): message is JsonRpcRequest {
  return Boolean(readObject(message) && "id" in readObject(message)! && typeof readString(message, "method") === "string" && !("result" in readObject(message)!));
}

function isNotification(message: unknown): message is JsonRpcNotification {
  return Boolean(readObject(message) && !("id" in readObject(message)!) && typeof readString(message, "method") === "string");
}

function writeMessage(session: CodexSession, message: unknown) {
  if (!session.child.stdin.writable) {
    throw new Error("Cannot write to codex app-server stdin.");
  }

  session.child.stdin.write(`${JSON.stringify(message)}\n`);
}

function sendRequest(session: CodexSession, method: string, params: unknown) {
  const id = session.nextRequestId;
  session.nextRequestId += 1;

  return new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(() => {
      session.pending.delete(String(id));
      reject(new Error(`Timed out waiting for ${method}.`));
    }, requestTimeoutMs);

    session.pending.set(String(id), {
      method,
      timeout,
      resolve,
      reject,
    });

    writeMessage(session, { id, method, params });
  });
}

function handleResponse(session: CodexSession, response: JsonRpcResponse) {
  const pending = session.pending.get(String(response.id));

  if (!pending) {
    return;
  }

  clearTimeout(pending.timeout);
  session.pending.delete(String(response.id));

  if (response.error?.message) {
    pending.reject(new Error(`${pending.method} failed: ${response.error.message}`));
    return;
  }

  pending.resolve(response.result);
}

function handleRequest(session: CodexSession, request: JsonRpcRequest) {
  if (
    request.method === "item/commandExecution/requestApproval" ||
    request.method === "item/fileChange/requestApproval" ||
    request.method === "execCommandApproval" ||
    request.method === "applyPatchApproval"
  ) {
    writeMessage(session, {
      id: request.id,
      result: {
        decision: "decline",
      },
    });
    session.activeCallbacks?.onStderr(`Codex requested ${request.method}; Prometheus declined it because approval UI is not implemented yet.\n`);
    return;
  }

  writeMessage(session, {
    id: request.id,
    error: {
      code: -32601,
      message: `Unsupported server request: ${request.method}`,
    },
  });
}

function handleNotification(session: CodexSession, notification: JsonRpcNotification) {
  const params = readObject(notification.params);

  if (notification.method === "thread/started") {
    const thread = readObject(params?.thread);
    const threadId = readString(thread, "id") ?? readString(params, "threadId");
    session.providerThreadId = threadId ?? session.providerThreadId;
    return;
  }

  if (notification.method === "turn/started") {
    const turn = readObject(params?.turn);
    session.activeTurnId = readString(turn, "id") ?? readString(params, "turnId") ?? session.activeTurnId;
    return;
  }

  if (notification.method === "item/agentMessage/delta") {
    const delta = readString(params, "delta");
    if (delta) {
      session.activeCallbacks?.onStdout(delta);
    }
    return;
  }

  if (notification.method === "turn/completed") {
    const turn = readObject(params?.turn);
    const status = readString(turn, "status");
    const error = readObject(turn?.error);
    const message = readString(error, "message");
    session.activeTurnId = null;
    const callbacks = session.activeCallbacks;
    session.activeCallbacks = null;

    if (status === "failed") {
      callbacks?.onError(new CodexAppServerError(message ?? "Codex turn failed.", 502));
      return;
    }

    callbacks?.onComplete();
    return;
  }

  if (notification.method === "error") {
    const error = readObject(params?.error);
    const message = readString(error, "message") ?? "Codex app-server reported an error.";
    session.activeCallbacks?.onError(new CodexAppServerError(message, 502));
  }
}

function attachSessionListeners(session: CodexSession) {
  session.output.on("line", (line) => {
    let message: unknown;

    try {
      message = JSON.parse(line);
    } catch {
      session.activeCallbacks?.onStderr("Received invalid JSON from codex app-server.\n");
      return;
    }

    if (isRequest(message)) {
      handleRequest(session, message);
      return;
    }

    if (isNotification(message)) {
      handleNotification(session, message);
      return;
    }

    if (isResponse(message)) {
      handleResponse(session, message);
    }
  });

  session.child.stderr.on("data", (chunk: Buffer) => {
    session.activeCallbacks?.onStderr(chunk.toString("utf8"));
  });

  session.child.once("error", (error: NodeJS.ErrnoException) => {
    const callbacks = session.activeCallbacks;
    session.activeCallbacks = null;
    callbacks?.onError(
      new CodexAppServerError(
        error.code === "ENOENT" ? "codex is not installed or is not on PATH." : "codex could not be started.",
        error.code === "ENOENT" ? 404 : 500,
      ),
    );
  });

  session.child.once("exit", (code, signal) => {
    session.closed = true;
    sessions.delete(session.id);

    for (const pending of session.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("codex app-server exited before request completed."));
    }
    session.pending.clear();

    const callbacks = session.activeCallbacks;
    session.activeCallbacks = null;
    callbacks?.onError(
      new CodexAppServerError(
        `codex app-server exited (code=${code ?? "null"}, signal=${signal ?? "null"}).`,
        502,
      ),
    );
  });
}

async function initializeSession(session: CodexSession) {
  await sendRequest(session, "initialize", {
    clientInfo: {
      name: "prometheus",
      title: "Prometheus",
      version: "0.1.0",
    },
    capabilities: {
      experimentalApi: true,
    },
  });
  writeMessage(session, { method: "initialized" });

  const response = await sendRequest(session, "thread/start", {
    model: session.model,
    cwd: session.cwd,
    approvalPolicy: getCodexApprovalPolicy(session.runtimeMode),
    sandbox: getCodexSandbox(session.runtimeMode),
    experimentalRawEvents: false,
    persistExtendedHistory: true,
  });
  const responseObject = readObject(response);
  const thread = readObject(responseObject?.thread);
  const threadId = readString(thread, "id") ?? readString(responseObject, "threadId");

  if (!threadId) {
    throw new Error("thread/start response did not include a thread id.");
  }

  session.providerThreadId = threadId;
}

function createSession(input: CodexTurnInput) {
  const child = spawn("codex", ["app-server"], {
    cwd: input.workspaceRoot ?? undefined,
    shell: process.platform === "win32",
    stdio: ["pipe", "pipe", "pipe"],
  });
  const output = readline.createInterface({ input: child.stdout });
  const session: CodexSession = {
    id: input.sessionId,
    child,
    output,
    pending: new Map(),
    nextRequestId: 1,
    cwd: input.workspaceRoot ?? process.cwd(),
    model: input.model?.trim() || null,
    runtimeMode: input.runtimeMode ?? "chat",
    providerThreadId: null,
    activeTurnId: null,
    activeCallbacks: null,
    ready: Promise.resolve(),
    closed: false,
  };

  attachSessionListeners(session);
  session.ready = initializeSession(session).catch((error) => {
    session.closed = true;
    sessions.delete(input.sessionId);
    if (!session.child.killed) {
      killChildProcess(session.child);
    }
    throw error;
  });
  sessions.set(input.sessionId, session);

  return session;
}

function getSession(input: CodexTurnInput) {
  const existing = sessions.get(input.sessionId);

  if (existing && !existing.closed) {
    return existing;
  }

  return createSession(input);
}

export function startCodexAppServerTurn(
  input: CodexTurnInput,
  callbacks: LocalChatTurnCallbacks,
): LocalChatTurnHandle {
  const session = getSession(input);
  let stopped = false;

  void (async () => {
    try {
      await session.ready;

      if (session.activeCallbacks) {
        throw new CodexAppServerError("That Codex session already has a running turn.", 409);
      }

      if (!session.providerThreadId) {
        throw new Error("Codex app-server session is missing a provider thread id.");
      }

      session.activeCallbacks = callbacks;
      const response = await sendRequest(session, "turn/start", {
        threadId: session.providerThreadId,
        input: [
          {
            type: "text",
            text: buildPrompt(input),
            text_elements: [],
          },
        ],
        ...(input.model?.trim() ? { model: input.model.trim() } : {}),
      });
      const turn = readObject(readObject(response)?.turn);
      if (session.activeCallbacks === callbacks) {
        session.activeTurnId = readString(turn, "id") ?? session.activeTurnId;
      }
    } catch (error) {
      if (session.activeCallbacks === callbacks) {
        session.activeCallbacks = null;
        session.activeTurnId = null;
      }

      if (stopped) {
        callbacks.onError(new CodexAppServerError("codex turn was stopped.", 499));
        return;
      }

      callbacks.onError(
        error instanceof CodexAppServerError
          ? error
          : new CodexAppServerError(
              error instanceof Error ? error.message : "Codex app-server request failed.",
              502,
            ),
      );
    }
  })();

  return {
    stop: () => {
      stopped = true;
      const providerThreadId = session.providerThreadId;
      const turnId = session.activeTurnId;

      if (!providerThreadId || !turnId) {
        session.activeCallbacks?.onError(new CodexAppServerError("codex turn was stopped.", 499));
        session.activeCallbacks = null;
        return;
      }

      void sendRequest(session, "turn/interrupt", {
        threadId: providerThreadId,
        turnId,
      }).catch(() => {
        killChildProcess(session.child);
      });
    },
  };
}

export function disposeCodexAppServerSessions() {
  for (const session of sessions.values()) {
    session.closed = true;
    session.output.close();
    for (const pending of session.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("codex app-server session disposed."));
    }
    session.pending.clear();
    if (!session.child.killed) {
      killChildProcess(session.child);
    }
  }

  sessions.clear();
}
