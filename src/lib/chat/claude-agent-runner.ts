import { existsSync } from "node:fs";
import path from "node:path";

import {
  query,
  type CanUseTool,
  type McpServerConfig,
  type PermissionResult,
  type PermissionUpdate,
  type SDKMessage,
  type SDKUserMessage,
  type Query,
} from "@anthropic-ai/claude-agent-sdk";

import type {
  ChatApprovalDecision,
  ChatApprovalKind,
  ChatApprovalRequest,
  ChatRuntimeMode,
} from "./types";
import type { LocalChatTurnCallbacks, LocalChatTurnHandle } from "./local-chat-runner";

type ClaudeTurnInput = {
  sessionId: string;
  prompt: string;
  model?: string | null;
  runtimeMode?: ChatRuntimeMode;
  workspaceRoot?: string | null;
  activeFilePath?: string | null;
};

type QueuedMessage = {
  message: SDKUserMessage;
};

type PendingPrompt = {
  resolve: (value: IteratorResult<SDKUserMessage>) => void;
  reject: (error: Error) => void;
};

type PendingApproval = {
  approval: ChatApprovalRequest;
  resolve: (decision: ChatApprovalDecision) => void;
  suggestions: PermissionUpdate[] | undefined;
  toolInput: Record<string, unknown>;
};

type ClaudeSession = {
  id: string;
  queue: QueuedMessage[];
  waiters: PendingPrompt[];
  pendingApprovals: Map<string, PendingApproval>;
  query: Query;
  activeCallbacks: LocalChatTurnCallbacks | null;
  activeTurnCompleted: boolean;
  activeTurnHadOutput: boolean;
  streamStarted: boolean;
  closed: boolean;
};

const sessions = new Map<string, ClaudeSession>();

class ClaudeAgentError extends Error {
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

function createAsyncPrompt(session: Omit<ClaudeSession, "query">): AsyncIterable<SDKUserMessage> {
  return {
    [Symbol.asyncIterator]() {
      return {
        next() {
          if (session.queue.length > 0) {
            const queued = session.queue.shift();
            return Promise.resolve({
              done: false,
              value: queued!.message,
            });
          }

          if (session.closed) {
            return Promise.resolve({
              done: true,
              value: undefined,
            });
          }

          return new Promise<IteratorResult<SDKUserMessage>>((resolve, reject) => {
            session.waiters.push({ resolve, reject });
          });
        },
      };
    },
  };
}

function enqueueMessage(session: ClaudeSession, message: SDKUserMessage) {
  const waiter = session.waiters.shift();

  if (waiter) {
    waiter.resolve({
      done: false,
      value: message,
    });
    return;
  }

  session.queue.push({ message });
}

function closePromptQueue(session: ClaudeSession) {
  session.closed = true;

  for (const waiter of session.waiters.splice(0)) {
    waiter.resolve({
      done: true,
      value: undefined,
    });
  }
}

function getContextPrefix(input: ClaudeTurnInput) {
  const contextLines = [
    input.workspaceRoot ? `Workspace root: ${input.workspaceRoot}` : null,
    input.activeFilePath ? `Selected file: ${input.activeFilePath}` : null,
  ].filter(Boolean);

  return contextLines.length > 0 ? [...contextLines, ""].join("\n") : "";
}

function buildPrompt(input: ClaudeTurnInput) {
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
    getContextPrefix(input),
    "User message:",
    input.prompt,
  ].join("\n");
}

function buildUserMessage(input: ClaudeTurnInput): SDKUserMessage {
  return {
    type: "user",
    session_id: input.sessionId,
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [
        {
          type: "text",
          text: buildPrompt(input),
        },
      ],
    },
  } as SDKUserMessage;
}

function getRepoMapMcpConfig(workspaceRoot: string): McpServerConfig | null {
  if (process.env.REPO_MAP_MCP_DISABLED === "1") return null;
  const overridePath = process.env.REPO_MAP_MCP_PATH?.trim();
  const candidatePaths = [
    overridePath,
    path.resolve(workspaceRoot, "mcp-servers/repo-map/dist/index.js"),
    path.resolve(process.cwd(), "mcp-servers/repo-map/dist/index.js"),
  ].filter((p): p is string => !!p);

  const serverPath = candidatePaths.find((p) => existsSync(p));
  if (!serverPath) return null;

  return {
    type: "stdio",
    command: process.execPath,
    args: [serverPath],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      REPO_MAP_ROOT: workspaceRoot,
    } as Record<string, string>,
  };
}

function getPermissionMode(runtimeMode: ChatRuntimeMode | undefined) {
  if (runtimeMode === "chat" || runtimeMode === "read-only") {
    return "dontAsk" as const;
  }

  return "default" as const;
}

