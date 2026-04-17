import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { ChatWorkspace } from "@/components/chat-workspace/chat-workspace";
import { ProjectGraph } from "@/components/project-graph/project-graph";
import {
  sampleProjectGraphEdges,
  sampleProjectGraphNodes,
} from "@/lib/graph/sample-project-graph";
import type { ChatRuntimeEvent, ChatSession } from "@/lib/chat/types";
import type { GitStatusFile, GitStatusResponse } from "@/lib/git/types";
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

function workspaceLabel(workspaceRoot: string | null) {
  if (!workspaceRoot) {
    return "No folder";
  }

  return workspaceRoot.split(/[\\/]/).filter(Boolean).at(-1) ?? workspaceRoot;
}

function sessionTitle(session: ChatSession | null, activeFilePath: string | null) {
  if (session) {
    return session.title;
  }

  if (activeFilePath) {
    return activeFilePath;
  }

  return "";
}

function gitWorkspaceRoot(status: GitStatusResponse | null, workspaceRoot: string | null) {
  return status?.repositoryRoot ?? workspaceRoot;
}

function gitFileStateLabel(file: GitStatusFile) {
  if (file.index === "?" && file.workingTree === "?") {
    return "untracked";
  }

  if (file.index !== " " && file.workingTree !== " ") {
    return "staged + modified";
  }

  if (file.index !== " ") {
    return "staged";
  }

  return "modified";
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
  const [draftThreadId, setDraftThreadId] = useState<string | null>(null);
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);
  const [workspaceEntries, setWorkspaceEntries] = useState<WorkspaceEntry[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [gitStatus, setGitStatus] = useState<GitStatusResponse | null>(null);
  const [gitMessage, setGitMessage] = useState<string | null>(null);
  const [isGitBusy, setIsGitBusy] = useState(false);
  const [isCommitModalOpen, setIsCommitModalOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [selectedCommitPaths, setSelectedCommitPaths] = useState<Set<string>>(() => new Set());
  const [commitError, setCommitError] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
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
  const hasActiveDraft = Boolean(draftThreadId && !selectedSessionId && !activeFilePath);
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
        setDraftThreadId(null);
      }
    }

    const unsubscribe = window.prometheus.chat.onEvent(handleChatEvent);

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  const refreshGitStatus = useCallback(async (root: string | null) => {
    if (!root) {
      setGitStatus(null);
      return null;
    }

    const status = await window.prometheus.git.getStatus({ workspaceRoot: root });
    setGitStatus(status);
    return status;
  }, []);

  const loadWorkspace = useCallback(
    async (root?: string | null) => {
      try {
        const workspace = await window.prometheus.workspace.listFiles({ workspaceRoot: root });

        setWorkspaceRoot(workspace.workspaceRoot);
        setWorkspaceEntries(workspace.entries);
        setExpandedPaths(initialExpandedPaths(workspace.entries));
        setActiveFilePath(null);
        setDraftThreadId(null);
        setWorkspaceError(null);
        await refreshGitStatus(workspace.workspaceRoot);
      } catch (error) {
        setWorkspaceError(
          error instanceof Error ? error.message : "Failed to load workspace files.",
        );
      }
    },
    [refreshGitStatus],
  );

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  useEffect(() => {
    const unsubscribeShortcut = window.prometheus.shell.onShortcut((shortcut) => {
      if (shortcut === "toggle-sidebar") {
        setIsSidebarCollapsed((current) => !current);
        return;
      }

      setIsGraphCollapsed((current) => !current);
    });

    return () => {
      unsubscribeShortcut();
    };
  }, []);

  function selectSession(session: ChatSession) {
    setSelectedSessionId(session.id);
    setActiveFilePath(session.activeFilePath);
    setDraftThreadId(null);
  }

  function openDraftThread() {
    setDraftThreadId(`draft:${Date.now()}`);
    setActiveFilePath(null);
    setSelectedSessionId(null);
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

  async function openFolder() {
    try {
      const workspace = await window.prometheus.workspace.openFolder();

      if (!workspace) {
        return;
      }

      setWorkspaceRoot(workspace.workspaceRoot);
      setWorkspaceEntries(workspace.entries);
      setExpandedPaths(initialExpandedPaths(workspace.entries));
      setActiveFilePath(null);
      setSelectedSessionId(null);
      setDraftThreadId(null);
      setWorkspaceError(null);
      await refreshGitStatus(workspace.workspaceRoot);
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : "Failed to open folder.");
    }
  }

  async function openCommitModal() {
    const root = gitWorkspaceRoot(gitStatus, workspaceRoot);

    if (!root || isGitBusy) {
      return;
    }

    setCommitError(null);
    setGitMessage(null);

    const status = await refreshGitStatus(root);
    const files = status?.files ?? gitStatus?.files ?? [];

    setSelectedCommitPaths(new Set(files.map((file) => file.path)));
    setCommitMessage("");
    setIsCommitModalOpen(true);
  }

  function toggleCommitPath(path: string) {
    setSelectedCommitPaths((current) => {
      const next = new Set(current);

      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }

      return next;
    });
  }

  async function commitSelectedChanges(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const root = gitWorkspaceRoot(gitStatus, workspaceRoot);
    const files = Array.from(selectedCommitPaths);

    if (!root || isGitBusy) {
      return;
    }

    if (!commitMessage.trim()) {
      setCommitError("Write a commit message.");
      return;
    }

    if (files.length === 0) {
      setCommitError("Select at least one file.");
      return;
    }

    setIsGitBusy(true);
    setCommitError(null);
    setGitMessage(null);

    try {
      const result = await window.prometheus.git.commit({
        workspaceRoot: root,
        message: commitMessage,
        files,
      });

      setGitStatus(result.status);
      setGitMessage(result.output || "Committed changes.");
      setIsCommitModalOpen(false);
      setCommitMessage("");
      setSelectedCommitPaths(new Set());
    } catch (error) {
      setCommitError(error instanceof Error ? error.message : "Commit failed.");
      await refreshGitStatus(root);
    } finally {
      setIsGitBusy(false);
    }
  }

  async function pushChanges() {
    const root = gitWorkspaceRoot(gitStatus, workspaceRoot);

    if (!root || isGitBusy) {
      return;
    }

    setIsGitBusy(true);
    setGitMessage(null);

    try {
      const result = await window.prometheus.git.push({ workspaceRoot: root });

      setGitStatus(result.status);
      setGitMessage(result.output || "Pushed changes.");
    } catch (error) {
      setGitMessage(error instanceof Error ? error.message : "Push failed.");
      await refreshGitStatus(root);
    } finally {
      setIsGitBusy(false);
    }
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
    <main
      className={`${styles.workspace} ${isGraphCollapsed ? styles.workspaceGraphCollapsed : ""} ${
        isSidebarCollapsed ? styles.workspaceSidebarCollapsed : ""
      }`}
    >
      <header className={styles.appHeader}>
        <div className={styles.productMark}>
          <strong>Prometheus</strong>
        </div>

        <div className={styles.headerContext}>
          <strong>{sessionTitle(selectedSession, activeFilePath)}</strong>
        </div>

        <div className={styles.headerActions} aria-label="Workspace actions">
          <button className={styles.headerSplitButton} type="button" onClick={() => void openFolder()}>
            <span className={styles.headerButtonMain}>Open</span>
          </button>

          <button
            className={styles.headerButton}
            type="button"
            disabled={
              isGitBusy ||
              !gitWorkspaceRoot(gitStatus, workspaceRoot) ||
              (gitStatus?.isRepository === true && gitStatus.summary.changed === 0)
            }
            onClick={() => void openCommitModal()}
          >
            <span>Commit</span>
          </button>

          <button
            className={styles.headerButton}
            type="button"
            disabled={isGitBusy || !gitWorkspaceRoot(gitStatus, workspaceRoot)}
            onClick={() => void pushChanges()}
          >
            <span>Push</span>
          </button>
        </div>
      </header>

      <aside className={styles.sidebar} aria-label="Project navigation">
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2>Files</h2>
            <button
              className={styles.commandButton}
              type="button"
              onClick={() => void openFolder()}
            >
              open
            </button>
          </div>
          {gitMessage ? <p className={styles.inlineNotice}>{gitMessage}</p> : null}
          {workspaceError ? <p className={styles.emptyList}>{workspaceError}</p> : null}
          {workspaceRoot ? (
            <button
              className={`${styles.fileRow} ${activeFilePath === null ? styles.selectedFileRow : ""}`}
              type="button"
              onClick={() => {
                setActiveFilePath(null);
                setDraftThreadId(null);
                setSelectedSessionId(repoSessions[0]?.id ?? null);
              }}
            >
              <span className={styles.fileIcon}>@</span>
              <span className={styles.fileName}>{workspaceLabel(workspaceRoot)}</span>
              <span className={styles.fileChatCount}>{repoSessions.length || ""}</span>
            </button>
          ) : null}
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
              onClick={() => openDraftThread()}
            >
              + new
            </button>
          </div>
          <div className={styles.chatList}>
            {hasActiveDraft ? (
              <button
                className={`${styles.chatItem} ${styles.selectedChatItem}`}
                type="button"
                onClick={() => openDraftThread()}
              >
                <span className={styles.chatItemTop}>
                  <strong>New thread</strong>
                  <span>draft</span>
                </span>
                <span className={styles.chatMeta}>Ready for a prompt</span>
              </button>
            ) : null}
            {repoSessions.length === 0 && !hasActiveDraft ? (
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
          onSessionSelected={(sessionId) => {
            setSelectedSessionId(sessionId);
            setDraftThreadId(null);
          }}
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

      {isGraphCollapsed ? (
        <button
          className={styles.graphEdgeToggle}
          type="button"
          aria-label="Expand graph"
          onClick={() => setIsGraphCollapsed(false)}
        >
          &lt;
        </button>
      ) : null}

      {isCommitModalOpen ? (
        <div className={styles.modalBackdrop} role="presentation">
          <form className={styles.commitModal} onSubmit={(event) => void commitSelectedChanges(event)}>
            <div className={styles.modalHeader}>
              <div>
                <strong>Commit changes</strong>
                <span>{gitStatus?.branch ?? workspaceLabel(workspaceRoot)}</span>
              </div>
              <button
                type="button"
                aria-label="Close commit modal"
                onClick={() => setIsCommitModalOpen(false)}
              >
                x
              </button>
            </div>

            <label className={styles.commitMessageField}>
              <span>Message</span>
              <input
                value={commitMessage}
                onChange={(event) => setCommitMessage(event.target.value)}
                placeholder="Commit message"
                disabled={isGitBusy}
                autoFocus
              />
            </label>

            <div className={styles.commitFilesHeader}>
              <span>Files</span>
              <button
                type="button"
                onClick={() =>
                  setSelectedCommitPaths(new Set(gitStatus?.files.map((file) => file.path) ?? []))
                }
              >
                select all
              </button>
            </div>

            <div className={styles.commitFileList}>
              {gitStatus?.files.length ? (
                gitStatus.files.map((file) => (
                  <label className={styles.commitFileRow} key={`${file.index}:${file.workingTree}:${file.path}`}>
                    <input
                      type="checkbox"
                      checked={selectedCommitPaths.has(file.path)}
                      onChange={() => toggleCommitPath(file.path)}
                      disabled={isGitBusy}
                    />
                    <span>{file.path}</span>
                    <em>{gitFileStateLabel(file)}</em>
                  </label>
                ))
              ) : (
                <p className={styles.emptyList}>No changed files.</p>
              )}
            </div>

            {commitError ? <p className={styles.modalError}>{commitError}</p> : null}

            <div className={styles.modalActions}>
              <button type="button" onClick={() => setIsCommitModalOpen(false)} disabled={isGitBusy}>
                Cancel
              </button>
              <button
                type="submit"
                disabled={isGitBusy || !commitMessage.trim() || selectedCommitPaths.size === 0}
              >
                {isGitBusy ? "Committing" : "Commit"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}
