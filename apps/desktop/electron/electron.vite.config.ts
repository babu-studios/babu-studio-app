import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { loadEnv } from "vite";

const environment = loadEnv(process.env.NODE_ENV ?? "development", __dirname, "BABU_STUDIO_");

export default defineConfig({
  main: {
    define: {
      __YOUTUBE_OAUTH_CLIENT_SECRET__: JSON.stringify(
        environment.BABU_STUDIO_YOUTUBE_CLIENT_SECRET ?? "",
      ),
    },
    resolve: {
      alias: {
        "@shared": resolve(__dirname, "../../../shared"),
      },
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/main.ts"),
        },
      },
    },
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/preload.ts"),
        },
      },
    },
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    root: resolve(__dirname, "../renderer/react"),
    base: "./",
    plugins: [react()],
    resolve: {
      alias: {
        "@shared": resolve(__dirname, "../../../shared"),
      },
    },
    build: {
      rollupOptions: {
        input: resolve(__dirname, "../renderer/react/index.html"),
      },
      outDir: resolve(__dirname, "out/renderer"),
      emptyOutDir: true,
    },
  },
});
