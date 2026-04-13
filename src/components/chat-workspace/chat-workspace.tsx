import { FormEvent, useMemo, useState } from "react";

import type {
  ChatProviderId,
  ChatRuntimeMode,
  ChatSession,
} from "@/lib/chat/types";
import styles from "./chat-workspace.module.css";

const providerLabels: Record<ChatProviderId, string> = {
  claude: "Claude",
  codex: "Codex",
};

const runtimeLabels: Record<ChatRuntimeMode, string> = {
  chat: "Chat",
  "read-only": "Read-only agent",
  "workspace-write": "Workspace agent",
};

type ChatWorkspaceProps = {
  session: ChatSession | null;
  onSessionSelected: (sessionId: string) => void;
};

export function ChatWorkspace({ session, onSessionSelected }: ChatWorkspaceProps) {
  const [providerId, setProviderId] = useState<ChatProviderId>("claude");
  const [runtimeMode, setRuntimeMode] = useState<ChatRuntimeMode>("chat");
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isRunning = session?.status === "running" || isStarting;
  const selectedProviderId = session?.providerId ?? providerId;
  const selectedRuntimeMode = session?.runtimeMode ?? runtimeMode;
  const selectedModel = session?.model ?? (model.trim() || null);
  const providerLocked = Boolean(session && session.messages.length > 0);
  const messages = session?.messages ?? [];
  const title = session?.title ?? "New thread";
  const subtitle = useMemo(() => {
    if (!session) {
      return "Pick a provider, choose a runtime, and start a desktop-backed thread.";
    }

    const modelLabel = session.model ? ` · ${session.model}` : "";
    return `${providerLabels[session.providerId]} · ${runtimeLabels[session.runtimeMode]}${modelLabel}`;
  }, [session]);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedPrompt = prompt.trim();

    if (!trimmedPrompt || isRunning) {
      return;
    }

    setIsStarting(true);
    setError(null);

    try {
      const result = await window.prometheus.chat.startTurn({
        sessionId: session?.id ?? null,
        providerId: selectedProviderId,
        prompt: trimmedPrompt,
        model: selectedModel,
        runtimeMode: selectedRuntimeMode,
      });

      setPrompt("");
      onSessionSelected(result.session.id);
    } catch (sendError) {
      setError(
        sendError instanceof Error
          ? sendError.message
          : "Local provider request failed.",
      );
    } finally {
      setIsStarting(false);
    }
  }

  async function stopTurn() {
    if (!session) {
      return;
    }

    await window.prometheus.chat.stopTurn({ sessionId: session.id });
  }

  return (
    <section className={styles.workspace} aria-label="Chat workspace">
      <header className={styles.header}>
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>

        <div className={styles.controls}>
          <div className={styles.control}>
            <label htmlFor="provider">Provider</label>
            <select
              id="provider"
              value={selectedProviderId}
              onChange={(event) => setProviderId(event.target.value as ChatProviderId)}
              disabled={providerLocked || isRunning}
            >
              <option value="claude">Claude</option>
              <option value="codex">Codex</option>
            </select>
          </div>

          <div className={styles.control}>
            <label htmlFor="runtime">Runtime</label>
            <select
              id="runtime"
              value={selectedRuntimeMode}
              onChange={(event) => setRuntimeMode(event.target.value as ChatRuntimeMode)}
              disabled={isRunning}
            >
              <option value="chat">Chat</option>
              <option value="read-only">Read-only agent</option>
              <option value="workspace-write">Workspace agent</option>
            </select>
          </div>

          <div className={styles.control}>
            <label htmlFor="model">Model</label>
            <input
              id="model"
              value={session?.model ?? model}
              onChange={(event) => setModel(event.target.value)}
              placeholder={selectedProviderId === "claude" ? "sonnet" : "default"}
              disabled={isRunning || Boolean(session?.model)}
            />
          </div>
        </div>
      </header>

      <div className={styles.thread}>
        {messages.length === 0 ? (
          <div className={styles.emptyState}>
            <strong>Start a provider-backed thread</strong>
            <p>
              Prometheus will launch the selected local CLI from the Electron main process,
              stream output here, and keep the thread in the sidebar.
            </p>
          </div>
        ) : (
          messages.map((message) => (
            <article
              className={`${styles.message} ${
                message.role === "assistant" ? styles.assistant : ""
              } ${message.status === "failed" ? styles.failed : ""}`}
              key={message.id}
            >
              <div className={styles.messageHeader}>
                <strong>{message.role === "user" ? "You" : "Prometheus"}</strong>
                {message.providerId ? (
                  <span className={styles.providerBadge}>
                    {providerLabels[message.providerId]}
                  </span>
                ) : null}
              </div>
              <p>{message.content || "Waiting for provider output..."}</p>
            </article>
          ))
        )}

        {isStarting ? (
          <article className={`${styles.message} ${styles.assistant}`}>
            <div className={styles.messageHeader}>
              <strong>Prometheus</strong>
              <span className={styles.providerBadge}>{providerLabels[selectedProviderId]}</span>
            </div>
            <p>Starting {providerLabels[selectedProviderId]}...</p>
          </article>
        ) : null}
      </div>

      <footer className={styles.composer}>
        <form className={styles.composerBox} onSubmit={sendMessage}>
          <textarea
            aria-label="Message"
            placeholder={`Ask ${providerLabels[selectedProviderId]} from Prometheus`}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            disabled={isRunning}
          />
          {session?.status === "running" ? (
            <button className={styles.stopButton} type="button" onClick={() => void stopTurn()}>
              Stop
            </button>
          ) : (
            <button type="submit" disabled={isRunning || !prompt.trim()}>
              {isStarting ? "Starting" : "Send"}
            </button>
          )}
        </form>
        {error || session?.lastError ? (
          <p className={styles.error}>{error ?? session?.lastError}</p>
        ) : null}
      </footer>
    </section>
  );
}
