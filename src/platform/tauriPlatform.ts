import type { InvoiceFile, MergeResult, ProgressPayload } from "@shared-types/index";
import type { AppPlatform, MergeInput, SourceSelection } from "./types";

type TauriApis = {
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
  convertFileSrc: (filePath: string) => string;
  open: (options: { directory: true; multiple: false }) => Promise<string | string[] | null>;
  listen: <T>(
    eventName: string,
    handler: (event: { payload: T }) => void
  ) => Promise<() => void>;
  readBinaryFile: (path: string) => Promise<Uint8Array>;
};

interface TauriPlatformDeps {
  loadApis?: () => Promise<TauriApis>;
}

async function loadTauriApis(): Promise<TauriApis> {
  const [{ invoke, convertFileSrc }, { open }, { listen }, { readBinaryFile }] = await Promise.all([
    import("@tauri-apps/api/tauri"),
    import("@tauri-apps/api/dialog"),
    import("@tauri-apps/api/event"),
    import("@tauri-apps/api/fs")
  ]);

  return { invoke, convertFileSrc, open, listen, readBinaryFile };
}

export function createTauriPlatform(deps: TauriPlatformDeps = {}): AppPlatform {
  const getApis = (() => {
    let promise: Promise<TauriApis> | null = null;
    return () => {
      promise ??= (deps.loadApis ?? loadTauriApis)();
      return promise;
    };
  })();

  let selectedFolderPath: string | null = null;

  return {
    kind: "tauri",
    async selectSource(): Promise<SourceSelection | null> {
      const { open, invoke } = await getApis();
      const folder = await open({ directory: true, multiple: false });
      if (!folder || Array.isArray(folder)) {
        return null;
      }

      const files = await invoke<InvoiceFile[]>("scan_folder_cmd", { folderPath: folder });
      selectedFolderPath = folder;
      return {
        folderLabel: folder,
        files
      };
    },
    async readFile(file: InvoiceFile): Promise<Uint8Array> {
      const { readBinaryFile } = await getApis();
      return readBinaryFile(file.path);
    },
    async imageUrl(file: InvoiceFile): Promise<string> {
      const { convertFileSrc } = await getApis();
      return convertFileSrc(file.path);
    },
    async merge(input: MergeInput, onProgress: (payload: ProgressPayload) => void): Promise<MergeResult> {
      if (!selectedFolderPath) {
        throw new Error("No folder selected");
      }

      const { invoke, listen } = await getApis();
      const unlisten = await listen<ProgressPayload>("merge-progress", (event) => {
        onProgress(event.payload);
      });

      try {
        return await invoke<MergeResult>("merge_invoices_cmd", {
          req: {
            folder_path: selectedFolderPath,
            files: input.files,
            sort_mode: "Custom",
            output_file_name: input.outputFileName?.trim() ? input.outputFileName.trim() : null
          }
        });
      } finally {
        unlisten();
      }
    },
    dispose(): void {
      selectedFolderPath = null;
    }
  };
}
