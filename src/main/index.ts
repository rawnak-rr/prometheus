import { app, BrowserWindow, ipcMain, shell } from "electron";
import { join } from "node:path";

import type {
  ChatRuntimeEvent,
  ChatApprovalResponseRequest,
  ChatProviderId,
  ChatStopTurnRequest,
  ChatTurnStartRequest,
  ChatTurnStartResult,
} from "@/lib/chat/types";
import { detectLocalProviders } from "@/lib/providers/local-provider-detection";
import type { LocalProvidersResponse } from "@/lib/providers/types";
import { disposeClaudeAgentSessions } from "@/lib/chat/claude-agent-runner";
import { disposeCodexAppServerSessions } from "@/lib/chat/codex-app-server-runner";
import { createChatSessionManager } from "./chat/session-manager";
import { listWorkspaceFiles } from "./workspace/workspace-files";

const supportedChatProviders = new Set<ChatProviderId>(["claude", "codex"]);

function isChatProviderId(value: unknown): value is ChatProviderId {
  return typeof value === "string" && supportedChatProviders.has(value as ChatProviderId);
}

function isRuntimeMode(value: unknown): value is ChatTurnStartRequest["runtimeMode"] {
  return value === "chat" || value === "read-only" || value === "workspace-write";
}

function broadcastChatEvent(event: ChatRuntimeEvent) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("chat:event", event);
  }
}

const chatSessionManager = createChatSessionManager(broadcastChatEvent);

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    title: "Prometheus",
    backgroundColor: "#101114",
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

ipcMain.handle("providers:list", async (): Promise<LocalProvidersResponse> => {
  const providers = await detectLocalProviders();

  return {
    runtime: "desktop",
    providers,
  };
});

ipcMain.handle("workspace:list-files", async () => listWorkspaceFiles());

ipcMain.handle(
  "chat:list-sessions",
  async () => chatSessionManager.listSessions(),
);

ipcMain.handle(
  "chat:start-turn",
  async (_event, request: Partial<ChatTurnStartRequest>): Promise<ChatTurnStartResult> => {
    if (!isChatProviderId(request.providerId)) {
      throw new Error("Unsupported provider.");
    }

    if (typeof request.prompt !== "string") {
      throw new Error("Prompt is required.");
    }

    if (!isRuntimeMode(request.runtimeMode)) {
      throw new Error("Unsupported runtime mode.");
    }

    return chatSessionManager.startTurn({
      sessionId: typeof request.sessionId === "string" ? request.sessionId : null,
      providerId: request.providerId,
      prompt: request.prompt,
      model: typeof request.model === "string" ? request.model : null,
      runtimeMode: request.runtimeMode,
      activeFilePath: typeof request.activeFilePath === "string" ? request.activeFilePath : null,
      workspaceRoot: typeof request.workspaceRoot === "string" ? request.workspaceRoot : null,
    });
  },
);

ipcMain.handle("chat:stop-turn", async (_event, request: Partial<ChatStopTurnRequest>) => {
  if (typeof request.sessionId !== "string") {
    throw new Error("Session id is required.");
  }

  chatSessionManager.stopTurn({ sessionId: request.sessionId });
});

ipcMain.handle(
  "chat:respond-to-approval",
  async (_event, request: Partial<ChatApprovalResponseRequest>) => {
    if (typeof request.sessionId !== "string") {
      throw new Error("Session id is required.");
    }

    if (typeof request.approvalId !== "string") {
      throw new Error("Approval id is required.");
    }

    if (
      request.decision !== "accept" &&
      request.decision !== "acceptForSession" &&
      request.decision !== "decline" &&
      request.decision !== "cancel"
    ) {
      throw new Error("Unsupported approval decision.");
    }

    chatSessionManager.respondToApproval({
      sessionId: request.sessionId,
      approvalId: request.approvalId,
      decision: request.decision,
    });
  },
);

void app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  disposeClaudeAgentSessions();
  disposeCodexAppServerSessions();
});
