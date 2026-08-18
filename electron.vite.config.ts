import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";

function forbidPreloadChunks(): Plugin {
  return {
    name: "forbid-preload-chunks",
    generateBundle(_options, bundle) {
      const extra = Object.keys(bundle).filter(
        (file) => file !== "preload-ui.cjs" && file !== "preload-aws.cjs",
      );
      if (extra.length > 0) {
        throw new Error(
          `Sandboxed preload cannot load extra chunks: ${extra.join(", ")}`,
        );
      }
    },
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, "src/main/main.ts"),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin(), forbidPreloadChunks()],
    build: {
      rollupOptions: {
        input: {
          "preload-aws": resolve(__dirname, "src/preload/preload-aws.ts"),
          "preload-ui": resolve(__dirname, "src/preload/preload-ui.ts"),
        },
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs",
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    plugins: [react()],
  },
});
