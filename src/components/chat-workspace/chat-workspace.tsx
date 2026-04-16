import { FormEvent, useMemo, useState } from "react";

import type {
  ChatApprovalDecision,
  ChatApprovalRequest,
  ChatMessage,
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
  chat: "chat",
  "read-only": "read-only",
  "workspace-write": "workspace-write",
};

type MessageBlock =
  | {
      kind: "text";
      text: string;
    }
  | {
      kind: "code";
      code: string;
      language: string | null;
      isDiff: boolean;
    };

type DiffFileStat = {
  path: string;
  additions: number;
  deletions: number;
};

type ChatWorkspaceProps = {
  session: ChatSession | null;
  activeFilePath: string | null;
  workspaceRoot: string | null;
  onSessionSelected: (sessionId: string) => void;
};

const fencePattern = /```([^\n`]*)\n([\s\S]*?)```/g;

function isDiffLanguage(language: string | null) {
  if (!language) {
    return false;
  }

  return ["diff", "patch", "udiff"].includes(language.toLowerCase());
}

function looksLikeDiff(code: string) {
  const lines = code.split("\n");

  return lines.some((line) => line.startsWith("diff --git ")) || lines.some((line) => line.startsWith("@@ "));
}

function parseMessageBlocks(content: string): MessageBlock[] {
  if (!content) {
    return [{ kind: "text", text: "" }];
  }

  const blocks: MessageBlock[] = [];
  let cursor = 0;

  for (const match of content.matchAll(fencePattern)) {
    const [rawFence, rawLanguage = "", code = ""] = match;
    const index = match.index ?? 0;
    const text = content.slice(cursor, index);

    if (text.trim()) {
      blocks.push({ kind: "text", text });
    }

    const language = rawLanguage.trim() || null;
    blocks.push({
      kind: "code",
      code: code.replace(/\n$/, ""),
      language,
      isDiff: isDiffLanguage(language) || looksLikeDiff(code),
    });

    cursor = index + rawFence.length;
  }

  const rest = content.slice(cursor);

  if (rest.trim()) {
    blocks.push({ kind: "text", text: rest });
  }

  return blocks.length > 0 ? blocks : [{ kind: "text", text: content }];
}

function getDiffLineClass(line: string) {
  if (line.startsWith("diff --git ") || line.startsWith("index ")) {
    return styles.diffMeta;
  }

  if (line.startsWith("@@ ")) {
    return styles.diffHunk;
  }

  if (line.startsWith("+++") || line.startsWith("---")) {
    return styles.diffFile;
  }

  if (line.startsWith("+")) {
    return styles.diffAddition;
  }

  if (line.startsWith("-")) {
    return styles.diffDeletion;
  }

  return styles.diffContext;
}

function normalizeDiffPath(value: string) {
  return value.replace(/^["']?([ab]\/)/, "").replace(/["']$/, "");
}

function summarizeDiffBlock(code: string): DiffFileStat[] {
  const files = new Map<string, DiffFileStat>();
  let activePath: string | null = null;

  function ensureFile(path: string) {
    const normalizedPath = normalizeDiffPath(path);
    const existing = files.get(normalizedPath);

    if (existing) {
      activePath = normalizedPath;
      return existing;
    }

    const file: DiffFileStat = {
      path: normalizedPath,
      additions: 0,
      deletions: 0,
    };

    files.set(normalizedPath, file);
    activePath = normalizedPath;
    return file;
  }

  for (const line of code.split("\n")) {
    const gitDiffMatch = /^diff --git a\/(.+) b\/(.+)$/.exec(line);

    if (gitDiffMatch) {
      ensureFile(gitDiffMatch[2] ?? gitDiffMatch[1] ?? "unknown");
      continue;
    }

    if (line.startsWith("+++ ")) {
      const path = line.slice(4).trim();

      if (path !== "/dev/null") {
        ensureFile(path);
      }

      continue;
    }

    if (!activePath) {
      continue;
    }

    const activeFile = files.get(activePath);

    if (!activeFile) {
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      activeFile.additions += 1;
    }

    if (line.startsWith("-") && !line.startsWith("---")) {
      activeFile.deletions += 1;
    }
  }

  return Array.from(files.values()).filter((file) => file.additions > 0 || file.deletions > 0);
}

function collectDiffStats(blocks: MessageBlock[]) {
  const fileStats = new Map<string, DiffFileStat>();

  for (const block of blocks) {
    if (block.kind !== "code" || !block.isDiff) {
      continue;
    }

    for (const file of summarizeDiffBlock(block.code)) {
      const existing = fileStats.get(file.path);

      if (existing) {
        existing.additions += file.additions;
        existing.deletions += file.deletions;
        continue;
      }

      fileStats.set(file.path, { ...file });
    }
  }

  const files = Array.from(fileStats.values());

  return {
    files,
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
  };
}

function MessageContent({ blocks }: { blocks: MessageBlock[] }) {
  return (
    <div className={styles.messageBody}>
      {blocks.map((block, index) => {
        if (block.kind === "text") {
          return (
            <p className={styles.textBlock} key={`text:${index}`}>
              {block.text.trim()}
            </p>
          );
        }

        return <CodeBlock block={block} key={`code:${index}`} />;
      })}
    </div>
  );
}

function CodeBlock({ block }: { block: Extract<MessageBlock, { kind: "code" }> }) {
  const label = block.isDiff ? "diff" : block.language || "text";

  return (
    <figure className={`${styles.codeBlock} ${block.isDiff ? styles.diffBlock : ""}`}>
      <figcaption>{label}</figcaption>
      <pre>
        {block.isDiff ? (
          block.code.split("\n").map((line, index) => (
            <span className={getDiffLineClass(line)} key={`${index}:${line}`}>
              {line || " "}
            </span>
          ))
        ) : (
          <code>{block.code}</code>
        )}
      </pre>
    </figure>
  );
}

function DiffSummary({ blocks }: { blocks: MessageBlock[] }) {
  const stats = collectDiffStats(blocks);

  if (stats.files.length === 0) {
    return null;
  }

  return (
    <div className={styles.changedFiles}>
      <div className={styles.changedFilesHeader}>
        <span>changed files ({stats.files.length})</span>
        <DiffStat additions={stats.additions} deletions={stats.deletions} />
      </div>
      <div className={styles.changedFileList}>
        {stats.files.map((file) => (
          <div className={styles.changedFileRow} key={file.path}>
            <span>{file.path}</span>
            <DiffStat additions={file.additions} deletions={file.deletions} />
          </div>
        ))}
      </div>
    </div>
  );
}

function DiffStat({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className={styles.diffStat}>
      <span className={styles.diffStatAdd}>+{additions}</span>
      <span>/</span>
      <span className={styles.diffStatDelete}>-{deletions}</span>
    </span>
  );
}

function ChatMessageArticle({ message }: { message: ChatMessage }) {
  const content = message.content || "waiting for provider output...";
  const blocks = parseMessageBlocks(content);
  const isAssistant = message.role === "assistant";

  return (
    <article
      className={`${styles.message} ${isAssistant ? styles.assistant : styles.user} ${
        message.status === "failed" ? styles.failed : ""
      }`}
      key={message.id}
    >
      <div className={styles.messageHeader}>
        <strong>{isAssistant ? "assistant" : "prompt"}</strong>
        {message.providerId ? (
          <span className={styles.providerBadge}>
            {providerLabels[message.providerId].toLowerCase()}
          </span>
        ) : null}
      </div>
      <div className={styles.messageColumn}>
        <MessageContent blocks={blocks} />
        {isAssistant ? <DiffSummary blocks={blocks} /> : null}
      </div>
    </article>
  );
}

function ApprovalRequestPanel({
  approval,
  pendingCount,
  isResponding,
  onRespond,
}: {
  approval: ChatApprovalRequest;
  pendingCount: number;
  isResponding: boolean;
  onRespond: (approvalId: string, decision: ChatApprovalDecision) => void;
}) {
  const detail = approval.detail ?? approval.command ?? approval.path ?? approval.reason;

  return (
    <div className={styles.approvalPanel}>
      <div className={styles.approvalHeader}>
        <span>pending approval</span>
        <strong>{approval.title}</strong>
        {pendingCount > 1 ? <span>{pendingCount} pending</span> : null}
      </div>

      {detail ? <pre className={styles.approvalDetail}>{detail}</pre> : null}

      <div className={styles.approvalMeta}>
        {approval.cwd ? <span>cwd: {approval.cwd}</span> : null}
        {approval.reason ? <span>{approval.reason}</span> : null}
      </div>

      <div className={styles.approvalActions}>
        <button
          type="button"
          disabled={isResponding}
          onClick={() => onRespond(approval.id, "cancel")}
        >
          cancel turn
        </button>
        <button
          className={styles.declineApproval}
          type="button"
          disabled={isResponding}
          onClick={() => onRespond(approval.id, "decline")}
        >
          decline
        </button>
        <button
          type="button"
          disabled={isResponding}
          onClick={() => onRespond(approval.id, "acceptForSession")}
        >
          allow session
        </button>
        <button
          className={styles.acceptApproval}
          type="button"
          disabled={isResponding}
          onClick={() => onRespond(approval.id, "accept")}
        >
          approve once
        </button>
      </div>
    </div>
  );
}

export function ChatWorkspace({
  session,
  activeFilePath,
  workspaceRoot,
  onSessionSelected,
}: ChatWorkspaceProps) {
  const [providerId, setProviderId] = useState<ChatProviderId>("claude");
  const [runtimeMode, setRuntimeMode] = useState<ChatRuntimeMode>("chat");
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [respondingApprovalId, setRespondingApprovalId] = useState<string | null>(null);
  const isRunning = session?.status === "running" || isStarting;
  const selectedProviderId = session?.providerId ?? providerId;
  const selectedRuntimeMode = session?.runtimeMode ?? runtimeMode;
  const selectedModel = session?.model ?? (model.trim() || null);
  const providerLocked = Boolean(session && session.messages.length > 0);
  const messages = session?.messages ?? [];
  const pendingApprovals = session?.pendingApprovals ?? [];
  const activeApproval = pendingApprovals[0] ?? null;
  const title = session?.title ?? "new thread";
  const subtitle = useMemo(() => {
    const provider = session?.providerId ?? providerId;
    const runtime = session?.runtimeMode ?? runtimeMode;
    const modelLabel = session?.model ?? model.trim();
    return [
      providerLabels[provider].toLowerCase(),
      runtimeLabels[runtime],
      session?.activeFilePath ?? activeFilePath ?? "repo",
      modelLabel || "default model",
    ].join(" / ");
  }, [activeFilePath, model, providerId, runtimeMode, session]);

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
        activeFilePath: session?.activeFilePath ?? activeFilePath,
        workspaceRoot: session?.workspaceRoot ?? workspaceRoot,
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

  async function respondToApproval(approvalId: string, decision: ChatApprovalDecision) {
    if (!session || respondingApprovalId) {
      return;
    }

    setRespondingApprovalId(approvalId);
    setError(null);

    try {
      await window.prometheus.chat.respondToApproval({
        sessionId: session.id,
        approvalId,
        decision,
      });
    } catch (approvalError) {
      setError(
        approvalError instanceof Error
          ? approvalError.message
          : "Approval response failed.",
      );
    } finally {
      setRespondingApprovalId(null);
    }
  }

  return (
    <section className={styles.workspace} aria-label="Chat workspace">
      <div className={styles.thread}>
        {messages.length === 0 ? (
          <div className={styles.emptyState}>
            <strong>{title}</strong>
            <p>{subtitle}</p>
          </div>
        ) : (
          messages.map((message) => <ChatMessageArticle key={message.id} message={message} />)
        )}

        {isStarting ? (
          <article className={`${styles.message} ${styles.assistant}`}>
            <div className={styles.messageHeader}>
              <strong>assistant</strong>
              <span className={styles.providerBadge}>
                {providerLabels[selectedProviderId].toLowerCase()}
              </span>
            </div>
            <div className={styles.messageColumn}>
              <div className={styles.messageBody}>
                <p className={styles.textBlock}>
                  starting {providerLabels[selectedProviderId].toLowerCase()}...
                </p>
              </div>
            </div>
          </article>
        ) : null}
      </div>

      <footer className={styles.composer}>
        {activeApproval ? (
          <ApprovalRequestPanel
            approval={activeApproval}
            pendingCount={pendingApprovals.length}
            isResponding={respondingApprovalId === activeApproval.id}
            onRespond={(approvalId, decision) => void respondToApproval(approvalId, decision)}
          />
        ) : null}
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
        <form className={styles.composerBox} onSubmit={sendMessage}>
          <textarea
            aria-label="Message"
            placeholder={`ask ${providerLabels[selectedProviderId].toLowerCase()} from prometheus`}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            disabled={isRunning}
          />
          {session?.status === "running" ? (
            <button className={styles.stopButton} type="button" onClick={() => void stopTurn()}>
              stop
            </button>
          ) : (
            <button type="submit" disabled={isRunning || !prompt.trim()}>
              {isStarting ? "starting" : "send"}
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
