import { app, BrowserWindow, ipcMain, shell } from "electron";
import { join } from "node:path";

import { LocalChatError, runLocalChat } from "@/lib/chat/local-chat-runner";
import type {
  ChatProviderId,
  LocalChatRequest,
  LocalChatResponse,
} from "@/lib/chat/types";
import { detectLocalProviders } from "@/lib/providers/local-provider-detection";
import type { LocalProvidersResponse } from "@/lib/providers/types";

const supportedChatProviders = new Set<ChatProviderId>(["claude", "codex"]);

function isChatProviderId(value: unknown): value is ChatProviderId {
  return typeof value === "string" && supportedChatProviders.has(value as ChatProviderId);
}

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
  "chat:send",
  async (_event, request: Partial<LocalChatRequest>): Promise<LocalChatResponse> => {
    if (!isChatProviderId(request.providerId)) {
      throw new Error("Unsupported provider.");
    }

    if (typeof request.prompt !== "string") {
      throw new Error("Prompt is required.");
    }

    const startedAt = Date.now();

    try {
      const content = await runLocalChat({
        providerId: request.providerId,
        prompt: request.prompt,
      });

      return {
        providerId: request.providerId,
        content,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      if (error instanceof LocalChatError) {
        throw new Error(error.message);
      }

      throw new Error("Local provider request failed.");
    }
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
