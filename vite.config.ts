import { defineConfig, type PluginOption } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import react from "@vitejs/plugin-react";

export default defineConfig(() => {
  const isTest = Boolean(process.env.VITEST);
  const reactPlugin = react();
  const pluginList: PluginOption[] = Array.isArray(reactPlugin) ? reactPlugin : [reactPlugin];
  const minify: "esbuild" | "terser" | false = process.env.TAURI_DEBUG ? false : "esbuild";

  return {
    plugins: pluginList,
    clearScreen: false,
    resolve: {
      alias: {
        "@components": path.resolve(__dirname, "src/components"),
        "@styles": path.resolve(__dirname, "src/styles"),
        "@lib": path.resolve(__dirname, "src/lib"),
        "@shared-types": path.resolve(__dirname, "src/types")
      }
    },
    server: {
      port: 1420,
      strictPort: true,
      host: "0.0.0.0"
    },
    build: {
      outDir: "dist",
      target: process.env.TAURI_PLATFORM === "windows" ? "chrome105" : "safari15",
      minify,
      sourcemap: !!process.env.TAURI_DEBUG
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./vitest.setup.ts"],
      reporters: isTest ? undefined : ["default"],
      coverage: {
        reporter: ["text", "html"],
        provider: "v8"
      }
    }
  };
});
