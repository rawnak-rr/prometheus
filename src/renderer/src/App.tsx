import { useEffect, useMemo, useState } from "react";

import { ChatWorkspace } from "@/components/chat-workspace/chat-workspace";
import { ProjectGraph } from "@/components/project-graph/project-graph";
import {
  sampleProjectGraphEdges,
  sampleProjectGraphNodes,
} from "@/lib/graph/sample-project-graph";
import type { ChatRuntimeEvent, ChatSession } from "@/lib/chat/types";
import styles from "./App.module.css";

const projects = [
  { name: "prometheus", meta: "desktop workspace", state: "open" },
  { name: "study-graph", meta: "planned workspace", state: "soon" },
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
          <span className={styles.appName}>prometheus</span>
          <span className={styles.appMode}>local</span>
        </div>

        <div className={styles.cwd}>
          <span>cwd</span>
          <strong>~/prometheus</strong>
        </div>

        <section className={styles.section}>
          <h2>Projects</h2>
          <div className={styles.list}>
            {projects.map((project, index) => (
              <div
                className={`${styles.listItem} ${index === 0 ? styles.activeListItem : ""}`}
                key={project.name}
              >
                <span className={styles.itemText}>
                  <strong>{project.name}</strong>
                  <span>{project.meta}</span>
                </span>
                <span className={styles.itemState}>{project.state}</span>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2>Chats</h2>
            <button
              className={styles.commandButton}
              type="button"
              onClick={() => setSelectedSessionId(null)}
            >
              + new
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
                  <span className={styles.chatItemTop}>
                    <strong>{session.title}</strong>
                    <span>{session.status}</span>
                  </span>
                  <span className={styles.chatMeta}>
                    {providerLabel(session)} / {session.runtimeMode}
                  </span>
                </button>
              ))
            )}
          </div>
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
          <p>project / chat / file / topic / provider</p>
        </div>
        <ProjectGraph nodes={sampleProjectGraphNodes} edges={sampleProjectGraphEdges} />
      </aside>
    </main>
  );
}
