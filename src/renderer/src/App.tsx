import { useEffect, useMemo, useState } from "react";

import { ChatWorkspace } from "@/components/chat-workspace/chat-workspace";
import { ProjectGraph } from "@/components/project-graph/project-graph";
import {
  sampleProjectGraphEdges,
  sampleProjectGraphNodes,
} from "@/lib/graph/sample-project-graph";
import type { ChatRuntimeEvent, ChatSession } from "@/lib/chat/types";
import type { WorkspaceEntry } from "@/lib/workspace/types";
import styles from "./App.module.css";

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

type WorkspaceTreeNode = WorkspaceEntry & {
  name: string;
  children: WorkspaceTreeNode[];
};

function entryName(path: string) {
  return path.split("/").at(-1) ?? path;
}

function buildWorkspaceTree(entries: WorkspaceEntry[]) {
  const nodeByPath = new Map<string, WorkspaceTreeNode>();
  const roots: WorkspaceTreeNode[] = [];

  for (const entry of entries) {
    nodeByPath.set(entry.path, {
      ...entry,
      name: entryName(entry.path),
      children: [],
    });
  }

  for (const node of nodeByPath.values()) {
    if (node.parentPath) {
      nodeByPath.get(node.parentPath)?.children.push(node);
      continue;
    }

    roots.push(node);
  }

  function sortNodes(nodes: WorkspaceTreeNode[]) {
    nodes.sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "directory" ? -1 : 1;
      }

      return left.name.localeCompare(right.name);
    });

    for (const node of nodes) {
      sortNodes(node.children);
    }
  }

  sortNodes(roots);
  return roots;
}

function initialExpandedPaths(entries: WorkspaceEntry[]) {
  return new Set(
    entries
      .filter((entry) => entry.kind === "directory" && !entry.parentPath)
      .map((entry) => entry.path),
  );
}

