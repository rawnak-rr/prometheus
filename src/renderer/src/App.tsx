import { useEffect, useMemo, useState } from "react";

import { ChatWorkspace } from "@/components/chat-workspace/chat-workspace";
import { ProviderList } from "@/components/provider-list/provider-list";
import { ProjectGraph } from "@/components/project-graph/project-graph";
import {
  sampleProjectGraphEdges,
  sampleProjectGraphNodes,
} from "@/lib/graph/sample-project-graph";
import type { ChatRuntimeEvent, ChatSession } from "@/lib/chat/types";
import styles from "./App.module.css";

const projects = [
  { name: "Prometheus", meta: "Desktop workspace" },
  { name: "Study Graph", meta: "Planned workspace" },
];

function upsertSession(sessions: ChatSession[], session: ChatSession) {
  const existingIndex = sessions.findIndex((candidate) => candidate.id === session.id);

  if (existingIndex === -1) {
    return [session, ...sessions].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  const nextSessions = [...sessions];
  nextSessions[existingIndex] = session;
  return nextSessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function providerLabel(session: ChatSession) {
  return session.providerId === "claude" ? "Claude" : "Codex";
}

export function App() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? null,
    [selectedSessionId, sessions],
  );

  useEffect(() => {
    let isMounted = true;

    window.prometheus.chat.listSessions().then((loadedSessions) => {
      if (!isMounted) {
        return;
      }

      setSessions(loadedSessions);
      setSelectedSessionId((current) => current ?? loadedSessions[0]?.id ?? null);
    });

    function handleChatEvent(event: ChatRuntimeEvent) {
      if (event.type === "sessions.changed") {
        setSessions(event.sessions);
        return;
      }

      setSessions((currentSessions) => upsertSession(currentSessions, event.session));

      if (event.type === "turn.started") {
        setSelectedSessionId(event.sessionId);
      }
    }

    const unsubscribe = window.prometheus.chat.onEvent(handleChatEvent);

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  return (
    <main className={styles.workspace}>
      <aside className={styles.sidebar} aria-label="Project navigation">
        <div className={styles.brand}>
          <p className={styles.eyebrow}>Prometheus</p>
          <h1>Project memory</h1>
          <p>Chat with local coding agents while the repository map stays visible.</p>
        </div>

        <section className={styles.section}>
          <h2>Projects</h2>
          <div className={styles.list}>
            {projects.map((project) => (
              <div className={styles.listItem} key={project.name}>
                <strong>{project.name}</strong>
                <span>{project.meta}</span>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2>Chats</h2>
            <button type="button" onClick={() => setSelectedSessionId(null)}>
              New
            </button>
          </div>
          <div className={styles.chatList}>
            {sessions.length === 0 ? (
              <p className={styles.emptyList}>No threads yet.</p>
            ) : (
              sessions.map((session) => (
                <button
                  className={`${styles.chatItem} ${
                    session.id === selectedSessionId ? styles.selectedChatItem : ""
                  }`}
                  key={session.id}
                  type="button"
                  onClick={() => setSelectedSessionId(session.id)}
                >
                  <strong>{session.title}</strong>
                  <span>
                    {providerLabel(session)} · {session.runtimeMode} · {session.status}
                  </span>
                </button>
              ))
            )}
          </div>
        </section>

        <section className={styles.section}>
          <h2>Providers</h2>
          <ProviderList />
        </section>
      </aside>

      <div className={styles.main}>
        <ChatWorkspace
          session={selectedSession}
          onSessionSelected={(sessionId) => setSelectedSessionId(sessionId)}
        />
      </div>

      <aside className={styles.graphPanel} aria-label="Project graph">
        <div className={styles.graphHeader}>
          <h2>Graph</h2>
          <p>Project, chat, file, topic, summary, and provider nodes.</p>
        </div>
        <ProjectGraph nodes={sampleProjectGraphNodes} edges={sampleProjectGraphEdges} />
      </aside>
    </main>
  );
}
