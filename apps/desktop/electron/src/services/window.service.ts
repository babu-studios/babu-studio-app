import { BrowserWindow } from "electron";
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

  if (process.env.ELECTRON_RENDERER_URL) {
    const rendererUrl = new URL(process.env.ELECTRON_RENDERER_URL);
    rendererUrl.searchParams.set("duiStudioElectron", "1");
    void window.loadURL(rendererUrl.toString());
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return window;
}
