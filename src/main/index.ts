import { app, BrowserWindow, ipcMain, shell } from "electron";
import { join } from "node:path";

import type {
  ChatRuntimeEvent,
  ChatProviderId,
  ChatStopTurnRequest,
  ChatTurnStartRequest,
  ChatTurnStartResult,
} from "@/lib/chat/types";
import { detectLocalProviders } from "@/lib/providers/local-provider-detection";
import type { LocalProvidersResponse } from "@/lib/providers/types";
import { createChatSessionManager } from "./chat/session-manager";

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
    });
  },
);

ipcMain.handle("chat:stop-turn", async (_event, request: Partial<ChatStopTurnRequest>) => {
  if (typeof request.sessionId !== "string") {
    throw new Error("Session id is required.");
  }

  chatSessionManager.stopTurn({ sessionId: request.sessionId });
});

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
