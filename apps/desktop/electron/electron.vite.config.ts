import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: {
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
