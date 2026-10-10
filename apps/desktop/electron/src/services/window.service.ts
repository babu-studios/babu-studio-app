import { BrowserWindow, shell } from "electron";
import { join } from "node:path";
import { electronWindowDefaults } from "../config/electron.config";

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    ...electronWindowDefaults,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://www.instagram.com/")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("https://www.instagram.com/")) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    const rendererUrl = new URL(process.env.ELECTRON_RENDERER_URL);
    rendererUrl.searchParams.set("duiStudioElectron", "1");
    void window.loadURL(rendererUrl.toString());
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return window;
}