function getTools(runtimeMode: ChatRuntimeMode | undefined) {
  if (runtimeMode === "chat") {
    return [];
  }

  if (runtimeMode === "read-only") {
    return ["Read", "Grep", "Glob", "LS"];
  }

  return { type: "preset" as const, preset: "claude_code" as const };
}

function toolKind(toolName: string): ChatApprovalKind {
  const normalized = toolName.toLowerCase();

  if (normalized.includes("bash")) {
    return "command";
  }

  if (
    normalized.includes("edit") ||
    normalized.includes("write") ||
    normalized.includes("patch")
  ) {
    return "file-change";
  }

  return "file-read";
}

function approvalTitle(kind: ChatApprovalKind, toolName: string, title?: string) {
  if (title?.trim()) {
    return title.trim();
  }

  switch (kind) {
    case "command":
      return `Allow ${toolName} command`;
    case "file-read":
      return `Allow ${toolName} read`;
    case "file-change":
      return `Allow ${toolName} change`;
  }
}

function approvalDetail(toolName: string, toolInput: Record<string, unknown>) {
  return (
    readString(toolInput, "command") ??
    readString(toolInput, "file_path") ??
    readString(toolInput, "path") ??
    readString(toolInput, "pattern") ??
    toolName
  );
}

function buildApproval(input: {
  toolName: string;
  toolInput: Record<string, unknown>;
  options: Parameters<CanUseTool>[2];
}): ChatApprovalRequest {
  const kind = toolKind(input.toolName);

  return {
    id: crypto.randomUUID(),
    kind,
    method: `claude/canUseTool/${input.toolName}`,
    turnId: null,
    itemId: input.options.toolUseID ?? null,
    title: approvalTitle(kind, input.toolName, input.options.title ?? input.options.displayName),
    detail: input.options.description ?? approvalDetail(input.toolName, input.toolInput),
    command: readString(input.toolInput, "command") ?? null,
    cwd: readString(input.toolInput, "cwd") ?? null,
    path:
      readString(input.toolInput, "file_path") ??
      readString(input.toolInput, "path") ??
      input.options.blockedPath ??
      null,
    reason: input.options.decisionReason ?? null,
    createdAt: new Date().toISOString(),
  };
}

function toPermissionResult(
  decision: ChatApprovalDecision,
  pending: PendingApproval,
): PermissionResult {
  if (decision === "accept" || decision === "acceptForSession") {
    return {
      behavior: "allow",
      updatedInput: pending.toolInput,
      ...(decision === "acceptForSession" && pending.suggestions
        ? { updatedPermissions: pending.suggestions }
        : {}),
    };
  }

  return {
    behavior: "deny",
    message:
      decision === "cancel" ? "User cancelled tool execution." : "User declined tool execution.",
    interrupt: decision === "cancel",
  };
}

function extractTextDelta(message: SDKMessage) {
  if (message.type !== "stream_event") {
    return null;
  }

  const event = readObject(message.event);
  if (readString(event, "type") !== "content_block_delta") {
    return null;
  }

  const delta = readObject(event?.delta);
  const text = readString(delta, "text");

  return text?.trim() ? text : null;
}

function extractAssistantText(message: SDKMessage) {
  if (message.type !== "assistant") {
    return null;
  }

  const content = readObject(message.message)?.content;
  if (!Array.isArray(content)) {
    return null;
  }

  const text = content
    .map((block) => readString(block, "text"))
    .filter((value): value is string => Boolean(value))
    .join("");

  return text.trim() ? text : null;
}

function resultError(message: SDKMessage) {
  if (message.type !== "result" || !message.is_error) {
    return null;
  }

  if ("errors" in message && Array.isArray(message.errors) && message.errors.length > 0) {
    return message.errors.join(" ");
  }

  if ("result" in message && typeof message.result === "string" && message.result.trim()) {
    return message.result;
  }

  return "Claude turn failed.";
}

async function runStream(session: ClaudeSession) {
  try {
    for await (const message of session.query) {
      if (session.closed) {
        return;
      }

      if (message.type === "system" && message.subtype === "init") {
        process.stderr.write(
          `[claude-init] mcp_servers=${JSON.stringify(
            (message as unknown as { mcp_servers?: unknown }).mcp_servers ?? [],
          )}\n`,
        );
        continue;
      }

      const delta = extractTextDelta(message);
      if (delta) {
        session.activeTurnHadOutput = true;
        session.activeCallbacks?.onStdout(delta);
        continue;
      }

      if (message.type === "assistant" && "error" in message && message.error) {
        const text = extractAssistantText(message);
        session.activeCallbacks?.onError(new ClaudeAgentError(text ?? message.error, 502));
        session.activeCallbacks = null;
        continue;
      }

      if (message.type === "result") {
        const error = resultError(message);
        const callbacks = session.activeCallbacks;
        session.activeCallbacks = null;
        session.activeTurnCompleted = true;

        if (error) {
          callbacks?.onError(new ClaudeAgentError(error, 502));
        } else {
          if (!session.activeTurnHadOutput && "result" in message && message.result.trim()) {
            callbacks?.onStdout(message.result);
          }
          callbacks?.onComplete();
        }
      }
    }
  } catch (error) {
    const callbacks = session.activeCallbacks;
    session.activeCallbacks = null;
    callbacks?.onError(
      new ClaudeAgentError(error instanceof Error ? error.message : "Claude stream failed.", 502),
    );
  } finally {
    session.closed = true;
    sessions.delete(session.id);
  }
}