export function App() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);
  const [workspaceEntries, setWorkspaceEntries] = useState<WorkspaceEntry[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [isGraphCollapsed, setIsGraphCollapsed] = useState(false);
  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? null,
    [selectedSessionId, sessions],
  );
  const workspaceTree = useMemo(() => buildWorkspaceTree(workspaceEntries), [workspaceEntries]);
  const repoSessions = useMemo(
    () => sessions.filter((session) => !session.activeFilePath),
    [sessions],
  );
  const sessionsByFilePath = useMemo(() => {
    const next = new Map<string, ChatSession[]>();

    for (const session of sessions) {
      if (!session.activeFilePath) {
        continue;
      }

      const current = next.get(session.activeFilePath) ?? [];
      current.push(session);
      next.set(session.activeFilePath, current);
    }

    return next;
  }, [sessions]);

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

  useEffect(() => {
    let isMounted = true;

    window.prometheus.workspace
      .listFiles()
      .then((workspace) => {
        if (!isMounted) {
          return;
        }

        setWorkspaceRoot(workspace.workspaceRoot);
        setWorkspaceEntries(workspace.entries);
        setExpandedPaths(initialExpandedPaths(workspace.entries));
        setWorkspaceError(null);
      })
      .catch((error) => {
        if (!isMounted) {
          return;
        }

        setWorkspaceError(
          error instanceof Error ? error.message : "Failed to load workspace files.",
        );
      });

    return () => {
      isMounted = false;
    };
  }, []);

  function selectSession(session: ChatSession) {
    setSelectedSessionId(session.id);
    setActiveFilePath(session.activeFilePath);
  }

  function toggleDirectory(path: string) {
    setExpandedPaths((current) => {
      const next = new Set(current);

      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }

      return next;
    });
  }

  function renderWorkspaceNode(node: WorkspaceTreeNode, depth = 0) {
    const isExpanded = expandedPaths.has(node.path);
    const fileSessions = node.kind === "file" ? sessionsByFilePath.get(node.path) ?? [] : [];
    const selected = node.kind === "file" && node.path === activeFilePath;

    return (
      <div className={styles.fileNode} key={node.path}>
        <button
          className={`${styles.fileRow} ${selected ? styles.selectedFileRow : ""}`}
          style={{ paddingLeft: `${6 + depth * 13}px` }}
          type="button"
          onClick={() => {
            if (node.kind === "directory") {
              toggleDirectory(node.path);
              return;
            }

            setActiveFilePath(node.path);
            setSelectedSessionId(fileSessions[0]?.id ?? null);
          }}
        >
          <span className={styles.fileIcon}>
            {node.kind === "directory" ? (isExpanded ? "v" : ">") : "-"}
          </span>
          <span className={styles.fileName}>{node.name}</span>
          {fileSessions.length > 0 ? (
            <span className={styles.fileChatCount}>{fileSessions.length}</span>
          ) : null}
        </button>

        {fileSessions.length > 0 ? (
          <div className={styles.fileChats}>
            {fileSessions.map((session) => (
              <button
                className={`${styles.nestedChatItem} ${
                  session.id === selectedSessionId ? styles.selectedNestedChatItem : ""
                }`}
                key={session.id}
                style={{ paddingLeft: `${25 + depth * 13}px` }}
                type="button"
                onClick={() => selectSession(session)}
              >
                <span>{session.title}</span>
                <span>{session.status}</span>
              </button>
            ))}
          </div>
        ) : null}

        {node.kind === "directory" && isExpanded ? (
          <div>{node.children.map((child) => renderWorkspaceNode(child, depth + 1))}</div>
        ) : null}
      </div>
    );
  }

  return (
    <main className={`${styles.workspace} ${isGraphCollapsed ? styles.workspaceGraphCollapsed : ""}`}>
      <aside className={styles.sidebar} aria-label="Project navigation">
        <div className={styles.brand}>
          <span className={styles.appName}>prometheus</span>
        </div>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2>Files</h2>
            <button
              className={styles.commandButton}
              type="button"
              onClick={() => {
                setActiveFilePath(null);
                setSelectedSessionId(null);
              }}
            >
              repo
            </button>
          </div>
          {workspaceError ? <p className={styles.emptyList}>{workspaceError}</p> : null}
          <div className={styles.fileTree}>
            {workspaceTree.length === 0 && !workspaceError ? (
              <p className={styles.emptyList}>Loading files...</p>
            ) : (
              workspaceTree.map((node) => renderWorkspaceNode(node))
            )}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2>Repo Threads</h2>
            <button
              className={styles.commandButton}
              type="button"
              onClick={() => {
                setActiveFilePath(null);
                setSelectedSessionId(null);
              }}
            >
              + new
            </button>
          </div>
          <div className={styles.chatList}>
            {repoSessions.length === 0 ? (
              <p className={styles.emptyList}>No threads yet.</p>
            ) : (
              repoSessions.map((session) => (
                <button
                  className={`${styles.chatItem} ${
                    session.id === selectedSessionId ? styles.selectedChatItem : ""
                  }`}
                  key={session.id}
                  type="button"
                  onClick={() => selectSession(session)}
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
          activeFilePath={activeFilePath}
          workspaceRoot={workspaceRoot}
          onSessionSelected={(sessionId) => setSelectedSessionId(sessionId)}
        />
      </div>

      <aside
        className={`${styles.graphPanel} ${isGraphCollapsed ? styles.graphPanelCollapsed : ""}`}
        aria-label="Project graph"
      >
        <div className={styles.graphHeader}>
          <h2>Graph</h2>
          <button
            className={styles.graphToggle}
            type="button"
            aria-label={isGraphCollapsed ? "Expand graph" : "Collapse graph"}
            onClick={() => setIsGraphCollapsed((current) => !current)}
          >
            {isGraphCollapsed ? "<" : ">"}
          </button>
        </div>
        {isGraphCollapsed ? null : (
          <ProjectGraph nodes={sampleProjectGraphNodes} edges={sampleProjectGraphEdges} />
        )}
      </aside>
    </main>
  );
}
