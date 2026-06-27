import type { AppPlatform } from "./types";
import { createBrowserPlatform } from "./browserPlatform";
import { createTauriPlatform } from "./tauriPlatform";

type RuntimeWindow = Window & { __TAURI_IPC__?: unknown };

let browserPlatform: AppPlatform | null = null;
let tauriPlatform: AppPlatform | null = null;

export function isTauriRuntime(target: { __TAURI_IPC__?: unknown } = window as RuntimeWindow): boolean {
  return typeof target.__TAURI_IPC__ === "function";
}

export function getPlatform(target: RuntimeWindow = window as RuntimeWindow): AppPlatform {
  if (isTauriRuntime(target)) {
    tauriPlatform ??= createTauriPlatform();
    return tauriPlatform;
  }

  browserPlatform ??= createBrowserPlatform();
  return browserPlatform;
}

export { createBrowserPlatform, createTauriPlatform };
export type { AppPlatform } from "./types";
