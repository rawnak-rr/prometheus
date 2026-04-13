import { FormEvent, useState } from "react";

import type { ChatMessage, ChatProviderId } from "@/lib/chat/types";
import styles from "./chat-workspace.module.css";

const initialMessages: ChatMessage[] = [
  {
    id: "seed-user",
    role: "user",
    content: "Build the first project shell with chat, providers, and graph context.",
  },
  {
    id: "seed-assistant",
    role: "assistant",
    providerId: "claude",
    content:
      "The local chat bridge is ready for Claude and Codex. Pick a provider and send a prompt.",
  },
];

const providerLabels: Record<ChatProviderId, string> = {
  claude: "Claude",
  codex: "Codex",
};

function createMessageId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

export function ChatWorkspace() {
  const [providerId, setProviderId] = useState<ChatProviderId>("claude");
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [prompt, setPrompt] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedPrompt = prompt.trim();

    if (!trimmedPrompt || isSending) {
      return;
    }

    const userMessage: ChatMessage = {
      id: createMessageId(),
      role: "user",
      content: trimmedPrompt,
    };

    setMessages((currentMessages) => [...currentMessages, userMessage]);
    setPrompt("");
    setIsSending(true);
    setError(null);

    try {
      const data = await window.prometheus.chat.send({
        providerId,
        prompt: trimmedPrompt,
      });

      const assistantMessage: ChatMessage = {
        id: createMessageId(),
        role: "assistant",
        providerId: data.providerId,
        content: data.content,
      };

      setMessages((currentMessages) => [...currentMessages, assistantMessage]);
    } catch (sendError) {
      setError(
        sendError instanceof Error
          ? sendError.message
          : "Local provider request failed.",
      );
    } finally {
      setIsSending(false);
    }
  }

  return (
    <section className={styles.workspace} aria-label="Chat workspace">
      <header className={styles.header}>
        <div>
          <h2>Local chatbot</h2>
          <p>Send prompts through the desktop app to Claude or Codex.</p>
        </div>

        <div className={styles.providerControl}>
          <label htmlFor="provider">Provider</label>
          <select
            id="provider"
            value={providerId}
            onChange={(event) => setProviderId(event.target.value as ChatProviderId)}
            disabled={isSending}
          >
            <option value="claude">Claude</option>
            <option value="codex">Codex</option>
          </select>
        </div>
      </header>

      <div className={styles.thread}>
        {messages.map((message) => (
          <article
            className={`${styles.message} ${
              message.role === "assistant" ? styles.assistant : ""
            }`}
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
            <p>{message.content}</p>
          </article>
        ))}

        {isSending ? (
          <article className={`${styles.message} ${styles.assistant}`}>
            <div className={styles.messageHeader}>
              <strong>Prometheus</strong>
              <span className={styles.providerBadge}>{providerLabels[providerId]}</span>
            </div>
            <p>Waiting for {providerLabels[providerId]}...</p>
          </article>
        ) : null}
      </div>

      <footer className={styles.composer}>
        <form className={styles.composerBox} onSubmit={sendMessage}>
          <textarea
            aria-label="Message"
            placeholder={`Ask ${providerLabels[providerId]} from Prometheus`}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            disabled={isSending}
          />
          <button type="submit" disabled={isSending || !prompt.trim()}>
            {isSending ? "Sending" : "Send"}
          </button>
        </form>
        {error ? <p className={styles.error}>{error}</p> : null}
      </footer>
    </section>
  );
}
