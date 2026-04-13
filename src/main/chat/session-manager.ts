import { randomUUID } from "node:crypto";

import {
  startLocalChatTurn,
  type LocalChatTurnHandle,
} from "@/lib/chat/local-chat-runner";
import type {
  ChatMessage,
  ChatRuntimeEvent,
  ChatSession,
  ChatStopTurnRequest,
  ChatTurnStartRequest,
  ChatTurnStartResult,
} from "@/lib/chat/types";

type Broadcast = (event: ChatRuntimeEvent) => void;

type RunningTurn = {
  sessionId: string;
  turnId: string;
  assistantMessageId: string;
  handle: LocalChatTurnHandle;
};

const maxTitleLength = 42;
const workspaceRoot = process.cwd();

function now() {
  return new Date().toISOString();
}

function createTitle(prompt: string) {
  const compact = prompt.replace(/\s+/g, " ").trim();

  if (!compact) {
    return "New thread";
  }

  return compact.length > maxTitleLength
    ? `${compact.slice(0, maxTitleLength - 1).trim()}...`
    : compact;
}

function createUserMessage(prompt: string): ChatMessage {
  return {
    id: randomUUID(),
    role: "user",
    content: prompt,
    createdAt: now(),
    status: "completed",
  };
}

function createAssistantMessage(providerId: ChatMessage["providerId"]): ChatMessage {
  return {
    id: randomUUID(),
    role: "assistant",
    providerId,
    content: "",
    createdAt: now(),
    status: "streaming",
  };
}

function resolveSessionScope(activeFilePath?: string | null) {
  return activeFilePath ? "file" : "repo";
}

function cloneSession(session: ChatSession): ChatSession {
  return {
    ...session,
    messages: session.messages.map((message) => ({ ...message })),
  };
}

export function createChatSessionManager(broadcast: Broadcast) {
  const sessions = new Map<string, ChatSession>();
  const runningTurns = new Map<string, RunningTurn>();

  function listSessions() {
    return Array.from(sessions.values())
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(cloneSession);
  }

  function emitSessionsChanged() {
    broadcast({
      type: "sessions.changed",
      sessions: listSessions(),
    });
  }

  function emit(event: ChatRuntimeEvent) {
    broadcast(event);
    emitSessionsChanged();
  }

  function getSession(sessionId: string) {
    const session = sessions.get(sessionId);

    if (!session) {
      throw new Error("Unknown chat session.");
    }

    return session;
  }

  function resolveSession(request: ChatTurnStartRequest) {
    if (request.sessionId) {
      const session = getSession(request.sessionId);

      if (session.status === "running") {
        throw new Error("That session already has a running turn.");
      }

      return session;
    }

    const createdAt = now();
    const session: ChatSession = {
      id: randomUUID(),
      title: createTitle(request.prompt),
      workspaceRoot: request.workspaceRoot?.trim() || workspaceRoot,
      scope: resolveSessionScope(request.activeFilePath),
      activeFilePath: request.activeFilePath?.trim() || null,
      providerId: request.providerId,
      model: request.model?.trim() ? request.model.trim() : null,
      runtimeMode: request.runtimeMode,
      status: "idle",
      messages: [],
      createdAt,
      updatedAt: createdAt,
      activeTurnId: null,
      lastError: null,
    };

    sessions.set(session.id, session);
    return session;
  }

  function appendDelta(session: ChatSession, messageId: string, delta: string) {
    const message = session.messages.find((candidate) => candidate.id === messageId);

    if (!message) {
      return;
    }

    message.content += delta;
    session.updatedAt = now();

    emit({
      type: "message.delta",
      sessionId: session.id,
      messageId,
      delta,
      session: cloneSession(session),
    });
  }

  function markCompleted(session: ChatSession, turnId: string, assistantMessageId: string) {
    const assistantMessage = session.messages.find((message) => message.id === assistantMessageId);

    if (assistantMessage) {
      assistantMessage.status = "completed";
      assistantMessage.content =
        assistantMessage.content.trim() || "The provider completed without returning text.";
    }

    session.status = "idle";
    session.activeTurnId = null;
    session.lastError = null;
    session.updatedAt = now();
    runningTurns.delete(session.id);

    emit({
      type: "turn.completed",
      sessionId: session.id,
      turnId,
      session: cloneSession(session),
    });
  }

  function markFailed(
    session: ChatSession,
    turnId: string,
    assistantMessageId: string,
    error: string,
  ) {
    const assistantMessage = session.messages.find((message) => message.id === assistantMessageId);

    if (assistantMessage) {
      assistantMessage.status = "failed";
      assistantMessage.content = assistantMessage.content.trim() || error;
    }

    session.status = "error";
    session.activeTurnId = null;
    session.lastError = error;
    session.updatedAt = now();
    runningTurns.delete(session.id);

    emit({
      type: "turn.failed",
      sessionId: session.id,
      turnId,
      error,
      session: cloneSession(session),
    });
  }

  function startTurn(request: ChatTurnStartRequest): ChatTurnStartResult {
    const prompt = request.prompt.trim();

    if (!prompt) {
      throw new Error("Prompt is required.");
    }

    const session = resolveSession(request);
    const turnId = randomUUID();
    const userMessage = createUserMessage(prompt);
    const assistantMessage = createAssistantMessage(session.providerId);

    session.providerId = request.providerId;
    session.model = request.model?.trim() ? request.model.trim() : session.model;
    session.runtimeMode = request.runtimeMode;
    session.status = "running";
    session.activeTurnId = turnId;
    session.lastError = null;
    session.messages.push(userMessage, assistantMessage);
    session.updatedAt = now();

    emit({
      type: "turn.started",
      sessionId: session.id,
      turnId,
      session: cloneSession(session),
    });

    const handle = startLocalChatTurn(
      {
        providerId: session.providerId,
        prompt,
        model: session.model,
        runtimeMode: session.runtimeMode,
        workspaceRoot: session.workspaceRoot,
        activeFilePath: session.activeFilePath,
      },
      {
        onStdout: (chunk) => appendDelta(session, assistantMessage.id, chunk),
        onStderr: (chunk) => {
          emit({
            type: "turn.stderr",
            sessionId: session.id,
            turnId,
            text: chunk,
            session: cloneSession(session),
          });
        },
        onComplete: () => markCompleted(session, turnId, assistantMessage.id),
        onError: (error) => markFailed(session, turnId, assistantMessage.id, error.message),
      },
    );

    runningTurns.set(session.id, {
      sessionId: session.id,
      turnId,
      assistantMessageId: assistantMessage.id,
      handle,
    });

    return {
      session: cloneSession(session),
      turnId,
    };
  }

  function stopTurn(request: ChatStopTurnRequest) {
    const runningTurn = runningTurns.get(request.sessionId);

    if (!runningTurn) {
      return;
    }

    runningTurn.handle.stop();
  }

  return {
    listSessions,
    startTurn,
    stopTurn,
  };
}