function createCanUseTool(session: Omit<ClaudeSession, "query">): CanUseTool {
  return async (toolName, toolInput, options) => {
    const approval = buildApproval({ toolName, toolInput, options });

    return await new Promise<PermissionResult>((resolve) => {
      const pendingApproval: PendingApproval = {
        approval,
        resolve: (decision) => resolve(toPermissionResult(decision, pendingApproval)),
        suggestions: options.suggestions,
        toolInput,
      };

      session.pendingApprovals.set(approval.id, pendingApproval);
      session.activeCallbacks?.onApprovalRequest?.(approval);

      options.signal.addEventListener(
        "abort",
        () => {
          if (!session.pendingApprovals.has(approval.id)) {
            return;
          }

          session.pendingApprovals.delete(approval.id);
          resolve({
            behavior: "deny",
            message: "Tool execution was aborted.",
            interrupt: true,
          });
        },
        { once: true },
      );
    });
  };
}

function createSession(input: ClaudeTurnInput) {
  const baseSession: Omit<ClaudeSession, "query"> = {
    id: input.sessionId,
    queue: [],
    waiters: [],
    pendingApprovals: new Map(),
    activeCallbacks: null,
    activeTurnCompleted: false,
    activeTurnHadOutput: false,
    streamStarted: false,
    closed: false,
  };
  const prompt = createAsyncPrompt(baseSession);
  const permissionMode = getPermissionMode(input.runtimeMode);
  const workspaceRoot = input.workspaceRoot ?? process.cwd();
  const repoMapServer = getRepoMapMcpConfig(workspaceRoot);
  const claudeQuery = query({
    prompt,
    options: {
      cwd: workspaceRoot,
      ...(input.model?.trim() ? { model: input.model.trim() } : {}),
      permissionMode,
      tools: getTools(input.runtimeMode),
      includePartialMessages: true,
      canUseTool: createCanUseTool(baseSession),
      env: process.env,
      ...(input.workspaceRoot ? { additionalDirectories: [input.workspaceRoot] } : {}),
      ...(repoMapServer ? { mcpServers: { "repo-map": repoMapServer } } : {}),
    },
  });
  const session: ClaudeSession = {
    ...baseSession,
    query: claudeQuery,
  };

  sessions.set(input.sessionId, session);
  return session;
}

function getSession(input: ClaudeTurnInput) {
  const existing = sessions.get(input.sessionId);

  if (existing && !existing.closed) {
    return existing;
  }

  return createSession(input);
}

export function startClaudeAgentTurn(
  input: ClaudeTurnInput,
  callbacks: LocalChatTurnCallbacks,
): LocalChatTurnHandle {
  const session = getSession(input);

  if (!session.streamStarted) {
    session.streamStarted = true;
    void runStream(session);
  }

  if (session.activeCallbacks) {
    callbacks.onError(new ClaudeAgentError("That Claude session already has a running turn.", 409));
    return { stop: () => undefined };
  }

  session.activeCallbacks = callbacks;
  session.activeTurnCompleted = false;
  session.activeTurnHadOutput = false;
  enqueueMessage(session, buildUserMessage(input));

  return {
    stop: () => {
      void session.query.interrupt().catch((error: unknown) => {
        callbacks.onError(
          new ClaudeAgentError(error instanceof Error ? error.message : "Failed to stop Claude."),
        );
      });
    },
  };
}

export function respondToClaudeAgentApproval(
  sessionId: string,
  approvalId: string,
  decision: ChatApprovalDecision,
) {
  const session = sessions.get(sessionId);

  if (!session || session.closed) {
    throw new Error("Claude session is not running.");
  }

  const pendingApproval = session.pendingApprovals.get(approvalId);

  if (!pendingApproval) {
    throw new Error("Unknown approval request.");
  }

  session.pendingApprovals.delete(approvalId);
  pendingApproval.resolve(decision);
  session.activeCallbacks?.onApprovalResolved?.(approvalId, decision);
}

export function disposeClaudeAgentSessions() {
  for (const session of sessions.values()) {
    closePromptQueue(session);
    void session.query.interrupt().catch(() => undefined);
    session.pendingApprovals.clear();
  }

  sessions.clear();
}
